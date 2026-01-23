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

const AUDIOS_BETA: any = {
  agradecimiento: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/agradecimiento_v2.mp3",
  ansiedad: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ansiedad_v2.mp3",
  ira: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ira_v2.mp3",
  tristeza: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/tristeza_v2.mp3",
  neutro: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/neutro_v2.mp3"
};

app.all("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const userPhone = From ? From.replace(/\D/g, "") : "";

  try {
    // 1. Buscamos al usuario de la forma más rápida
    const { data: usuario } = await supabase.from('usuarios').select('nombre').or(`telefono.eq.${userPhone},telefono.eq.+${userPhone}`).single();
    
    // Si no existe, enviamos OK para que Twilio no reintente eternamente
    if (!usuario) return res.status(200).send("OK");
    
    const nombreUsuario = usuario.nombre || "amigo/a";
    let mensajeTexto = Body || "";

    // 2. Procesar el Audio (Esto ya funcionaba)
    if (MediaUrl0) {
      const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const audioResponse = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${twilioAuth}` }
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(audioResponse.data), { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const transcription = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      mensajeTexto = transcription.data.text || "";
    }

    // 3. Filtro de Silencio (Si el mensaje es muy corto, pedimos apoyo)
    if (mensajeTexto.trim().length < 7) {
      res.set("Content-Type", "text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message><Body>Hola ${nombreUsuario}. No pude escucharte bien. Si necesitas apoyo, envía un voice y explícame lo que estás sintiendo. ✨</Body></Message>
        </Response>`);
    }

    // 4. Respuesta de Anesi (Inyectando el nombre)
    const mentorRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de los 3 Cerebros. Responde a ${nombreUsuario} con paz y brevedad (2 frases). DEBES usar su nombre ${nombreUsuario}. Etiqueta final: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
        },
        { role: "user", content: mensajeTexto }
      ]
    });

    const respuestaRaw = mentorRes.choices[0].message.content || "";
    let emocion = "neutro";
    if (respuestaRaw.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (respuestaRaw.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (respuestaRaw.includes("IRA")) emocion = "ira";
    else if (respuestaRaw.includes("TRISTEZA")) emocion = "tristeza";

    const mensajeLimpio = respuestaRaw.replace(/\[.*?\]/g, "").trim();

    // 5. Respuesta TwiML (Dos mensajes para asegurar texto + audio)
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${mensajeLimpio}</Body></Message>
        <Message><Media>${AUDIOS_BETA[emocion]}</Media></Message>
      </Response>`);

  } catch (error: any) {
    console.error("Error:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está conectando... Intenta tu audio de nuevo.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Activo"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0");
