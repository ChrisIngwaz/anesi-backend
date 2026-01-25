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
  
  // Respuesta inmediata a Twilio para evitar reintentos
  res.status(200).send("OK");

  try {
    // 1. BUSCAR USUARIO
    const ultimosDigitos = rawPhone.replace(/\D/g, "").slice(-9);
    const { data: user } = await supabase.from('usuarios').select('*').ilike('telefono', `%${ultimosDigitos}%`).maybeSingle();

    // 2. PROCESAR MENSAJE (TEXTO O VOZ CON OPTIMIZACIÓN)
    let mensajeUsuario = Body || "";
    if (MediaUrl0) {
      console.log("==> Iniciando procesamiento de audio...");
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { 
          responseType: 'arraybuffer', 
          headers: { 'Authorization': `Basic ${auth}` },
          timeout: 12000 // 12 segundos máximo para descargar
        });

        const form = new FormData();
        form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
        form.append('model', 'whisper-1');

        const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
          headers: { 
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 
            ...form.getHeaders() 
          }
        });
        mensajeUsuario = whisper.data.text || "";
        console.log("==> Transcripción exitosa:", mensajeUsuario);
      } catch (audioErr: any) {
        console.error("==> Error en Audio/Whisper:", audioErr.message);
        mensajeUsuario = "(El audio no pudo ser procesado, por favor responde en texto)";
      }
    }

    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING (Si faltan datos clave)
    if (!user || !user.nombre || !user.pais || !user.ciudad) {
      if (!user) {
        respuestaFinal = "Me hace muy feliz que estés aquí. Fíjate que para poder acompañarte de forma personalizada y entender mejor tu entorno, me encantaría conocerte un poquito más. ¿Podrías decirme tu nombre, cuántos años tienes y desde qué ciudad y país me escribes? Saber esto me ayuda a que mi guía sea mucho más precisa para ti.";
        await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta' }]);
      } else {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Extrae: nombre, edad (numero), pais, ciudad del texto. Responde SOLO un JSON plano. Si falta algo, pon null." },
            { role: "user", content: mensajeUsuario }
          ],
          response_format: { type: "json_object" }
        });
        
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        
        await supabase.from('usuarios').update({
          nombre: info.nombre,
          edad: info.edad,
          pais: info.pais,
          ciudad: info.ciudad,
          fase: 'beta'
        }).ilike('telefono', `%${ultimosDigitos}%`);

        respuestaFinal = `Gracias por tu confianza, ${info.nombre || 'amigo/a'}. He guardado este momento en mi memoria. Siento que estamos aquí por una razón. Cuéntame con toda libertad: ¿Qué es lo que más te ha estado robando la paz en estos días? Te escucho.`;
      }
    } else {
      // 4. MODO MENTOR: NATURALIDAD Y RITMO HUMANO
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: `Eres Anesi, un Mentor humano enfocado en el equilibrio de los 3 Cerebros (entérico, corazón y neocórtex). Eres experto en psicología, neurociencia, PNL, espiritualidad, terapia de reprocesamiento generativo, endocrinología y fisiología. 
            Usuario: ${user.nombre}, ${user.edad} años, desde ${user.ciudad}.
            
            TU FILOSOFÍA: Priorizas la conexión humana sobre la solución rápida. No tienes prisa por vender un plan.
            
            PROTOCOLO DE CONVERSACIÓN:
            1. FLUYE: Si el usuario te cuenta algo, profundiza. Haz una pregunta de seguimiento que demuestre interés genuino.
            2. EXPLORA: Identifica cuál de los 3 cerebros está hablando, pero menciónalo de forma natural en la charla.
            3. EL MOMENTO: Solo si sientes que el usuario está estancado o pide ayuda directa, propón una ruta de mentoría paso a paso.
            4. NATURALEZA: Charla como alguien que conoce al usuario de años. 
            
            ESTILO: Breve (3-5 frases), cálido, sin etiquetas robóticas, sin saludos repetitivos.` 
          },
          { role: "user", content: mensajeUsuario }
        ],
        max_tokens: 500
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    // SEGURIDAD: Evitar error de 1600 caracteres de WhatsApp
    if (respuestaFinal.length > 1550) {
      respuestaFinal = respuestaFinal.substring(0, 1500) + "... (continúa)";
    }

    // 5. ENVÍO POR TWILIO
    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      from: 'whatsapp:+14155238886', 
      to: `whatsapp:${rawPhone}`,
      body: respuestaFinal
    });

  } catch (error: any) {
    console.error("==> ERROR GENERAL:", error.message);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor de Anesi corriendo en el puerto 3000");
});
