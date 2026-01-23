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
  const rawPhone = From ? From.replace("whatsapp:", "") : ""; // +593995430859
  
  console.log(`Procesando mensaje de: ${rawPhone}`);

  try {
    // 1. BUSCAR USUARIO (Si falla la DB, seguimos con un nombre genérico para no romper el flujo)
    let nombreUser = "corazón";
    try {
      const { data: usuario } = await supabase
        .from('usuarios')
        .select('nombre')
        .or(`telefono.eq.${rawPhone},telefono.eq.${rawPhone.replace("+", "")},telefono.ilike.%${rawPhone.slice(-9)}%`)
        .maybeSingle();
      
      if (usuario?.nombre) nombreUser = usuario.nombre;
    } catch (dbErr) {
      console.log("Error en DB, usando nombre genérico");
    }

    let mensajeTexto = Body || "";

    // 2. PROCESAR AUDIO
    if (MediaUrl0) {
      const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const audioRes = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${twilioAuth}` },
        timeout: 10000 // 10 segundos máximo para descargar
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(audioRes.data), { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      mensajeTexto = whisperRes.data.text || "";
    }

    // 3. FILTRO DE SILENCIO / ALUCINACIONES
    const basura = ["bon appetit", "gracias por ver", "subtitles", "thank you", "de nada", "hola."];
    const esBasura = basura.some(f => mensajeTexto.toLowerCase().includes(f));

    res.set("Content-Type", "text/xml");

    if (mensajeTexto.trim().length < 7 || (MediaUrl0 && esBasura && mensajeTexto.length < 25)) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response><Message><Body>Hola ${nombreUser}. No logré escucharte bien. Por favor, dime qué sientes. ✨</Body></Message></Response>`);
    }

    // 4. IA MENTOR
    const mentorResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de los 3 Cerebros. Responde a ${nombreUser} con paz en 2 frases. NO uses "amigo/a". Termina con etiqueta: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
        },
        { role: "user", content: mensajeTexto }
      ]
    });

    const respuestaRaw = mentorResponse.choices[0].message.content || "";
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
    console.error("ERROR CRÍTICO:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está conectando... Por favor intenta tu mensaje de nuevo.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Online"));
app.listen(process.env.PORT || 3000);
