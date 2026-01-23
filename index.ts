import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AUDIOS: Record<string, string> = {
  agradecimiento: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/agradecimiento_v2.mp3",
  ansiedad: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ansiedad_v2.mp3",
  ira: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ira_v2.mp3",
  tristeza: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/tristeza_v2.mp3",
  neutro: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/neutro_v2.mp3"
};

app.all("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  // Respondemos inmediatamente con XML para que Twilio no se pierda
  res.set("Content-Type", "text/xml");

  try {
    // 1. OBTENER USUARIO (Búsqueda por coincidencia parcial para asegurar el nombre)
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .ilike('telefono', `%${rawPhone.slice(-8)}%`)
      .maybeSingle();

    const nombre = usuario?.nombre || "corazón";
    let textoUser = Body || "";

    // 2. PROCESAR AUDIO
    if (MediaUrl0) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      
      const audioRes = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${auth}` }
      });

      // Usamos el FormData nativo para evitar errores de librería
      const formData = new FormData();
      const blob = new Blob([audioRes.data], { type: 'audio/ogg' });
      formData.append('file', blob, 'voice.ogg');
      formData.append('model', 'whisper-1');

      const whisper = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: formData
      });

      const whisperData: any = await whisper.json();
      textoUser = whisperData.text || "";
    }

    // 3. FILTRO DE SILENCIO / ALUCINACIÓN
    const basura = ["bon appetit", "gracias", "thank you", "placer", "subtitles", "bye"];
    const esBasura = basura.some(b => textoUser.toLowerCase().includes(b)) && textoUser.length < 20;

    if (!textoUser || textoUser.length < 5 || esBasura) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response><Message><Body>Hola ${nombre}. No logré escucharte bien. Repíteme qué sientes, por favor. ✨</Body></Message></Response>`);
    }

    // 4. IA MENTOR
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `Eres Anesi. Saluda a ${nombre}. Responde con paz en máximo 2 frases. Etiqueta final: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` },
        { role: "user", content: textoUser }
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
    console.error("ERROR:", error.message);
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está conectando... Por favor intenta el audio una vez más.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);
