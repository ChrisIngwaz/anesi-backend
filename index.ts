import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
const fetch = require('node-fetch');

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

app.get("/", (req, res) => res.send("<h1>🚀 Anesi Online - Sistema de Audio Activo</h1>"));

app.all("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const userPhone = From ? From.replace(/\D/g, "") : "";

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('*')
      .or(`telefono.eq.${userPhone},telefono.eq.+${userPhone}`)
      .single();
    
    if (!usuario) return res.status(200).send("OK");

    let mensajeUsuario = Body || "";
    let esAudio = false;

    // 1. RECEPCIÓN DE AUDIO
    if (MediaUrl0) {
      esAudio = true;
      const response = await fetch(MediaUrl0);
      const blob = await response.blob();
      const transcription = await openai.audio.transcriptions.create({
        file: blob as any,
        model: "whisper-1",
      });
      mensajeUsuario = transcription.text;
    }

    // 2. ANÁLISIS DEL DOLOR ESPECÍFICO
    const mentorResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        { role: "system", content: "Eres Anesi, Mentor de los 3 Cerebros. Tu objetivo es identificar el dolor del usuario y validarlo brevemente (máximo 3 frases). Al final añade SIEMPRE una etiqueta: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO]." },
        { role: "user", content: mensajeUsuario }
      ]
    });

    const respuestaTexto = mentorResponse.choices[0].message.content || "";
    
    // 3. SELECCIÓN DEL AUDIO PREGRABADO
    let emocion = "neutro";
    if (respuestaTexto.includes("[AGRADECIMIENTO]")) emocion = "agradecimiento";
    else if (respuestaTexto.includes("[ANSIEDAD]")) emocion = "ansiedad";
    else if (respuestaTexto.includes("[IRA]")) emocion = "ira";
    else if (respuestaTexto.includes("[TRISTEZA]")) emocion = "tristeza";

    const mensajeLimpio = respuestaTexto.replace(/\[.*?\]/g, "").trim();
    const audioUrl = AUDIOS_BETA[emocion];

    // 4. ENVÍO DE LA SECUENCIA
    const responseXml = `
      <Response>
        <Message>
          <Body>Hola ${usuario.nombre || "bienvenido"}. He escuchado tu mensaje:\n\n"${mensajeLimpio}"\n\nEscucha este ejercicio diseñado para tu estado actual:</Body>
          <Media>${audioUrl}</Media>
        </Message>
      </Response>`;

    return res.type("text/xml").send(responseXml);

  } catch (error: any) {
    console.error("Error:", error.message);
    return res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Anesi Listo`));
