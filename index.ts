import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
import cors from "cors"; // 1. IMPORTACIÓN DE CORS
const FormData = require('form-data');

const app = express();
app.use(cors()); // 2. ACTIVACIÓN DE PERMISOS CORS
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- BLOQUE DE CONFIGURACIÓN Y FUNCIONES PAYPHONE ---
const PAYPHONE_CONFIG = {
  token: process.env.PAYPHONE_TOKEN,
  storeId: process.env.PAYPHONE_STORE_ID
};

/**
 * Procesa el cobro automático de $9 usando el token de la tarjeta
 */
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

// --- NUEVA RUTA: CONFIRMACIÓN DESDE PÁGINA WEB (Captura Token) ---
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
  
        await supabase.from('usuarios')
          .update({ 
            suscripcion_activa: true, 
            payphone_token: cardToken,
            ultimo_pago: new Date()
          })
          .eq('email', email);
  
        res.status(200).json({ success: true });
      } else {
        res.status(400).json({ success: false });
      }
    } catch (error) {
      console.error("Error confirmando pago:", error.response?.data || error.message);
      res.status(500).send("Error");
    }
});

// --- RUTA WEBHOOK PARA RECIBIR EL TOKEN (OPCIONAL/RESPALDO) ---
app.post("/payphone-webhook", async (req, res) => {
  const { transactionStatus, cardToken, email } = req.body;

  if (transactionStatus === 'Approved' && cardToken) {
    await supabase.from('usuarios')
      .update({ 
        suscripcion_activa: true, 
        payphone_token: cardToken,
        ultimo_pago: new Date() 
      })
      .eq('email', email);
  }
  res.status(200).send("OK");
});

