import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
const FormData = require('form-data');
const twilio = require('twilio'); // Añadimos la librería oficial

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const AUDIOS: any = {
  agradecimiento: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/agradecimiento_v2.mp3",
  ansiedad: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ansiedad_v2.mp3",
  ira: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/ira_v2.mp3",
  tristeza: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/tristeza_v2.mp3",
  neutro: "https://txuwjkkwnezfqpromber.supabase.co/storage/v1/object/public/audios/neutro_v2.mp3"
};

app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  // Respondemos 200 OK inmediatamente para que Twilio no se quede esperando
  res.status(200).send("Procesando");

  try {
    let nombre = "corazón";
    const { data: user } = await supabase.from('usuarios').select('nombre').ilike('telefono', `%${rawPhone.slice(-8)}%`).maybeSingle();
    if (user?.nombre) nombre = user.nombre;

    let texto = Body || "";
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

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: `Eres Anesi. Responde a ${nombre} con paz en 2 frases. Usa: [IRA], [ANSIEDAD], [TRISTEZA], [AGRADECIMIENTO] o [NEUTRO].` }, { role: "user", content: texto }]
    });

    const raw = ai.choices[0].message.content || "";
    let emocion = "neutro";
    if (raw.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (raw.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (raw.includes("IRA")) emocion = "ira";
    else if (raw.includes("TRISTEZA")) emocion = "tristeza";

    const msg = raw.replace(/\[.*?\]/g, "").trim();

    // ENVÍO ACTIVO (Push)
    await client.messages.create({
      from: 'whatsapp:+14155238886', // Asegúrate que sea el número de tu Sandbox
      to: `whatsapp:${rawPhone}`,
      body: msg,
      mediaUrl: [AUDIOS[emocion]]
    });
    
    console.log(`==> ENVIADO CORRECTAMENTE A: ${rawPhone}`);

  } catch (error: any) {
    console.error("==> ERROR:", error.message);
  }
});

app.get("/", (req, res) => res.send("ANESI ACTIVE"));
app.listen(process.env.PORT || 3000);
