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

app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  console.log(`==> INICIO PROCESO: ${rawPhone}`);

  try {
    // 1. BÚSQUEDA DE USUARIO CON TIMEOUT (Para que no se trabe)
    let nombreUser = "corazón";
    try {
      const userPromise = supabase
        .from('usuarios')
        .select('nombre')
        .or(`telefono.eq.${rawPhone},telefono.eq.${rawPhone.replace("+", "")}`)
        .maybeSingle();

      // Si la DB no responde en 4 segundos, saltamos al catch
      const { data: usuario } = await Promise.race([
        userPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout DB')), 4000))
      ]) as any;

      if (usuario?.nombre) nombreUser = usuario.nombre;
      console.log(`==> USUARIO ENCONTRADO: ${nombreUser}`);
    } catch (e) {
      console.log("==> DB LENTA O ERROR: Usando nombre genérico");
    }

    let mensajeTexto = Body || "";

    // 2. PROCESAR AUDIO
    if (MediaUrl0) {
      console.log("==> DESCARGANDO AUDIO...");
      const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const response = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${twilioAuth}` },
        timeout: 8000
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(response.data), { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      console.log("==> TRANSCRIBIENDO CON OPENAI...");
      const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      mensajeTexto = whisper.data.text || "";
    }

    // 3. FILTRO DE SILENCIO / BASURA
    const basura = ["bon appetit", "gracias por ver", "subtitles", "thank you", "de nada"];
    const esBasura = basura.some(f => mensajeTexto.toLowerCase().includes(f));

    res.set("Content-Type", "text/xml");

    if (mensajeTexto.trim().length < 5 || esBasura) {
      console.log("==> FILTRADO POR SILENCIO/BASURA");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response><Message><Body>Hola ${nombreUser}. No pude escucharte bien. Dime qué sientes, por favor. ✨</Body></Message></Response>`);
    }

    // 4. RESPUESTA IA
    console.log("==> GENERANDO RESPUESTA IA...");
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `Eres Anesi. Saluda a ${nombreUser}. Responde con paz en 2 frases. NO uses "amigo/a". Etiqueta final: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` },
        { role: "user", content: mensajeTexto }
      ]
    });

    const raw = ai.choices[0].message.content || "";
    let emocion = "neutro";
    if (raw.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (raw.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (raw.includes("IRA")) emocion = "ira";
    else if (raw.includes("TRISTEZA")) emocion = "tristeza";

    const limpio = raw.replace(/\[.*?\]/g, "").trim();

    console.log("==> ENVIANDO RESPUESTA FINAL");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${limpio}</Body></Message>
        <Message><Media>${AUDIOS_BETA[emocion]}</Media></Message>
      </Response>`);

  } catch (error: any) {
    console.error("==> ERROR CRÍTICO:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Message><Body>Anesi está conectando su energía. Intenta de nuevo, por favor.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);
