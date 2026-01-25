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

app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);

  try {
    let nombre = "";
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('nombre').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();
    nombre = user?.nombre || "";

    let mensajeUsuario = Body || "";
    if (MediaUrl0) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` } });
      const form = new FormData();
      form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');
      const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      mensajeUsuario = whisper.data.text || "";
    }

    // NUEVO PROMPT PARA NATURALIDAD TOTAL
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de los 3 Cerebros. 
          ESTILO DE CONVERSACIÓN:
          - Habla de forma NATURAL y FLUIDA, como en una charla de terapia real.
          - ESTÁ PROHIBIDO empezar siempre con "Saludos" o "Hola". 
          - Varía tus inicios aleatoriamente según el contexto: "Mira ${nombre}...", "Entiendo lo que dices...", "Esto que mencionas es clave...", "Fíjate en esto...", "Ok, vamos a analizarlo...", o entra directo al tema.
          - Mantén tu autoridad profesional en el eje intestino-corazón-cerebro pero con calidez humana.
          - No uses palabras como "corazón" o "cariño".
          - Máximo 3-4 frases y borra siempre las etiquetas de emoción al final.` 
        },
        { role: "user", content: mensajeUsuario }
      ]
    });

    let respuestaFinal = (completion.choices[0].message.content || "").replace(/\[.*?\]/g, "").trim();

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      from: 'whatsapp:+14155238886', 
      to: `whatsapp:${rawPhone}`,
      body: respuestaFinal
    });

  } catch (error: any) {
    console.error("==> ERROR:", error.message);
  }
});

app.listen(process.env.PORT || 3000);
