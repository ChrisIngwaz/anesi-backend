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
  
  console.log(`==> PROCESANDO: ${rawPhone}`);

  try {
    // 1. Identificación de Usuario (Sin apodos)
    let nombre = "";
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('nombre').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();
    nombre = user?.nombre || "";

    // 2. Procesar Texto o Audio
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

    // 3. IA Mentor (Perfil de Autoridad)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor de los 3 Cerebros. Autoridad en Psicología y eje intestino-corazón-cerebro. 
          PROHIBIDO usar "corazón", "amor" o "cariño". Saluda a ${nombre} con respeto.
          Explica la conexión síntoma-emoción en 3 frases. 
          Incluye al final la etiqueta [EMOCION] para mi control.` 
        },
        { role: "user", content: mensajeUsuario }
      ]
    });

    const respuestaRaw = completion.choices[0].message.content || "";
    // Limpiamos la etiqueta para que el usuario no la vea
    const respuestaFinal = respuestaRaw.replace(/\[.*?\]/g, "").trim();

    // 4. Respuesta TwiML Pura (Formato que Twilio ama)
    res.set("Content-Type", "text/xml");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>${respuestaFinal}</Body></Message></Response>`;
    
    console.log("==> RESPUESTA DESPACHADA");
    return res.status(200).send(xml);

  } catch (error: any) {
    console.error("==> ERROR:", error.message);
    res.set("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>Anesi está procesando tu energía, por favor intenta en un momento.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("ANESI SISTEMA ACTIVO"));
app.listen(process.env.PORT || 3000);
