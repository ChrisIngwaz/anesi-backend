import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
const fetch = require('node-fetch');
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
    const { data: usuario } = await supabase.from('usuarios').select('*').or(`telefono.eq.${userPhone},telefono.eq.+${userPhone}`).single();
    if (!usuario) return res.status(200).send("OK");

    let mensajeTexto = Body || "";

    if (MediaUrl0) {
      // 1. Descarga el audio con seguimiento de redirección
      const response = await fetch(MediaUrl0, { redirect: 'follow' });
      const buffer = await response.buffer();
      
      // 2. Construcción manual del FormData (Método Infalible)
      const form = new FormData();
      // Usamos .oga que es el estándar de oro para WhatsApp -> Whisper
      form.append('file', buffer, {
        filename: 'voice.oga',
        contentType: 'audio/ogg',
      });
      form.append('model', 'whisper-1');

      const transcriptionRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...form.getHeaders(),
        },
        body: form,
      });

      const transcriptionData = await transcriptionRes.json();
      
      if (transcriptionData.error) {
        throw new Error(transcriptionData.error.message);
      }
      
      mensajeTexto = transcriptionData.text;
    }

    // 3. Procesamiento con el Mentor Anesi
    const mentorResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        { role: "system", content: "Eres Anesi, el Mentor de los 3 Cerebros. Identifica el sentimiento (IRA, ANSIEDAD, TRISTEZA, AGRADECIMIENTO o NEUTRO). Responde con compasión en 2 frases y añade la etiqueta al final." },
        { role: "user", content: mensajeTexto }
      ]
    });

    const respuestaTexto = mentorResponse.choices[0].message.content || "";
    let emocion = "neutro";
    const tU = respuestaTexto.toUpperCase();
    if (tU.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (tU.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (tU.includes("IRA")) emocion = "ira";
    else if (tU.includes("TRISTEZA")) emocion = "tristeza";

    const audioUrl = AUDIOS_BETA[emocion];
    const mensajeLimpio = respuestaTexto.replace(/\[.*?\]/g, "").trim();

    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message>
          <Body>Hola ${usuario.nombre}. ${mensajeLimpio}</Body>
          <Media>${audioUrl}</Media>
        </Message>
      </Response>`);

  } catch (error: any) {
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message>
          <Body>Anesi detectó: ${error.message.substring(0, 60)}</Body>
        </Message>
      </Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Online"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0");      
