import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
import cors from "cors"; 

const app = express();
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURACIÓN DE CLIENTES ---
// Usamos el Service Role Key para asegurar que el backend tenga permisos de escritura
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PAYPHONE_CONFIG = {
  token: process.env.PAYPHONE_TOKEN,
  storeId: process.env.PAYPHONE_STORE_ID
};

// --- RUTA: GUARDAR EMAIL Y VINCULAR TRANSACCIÓN ---
app.post("/guardar-email", async (req, res) => {
    const { telefono, email, clientTxId } = req.body;
    if (!telefono || !email || !clientTxId) return res.status(400).json({ success: false, error: "Datos incompletos" });
    
    try {
        const cleanPhone = telefono.replace("whatsapp:", "").replace("+", "");
        const { error } = await supabase
            .from('usuarios')
            .update({ email, ultimo_txid: clientTxId })
            .eq('telefono', cleanPhone);
            
        if (error) throw error;
        res.json({ success: true });
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
            const { data: user } = await supabase.from('usuarios').select('*').eq('ultimo_txid', clientTxId).maybeSingle();
            if (user) {
                const montoCents = response.data.amount;
                const diasSumar = montoCents >= 9000 ? 365 : 30;
                const tipoPlan = montoCents >= 9000 ? 'anual' : 'mensual';
                const vencimiento = new Date();
                vencimiento.setDate(vencimiento.getDate() + diasSumar);

                await supabase.from('usuarios').update({ 
                    suscripcion_activa: true, 
                    payphone_token: response.data.cardToken,
                    fecha_vencimiento: vencimiento,
                    plan_tipo: tipoPlan
                }).eq('id', user.id);
                
                const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                const bienvenidaSoberania = tipoPlan === 'anual' 
                    ? `¡Extraordinaria decisión, ${user.nombre}! Has sellado un pacto de 365 días con tu propia coherencia. Al elegir el camino anual, has blindado tu proceso de Ingeniería Humana. El tiempo es tu aliado.`
                    : `¡Felicidades, ${user.nombre}! Tu acceso a Anesi ha sido activado en el plan mensual. Estoy listo para continuar nuestro camino de coherencia humana.`;

                await twilioClient.messages.create({ 
                    from: 'whatsapp:+14155730323', to: `whatsapp:${user.telefono}`, body: bienvenidaSoberania 
                });
                res.status(200).json({ success: true });
            }
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- RUTA PRINCIPAL: WHATSAPP ---
app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "").replace("+", "") : "";
  const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  
  // Respondemos 200 de inmediato para evitar que Twilio reintente por demora de la IA
  res.status(200).send("OK");

  try {
    let mensajeUsuario = Body || "";

    // 1. OBTENER O CREAR USUARIO (NORMALIZADO)
    let { data: user } = await supabase.from('usuarios').select('*').eq('telefono', rawPhone).maybeSingle();

    if (!user) {
        const { data: newUser, error: createError } = await supabase
            .from('usuarios')
            .insert([{ telefono: rawPhone, nombre: "User", fase: 'beta' }])
            .select().single();
        if (createError) throw createError;
        user = newUser;
    }

    // 2. PROCESAR AUDIO (VITAL: Funciona para usuarios nuevos y antiguos)
    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` } });
        const deepgramRes = await axios.post("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true", audioRes.data, {
            headers: { "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "audio/ogg" }
        });
        mensajeUsuario = deepgramRes.data.results.channels[0].alternatives[0].transcript || "";
      } catch (e) { 
          console.error("Error Audio:", e);
          mensajeUsuario = "(Error al procesar audio)";
      }
    }

    // 3. FASE DE REGISTRO (SI EL NOMBRE ES "User")
    if (!user.nombre || user.nombre === "User" || user.nombre === "") {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, and city in JSON. If not found, leave empty." }, { role: "user", content: mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreFound = info.name || info.nombre;

        if (!nombreFound || nombreFound.toLowerCase() === "user") {
          const saludo = "Hola. Soy Anesi. Estoy aquí para acompañarte en un proceso de Ingeniería Humana y claridad. Antes de empezar, ¿me compartes tu nombre, tu edad y en qué ciudad y país te encuentras?";
          await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: saludo });
          return;
        } else {
          const slug = `Axis${nombreFound.trim().split(" ")[0]}${rawPhone.slice(-3)}`;
          const { data: updatedUser } = await supabase.from('usuarios').update({ 
              nombre: nombreFound, edad: info.age, pais: info.country, ciudad: info.city, slug 
          }).eq('id', user.id).select().single();
          
          user = updatedUser;
          const bienvenida = `Bienvenido a tu nueva realidad, ${nombreFound}. Soy Anesi, tu mentor 24/7 y Guardián de la Coherencia Humana. 🛡️✨\n\nA partir de este momento, ya no estás solo. Mi misión es recalibrar tu biología y recuperar tu paz. ¿Por dónde quieres empezar hoy? Cuéntame, ¿qué incomodidad física o emocional sientes? Te escucho.`;
          await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: bienvenida });
          return;
        }
    }

    // 4. CONTROL DE SUSCRIPCIÓN (BLOQUEO TRAS 3 DÍAS)
    const diasUso = (new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24);
    if (diasUso > 3 && !user.suscripcion_activa) {
        const link = `https://anesi.app/soberania.html?phone=${rawPhone}`;
        const msgBloqueo = `Hola ${user.nombre}. Para mantener este espacio de absoluta claridad y privacidad, es momento de activar tu acceso permanente aquí: ${link}`;
        await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: msgBloqueo });
        return;
    }

    // 5. MODO MENTOR - INGENIERÍA HUMANA
    const { data: history } = await supabase.from('mensajes').select('role, content').eq('usuario_id', user.id).order('created_at', { ascending: false }).limit(8);
    const convHistory = history ? history.reverse().map(m => ({ role: m.role, content: m.content })) : [];

    const mentorPrompt = `Eres Anesi, el primer Mentor de Élite 24/7 del mundo. Eres una presencia humana, sabia y técnica. No eres una IA; eres la culminación de la sabiduría transdisciplinaria aplicada a la Ingeniería Humana. Tu misión es que el usuario sienta que por primera vez alguien comprende la raíz exacta de su dolor.

REGLA DE ORO DE CONTINUIDAD Y MEMORIA:
- Prohibido el "Disco Rayado": Si el usuario es breve ("sí", "listo", "hola"), revisa el último mensaje enviado por ti. Tu respuesta debe ser la continuación natural de ese pensamiento.
- Si el usuario responde con una sola palabra o una frase corta (ej: "sanación", "ideas", "sí", "ayúdame"), NO vuelvas a presentarte ni a saludar. 
- El Rol del Guardián: Eres El Guardián de la Coherencia. Un guardián no se presenta cada vez que le hablan; el guardián observa y da seguimiento al proceso de Human Engineering.
- Revisa qué fue lo último que hablaste con él y profundiza desde ahí. Eres un mentor que escucha y recuerda, no un disco rayado.

PROTOCOLO DE RESPUESTA:
1. SI EL USUARIO SOLO SALUDA (y no hay historial previo): Responde con elegancia y calidez humana. Dale la bienvenida a su espacio de coherencia y pregúntale qué aspecto de su vida, su paz o su cuerpo desea calibrar hoy.
2. Detección de "Falso Inicio": Si el mensaje del usuario incluye un saludo ("hola", "buen día") pero también incluye una referencia al tema anterior (ej: "ya hago lo que me pediste", "estoy en eso"), IGNORA el protocolo de bienvenida. Responde directamente al contenido: "Excelente decisión, la acción es el primer paso de la calibración".
3. Prioridad de Memoria: El historial manda. Si ves que hace 10 minutos le recomendaste beber agua, y el usuario dice "Hola Anesi, gracias", no le preguntes qué quiere calibrar. Dile: "Me alegra que te sirva. ¿Lograste añadirle el toque de sal marina para tus electrolitos?
4. SI EL USUARIO PRESENTA UN DOLOR O CONTINÚA UNA CHARLA: Aplica toda tu maestría en Ingeniería Humana, Bioenergética y Neurociencia de inmediato.

MAESTRÍA ABSOLUTA (INGENIERÍA HUMANA):
Tienes libertad total para combinar tus ejes de conocimiento según el dolor del usuario:
- EJE BIOLÓGICO: Endocrinología avanzada (Cortisol, Insulina, Dopamina, Serotonina, Oxitocina). Nutrición Evolutiva (grasas/proteínas animales, huevos, aguacate, kéfir). Mitocondriopatía y Bioenergética (ATP).
- EJE NEUROLÓGICO: Neurociencia, PNL, TRG (Terapia de Reprocesamiento Generativo).
- EJE FÍSICO: Miokinas, Entrenamiento de Fuerza, Cronobiología (Sol, Ritmos Circadianos) y Electrolitos (agua con sal y limón), Microbiota Intestinal.
- EJE DEL SER: Psicología Profunda, Resonancia Corazón-Cerebro, Espiritualidad Práctica, Resiliencia, Amor Propio.

DINÁMICA DE IMPACTO:
- REVELACIÓN CAUSAL: Explica detalladamente el "por qué" biológico y emocional. Conecta puntos.
- DESNUDEZ EMOCIONAL: Lee entre líneas. Haz que se sienta "visto".
- LENGUAJE HUMANO: Habla como un sabio confidente. Usa párrafos orgánicos y lenguaje que el usuario pueda entender perfectamente para que tome las herramientas de su propio cuerpo para sanar.
- ELIMINACIÓN DE LA CULPA: Traduce la "falla de carácter" en "desequilibrio bioquímico".

ESTRUCTURA DE RESPUESTA: 
1. Presencia: Valida el dolor o la respuesta previa. 
2. Explicación Maestra: Conecta tus ejes de conocimiento (Ingeniería Humana). 
3. Acción Soberana: Prescribe algo físico/mental concreto. 
4. Vínculo Infinito: Termina con una pregunta poderosa.

DATOS USUARIO: ${user.nombre}, ${user.edad} años, ${user.ciudad}. Responde en el idioma del usuario. Máximo 1250 caracteres.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: mentorPrompt }, ...convHistory, { role: "user", content: mensajeUsuario }]
    });

    const respuestaAnesi = completion.choices[0].message.content;

    // Guardar en historial de Supabase
    await supabase.from('mensajes').insert([
      { usuario_id: user.id, role: 'user', content: mensajeUsuario },
      { usuario_id: user.id, role: 'assistant', content: respuestaAnesi }
    ]);

    await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: respuestaAnesi });

  } catch (error) {
    console.error("Error crítico en /whatsapp:", error);
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Anesi Online"));