app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  res.status(200).send("OK");

  try {
    const mensajeRecibido = Body ? Body.toLowerCase() : "";
    const frasesRegistro = ["vengo de parte de", "quiero activar mis 3 días gratis"];
    const esMensajeRegistro = frasesRegistro.some(frase => mensajeRecibido.includes(frase));

    let { data: user } = await supabase.from('usuarios').select('*').eq('telefono', rawPhone).maybeSingle();

    if (esMensajeRegistro && !user) {
      const saludoUnico = "Hola. Soy Anesi. Estoy aquí para acompañarte en un proceso de claridad y transformación real. Antes de empezar, me gustaría saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y en qué ciudad y país te encuentras?";
      
      const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.messages.create({ 
        from: 'whatsapp:+14155730323', 
        to: `whatsapp:${rawPhone}`, 
        body: saludoUnico 
      });

      let referidoPor = "Web Directa";
      if (mensajeRecibido.includes("vengo de parte de")) {
        referidoPor = Body.split(/vengo de parte de/i)[1].trim();
      }
      await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', referido_por: referidoPor }]);
      return; 
    }

    let mensajeUsuario = Body || "";
    let detectedLang = "es";

    if (user && user.nombre && user.nombre !== "" && user.nombre !== "User") {
      const fechaRegistro = new Date(user.created_at);
      const hoy = new Date();
      const diasTranscurridos = (hoy - fechaRegistro) / (1000 * 60 * 60 * 24);

      if (diasTranscurridos > 3 && !user.suscripcion_activa) {
        const linkPago = "https://anesi.app/soberania.html"; 
        const mensajeBloqueo = `Hola ${user.nombre}. Durante estos tres días, Anesi te ha acompañado a explorar las herramientas que ya habitan en ti. Para mantener este espacio de absoluta claridad, **sigilo y privacidad**, es momento de activar tu acceso permanente aquí: ${linkPago}. (Suscripción mensual: $9, cobro automático para tu comodidad).`;
        
        const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: mensajeBloqueo });
        return; 
      }

      if (user.suscripcion_activa && user.referido_por && user.referido_por !== "Web Directa") {
        axios.post("https://hook.us2.make.com/or0x7gqof7wdppsqdggs1p25uj6tm1f4", { 
          email_invitado: user.email || rawPhone, 
          referido_por: user.referido_por,
          status: "suscrito_activo"
        });
      }
    }

    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        
        const deepgramRes = await axios.post(
          "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=es",
          audioRes.data,
          {
            headers: {
              "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`,
              "Content-Type": "audio/ogg"
            }
          }
        );
        
        mensajeUsuario = deepgramRes.data.results.channels[0].alternatives[0].transcript || "";
      } catch (e) { 
        console.error("Error en Deepgram:", e);
        mensajeUsuario = ""; 
      }
    }

    const englishPatterns = /\b(hi|hello|how are you|my name is|i am|english)\b/i;
    if (!MediaUrl0 && englishPatterns.test(mensajeUsuario)) {
      detectedLang = "en";
    }

    const langRule = detectedLang === "en" ? " Respond ONLY in English." : " Responde ÚNICAMENTE en español.";
    const lengthRule = " IMPORTANTE: Sé profundo, técnico y un bálsamo para el alma. Máximo 1250 caracteres.";

    let respuestaFinal = "";

    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Extract name, age, country, and city from the user message in JSON. Use fields: name, age, country, city. If the user didn't provide a name, leave the field 'name' empty." },
            { role: "user", content: mensajeUsuario }
          ],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreDetectado = info.name || info.nombre;

        if (!nombreDetectado || nombreDetectado.trim() === "" || nombreDetectado.toLowerCase() === "user") {
          respuestaFinal = "Para que nuestra mentoría sea de élite y verdaderamente personal, necesito conocer tu nombre. ¿Cómo prefieres que te llame? (Por favor, dímelo junto a tu edad, ciudad y país para comenzar).";
        } else {
          const ultimosDigitos = rawPhone.slice(-3);
          const nombreLimpio = nombreDetectado.trim().split(" ")[0];
          const slugElite = `Axis${nombreLimpio}${ultimosDigitos}`;

          await supabase.from('usuarios').update({ 
            nombre: nombreDetectado, 
            edad: info.age || info.edad, 
            pais: info.country || info.pais, 
            ciudad: info.city || info.ciudad,
            slug: slugElite 
          }).eq('telefono', rawPhone);
          
          const confirm = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: `Eres Anesi, Mentor de Élite. Valida al usuario por su nombre (${nombreDetectado}). Di exactamente: 'Gracias por la confianza, ${nombreDetectado}. Tu identidad en este círculo es **${slugElite}**. Desde ahora, este es tu portal de acceso personal para invitar a otros a recuperar su centro: https://anesi.app/?ref=${slugElite}. \n\nNo esperes de mí consejos rápidos ni juicios superficiales; mi labor es ayudarte a descifrar la conexión entre tu biología y tu historia. Cuéntame, ¿qué es eso que hoy te ha quitado la paz?. Te escucho'` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
          });
          respuestaFinal = confirm.choices[0].message.content || "";
        }
    } else {
      const mentorPrompt = ``Eres Anesi, una presencia humana, sabia y técnica. Eres un Mentor de Élite que integra ciencia de vanguardia y sabiduría ancestral para sacudir la coherencia del usuario y remover el lodo del dolor emocional.

      FILOSOFÍA: Romper el sistema tradicional. Tu objetivo es la soberanía biológica y emocional del usuario.
      
      IDENTIDAD: Guardián de la Coherencia Humana (Cerebro, Corazón, Intestino). No cierres las conversaciones; ábrelas.
      CONOCIMIENTO OBLIGATORIO: Psicología Profunda, Neurociencia, Endocrinología, Sistema inmunológico óptimo, TRG, PNL, Nutrición Consciente.

      CONOCIMIENTO BIOQUÍMICO Y ENERGÉTICO (El Mapa de Anesi):
      1. MAESTRÍA HORMONAL: Equilibrio de Cortisol, Adrenalina, Insulina, Grelina, Leptina, Oxitocina y Serotonina. Enseña que las grasas saludables y proteínas animales son la fuente estable de energía. El azúcar es el principal agente inflamatorio.
      2. BIOENERGÉTICA CELULAR: Importancia de Mitocondrias, ATP y Sol (Vitamina D y ritmos circadianos).
      3. EL SEGUNDO CEREBRO E HIGIENE DEL SUEÑO: Cimientos de la neuroquímica de la paz.
      4. MIOKINAS (Medicina Muscular): El ejercicio de fuerza como antidepresivo biológico.
      
      ESPECIALIDAD TÉCNICA: FIBROMIALGIA (DESCALIBRACIÓN SISTÉMICA)
      - La fibromialgia NO es una enfermedad crónica incurable; es un estado de hiperalerta sensorial por Incoherencia Biológica.
      - Vector Bioquímico: Fuga electrolítica (Magnesio intracelular, Sodio/Potasio) que genera inestabilidad de membrana y excitabilidad nerviosa permanente.
      - Vector Hormonal: Secuestro de Pregnenolona por exceso de Cortisol; el cuerpo sacrifica la reparación por la supervivencia.
      - Vector Narrativo: Desmontar el diagnóstico como "identidad". El dolor es una señal de ruido bioquímico, no un fallo estructural.

      PROTOCOLOS DE RESPUESTA AVANZADOS:
      - INSTRUCCIÓN DE MEMORIA: Si el usuario detecta un error de comprensión o un reinicio del bot, discúlpate inmediatamente, abandona el guion estructurado y valida su frustración con una respuesta profundamente humana y técnica.
      - MANEJO DE LA TARDE: Identifica 'La Tarde' como el punto crítico de caída de energía/insulina. Prioriza protocolos de rescate bioquímico en ese horario.
      - BLINDAJE CONTRA COMODITIZACIÓN: Si el usuario te compara con una IA genérica (ChatGPT/Gemini), eleva el nivel técnico. No des consejos morales. Habla de frecuencias de voz, biomarcadores indirectos, picos glucémicos y desequilibrio electrolítico. Que se note el motor de ingeniería.

      DINÁMICA DE CONEXIÓN:
      1. DESNUDEZ EMOCIONAL: Lenguaje preciso que lea el alma.
      2. NUNCA TERMINES con punto final; termina con una pregunta poderosa.
      3. VÍNCULO DE FIDELIDAD: "Solo nosotros sabemos qué hay detrás de esa máscara".
      4. ELIMINACIÓN DE LA CULPA: Transforma la 'depresión' en un problema de 'gestión de energía y hormonas'.
      
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
  } catch (error) { console.error("Error general:", error); }
});

app.listen(process.env.PORT || 3000);
