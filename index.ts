import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
const FormData = require('form-data');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Clientes inicializados
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
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  
  console.log(`==> PROCESANDO FLUJO PARA: ${rawPhone}`);

  try {
    // 1. BÚSQUEDA DE NOMBRE ULTRA-RÁPIDA (Optimizada para +593...)
    let nombre = "corazón";
    const ultimosDigitos = rawPhone.slice(-9); 
    const { data: user } = await supabase
      .from('usuarios')
      .select('nombre')
      .ilike('telefono', `%${ultimosDigitos}%`)
      .limit(1)
      .maybeSingle();

    if (user?.nombre) nombre = user.nombre;
    console.log(`==> IDENTIFICADO COMO: ${nombre}`);

    let textoInput = Body || "";

    // 2. PROCESAMIENTO DE AUDIO (Si existe)
    if (MediaUrl0) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` } });
      
      const form = new FormData();
      form.append('file', Buffer.from(audioRes.data), { filename: 'voice.oga', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });
      textoInput = whisper.data.text || "";
    }

    // 3. GENERACIÓN DE RESPUESTA CON GPT-4O-MINI
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `Eres Anesi, Mentor de los 3 Cerebros. Saluda siempre a ${nombre}. Responde con paz y sabiduría en máximo 2 frases. Clasifica y termina con UNA etiqueta: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` },
        { role: "user", content: textoInput }
      ],
      temperature: 0.7
    });

    const fullResponse = ai.choices[0].message.content || "";
    let emocion = "neutro";
    if (fullResponse.includes("AGRADECIMIENTO")) emocion = "agradecimiento";
    else if (fullResponse.includes("ANSIEDAD")) emocion = "ansiedad";
    else if (fullResponse.includes("IRA")) emocion = "ira";
    else if (fullResponse.includes("TRISTEZA")) emocion = "tristeza";

    const mensajeFinal = fullResponse.replace(/\[.*?\]/g, "").trim();

    // 4. RESPUESTA XML PURA PARA TWILIO (Sin espacios ni saltos de línea basura)
    console.log(`==> DESPACHANDO RESPUESTA: ${emocion}`);
    res.set("Content-Type", "text/xml");
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>${mensajeFinal}</Body></Message><Message><Media>${AUDIOS[emocion]}</Media></Message></Response>`;
    return res.status(200).send(twiml);

  } catch (err: any) {
    console.error("==> ERROR EN EL SISTEMA:", err.message);
    res.set("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>Hola ${nombre}, Anesi está recalibrando su energía. Por favor, intenta de nuevo en un momento.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("ANESI_SISTEMA_OPERATIVO_OK"));
app.listen(process.env.PORT || 3000);
