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
  
  // 1. RESPUESTA INMEDIATA (Para que Twilio no marque error de HTTP)
  res.status(200).send("OK");

  try {
    let nombre = "";
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('nombre').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();
    nombre = user?.nombre || "";

    // 2. PROCESAMIENTO DE TEXTO O VOZ
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

    // 3. IA MENTOR: FLUIDEZ Y NATURALIDAD
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, un Mentor humano y sabio. 
          REGLAS DE ORO:
          - NUNCA empieces con "Saludos" o "Hola". Sé natural.
          - Usa inicios variados: "Fíjate ${nombre}...", "Entiendo lo que sientes...", "Es interesante que menciones eso...", "Mira...", o ve directo al grano.
          - Explica la conexión entre el síntoma físico (intestino) y la emoción (cerebro/corazón) con autoridad pero sencillez.
          - No uses términos afectuosos como "corazón" o "amor".
          - Máximo 3 frases cortas. Borra etiquetas como [ANSIEDAD] antes de responder.` 
        },
        { role: "user", content: mensajeUsuario }
      ],
      temperature: 0.8
    });

    const respuestaFinal = (completion.choices[0].message.content || "").replace(/\[.*?\]/g, "").trim();

    // 4. ENVÍO "PUSH" (Requiere la librería twilio instalada en Render)
    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      from: 'whatsapp:+14155238886', 
      to: `whatsapp:${rawPhone}`,
      body: respuestaFinal
    });

    console.log(`==> RESPUESTA NATURAL ENVIADA A: ${nombre}`);

  } catch (error: any) {
    console.error("==> FALLO EN FLUJO:", error.message);
  }
});

app.listen(process.env.PORT || 3000);
