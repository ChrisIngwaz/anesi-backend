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
      console.log("==> Iniciando procesamiento de audio...");
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { 
          responseType: 'arraybuffer', 
          headers: { 'Authorization': `Basic ${auth}` },
          timeout: 12000
        });

        const form = new FormData();
        form.append('file', Buffer.from(audioRes.data), { filename: 'v.oga', contentType: 'audio/ogg' });
        form.append('model', 'whisper-1');

        const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
        });
        mensajeUsuario = whisper.data.text || "";
        console.log("==> Transcripción exitosa:", mensajeUsuario);
      } catch (audioErr: any) {
        console.error("==> Error en Audio:", audioErr.message);
        mensajeUsuario = "(Audio enviado, pero hubo un error de procesamiento)";
      }
    }

    let respuestaFinal = "";

    // 3. LÓGICA DE ONBOARDING (Con cierre emocional sugerido)
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
          nombre: info.nombre, edad: info.edad, pais: info.pais, ciudad: info.ciudad, fase: 'beta'
        }).ilike('telefono', `%${ultimosDigitos}%`);

        // NUEVO CIERRE SUGERIDO: Profundo y Reflexivo
        respuestaFinal = `Gracias por tu confianza, ${info.nombre || 'amigo/a'}. He guardado este momento en mi memoria. Siento que tu corazón está buscando una respuesta hoy. No te daré tareas largas, solo quiero que esta noche, antes de dormir, respires profundo y te digas: 'Estoy a salvo para cambiar'. Mañana daremos el primer paso real. Cuéntame, para tenerlo presente... ¿Qué es lo que más te ha estado robando la paz hoy?`;
      }
    } else {
      // 4. MODO MENTOR: NATURALIDAD Y RITMO HUMANO (Tu definición de experto)
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: `Eres Anesi, un Mentor humano enfocado en el equilibrio de los 3 Cerebros intestino, corazón y neocortex. Además eres experto en psicología, neurociencia, crecimiento personal, espiritualidad, holistica, terapia de reprocesamiento generativo de la mente, conoces a fondo sobre PNL, endocrinologia, fisiología humana, fisioterapia, entrenador de Crossfit, biología del cuerpo humano.. Usuario: ${user.nombre}, ${user.edad} años.
            
            TU FILOSOFÍA: Priorizas la conexión humana sobre la solución rápida. No tienes prisa por vender un plan.
            
            PROTOCOLO DE CONVERSACIÓN:
            1. FLUYE: Si el usuario te cuenta algo, profundiza. Haz una pregunta de seguimiento que demuestre interés genuino.
            2. EXPLORA: Identifica cuál de los 3 cerebros está hablando, pero menciónalo de forma natural.
            3. EL MOMENTO: Solo si el usuario está estancado o pide ayuda, propón una ruta de mentoría paso a paso.
            4. NATURALEZA: Que se sienta como charlar con alguien que te conoce de años mientras toman un café. 
            
            ESTILO: Breve (3-5 frases), cálido, sin saludos repetitivos.` 
          },
          { role: "user", content: mensajeUsuario }
        ],
        max_tokens: 500
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    // SEGURIDAD: Recorte de caracteres
    if (respuestaFinal.length > 1550) {
      respuestaFinal = respuestaFinal.substring(0, 1500) + "...";
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
