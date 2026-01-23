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
  const phoneFull = From ? From.replace("whatsapp:", "") : ""; // Ej: +593987654321
  const phoneDigits = phoneFull.replace(/\D/g, ""); // Ej: 593987654321
  const phoneShort = phoneDigits.slice(-9); // Ej: 987654321 (últimos dígitos)

  try {
    // 1. BUSQUEDA TRIPLE DE USUARIO (Para que no falle el nombre)
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .or(`telefono.eq.${phoneFull},telefono.eq.${phoneDigits},telefono.ilike.%${phoneShort}`)
      .maybeSingle();

    const nombreFinal = usuario?.nombre || "corazón";

    // 2. DESCARGA Y TRANSCRIPCIÓN (Con límite de tiempo estricto)
    let mensajeTexto = Body || "";

    if (MediaUrl0) {
      const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      
      const response = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${twilioAuth}` },
        timeout: 7000 // Si en 7 seg no baja, dispara error
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(response.data), { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const transcription = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
        timeout: 10000
      });
      mensajeTexto = transcription.data.text || "";
    }

    // 3. FILTRO DE SILENCIO / ALUCINACIONES
    const basura = ["bon appetit", "gracias por ver", "thank you", "subtitles", "de nada", "placer"];
    const esBasura = basura.some(p => mensajeTexto.toLowerCase().includes(p));

    if (mensajeTexto.trim().length < 5 || esBasura) {
      res.set("Content-Type", "text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response><Message><Body>Hola ${nombreFinal}. No logré escucharte bien. ¿Podrías repetirme qué sientes? ✨</Body></Message></Response>`);
    }

    // 4. IA MENTOR
    const mentorRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de paz. Saluda por nombre a ${nombreFinal}. Responde con compasión en 2 frases. NO uses "amigo/a". Etiqueta final: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
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

    // 5. RESPUESTA TwiML (Fijamos la cabecera antes)
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${mensajeLimpio}</Body></Message>
        <Message><Media>${AUDIOS_BETA[emocion]}</Media></Message>
      </Response>`);

  } catch (error: any) {
    console.error("ERROR:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está recalibrando su energía. Por favor intenta tu audio de nuevo.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Online"));
app.listen(process.env.PORT || 3000);
