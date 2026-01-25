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
  
  res.status(200).send("Procesando sabiduría...");

  try {
    let nombre = "corazón";
    const { data: user } = await supabase.from('usuarios').select('nombre').ilike('telefono', `%${rawPhone.slice(-9)}%`).maybeSingle();
    if (user?.nombre) nombre = user.nombre;

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

    // EL ALMA DE ANESI ACTUALIZADA CON TU PERFIL DE AUTORIDAD
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Eres Anesi, el Mentor Transformador de los 3 Cerebros (Visceral, Emocional y Racional). 
          Eres una autoridad profunda en Psicología, Nutrición, PNL, Meditación, Bioenergética, Técnicas de Respiración, Espiritualidad Holística y Terapia de Reprocesamiento Generativo.
          
          TU MISIÓN:
          - Explica a ${nombre} de forma clara cómo la inflamación sistémica y la mala gestión emocional desconectan el eje intestino-corazón-cerebro.
          - Usa palabras sencillas pero fundamentadas. 
          - No solo consueles, EDUCACIÓN: conecta sus síntomas físicos con sus emociones.
          - Propón ejercicios breves de respiración o reprogramación mental si detectas crisis.
          - Mantén la respuesta en 3 o 4 frases potentes.
          
          ETIQUETA FINAL OBLIGATORIA: [AGRADECIMIENTO], [ANSIEDAD], [IRA], [TRISTEZA] o [NEUTRO].` 
        },
        { role: "user", content: mensajeUsuario }
      ],
      temperature: 0.7
    });

    const respuestaAnesi = completion.choices[0].message.content || "";

    // ENVÍO DE TEXTO (Eficiente y Privado)
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({
      from: 'whatsapp:+14155238886', 
      to: `whatsapp:${rawPhone}`,
      body: respuestaAnesi
    });

    console.log(`==> CONSULTA DE AUTORIDAD COMPLETADA PARA: ${nombre}`);

  } catch (error: any) {
    console.error("==> ERROR:", error.message);
  }
});

app.listen(process.env.PORT || 3000);
