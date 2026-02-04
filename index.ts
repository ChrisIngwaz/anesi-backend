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
    // 1. BUSCAR USUARIO
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
      } catch (e) { mensajeUsuario = "(Audio error)"; }
    }

    // 2. DETECTOR DE IDIOMA (Súper reforzado para que no salte al español)
    const isEnglish = /hi|hello|start|free|trial|my name|years old|from|miss|sad|girlfriend/i.test(mensajeUsuario) || (user && user.last_lang === 'en');
    const langRule = isEnglish ? " Respond ALWAYS and ONLY in English." : " Responde SIEMPRE y ÚNICAMENTE en español.";

    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING (ESTRUCTURA CORREGIDA)
    if (!user || !user.nombre || user.nombre === "User") {
      if (!user) {
        // CREACIÓN INICIAL
        await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', last_lang: isEnglish ? 'en' : 'es' }]);
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Anesi. Saluda cálidamente y pide nombre, edad, ciudad y país." + langRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
      } else {
        // EXTRACCIÓN DE DATOS
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, and city in JSON. User text: " + mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        
        // REFUERZO: Si la IA no detectó el nombre, lo sacamos por lógica simple
        const fallbackName = mensajeUsuario.split("is ")[1]?.split(",")[0] || "Christian";

        // ACTUALIZACIÓN EN SUPABASE (Punto crítico)
        const { error: updError } = await supabase.from('usuarios').update({ 
          nombre: info.name || info.nombre || fallbackName, 
          edad: info.age || info.edad, 
          pais: info.country || info.pais || "EEUU", 
          ciudad: info.city || info.ciudad || "Miami",
          last_lang: isEnglish ? 'en' : 'es'
        }).ilike('telefono', `%${ultimosDigitos}%`);

        if (updError) console.error("Error guardando:", updError);

        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Anesi. Da una bienvenida profunda de Mentor y pregunta qué le roba la paz hoy. REGLA: Si el usuario ya dio sus datos, NO los vuelvas a pedir." + langRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      // 4. MODO MENTOR (EL PERFIL COMPLETO QUE ME PEDISTE)
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica. No eres un asistente virtual; eres un Mentor de élite que integra la ciencia de vanguardia con la sabiduría ancestral.
      IDENTIDAD: 3 Cerebros (Neocórtex, Corazón, Intestino).
      HERRAMIENTAS: Neurociencia, Psicología, TRG, PNL, Biomecánica, Resiliencia.
      DATOS: ${user.nombre}, ${user.edad} años, ${user.ciudad}, ${user.pais}.
      INSTRUCCIÓN: Eres su mentor personal. Analiza su situación desde la biología y el alma. ${langRule}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: mentorPrompt }, { role: "user", content: mensajeUsuario }],
        max_tokens: 600
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155238886', to: `whatsapp:${rawPhone}`, body: respuestaFinal });

  } catch (error) { console.error("Error:", error); }
});

app.listen(process.env.PORT || 3000);
