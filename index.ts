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
  // Limpiamos el número: quitamos el '+' si existe para estandarizar
  const userPhoneRaw = From ? From.replace("whatsapp:", "") : "";
  const userPhoneClean = userPhoneRaw.replace(/\+/g, "");

  res.set("Content-Type", "text/xml");

  try {
    // 1. BÚSQUEDA DE USUARIO (Intentamos con + y sin +)
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .or(`telefono.eq.${userPhoneClean},telefono.eq.+${userPhoneClean}`)
      .maybeSingle();

    const nombreFinal = usuario?.nombre || "corazón"; // Si no hay nombre, usa 'corazón' para que no sea frío

    let mensajeTexto = Body || "";

    // 2. PROCESAR AUDIO
    if (MediaUrl0) {
      const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const response = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${twilioAuth}` }
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(response.data), { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const transcription = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      mensajeTexto = transcription.data.text || "";
    }

    // 3. FILTRO DE SILENCIO Y ALUCINACIONES (Bon Appetit, etc)
    const palabrasBasura = ["bon appetit", "gracias por", "thank you", "subtitles", "de nada"];
    const esBasura = palabrasBasura.some(p => mensajeTexto.toLowerCase().includes(p));

    if (mensajeTexto.trim().length < 9 || esBasura) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message><Body>Hola ${nombreFinal}. No pude escucharte bien. Si necesitas apoyo, por favor envíame un audio contándome qué sientes. ✨</Body></Message>
        </Response>`);
    }

    // 4. IA MENTOR
    const mentorRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de paz. Saluda SIEMPRE por su nombre a ${nombreFinal}. Responde con compasión en 2 frases cortas. NUNCA uses "amigo" o "amiga". Etiqueta obligatoria: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
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

    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${mensajeLimpio}</Body></Message>
        <Message><Media>${AUDIOS_BETA[emocion]}</Media></Message>
      </Response>`);

  } catch (error: any) {
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está conectando. Por favor intenta tu audio de nuevo.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Online"));
app.listen(process.env.PORT || 3000);
