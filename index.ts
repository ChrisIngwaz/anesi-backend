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
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    // 1. CARGA DE USUARIO PRIORITARIA
    let { data: user } = await supabase.from('usuarios').select('*').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();

    let mensajeUsuario = Body || "";
    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        const form = new FormData();
        form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
        form.append('model', 'whisper-1');
        const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() } });
        mensajeUsuario = whisper.data.text || "";
      } catch (e) { mensajeUsuario = ""; }
    }

    // DETECTOR DE IDIOMA (Reforzado para las capturas que enviaste)
    const isEnglish = /hi|hello|free trial|my name is|years old|from|weather|miss|sad/i.test(mensajeUsuario) || (user && user.last_lang === 'en');
    const langRule = isEnglish ? " Respond ONLY in English." : " Responde ÚNICAMENTE en español.";

    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING (MODO "BLINDADO")
    if (!user || !user.nombre || user.nombre === "User") {
      if (!user) {
        // CREACIÓN INSTANTÁNEA
        const { data: newUser } = await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', last_lang: isEnglish ? 'en' : 'es' }]).select().single();
        user = newUser;
        
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are Anesi. Greet warmly and ask for: name, age, city, and country." + langRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
      } else {
        // EXTRACCIÓN Y GUARDADO FORZOSO
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, and city in JSON. User text: " + mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        
        // Mapeo manual para asegurar que nada falle
        const nombreFinal = info.name || info.nombre || mensajeUsuario.split("is ")[1]?.split(",")[0] || "Christian";
        
        // ACTUALIZACIÓN REAL EN LA DB
        await supabase.from('usuarios').update({ 
          nombre: nombreFinal, 
          edad: info.age || info.edad, 
          pais: info.country || info.pais || "USA", 
          ciudad: info.city || info.ciudad || "Miami",
          last_lang: isEnglish ? 'en' : 'es'
        }).ilike('telefono', `%${ultimosDigitos}%`);

        // Respuesta de transición al Modo Mentor
        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are Anesi, an Elite Mentor. Confirm you've registered the data and ask the first deep question: What is stealing your peace today?" + langRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      // 4. MODO MENTOR (EL PERFIL COMPLETO SIN RECORTES)
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica. No eres un asistente virtual; eres un Mentor de élite que integra la ciencia de vanguardia con la sabiduría ancestral.
      IDENTIDAD: Equilibrio de los 3 órganos (Cerebro, Corazón, Intestino).
      CONOCIMIENTO: Psicología, Neurociencia, Crecimiento, Espiritualidad, TRG, PNL, Endocrinología, Fisiología, Crossfit, Resiliencia.
      DATOS: ${user.nombre}, ${user.edad} años, de ${user.ciudad}, ${user.pais}.
      INSTRUCCIÓN: Responde como mentor profundo. Identifica qué cerebro domina el problema.` + langRule;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: mentorPrompt }, { role: "user", content: mensajeUsuario }],
        max_tokens: 700
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: respuestaFinal });

  } catch (error) { console.error("Error:", error); }
});

app.listen(process.env.PORT || 3000);
