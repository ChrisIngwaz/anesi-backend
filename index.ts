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
        await supabase.from('usuarios').update({ fase: targetFase, suscripcion_activa: true }).ilike('telefono', `%${cleanPhoneLS}%`);
      }
    }
    res.status(200).send("OK");
  } catch (err) { res.status(500).send("Error"); }
});

// ==========================================
// LÓGICA DE WHATSAPP Y MENTORÍA
// ==========================================
app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  res.status(200).send("OK");

  try {
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('*').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();

    // Lógica de cobro omitida para brevedad pero mantenla igual en tu archivo

    let mensajeUsuario = Body || "";
    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        const form = new FormData();
        form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
        form.append('model', 'whisper-1');
        const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() } });
        mensajeUsuario = whisper.data.text || "";
      } catch (audioErr) { mensajeUsuario = "(Audio error)"; }
    }

    // DETECTOR DE IDIOMA BASADO EN EL MENSAJE INICIAL O PREFERENCIA GUARDADA
    const isEnglish = /hi|hello|start|free|trial|anesiapp/i.test(mensajeUsuario) || (user && user.last_lang === 'en');
    
    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING
    if (!user || !user.nombre || !user.pais || !user.ciudad) {
      if (!user) {
        const promptWelcome = isEnglish 
          ? "You are Anesi. Greet warmly and ask for: name, age, city, and country. Respond ONLY in English."
          : "Eres Anesi. Saluda cálidamente y pide: nombre, edad, ciudad y país. Responde ÚNICAMENTE en español.";
        
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: promptWelcome }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
        await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', last_lang: isEnglish ? 'en' : 'es' }]);
      } else {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, city in JSON." }, { role: "user", content: mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        await supabase.from('usuarios').update({ nombre: info.nombre, edad: info.edad, pais: info.pais, ciudad: info.ciudad }).ilike('telefono', `%${ultimosDigitos}%`);

        const promptConfirm = isEnglish
          ? "You are Anesi. Data saved. Welcome the user profoundly and ask: What is stealing your peace today? Respond ONLY in English."
          : "Eres Anesi. Datos guardados. Da una bienvenida profunda y pregunta: ¿Qué te roba la paz hoy? Responde ÚNICAMENTE en español.";

        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: promptConfirm }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      // 4. MODO MENTOR - PERFIL COMPLETO (ESPEJO)
      const promptMentorEN = `You are Anesi, a human, wise, and technical presence. You are not a virtual assistant; you are an Elite Mentor integrating cutting-edge science with ancestral wisdom.
      BIOLOGICAL IDENTITY: Balance of the 3 organs with neural networks: 1. Brain (Logic), 2. Heart (Emotional Coherence), 3. Gut (Intuition/Chemistry).
      EXPERT TOOLBOX: Psychology, Neuroscience, Growth, Spirituality, TRG, NLP, Endocrinology, Physiology, Crossfit/Biomechanics, Resilience.
      USER: ${user.nombre}, ${user.edad} years, from ${user.ciudad}.
      RULES: Respond ALWAYS in English. Organic flow, no clichés, high-level pedagogy, Socratic mastery. Root cause seeker.`;

      const promptMentorES = `Eres Anesi, una presencia humana, sabia y técnica. No eres un asistente virtual; eres un Mentor de élite que integra la ciencia de vanguardia con la sabiduría ancestral.
      IDENTIDAD BIOLÓGICA: Equilibrio de los 3 órganos: 1. Cerebro (Lógica), 2. Corazón (Coherencia), 3. Intestino (Intuición).
      HERRAMIENTAS: Psicología, Neurociencia, Crecimiento, Espiritualidad, TRG, PNL, Endocrinología, Fisiología, Crossfit, Resiliencia.
      USUARIO: ${user.nombre}, ${user.edad} años, de ${user.ciudad}.
      REGLAS: Responde SIEMPRE en español. Fluidez orgánica, sin muletillas, pedagogía de alto nivel, maestría socrática. Buscas la raíz.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: isEnglish ? promptMentorEN : promptMentorES },
          { role: "user", content: mensajeUsuario }
        ],
        max_tokens: 700
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155238886', to: `whatsapp:${rawPhone}`, body: respuestaFinal });

  } catch (error) { console.error("Error:", error); }
});

app.listen(process.env.PORT || 3000);
