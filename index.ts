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
    // 1. Buscamos al usuario de forma exhaustiva
    const { data: usuario } = await supabase.from('usuarios').select('*').or(`telefono.eq.${userPhone},telefono.eq.+${userPhone}`).single();
    
    // Si no existe el usuario, no procesamos nada por privacidad
    if (!usuario) return res.status(200).send("OK");

    // 2. Extraemos el nombre y lo limpiamos
    const nombreUsuario = usuario.nombre || "amigo/a";

    let mensajeTexto = Body || "";

    if (MediaUrl0) {
      const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const response = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${twilioAuth}` }
      });
      
      const buffer = Buffer.from(response.data);
      const form = new FormData();
      form.append('file', buffer, { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const transcriptionRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });

      mensajeTexto = transcriptionRes.data.text || "";
    }

    // --- FILTRO DE SILENCIO / RUIDO ---
    const frasesAlucinadas = ["gracias por ver", "subtitles by", "gracias.", "thank you.", "de nada.", "hola.", "audio.", "descargar."];
    const esAlucinacion = frasesAlucinadas.some(f => mensajeTexto.toLowerCase().trim() === f);

    if (mensajeTexto.trim().length < 6 || esAlucinacion) {
      res.set("Content-Type", "text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>
            <Body>Hola ${nombreUsuario}. No pude escucharte bien. Si necesitas apoyo, envía un voice y explícame lo que estás sintiendo. ✨</Body>
          </Message>
        </Response>`);
    }

    // --- RESPUESTA PERSONALIZADA DE ANESI ---
    const mentorResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, el Mentor de los 3 Cerebros. Eres cálido y sabio. 
          IMPORTANTE: Dirígete siempre a ${nombreUsuario} por su nombre en tu respuesta. 
          Responde con compasión en máximo 2 frases. 
          Termina siempre con una de estas etiquetas: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
        },
        { role: "user", content: mensajeTexto }
      ]
    });

    const respuestaTextoRaw = mentorResponse.choices[0].message.content || "";
    let emocion = "neutro";
    const tU = respuestaTextoRaw.toUpperCase();
    if (tU.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (tU.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (tU.includes("IRA")) emocion = "ira";
    else if (tU.includes("TRISTEZA")) emocion = "tristeza";

    const audioUrl = AUDIOS_BETA[emocion];
    const mensajeLimpio = respuestaTextoRaw.replace(/\[.*?\]/g, "").trim();

    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${mensajeLimpio}</Body></Message>
        <Message><Media>${audioUrl}</Media></Message>
      </Response>`);

  } catch (error: any) {
    console.error("Error:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está recalibrando su energía. Intenta de nuevo.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Online"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0");
