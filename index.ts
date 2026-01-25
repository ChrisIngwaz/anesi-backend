import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
const FormData = require('form-data');
const twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  // 1. Respuesta rápida a Twilio
  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);

  try {
    // 2. Identificación seria del usuario
    let nombre = "";
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('nombre').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();
    
    // Si no hay nombre, simplemente no usamos apodos afectuosos
    nombre = user?.nombre || "";

    // 3. Procesar Texto o Voice Note
    let mensajeUsuario = Body || "";
    if (MediaUrl0) {
      console.log("==> PROCESANDO NOTA DE VOZ...");
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

    // 4. Configuración de Personalidad Estricta
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor Transformador de los 3 Cerebros. 
          INSTRUCCIONES CRÍTICAS:
          - Usa un tono de autoridad profesional, sabio y empático.
          - ESTÁ PROHIBIDO usar palabras como "corazón", "amor", "cariño", "amigo" o "querido/a". Dirígete a la persona por su nombre (${nombre}) o de forma neutral si no lo sabes.
          - Explica el eje intestino-corazón-cerebro de forma científica pero sencilla.
          - Máximo 3-4 frases.
          - Al final, incluye la etiqueta [ANSIEDAD], [IRA], [TRISTEZA], [AGRADECIMIENTO] o [NEUTRO] para análisis interno.` 
        },
        { role: "user", content: mensajeUsuario }
      ]
    });

    let respuestaAnesi = completion.choices[0].message.content || "";

    // 5. LIMPIEZA DE ETIQUETAS (Para que el usuario NO las vea)
    // Borramos cualquier cosa que esté entre corchetes []
    const mensajeLimpio = respuestaAnesi.replace(/\[.*?\]/g, "").trim();

    // 6. Envío final por Twilio
    await twilioClient.messages.create({
      from: 'whatsapp:+14155238886', 
      to: `whatsapp:${rawPhone}`,
      body: mensajeLimpio
    });

    console.log(`==> RESPUESTA PROFESIONAL ENVIADA A: ${rawPhone}`);

  } catch (error: any) {
    console.error("==> FALLO:", error.message);
  }
});

app.get("/", (req, res) => res.send("ANESI ONLINE - MODO PROFESIONAL"));
app.listen(process.env.PORT || 3000);
