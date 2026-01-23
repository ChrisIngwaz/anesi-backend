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

app.all("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  const cleanPhone = rawPhone.replace(/\+/g, "");

  try {
    // 1. BUSQUEDA RELÁMPAGO DE USUARIO
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .or(`telefono.eq.${rawPhone},telefono.eq.${cleanPhone}`)
      .maybeSingle();

    const nombre = usuario?.nombre || "corazón";
    let textoUser = Body || "";

    // 2. PROCESAMIENTO DE AUDIO ACELERADO
    if (MediaUrl0) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      
      const audioData = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${auth}` },
        timeout: 5000 // Máximo 5 seg para descargar
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(audioData.data), { filename: 'v.ogg', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
        timeout: 8000 // Máximo 8 seg para transcribir
      });
      textoUser = whisper.data.text || "";
    }

    // 3. DETECTOR DE SILENCIO / ALUCINACIÓN (Whisper suele decir "Gracias" o "Bon appetit" en silencio)
    const basura = ["bon appetit", "gracias", "thank you", "placer", "subtitles", "bye"];
    const esBasura = basura.some(b => textoUser.toLowerCase().includes(b)) && textoUser.length < 25;

    if (textoUser.trim().length < 5 || esBasura) {
      res.set("Content-Type", "text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>Hola ${nombre}. No logré escucharte bien. Repíteme qué sientes, por favor. ✨</Body></Message></Response>`);
    }

    // 4. GPT-4o-MINI: RESPUESTA ULTRA-CORTA PARA GANAR TIEMPO
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `Eres Anesi. Saluda a ${nombre}. Responde con paz en 15 palabras máximo. Usa etiqueta: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` },
        { role: "user", content: textoUser }
      ],
      max_tokens: 60
    });

    const resIA = ai.choices[0].message.content || "";
    let emocion = "neutro";
    if (resIA.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (resIA.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (resIA.includes("IRA")) emocion = "ira";
    else if (resIA.includes("TRISTEZA")) emocion = "tristeza";

    const msg = resIA.replace(/\[.*?\]/g, "").trim();

    // 5. RESPUESTA FINAL
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${msg}</Body></Message>
        <Message><Media>${AUDIOS[emocion]}</Media></Message>
      </Response>`);

  } catch (error: any) {
    console.error("Error:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>Anesi está conectando. Intenta de nuevo, por favor.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);
