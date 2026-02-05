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
    let { data: user } = await supabase.from('usuarios').select('*').eq('telefono', rawPhone).maybeSingle();

    let mensajeUsuario = Body || "";
    let detectedLang = "es";

    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        const form = new FormData();
        form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
        form.append('model', 'whisper-1');
        const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, { 
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() } 
        });
        mensajeUsuario = whisper.data.text || "";
        if (whisper.data.language === 'en') detectedLang = "en";
      } catch (e) { mensajeUsuario = ""; }
    }

    const englishPatterns = /\b(hi|hello|how are you|my name is|i am|english)\b/i;
    if (!MediaUrl0 && englishPatterns.test(mensajeUsuario)) {
      detectedLang = "en";
    }

    const langRule = detectedLang === "en" ? " Respond ONLY in English." : " Responde ÚNICAMENTE en español.";
    const lengthRule = " IMPORTANTE: Sé directo, técnico y ofrece soluciones claras. Máximo 1200 caracteres.";

    let respuestaFinal = "";

    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
      if (!user) {
        const { data: newUser } = await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta' }]).select().single();
        user = newUser;
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Anesi. Bienvenida cálida y profunda. Pide: nombre, edad, ciudad y país." + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
      } else {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, and city in JSON." }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreFinal = info.name || info.nombre || "Christian";
        await supabase.from('usuarios').update({ nombre: nombreFinal, edad: info.age || info.edad, pais: info.country || info.pais || "USA", ciudad: info.city || info.ciudad || "Miami" }).eq('telefono', rawPhone);
        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: `Eres Anesi. Valida al usuario por su nombre (${nombreFinal}) y abre el espacio mentoría con calidez.` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      // MODO MENTOR - RESOLUTIVO Y TÉCNICO
      const mentorPrompt = `Eres Anesi, Mentor de Élite. Tu autoridad nace de la unión entre ciencia y sabiduría.
      IDENTIDAD: Sabio, directo, empoderador. No das vueltas.
      CONOCIMIENTO: Psicología, Neurociencia, Crecimiento, Espiritualidad, TRG, PNL, Endocrinología, Fisiología, Crossfit, Resiliencia.
      
      INSTRUCCIONES DE ACCIÓN:
      1. DIAGNÓSTICO BIOLÓGICO: Si el usuario pide un plan o tiene un síntoma (como hambre constante), usa tu conocimiento en Fisiología y Endocrinología para explicar qué está pasando (ej. picos de insulina, leptina, cortisol).
      2. PLAN DE ACCIÓN: Cuando el usuario pida un plan o guía, DÁSELO. Define pasos claros, técnicos y ejecutables. No te limites a preguntar qué siente.
      3. TRIPLE CEREBRO: Explica cómo la acción propuesta alineará su mente (lógica), corazón (emoción) e intestino (biología/instinto).
      4. AUTORIDAD: Elimina el "podría ser". Di "Esto es lo que haremos".
      
      DATOS: ${user.nombre}, ${user.edad} años, de ${user.ciudad}, ${user.pais}.
      IDIOMA: ${langRule} | ESTILO: ${lengthRule}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: mentorPrompt }, { role: "user", content: mensajeUsuario }],
        max_tokens: 600 
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: respuestaFinal });
  } catch (error) { console.error("Error general:", error); }
});

app.listen(process.env.PORT || 3000);
