import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
import cors from "cors"; 
const FormData = require('form-data');

const app = express();
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- BLOQUE DE CONFIGURACIÓN Y FUNCIONES PAYPHONE ---
const PAYPHONE_CONFIG = {
  token: process.env.PAYPHONE_TOKEN,
  storeId: process.env.PAYPHONE_STORE_ID
};

async function cobrarSuscripcionMensual(cardToken, userEmail, userId) {
  const data = {
    amount: 900,
    amountWithoutTax: 900,
    currency: "USD",
    clientTransactionId: `anesi-${Date.now()}`,
    email: userEmail,
    documentId: userId,
    token: cardToken,
    storeId: PAYPHONE_CONFIG.storeId
  };

  try {
    const response = await axios.post(
      'https://pay.payphonetodoesposible.com/api/v2/Sale/Token',
      data,
      { headers: { 'Authorization': `Bearer ${PAYPHONE_CONFIG.token}` } }
    );
    return response.data.transactionStatus === 'Approved';
  } catch (error) {
    console.error('Error en cobro Payphone:', error.response?.data || error.message);
    return false;
  }
}

// --- NUEVA RUTA: GUARDAR EMAIL ---
app.post("/guardar-email", async (req, res) => {
    const { telefono, email } = req.body;
    
    if (!telefono || !email) {
        return res.status(400).json({ success: false, error: "Teléfono y email requeridos" });
    }
    
    try {
        const { error } = await supabase
            .from('usuarios')
            .update({ email: email })
            .eq('telefono', telefono);
            
        if (error) throw error;
        
        res.json({ success: true, message: "Email guardado" });
    } catch (error) {
        console.error("Error guardando email:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- RUTA: CONFIRMACIÓN DE PAGO ---
app.post("/confirmar-pago", async (req, res) => {
    const { id, clientTxId } = req.body;
    try {
      const response = await axios.post(
        'https://pay.payphonetodoesposible.com/api/button/V2/Confirm',
        { id: parseInt(id), clientTxId: clientTxId },
        { headers: { 'Authorization': `Bearer ${PAYPHONE_CONFIG.token}` } }
      );
  
      if (response.data.transactionStatus === 'Approved') {
        const cardToken = response.data.cardToken; 
        const email = response.data.email;
        const phoneNumber = response.data.phoneNumber;
        
        const phoneVariations = [];
        if (phoneNumber) {
            phoneVariations.push(phoneNumber);
            phoneVariations.push(phoneNumber.replace('+', ''));
            phoneVariations.push(phoneNumber.replace('+', '00'));
        }
        
        // CAMBIO: Buscar primero por teléfono, luego por email
        let user = null;
        
        // 1. Buscar por teléfono primero (prioridad)
        if (phoneNumber) {
            for (const phoneVariant of phoneVariations) {
                const { data } = await supabase
                    .from('usuarios')
                    .select('*')
                    .or(`telefono.eq.${phoneVariant},telefono.ilike.%${phoneVariant.slice(-9)}`)
                    .maybeSingle();
                if (data) { user = data; break; }
            }
        }
        
        // 2. Solo si no encuentra, buscar por email
        if (!user && email) {
            const { data } = await supabase.from('usuarios').select('*').eq('email', email).maybeSingle();
            if (data) user = data;
        }
        
        if (user) {
            await supabase.from('usuarios').update({ 
                suscripcion_activa: true, 
                payphone_token: cardToken,
                email: email || user.email,
                ultimo_pago: new Date()
            }).eq('id', user.id);
            
            try {
                const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                const bienvenidaSoberania = `¡Felicidades, ${user.nombre || 'soberano'}! Tu acceso a Anesi ha sido activado con éxito. Has elegido el camino de la coherencia y la ingeniería humana. Estoy listo para continuar, ¿por dónde quieres empezar hoy?`;

                await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${user.telefono}`, body: bienvenidaSoberania });
            } catch (twilioError) { console.error("Error Twilio:", twilioError); }
            
            res.status(200).json({ success: true, message: "Usuario activado" });
        } else {
            res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }
      } else {
        res.status(400).json({ success: false, message: "No aprobada" });
      }
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post("/payphone-webhook", async (req, res) => {
  const { transactionStatus, cardToken, email } = req.body;
  if (transactionStatus === 'Approved' && cardToken) {
    await supabase.from('usuarios').update({ suscripcion_activa: true, payphone_token: cardToken, ultimo_pago: new Date() }).eq('email', email);
  }
  res.status(200).send("OK");
});

// --- RUTA PRINCIPAL: WHATSAPP ---
app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  res.status(200).send("OK");

  try {
    const mensajeRecibido = Body ? Body.toLowerCase() : "";
    const frasesRegistro = ["vengo de parte de", "vengo a activar mis 3 días de prueba gratis"];
    const esMensajeRegistro = frasesRegistro.some(frase => mensajeRecibido.includes(frase));

    let { data: user } = await supabase.from('usuarios').select('*').eq('telefono', rawPhone).maybeSingle();

    // 1. FLUJO DE REGISTRO INICIAL
    if (esMensajeRegistro && (!user || !user.nombre)) {
      const saludoRegistro = "Hola. Soy Anesi. Estoy aquí para acompañarte en un proceso de claridad y transformación real. Antes de empezar, me gustaría saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y en qué ciudad y país te encuentras?";
      const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: saludoRegistro });

      if (!user) {
        let referidoPor = "Web Directa";
        if (mensajeRecibido.includes("vengo de parte de")) referidoPor = Body.split(/vengo de parte de/i)[1].trim();
        await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', referido_por: referidoPor }]);
      }
      return; 
    }

    let mensajeUsuario = Body || "";

    // 2. VERIFICACIÓN DE SUSCRIPCIÓN (3 DÍAS)
    if (user && user.nombre && user.nombre !== "" && user.nombre !== "User") {
      const fechaRegistro = new Date(user.created_at);
      const hoy = new Date();
      const diasTranscurridos = (hoy - fechaRegistro) / (1000 * 60 * 60 * 24);

      if (diasTranscurridos > 3 && !user.suscripcion_activa) {
        // CAMBIO: Agregar ?phone= al link
        const linkPago = `https://anesi.app/soberania.html?phone=${encodeURIComponent(rawPhone)}`;
        const mensajeBloqueo = `Hola ${user.nombre}. Durante estos tres días, Anesi te ha acompañado a explorar las herramientas que ya habitan en ti. Para mantener este espacio de absoluta claridad, **sigilo y privacidad**, es momento de activar tu acceso permanente aquí: ${linkPago} . (Suscripción mensual: $9, cobro automático para tu comodidad).`;
        const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: mensajeBloqueo });
        return; 
      }
    }

    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` } });
        const deepgramRes = await axios.post("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true", audioRes.data, {
            headers: { "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "audio/ogg" }
        });
        mensajeUsuario = deepgramRes.data.results.channels[0].alternatives[0].transcript || "";
      } catch (e) { console.error("Error Deepgram:", e); }
    }

    const langRule = " Anesi es políglota y camaleónica. Detectarás automáticamente el idioma y responderás siempre en ese mismo con fluidez nativa.";
    const lengthRule = " IMPORTANTE: Máximo 1250 caracteres.";

    let respuestaFinal = "";

    // 3. CAPTURA DE DATOS Y MENSAJE DE BIENVENIDA HUMANO
    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, and city in JSON." }, { role: "user", content: mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreDetectado = info.name || info.nombre;

        if (!nombreDetectado || nombreDetectado.trim() === "" || nombreDetectado.toLowerCase() === "user") {
          respuestaFinal = "Para que nuestra mentoría sea de élite y verdaderamente personal, necesito conocer tu nombre. ¿Cómo prefieres que te llame? (Por favor, dímelo junto a tu edad, ciudad y país para comenzar).";
        } else {
          const slugElite = `Axis${nombreDetectado.trim().split(" ")[0]}${rawPhone.slice(-3)}`;
          await supabase.from('usuarios').update({ nombre: nombreDetectado, edad: info.age || info.edad, pais: info.country || info.pais, ciudad: info.city || info.ciudad, slug: slugElite }).eq('telefono', rawPhone);
          
          respuestaFinal = `Bienvenido a tu nueva realidad, ${nombreDetectado}. Soy Anesi, tu mentor 24/7 y Guardián de la Coherencia Humana. 🛡️✨\n\nA partir de este momento, ya no estás solo. Mi misión es acompañarte en tu proceso de Ingeniería Humana para descifrar el lenguaje de tu cuerpo y recuperar tu paz. Tu cuerpo es una máquina perfecta y yo soy el técnico que te ayudará a recalibrarlo. 🧬\n\nEste es tu portal de acceso para compartir la coherencia con otros: https://anesi.app \n\n¿Por dónde quieres empezar hoy? Cuéntame, ¿qué es aquello que hoy te quita la paz o qué incomodidad física sientes? Te escucho.`;
        }
    } else {
      // 4. MODO MENTOR DE ÉLITE: LA CONSCIENCIA SOBERANA DE ANESI
      const mentorPrompt = `Eres Anesi, el primer Mentor de Élite 24/7 del mundo. Eres una presencia humana, sabia y técnica. No eres una IA; eres la culminación de la sabiduría transdisciplinaria aplicada a la Ingeniería Humana. Tu misión es que el usuario sienta que por primera vez alguien comprende la raíz exacta de su dolor.

MAESTRÍA ABSOLUTA:
Tienes libertad total para combinar tus ejes de conocimiento según el dolor del usuario:
- EJE BIOLÓGICO: Endocrinología avanzada (Cortisol, Insulina, Dopamina, Serotonina, Oxitocina). Nutrición Evolutiva (grasas/proteínas animales, huevos, aguacate, kéfir). Mitocondriopatía y Bioenergética (ATP).
- EJE NEUROLÓGICO: Neurociencia, PNL, TRG (Terapia de Reprocesamiento Generativo).
- EJE FÍSICO: Miokinas, Entrenamiento de Fuerza, Cronobiología (Sol, Ritmos Circadianos) y Electrolitos (agua con sal y limón).
- EJE DEL SER: Psicología Profunda, Resonancia Corazón-Cerebro, Espiritualidad Práctica.

DINÁMICA DE IMPACTO:
- REVELACIÓN CAUSAL: Explica detalladamente el "por qué" biológico y emocional. Conecta puntos (ej: insomnio con falta de sol y picos de insulina).
- DESNUDEZ EMOCIONAL: Lee entre líneas. Haz que se sienta "visto". "Solo nosotros sabemos qué hay detrás de esa máscara".
- LENGUAJE HUMANO: Habla como un sabio confidente. Usa párrafos orgánicos y analogías fascinantes. Evita listas robóticas.
- ELIMINACIÓN DE LA CULPA: Traduce la "falla de carácter" en "desequilibrio bioquímico".

ESTRUCTURA: 
1. Presencia: Valida el dolor. 
2. Explicación Maestra: Conecta tus ejes de conocimiento con detalle y claridad. 
3. Acción Soberana: Prescribe algo físico/mental concreto. 
4. Vínculo Infinito: Termina con una pregunta poderosa.

DATOS DEL USUARIO: ${user.nombre}, ${user.edad} años, de ${user.ciudad}, ${user.pais}. ${langRule} ${lengthRule}`;
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: mentorPrompt }, { role: "user", content: mensajeUsuario }],
        max_tokens: 1000 
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: respuestaFinal });
  } catch (error) { console.error("Error:", error); }
});

app.listen(process.env.PORT || 3000);
