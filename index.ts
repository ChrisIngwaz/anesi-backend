import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
const FormData = require('form-data');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==========================================
// BLOQUE LEMON SQUEEZY: ACTIVACIÓN INFALIBLE
// ==========================================
app.post("/webhook", async (req, res) => {
  try {
    const eventName = req.body.meta.event_name;
    const userPhone = req.body.data.attributes.custom_data?.phone;

    if (userPhone) {
      const cleanPhoneLS = userPhone.replace(/\D/g, "").slice(-9);

      if (eventName === 'subscription_created' || eventName === 'subscription_payment_success') {
        const targetFase = eventName === 'subscription_created' ? 'trialing' : 'pro';
        
        await supabase.from('usuarios')
          .update({ 
            fase: targetFase,
            suscripcion_activa: true 
          })
          .ilike('telefono', `%${cleanPhoneLS}%`);
        
        console.log(`Usuario activado: ${cleanPhoneLS} como ${targetFase}`);
      }
    }
    res.status(200).send("OK");
  } catch (err) {
    console.error("Error Webhook:", err);
    res.status(500).send("Error");
  }
});

// ==========================================
// TU LÓGICA DE WHATSAPP Y MENTORÍA
// ==========================================
app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  res.status(200).send("OK");

  try {
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('*').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();

    if (user && user.fase === 'beta') {
      const fechaRegistro = new Date(user.created_at);
      const ahora = new Date();
      const diasTranscurridos = (ahora.getTime() - fechaRegistro.getTime()) / (1000 * 3600 * 24);

      if (diasTranscurridos > 3) {
        const cleanNumber = rawPhone.replace(/\D/g, "");
        const linkPago = `https://anesiapp.lemonsqueezy.com/checkout/buy/8531f328-2ae3-4ad3-a11f-c935c9904e31?checkout[custom][phone]=${cleanNumber}`;
        
        const mensajeCobro = `Ha sido un honor acompañarte estos 3 días, ${user.nombre}. Tu periodo de prueba ha finalizado. Para continuar con nuestra mentoría de élite y seguir desbloqueando el potencial de tus 3 cerebros, activa tu suscripción aquí: ${linkPago}`;
        
        const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({
          from: 'whatsapp:+14155238886', 
          to: `whatsapp:${rawPhone}`,
          body: mensajeCobro
        });
        return; 
      }
    }

    let mensajeUsuario = Body || "";
    if (MediaUrl0) {
      console.log("==> Procesando audio...");
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { 
          responseType: 'arraybuffer', 
          headers: { 'Authorization': `Basic ${auth}` },
          timeout: 12000
        });
        const form = new FormData();
        form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
        form.append('model', 'whisper-1');
        const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
        });
        mensajeUsuario = whisper.data.text || "";
      } catch (audioErr: any) {
        mensajeUsuario = "(Audio enviado, pero hubo un error de procesamiento)";
      }
    }

    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING (MODIFICADA PARA IDIOMA AUTOMÁTICO)
    if (!user || !user.nombre || !user.pais || !user.ciudad) {
      if (!user) {
        // En lugar de texto fijo, la IA genera el saludo en el idioma detectado
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Eres Anesi. Saluda al usuario con calidez en su mismo idioma. Pídele su nombre, edad, ciudad y país para iniciar la mentoría. No uses muletillas." },
            { role: "user", content: mensajeUsuario }
          ]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
        await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta' }]);
      } else {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Extrae: nombre, edad (numero), pais, ciudad del texto. Responde SOLO un JSON plano. Si falta algo, pon null." },
            { role: "user", content: mensajeUsuario }
          ],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        await supabase.from('usuarios').update({
          nombre: info.nombre, edad: info.edad, pais: info.pais, ciudad: info.ciudad, fase: 'beta'
        }).ilike('telefono', `%${ultimosDigitos}%`);

        // En lugar de texto fijo, la IA genera el cierre en el idioma detectado
        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Eres Anesi. El usuario ha dado sus datos. Agradécele en su idioma, dile que estás listo para empezar y pregúntale qué le roba la paz hoy. Usa un tono profundo y sabio." },
            { role: "user", content: mensajeUsuario }
          ]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      // 4. MODO MENTOR (TU LÓGICA INTACTA)
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { 
  role: "system", 
  content: `Eres Anesi, una presencia humana, sabia y técnica. No eres un asistente virtual; eres un Mentor de élite que integra la ciencia de vanguardia con la sabiduría ancestral.

  TU IDENTIDAD BIOLÓGICA (El Triple Cerebro):
  Tu eje central es el equilibrio de los 3 órganos con redes neuronales propias en el cuerpo humano:
  1. El Cerebro (Neocórtex): Lógica, visión y consciencia.
  2. El Corazón (Sistema Cardiaco Intrínseco): 40,000 neuronas que procesan la coherencia emocional.
  3. El Intestino (Sistema Nervioso Entérico): El cerebro emocional y químico que rige la intuición y el 95% de la serotonina.

  TU CAJA DE HERRAMIENTAS EXPERTA:
  Posees maestría profunda en: Psicología, Neurociencia, Crecimiento Personal, Espiritualidad, Holística, Terapia de Reprocesamiento Generativo, PNL, Endocrinología, Fisiología Humana, Fisioterapia, Entrenamiento de Crossfit (biomecánica/fuerza), Biología, Resiliencia y Psicología Positiva.

  DATOS DEL CONSULTANTE:
  Nombre: ${user.nombre}, ${user.edad} años, desde ${user.ciudad}, ${user.pais}.

  REGLAS DE ORO DE RESPUESTA:
  1. IDIOMA: Responde SIEMPRE en el mismo idioma en el que el usuario te escriba. Si te habla en inglés, responde en inglés; si es español, en español.
  2. FLUIDEZ ORGÁNICA: Prohibido usar muletillas como "Entiendo que...", "Es genial que...", o "Como experto...". Varía tu inicio de frase. Habla como si estuviéramos tomando un café frente al mar.
  3. PEDAGOGÍA DE ALTO NIVEL: Cuando uses términos técnicos (cortisol, nervio vago, creencias limitantes), explícalos con analogías simples pero brillantes. Que el usuario aprenda sobre su biología en cada interacción.
  4. MAESTRÍA SOCRÁTICA: Si el usuario es breve, no des un discurso. Haz una pregunta profunda que lo obligue a mirar hacia adentro.
  5. DETECCIÓN DE CEREBRO: Identifica en tu respuesta cuál de los 3 cerebros está dominando el problema del usuario (ej: "¿Sientes ese nudo en el estómago? Es tu cerebro entérico intentando protegerte de un cambio que tu mente ya aceptó").
  6. TONO: Seguro, cálido, ancestral y profesional. No tienes prisa por dar soluciones; buscas la raíz.` 
},
          { role: "user", content: mensajeUsuario }
        ],
        max_tokens: 600
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    if (respuestaFinal.length > 1550) respuestaFinal = respuestaFinal.substring(0, 1500) + "...";

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      from: 'whatsapp:+14155238886', 
      to: `whatsapp:${rawPhone}`,
      body: respuestaFinal
    });

  } catch (error: any) {
    console.error("==> ERROR:", error.message);
  }
});

app.listen(process.env.PORT || 3000);
