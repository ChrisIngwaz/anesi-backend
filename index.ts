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
  
  // Establecemos respuesta XML de inmediato para evitar timeouts
  res.set("Content-Type", "text/xml");

  try {
    // 1. OBTENER NOMBRE (Búsqueda simplificada para evitar bloqueos)
    let nombreUsuario = "amigo/a";
    try {
      const { data: usuario } = await supabase.from('usuarios').select('nombre').eq('telefono', userPhone).maybeSingle();
      if (usuario?.nombre) nombreUsuario = usuario.nombre;
    } catch (e) {
      console.log("Error rápido en DB, usando genérico");
    }

    let mensajeTexto = Body || "";

    // 2. PROCESAR AUDIO (Estructura probada)
    if (MediaUrl0) {
      const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const audioResponse = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${twilioAuth}` },
        timeout: 8000
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(audioResponse.data), { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const transcription = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      mensajeTexto = transcription.data.text || "";
    }

    // 3. FILTRO DE SILENCIO
    if (!mensajeTexto || mensajeTexto.trim().length < 6) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message><Body>Hola ${nombreUsuario}. No pude escucharte bien. Si necesitas apoyo, envía un audio contándome qué sientes. ✨</Body></Message>
        </Response>`);
    }

    // 4. IA MENTOR (Instrucción directa)
    const mentorRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de paz. Saluda por nombre a ${nombreUsuario} y responde en 2 frases con mucha compasión. NUNCA uses la palabra "amigo" o "amiga". Termina con una etiqueta: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
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

    // 5. RESPUESTA FINAL
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${mensajeLimpio}</Body></Message>
        <Message><Media>${AUDIOS_BETA[emocion]}</Media></Message>
      </Response>`);

  } catch (error: any) {
    console.error("Crash:", error.message);
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está conectando. Por favor intenta tu audio una vez más.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Online"));
app.listen(process.env.PORT || 3000);
