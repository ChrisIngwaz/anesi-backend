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

app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  res.status(200).send("OK");

  try {
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('*').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();

    let mensajeUsuario = Body || "";
    // Manejo de audio (Whisper) - Mantenlo igual que en tu archivo original
    if (MediaUrl0) {
        try {
          const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
          const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
          const form = new FormData();
          form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
          form.append('model', 'whisper-1');
          const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() } });
          mensajeUsuario = whisper.data.text || "";
        } catch (e) { mensajeUsuario = ""; }
    }

    // DETECCIÓN DE IDIOMA EN TIEMPO REAL (Solución al fallo de la imagen)
    const isEnglish = /hi|hello|start|free|trial|my name|years old|from/i.test(mensajeUsuario) || (user && user.last_lang === 'en');
    const langSuffix = isEnglish ? " Respond ONLY in English." : " Responde ÚNICAMENTE en español.";

    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING (PERFIL COMPLETO)
    if (!user || !user.nombre || !user.pais || !user.ciudad) {
      if (!user) {
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Anesi, un Mentor de élite. Saluda y pide nombre, edad, ciudad y país." + langSuffix }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
        await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', last_lang: isEnglish ? 'en' : 'es' }]);
      } else {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, city in JSON. Important: If user says 'Miami, Florida', country is 'USA' and city is 'Miami'." }, { role: "user", content: mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        
        // Actualizamos datos y el idioma detectado
        await supabase.from('usuarios').update({ 
            nombre: info.nombre || user.nombre, 
            edad: info.edad || user.edad, 
            pais: info.pais || user.pais, 
            ciudad: info.ciudad || user.ciudad,
            last_lang: isEnglish ? 'en' : 'es' 
        }).ilike('telefono', `%${ultimosDigitos}%`);

        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Anesi. Confirma que tienes los datos, da una bienvenida profunda de mentor y pregunta qué le roba la paz hoy." + langSuffix }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      // 4. MODO MENTOR - EL PERFIL COMPLETO QUE TENÍAS
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica. No eres un asistente virtual; eres un Mentor de élite que integra la ciencia de vanguardia con la sabiduría ancestral.
      TU IDENTIDAD BIOLÓGICA: Equilibrio de los 3 órganos (Cerebro, Corazón, Intestino).
      TU CAJA DE HERRAMIENTAS: Psicología, Neurociencia, Crecimiento Personal, Espiritualidad, TRG, PNL, Endocrinología, Fisiología, Crossfit, Resiliencia.
      DATOS: ${user.nombre}, ${user.edad} años, ${user.ciudad}, ${user.pais}.
      REGLAS: Fluidez orgánica, pedagogía de alto nivel, maestría socrática, identifica qué cerebro domina el problema.` + langSuffix;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: mentorPrompt }, { role: "user", content: mensajeUsuario }],
        max_tokens: 600
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155238886', to: `whatsapp:${rawPhone}`, body: respuestaFinal });

  } catch (error) { console.error(error); }
});

app.listen(process.env.PORT || 3000);
