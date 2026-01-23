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

// USAMOS .all PARA QUE NADA DE UN 404
app.all("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  console.log(`Petición entrante de: ${rawPhone}`); // Esto saldrá en tu log de Render

  try {
    // 1. BUSCAR NOMBRE (Forma ultra-simple)
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .or(`telefono.ilike.%${rawPhone.slice(-9)}%`) // Busca los últimos 9 dígitos
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
    const basura = ["bon appetit", "gracias", "thank you", "subtitles", "bye"];
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
        { role: "system", content: `Eres Anesi, Mentor. Saluda a ${nombreUser}. Responde en 2 frases con paz. Etiqueta: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` },
        { role: "user", content: textoEscuchado }
      ]
    });

    const resIA = ai.choices[0].message.content || "";
    let emocion = "neutro";
    if (resIA.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (resIA.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (resIA.includes("IRA")) emocion = "ira";
    else if (resIA.includes("TRISTEZA")) emocion = "tristeza";

    const msg = resIA.replace(/\[.*?\]/g, "").trim();

    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${msg}</Body></Message>
        <Message><Media>${AUDIOS[emocion]}</Media></Message>
      </Response>`);

  } catch (error: any) {
    console.error("ERROR INTERNO:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está conectando... Intenta de nuevo.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Servidor Arriba"));
app.listen(process.env.PORT || 3000);
