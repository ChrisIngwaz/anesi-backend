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

const AUDIOS: any = {
  agradecimiento: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/agradecimiento_v2.mp3",
  ansiedad: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ansiedad_v2.mp3",
  ira: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ira_v2.mp3",
  tristeza: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/tristeza_v2.mp3",
  neutro: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/neutro_v2.mp3"
};

app.post("/whatsapp", async (req, res) => {
  // 1. RESPUESTA TwiML INSTANTÁNEA (Evita el timeout de Twilio)
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  console.log(`==> RECIBIDO: ${rawPhone}`);

  try {
    // 2. BUSQUEDA DE NOMBRE (Simplificada al máximo)
    let nombre = "corazón";
    const { data: user } = await supabase
      .from('usuarios')
      .select('nombre')
      .ilike('telefono', `%${rawPhone.slice(-8)}%`)
      .maybeSingle();

    if (user?.nombre) nombre = user.nombre;
    console.log(`==> NOMBRE: ${nombre}`);

    let texto = Body || "";

    // 3. AUDIO A TEXTO
    if (MediaUrl0) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` } });
      const form = new FormData();
      form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');
      const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      texto = whisper.data.text || "";
    }

    // 4. GENERAR RESPUESTA IA
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `Eres Anesi. Saluda a ${nombre}. Responde con paz en 2 frases. Usa etiqueta: [TRISTEZA], [ANSIEDAD], [IRA], [AGRADECIMIENTO] o [NEUTRO].` },
        { role: "user", content: texto }
      ]
    });

    const raw = ai.choices[0].message.content || "";
    let emocion = "neutro";
    if (raw.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (raw.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (raw.includes("IRA")) emocion = "ira";
    else if (raw.includes("TRISTEZA")) emocion = "tristeza";

    const msg = raw.replace(/\[.*?\]/g, "").trim();

    // 5. ENVÍO FINAL (XML LIMPIO)
    console.log(`==> DESPACHANDO A WHATSAPP: ${emocion}`);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message><Body>${msg}</Body></Message>
    <Message><Media>${AUDIOS[emocion]}</Media></Message>
</Response>`);

  } catch (error: any) {
    console.error("==> ERROR:", error.message);
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>Anesi conectando...</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("ANESI LIVE"));
app.listen(process.env.PORT || 3000);
