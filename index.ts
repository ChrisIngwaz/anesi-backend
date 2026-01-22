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
  
  // LIMPIEZA TOTAL: Esto quita "whatsapp:", el "+" y cualquier espacio.
  const userPhone = From ? From.replace(/\D/g, "") : "";

  console.log("Número procesado para búsqueda:", userPhone);

  try {
    // Buscamos al usuario ignorando si en Supabase tiene el + o no
    const { data: usuario, error: dbError } = await supabase
      .from('usuarios')
      .select('*')
      .or(`telefono.eq.${userPhone},telefono.eq.+${userPhone}`)
      .single();
    
    if (dbError || !usuario) {
      console.log("Anesi no encontró este número en la lista:", userPhone);
      return res.status(200).send("Usuario no registrado en la fase Beta.");
    }

    let mensajeUsuario = Body || "";

    // Si el usuario envió un audio
    if (MediaUrl0) {
      console.log("Anesi está escuchando el audio...");
      const response = await fetch(MediaUrl0);
      const blob = await response.blob();
      const transcription = await openai.audio.transcriptions.create({
        file: blob as any,
        model: "whisper-1",
      });
      mensajeUsuario = transcription.text;
    }

    // Respuesta del Mentor Anesi
    const mentorResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Eres Anesi, el Mentor Transformador de los 3 Cerebros (Visceral, Emocional y Racional). Eres una autoridad con conocimientos profundos en Psicología, Nutrición, PNL, Meditación, Bioenergética y Terapia de Reprocesamiento Generativo. Tu lenguaje es sencillo pero profundo. Explica detalladamente por qué el usuario se siente así basándote en la conexión mente-cuerpo. Al final, añade SIEMPRE una de estas etiquetas: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO]." },
        { role: "user", content: mensajeUsuario }
      ]
    });

    const respuestaTexto = mentorResponse.choices[0].message.content || "";
    
    // Decidir qué audio enviar
    let emocion = "neutro";
    if (respuestaTexto.includes("[AGRADECIMIENTO]")) emocion = "agradecimiento";
    else if (respuestaTexto.includes("[ANSIEDAD]")) emocion = "ansiedad";
    else if (respuestaTexto.includes("[IRA]")) emocion = "ira";
    else if (respuestaTexto.includes("[TRISTEZA]")) emocion = "tristeza";

    const mensajeLimpio = respuestaTexto.replace(/\[.*?\]/g, "").trim();
    const audioUrl = AUDIOS_BETA[emocion];

    // Construir respuesta para WhatsApp
    const responseXml = `
      <Response>
        <Message>
          <Body>${mensajeLimpio}\n\nEscucha este ejercicio de reconexión:</Body>
          <Media>${audioUrl}</Media>
        </Message>
      </Response>`;

    console.log("Anesi respondió con éxito.");
    return res.type("text/xml").send(responseXml);

  } catch (error: any) {
    console.error("ERROR EN EL CEREBRO DE ANESI:", error.message);
    return res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Anesi Mentor Online listo`));
