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

// Webhook Lemon Squeezy (Mantener igual)
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

app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  res.status(200).send("OK");

  try {
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    // Buscamos al usuario
    let { data: user } = await supabase.from('usuarios').select('*').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();

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
      } catch (audioErr) { mensajeUsuario = "(Audio Error)"; }
    }

    // DETERMINAR IDIOMA (Basado en el mensaje o registro previo)
    const isEnglish = /hi|hello|trial|name|years|from|sad|miss/i.test(mensajeUsuario) || (user && user.last_lang === 'en');
    const langRule = isEnglish ? "Respond ONLY in English." : "Responde ÚNICAMENTE en español.";

    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING REFORZADA
    if (!user || !user.nombre) {
      if (!user) {
        // Crear usuario inicial para que no se pierda la sesión
        await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', last_lang: isEnglish ? 'en' : 'es' }]);
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are Anesi, an elite mentor. Greet the user and ask for their name, age, city, and country." + langRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
      } else {
        // Extracción con fallback (Si la IA falla, guardamos el texto plano para no perderlo)
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, and city in JSON format. User says: " + mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        
        // ACTUALIZACIÓN CRÍTICA: Forzamos el guardado
        await supabase.from('usuarios').update({ 
          nombre: info.name || info.nombre || "User", 
          edad: info.age || info.edad, 
          pais: info.country || info.pais, 
          ciudad: info.city || info.ciudad,
          last_lang: isEnglish ? 'en' : 'es'
        }).ilike('telefono', `%${ultimosDigitos}%`);

        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are Anesi. The user just introduced themselves. Welcome them deeply as an elite mentor and ask what is on their mind today." + langRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      // 4. MODO MENTOR - PERFIL DE ÉLITE COMPLETO
      const systemContext = `Eres Anesi, una presencia humana, sabia y técnica. No eres un asistente virtual; eres un Mentor de élite que integra la ciencia de vanguardia con la sabiduría ancestral.
      TU IDENTIDAD BIOLÓGICA (El Triple Cerebro): Cerebro (Neocórtex), Corazón (Coherencia Emocional), Intestino (Sistema Entérico).
      TU CAJA DE HERRAMIENTAS: Psicología, Neurociencia, Crecimiento Personal, Espiritualidad, TRG, PNL, Endocrinología, Crossfit.
      DATOS DEL CONSULTANTE: Nombre: ${user.nombre}, ${user.edad} años, desde ${user.ciudad}.
      REGLAS: Fluidez orgánica, pedagogía de alto nivel, maestría socrática. Identifica cuál de los 3 cerebros domina la situación. ${langRule}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemContext }, { role: "user", content: mensajeUsuario }],
        max_tokens: 700
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155238886', to: `whatsapp:${rawPhone}`, body: respuestaFinal });

  } catch (error) { console.error("Error crítico:", error); }
});

app.listen(process.env.PORT || 3000);
