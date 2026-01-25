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
  
  console.log(`==> PROCESANDO CONSULTA: ${rawPhone}`);

  try {
    // 1. IDENTIFICACIÓN DE USUARIO (Búsqueda agresiva por terminación)
    let nombre = "corazón";
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase
      .from('usuarios')
      .select('nombre')
      .ilike('telefono', `%${ultimosDigitos}%`)
      .maybeSingle();

    if (user?.nombre) nombre = user.nombre;

    // 2. TRANSCRIPCIÓN DE AUDIO (Si el usuario envía Voice)
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

    // 3. GENERACIÓN DE RESPUESTA (Perfil de Autoridad Anesi)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, Mentor Transformador de los 3 Cerebros. Autoridad en Psicología, PNL, Nutrición y Reprocesamiento Generativo.
          Misión: Saluda a ${nombre}. Explica la desconexión del eje intestino-corazón-cerebro por inflamación o emoción. 
          Da una respuesta clara, científica pero sencilla. Máximo 4 frases.
          Termina con una etiqueta: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
        },
        { role: "user", content: mensajeUsuario }
      ],
      temperature: 0.7
    });

    const respuestaFinal = completion.choices[0].message.content || "";

    // 4. RESPUESTA TwiML PURA (Sin espacios, formato estricto)
    console.log(`==> ENVIANDO RESPUESTA A WHATSAPP`);
    res.set("Content-Type", "text/xml");
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>${respuestaFinal}</Body></Message></Response>`;
    return res.status(200).send(twiml);

  } catch (error: any) {
    console.error("==> ERROR CRÍTICO:", error.message);
    res.set("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>Hola ${nombre}, estoy recalibrando mi energía. Por favor, repite tu mensaje.</Body></Message></Response>`);
  }
});

app.get("/", (req, res) => res.send("ANESI SISTEMA OK"));
app.listen(process.env.PORT || 3000);
