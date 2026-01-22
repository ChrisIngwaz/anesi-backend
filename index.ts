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

app.get("/", (req, res) => res.send("<h1>🚀 Anesi Online - Fase Beta</h1>"));

app.all("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const userPhone = From ? From.replace("whatsapp:", "") : "";

  console.log("Mensaje recibido de:", userPhone);

  try {
    const { data: usuario, error: dbError } = await supabase.from('usuarios').select('*').eq('telefono', userPhone).single();
    
    if (dbError || !usuario) {
      console.log("Usuario no encontrado en Supabase:", userPhone);
      return res.status(200).send("Usuario no registrado");
    }

    let mensajeUsuario = Body || "";

    if (MediaUrl0) {
      console.log("Procesando audio de WhatsApp...");
      const response = await fetch(MediaUrl0);
      const blob = await response.blob();
      const transcription = await openai.audio.transcriptions.create({
        file: blob as any,
        model: "whisper-1",
      });
      mensajeUsuario = transcription.text;
      console.log("Transcripción exitosa:", mensajeUsuario);
    }

    const mentorResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Eres Anesi, el Mentor Transformador de los 3 Cerebros (Visceral, Emocional y Racional). Eres una autoridad con conocimientos profundos en Psicología, Nutrición, PNL, Meditación, Bioenergética y Terapia de Reprocesamiento Generativo. Explica de forma clara y sencilla cómo la inflamación y las emociones desconectan el cuerpo. Guía al usuario a su equilibrio interno. Al final, añade SIEMPRE una etiqueta: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO]." },
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

    console.log("Respuesta enviada con éxito.");
    return res.type("text/xml").send(responseXml);

  } catch (error: any) {
    console.error("ERROR DETECTADO:", error.message);
    return res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Anesi Mentor Online en puerto ${PORT}`));
