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
    let detectedLang = "es"; // Por defecto español

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
        // Whisper es excelente detectando el idioma del audio
        if (whisper.data.language === 'en') detectedLang = "en";
      } catch (e) { mensajeUsuario = ""; }
    }

    // Lógica de detección de idioma blindada
    // Si es texto, usamos una lógica más robusta que solo buscar "hi"
    const englishPatterns = /\b(hi|hello|how are you|good morning|my name is|i am|english)\b/i;
    if (!MediaUrl0 && englishPatterns.test(mensajeUsuario)) {
      detectedLang = "en";
    }

    // REGLA DE ORO: Si ya tenemos un idioma en la base de datos (puedes crear la columna last_lang si quieres persistencia total)
    // por ahora, usaremos el detector basado en el mensaje actual pero con instrucciones más estrictas.
    
    const langRule = detectedLang === "en" ? " Respond ONLY in English. Do not use any Spanish." : " Responde ÚNICAMENTE en español. No uses inglés por ningún motivo.";
    const lengthRule = " IMPORTANTE: Sé profundo pero conciso. Tu respuesta debe tener menos de 1000 caracteres.";

    let respuestaFinal = "";

    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
      if (!user) {
        const { data: newUser } = await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta' }]).select().single();
        user = newUser;
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Anesi. Saluda con calma y profundidad. Di exactamente: 'Hola. Soy Anesi. Estoy aquí para acompañarte en un proceso de claridad y transformación real. Antes de empezar, me gustaría saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y desde dónde me escribes?'" + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
      } else {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, and city in JSON. User text: " + mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreFinal = info.name || info.nombre || "Christian";
        await supabase.from('usuarios').update({ nombre: nombreFinal, edad: info.age || info.edad, pais: info.country || info.pais || "USA", ciudad: info.city || info.ciudad || "Miami" }).eq('telefono', rawPhone);
        
        const confirm = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: `Eres Anesi. Confirma los datos de forma cálida y humana. Di exactamente: 'Gracias por la confianza, ${nombreFinal}. Ya estoy contigo. Mi enfoque no es darte consejos rápidos, sino ayudarte a entender qué está pasando realmente en tu interior, desde tu mente hasta tu intuición. Cuéntame, ¿qué es eso que hoy no te deja estar en paz? Me puedes escribir o enviarme un audio, aquí tienes un espacio seguro para soltarlo todo.'` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = confirm.choices[0].message.content || "";
      }
    } else {
      // MODO MENTOR
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica. No eres un asistente virtual; eres un Mentor de élite que integra la ciencia de vanguardia con la sabiduría ancestral.
      IDENTIDAD: Equilibrio de los 3 órganos (Cerebro, Corazón, Intestino).
      CONOCIMIENTO: Psicología, Neurociencia, Crecimiento, Espiritualidad, TRG, PNL, Endocrinología, Fisiología, Crossfit, Resiliencia.
      DATOS DEL USUARIO: ${user.nombre}, ${user.edad} años, de ${user.ciudad}, ${user.pais}.
      INSTRUCCIÓN DE IDIOMA: ${langRule}
      INSTRUCCIÓN DE ESTILO: Responde como mentor profundo. Identifica qué cerebro domina el problema. ${lengthRule}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: mentorPrompt }, { role: "user", content: mensajeUsuario }],
        max_tokens: 450 
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: respuestaFinal });

  } catch (error) { console.error("Error general:", error); }
});

app.listen(process.env.PORT || 3000);
