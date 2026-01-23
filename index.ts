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

const AUDIOS: any = {
  agradecimiento: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/agradecimiento_v2.mp3",
  ansiedad: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ansiedad_v2.mp3",
  ira: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ira_v2.mp3",
  tristeza: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/tristeza_v2.mp3",
  neutro: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/neutro_v2.mp3"
};

// CAMBIO CRÍTICO: Usamos .post explícitamente para evitar el 404
app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  const phoneDigits = rawPhone.replace(/\D/g, "");

  try {
    // 1. BUSCAR NOMBRE (Probamos número completo y últimos 9 dígitos)
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .or(`telefono.eq.${rawPhone},telefono.eq.${phoneDigits},telefono.ilike.%${phoneDigits.slice(-9)}`)
      .maybeSingle();

    const nombreUser = usuario?.nombre || "corazón";
    let textoEscuchado = Body || "";

    // 2. PROCESAR AUDIO
    if (MediaUrl0) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const audioRes = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${auth}` }
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(audioRes.data), { filename: 'audio.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      textoEscuchado = whisper.data.text || "";
    }

    // 3. FILTRO DE SILENCIO / ALUCINACIONES
    const basura = ["bon appetit", "gracias", "thank you", "placer", "subtitles", "bye"];
    const esBasura = basura.some(b => textoEscuchado.toLowerCase().includes(b)) && textoEscuchado.length < 20;

    res.set("Content-Type", "text/xml");

    if (!textoEscuchado || textoEscuchado.length < 6 || esBasura) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response><Message><Body>Hola ${nombreUser}. No logré escucharte bien. Por favor, dime qué sientes. ✨</Body></Message></Response>`);
    }

    // 4. IA MENTOR
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de paz. Saluda por nombre a ${nombreUser}. Responde con compasión en 2 frases. NO uses "amigo/a". Etiqueta final: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
        },
        { role: "user", content: textoEscuchado }
      ]
    });

    const respuestaRaw = ai.choices[0].message.content || "";
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
        <Message><Media>${AUDIOS[emocion]}</Media></Message>
      </Response>`);

  } catch (error: any) {
    console.error("ERROR:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está recalibrando... Por favor intenta de nuevo.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Online"));
app.listen(process.env.PORT || 3000);
