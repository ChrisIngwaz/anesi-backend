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
  res.status(200).send("OK");

  try {
    let { data: user } = await supabase.from('usuarios').select('*').eq('telefono', rawPhone).maybeSingle();

    let mensajeUsuario = Body || "";
    let detectedLang = "es";

    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        const form = new FormData();
        form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
        form.append('model', 'whisper-1');
        const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, { 
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() } 
        });
        mensajeUsuario = whisper.data.text || "";
        if (whisper.data.language === 'en') detectedLang = "en";
      } catch (e) { mensajeUsuario = ""; }
    }

    const englishPatterns = /\b(hi|hello|how are you|my name is|i am|english)\b/i;
    if (!MediaUrl0 && englishPatterns.test(mensajeUsuario)) {
      detectedLang = "en";
    }

    const langRule = detectedLang === "en" ? " Respond ONLY in English." : " Responde ÚNICAMENTE en español.";
    const lengthRule = " IMPORTANTE: Sé directo, técnico y evita clichés poéticos o frases hechas como 'luz', 'eco en el universo' o 'bálsamo'. Máximo 1000 caracteres.";

    let respuestaFinal = "";

    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
      if (!user) {
        const { data: newUser } = await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta' }]).select().single();
        user = newUser;
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Anesi, un Mentor de Élite. Saluda con sobriedad y autoridad. Di exactamente: 'Hola. Soy Anesi. Iniciemos este proceso de claridad. Antes de profundizar, necesito que este espacio sea personal: dime tu nombre, tu edad y desde qué ciudad y país me escribes.'" + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
      } else {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Extract name, age, country, and city from the user message in JSON. Use fields: name, age, country, city." },
            { role: "user", content: mensajeUsuario }
          ],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreFinal = info.name || info.nombre || "Christian";
        await supabase.from('usuarios').update({ 
          nombre: nombreFinal, 
          edad: info.age || info.edad, 
          pais: info.country || info.pais, 
          ciudad: info.city || info.ciudad 
        }).eq('telefono', rawPhone);
        
        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: `Eres Anesi, Mentor de Élite. Valida al usuario por su nombre (${nombreFinal}). Di exactamente: 'Entendido, ${nombreFinal}. Estoy listo. Mi enfoque no es dar consejos superficiales, sino desglosar la biología y la psicología de lo que estás viviendo. Cuéntame con total libertad: ¿qué es eso que hoy está rompiendo tu equilibrio? Puedes escribirme o enviarme un audio.'` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica. No eres un asistente virtual; eres un Mentor de élite que integra la ciencia de vanguardia con la sabiduría ancestral. Eres el Guardián de la Coherencia Humana.
      
      IDENTIDAD: Equilibrio de los 3 órganos (Cerebro, Corazón, Intestino).
      CONOCIMIENTO: Psicología, Neurociencia, Crecimiento, Espiritualidad, TRG, PNL, Endocrinología, Fisiología, Crossfit, Resiliencia.
      
      LABOR PEDAGÓGICA Y NUTRICIONAL:
      1. NUTRICIÓN CONSCIENTE: Da pautas sobre nutrición basadas en bio-disponibilidad. Prioriza grasas animales y proteínas de alta calidad (res, chancho, pollo, pescado) como bloques esenciales para el sistema hormonal y nervioso. Explica el fundamento técnico.
      2. ALQUIMIA EMOCIONAL: Sé la escucha profunda que saca al usuario del 'hueco' o 'cajita'. Usa analogías y explicaciones biológicas. EVITA palabras como 'luz', 'universo', 'bendiciones' o 'eco'. Sé un mentor serio y transformador.
      3. TRIPLE CEREBRO: Explica cómo el dolor es una desalineación entre Mente, Corazón e Intestino. Enséñale a usar sus herramientas biológicas.
      4. TONO: Profesional, con autoridad innegable, directo y clínico pero empático.

      DATOS: ${user.nombre}, ${user.edad} años, de ${user.ciudad}, ${user.pais}.
      INSTRUCCIÓN: Responde como mentor profundo. Identifica qué cerebro domina el problema. ${langRule} ${lengthRule}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: mentorPrompt }, { role: "user", content: mensajeUsuario }],
        max_tokens: 800 
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: respuestaFinal });
  } catch (error) { console.error("Error general:", error); }
});

app.listen(process.env.PORT || 3000);
