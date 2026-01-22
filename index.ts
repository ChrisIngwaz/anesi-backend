import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import fetch from "node-fetch";

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

app.get("/", (req, res) => res.send("<h1>🚀 Anesi Online - Fase Beta</h1>"));

app.all("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const userPhone = From ? From.replace("whatsapp:", "") : "";

  try {
    const { data: usuario } = await supabase.from('usuarios').select('*').eq('telefono', userPhone).single();
    if (!usuario) return res.status(200).send("Usuario no registrado");

    let mensajeUsuario = Body || "";

    if (MediaUrl0) {
      const response = await fetch(MediaUrl0);
      const blob = await response.blob();
      const transcription = await openai.audio.transcriptions.create({
        file: blob as any,
        model: "whisper-1",
      });
      mensajeUsuario = transcription.text;
    }

    const mentorResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Eres Anesi, el Mentor Transformador de los 3 Cerebros (Visceral, Emocional y Racional). Eres una autoridad con conocimientos profundos en Psicología, Nutrición, Programación Neurolingüística (PNL), Meditación Guiada, Bioenergética, Técnicas de Respiración, Espiritualidad Holística y Terapia de Reprocesamiento Generativo de la mente. Tu misión es explicar de forma clara, detallada y con palabras sencillas cómo la inflamación sistémica y la mala gestión emocional desconectan el eje intestino-corazón-cerebro. Guía al usuario a comprender que su salud y paz dependen de su equilibrio interno. Usa tu autoridad para dar explicaciones fundamentadas pero comprensibles que generen confianza. Al final, añade siempre la etiqueta correspondiente: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO]." },
        { role: "user", content: mensajeUsuario }
      ]
    });

    const respuestaTexto = mentorResponse.choices[0].message.content || "";
    let emocion = "neutro";
    if (respuestaTexto.includes("[AGRADECIMIENTO]")) emocion = "agradecimiento";
    else if (respuestaTexto.includes("[ANSIEDAD]")) emocion = "ansiedad";
    else if (respuestaTexto.includes("[IRA]")) emocion = "ira";
    else if (respuestaTexto.includes("[TRISTEZA]")) emocion = "tristeza";

    const mensajeLimpio = respuestaTexto.replace(/\[.*?\]/g, "").trim();
    const audioUrl = AUDIOS_BETA[emocion];

    const responseXml = `
      <Response>
        <Message>
          <Body>${mensajeLimpio}\n\nEscucha este ejercicio para reconectar tu centro:</Body>
          <Media>${audioUrl}</Media>
        </Message>
      </Response>`;

    return res.type("text/xml").send(responseXml);
  } catch (error) {
    return res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Anesi Mentor Online`));
