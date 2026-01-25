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
    // 1. BUSCAR USUARIO
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('*').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();

    // 2. PROCESAR MENSAJE (TEXTO O VOZ)
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

    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING (Si faltan datos clave)
    if (!user || !user.nombre || !user.pais || !user.ciudad) {
      
      if (!user) {
        // Primerísimo contacto: Pedir datos
        respuestaFinal = "Me hace muy feliz que estés aquí. Fíjate que para poder acompañarte de forma personalizada y entender mejor tu entorno, me encantaría conocerte un poquito más. ¿Podrías decirme tu nombre, cuántos años tienes y desde qué ciudad y país me escribes? Saber esto me ayuda a que mi guía sea mucho más precisa para ti.";
        // Crear registro inicial vacío para marcar que ya empezamos el onboarding
        await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta' }]);
      } else {
        // El usuario está respondiendo sus datos: Usar IA para extraerlos
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Extrae: nombre, edad (numero), pais, ciudad del texto. Responde SOLO un JSON plano. Si falta algo, pon null." },
            { role: "user", content: mensajeUsuario }
          ],
          response_format: { type: "json_object" }
        });
        
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        
        // Actualizar Supabase con lo que encontramos
        await supabase.from('usuarios').update({
          nombre: info.nombre,
          edad: info.edad,
          pais: info.pais,
          ciudad: info.ciudad,
          fase: 'beta'
        }).ilike('telefono', `%${ultimosDigitos}%`);

        respuestaFinal = `¡Gracias por compartir esto conmigo, ${info.nombre || 'amigo/a'}! Ahora que estamos conectados, cuéntame: ¿Qué es lo que más te ha estado robando la paz en estos días? Te escucho.`;
      }
    } else {
      // 4. MODO MENTOR NORMAL (Usuario ya registrado)
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: `Eres Anesi, Mentor humano y sabio, experto en de los 3 Cerebros intestino, corazón y neocortex. Además eres experto en psicología, neurociencia, crecimiento personal, espiritualidad, holistica, terapia de reprocesamiento generativo de la mente, conoces a fondo sobre PNL, endocrinologia, fisiología humana, fisioterapia, entrenador de Crossfit, biología del cuerpo humano. Usuario: ${user.nombre}, ${user.edad} años, desde ${user.ciudad}, ${user.pais}. 
            REGLAS: Natural, cálido, sin saludos repetitivos. No uses "corazón/cariño". Explica la conexión biológica en 3 frases max.` 
          },
          { role: "user", content: mensajeUsuario }
        ]
      });
      respuestaFinal = (completion.choices[0].message.content || "").replace(/\[.*?\]/g, "").trim();
    }

    // 5. ENVÍO POR TWILIO
    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      from: 'whatsapp:+14155238886', 
      to: `whatsapp:${rawPhone}`,
      body: respuestaFinal
    });

  } catch (error: any) {
    console.error("==> ERROR:", error.message);
  }
});

app.listen(process.env.PORT || 3000);
