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
  const userPhone = From ? From.replace(/\D/g, "") : "";

  try {
    // 1. BUSQUEDA SIMPLIFICADA (Un solo intento)
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .or(`telefono.eq.${userPhone},telefono.eq.+${userPhone}`)
      .single();

    if (!usuario) {
        console.log("Usuario no encontrado:", userPhone);
        return res.status(200).send("OK");
    }

    const nombreReal = usuario.nombre;
    let mensajeTexto = Body || "";

    // 2. PROCESAMIENTO DE AUDIO CON TIMEOUT
    if (MediaUrl0) {
      const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      
      const response = await axios.get(MediaUrl0, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Basic ${twilioAuth}` },
        timeout: 10000 // 10 segundos máximo para descargar
      });
      
      const form = new FormData();
      form.append('file', Buffer.from(response.data), { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const transcriptionRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 
            ...form.getHeaders() 
        },
        timeout: 15000 // 15 segundos para transcribir
      });

      mensajeTexto = transcriptionRes.data.text || "";
    }

    // 3. FILTRO DE SILENCIO ACTUALIZADO
    const esSilencio = mensajeTexto.trim().length < 6 || 
                       ["gracias", "thank you", "de nada", "bye"].some(f => mensajeTexto.toLowerCase() === f);

    if (MediaUrl0 && esSilencio) {
      res.set("Content-Type", "text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message><Body>Hola ${nombreReal}. No pude escucharte bien. Si necesitas apoyo, envía un voice y dime qué sientes. ✨</Body></Message>
        </Response>`);
    }

    // 4. IA MENTOR
    const mentorResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de los 3 Cerebros. Responde a ${nombreReal} con paz. USA SIEMPRE EL NOMBRE ${nombreReal}. NUNCA uses "amigo/a". Máximo 2 frases. Etiqueta obligatoria: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
        },
        { role: "user", content: mensajeTexto }
      ]
    });

    const respuestaTextoRaw = mentorResponse.choices[0].message.content || "";
    let emocion = "neutro";
    const tU = respuestaTextoRaw.toUpperCase();
    if (tU.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (tU.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (tU.includes("IRA")) emocion = "ira";
    else if (tU.includes("TRISTEZA")) emocion = "tristeza";

    const audioUrl = AUDIOS_BETA[emocion];
    const mensajeLimpio = respuestaTextoRaw.replace(/\[.*?\]/g, "").trim();

    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>${mensajeLimpio}</Body></Message>
        <Message><Media>${audioUrl}</Media></Message>
      </Response>`);

  } catch (error: any) {
    // ESTO NOS DIRÁ QUÉ PASA REALMENTE
    console.error("ERROR DETECTADO:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message><Body>Anesi detectó un error: ${error.message}. Por favor, avisa al administrador.</Body></Message>
      </Response>`);
  }
});

app.get("/", (req, res) => res.send("🚀 Anesi Online"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0");
