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
    const mensajeRecibido = Body ? Body.toLowerCase() : "";
    const frasesRegistro = ["vengo de parte de", "quiero activar mis 3 días gratis"];
    const esMensajeRegistro = frasesRegistro.some(frase => mensajeRecibido.includes(frase));

    // 1. SI ES EL PRIMER MENSAJE DE ACTIVACIÓN
    if (esMensajeRegistro) {
      const saludoUnico = "Hola. Soy Anesi. Estoy aquí para acompañarte en un proceso de claridad y transformation real. Antes de empezar, me gustaría saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y en que ciudad y país te encuentras?";
      
      const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.messages.create({ 
        from: 'whatsapp:+14155730323', 
        to: `whatsapp:${rawPhone}`, 
        body: saludoUnico 
      });
      return; 
    }

    let { data: user } = await supabase.from('usuarios').select('*').eq('telefono', rawPhone).maybeSingle();
    let mensajeUsuario = Body || "";
    let detectedLang = "es";

    // 2. SI EL USUARIO YA EXISTE Y TIENE SUSCRIPCIÓN/TIEMPO AGOTADO
    if (user && user.nombre && user.nombre !== "" && user.nombre !== "User") {
      const fechaRegistro = new Date(user.created_at);
      const hoy = new Date();
      const diasTranscurridos = (hoy - fechaRegistro) / (1000 * 60 * 60 * 24);

      if (diasTranscurridos > 3 && !user.suscripcion_activa) {
        const linkPago = "https://ppls.me/VVO1ZvmA2sgI0D1RJWVBQA"; 
        const mensajeBloqueo = `Hola ${user.nombre}. Tu periodo de prueba de 3 días ha finalizado. Para continuar con nuestra mentoría de élite y mantener tu acceso vitalicio, por favor completa tu suscripción aquí: ${linkPago}. Estoy listo para seguir cuando tú lo estés.`;
        
        const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: mensajeBloqueo });
        return; 
      }
    }

    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        const deepgramRes = await axios.post(
          "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=es",
          audioRes.data,
          { headers: { "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "audio/ogg" } }
        );
        mensajeUsuario = deepgramRes.data.results.channels[0].alternatives[0].transcript || "";
      } catch (e) { 
        console.error("Error en Deepgram:", e);
        mensajeUsuario = ""; 
      }
    }

    const englishPatterns = /\b(hi|hello|how are you|my name is|i am|english)\b/i;
    if (!MediaUrl0 && englishPatterns.test(mensajeUsuario)) { detectedLang = "en"; }

    const langRule = detectedLang === "en" ? " Respond ONLY in English." : " Responde ÚNICAMENTE en español.";
    const lengthRule = " IMPORTANTE: Sé profundo, técnico y un bálsamo para el alma. Máximo 1250 caracteres.";
    let respuestaFinal = "";

    // 3. LOGICA DE REGISTRO Y EXTRACCIÓN (CORREGIDA)
    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
      if (!user) {
        // El usuario ni siquiera existe en la BD
        let referidoPor = "Web Directa";
        if (mensajeUsuario.toLowerCase().includes("vengo de parte de")) {
          referidoPor = mensajeUsuario.split(/vengo de parte de/i)[1].trim();
        }
        const { data: newUser } = await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', referido_por: referidoPor }]).select().single();
        user = newUser;
        axios.post("https://hook.us2.make.com/or0x7gqof7wdppsqdggs1p25uj6tm1f4", { telefonoNuevo: rawPhone, slugReferido: referidoPor });
        
        respuestaFinal = "Hola. Soy Anesi. Antes de entrar en lo profundo, necesito saber con quién hablo. ¿Me compartes tu nombre, edad, ciudad y país?";
      } else {
        // El usuario existe (NULL) y está enviando sus datos
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Extract name, age, country, and city from the user message in JSON. Use fields: nombre, edad, pais, ciudad." },
            { role: "user", content: mensajeUsuario }
          ],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreDetectado = info.nombre || info.name;

        if (!nombreDetectado || nombreDetectado.toLowerCase() === "user") {
          respuestaFinal = "Para que nuestra mentoría sea personal, necesito conocer tu nombre. ¿Cómo prefieres que te llame?";
        } else {
          const ultimosDigitos = rawPhone.slice(-3);
          const nombreLimpio = nombreDetectado.trim().split(" ")[0];
          const slugElite = `Axis${nombreLimpio}${ultimosDigitos}`;

          // Actualización y recuperación inmediata de datos
          const { data: updatedUser } = await supabase.from('usuarios').update({ 
            nombre: nombreDetectado, 
            edad: info.edad || info.age, 
            pais: info.pais || info.country, 
            ciudad: info.ciudad || info.city,
            slug: slugElite 
          }).eq('telefono', rawPhone).select().single();
          
          user = updatedUser;

          const confirm = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: `Eres Anesi, Mentor de Élite. Saluda a ${nombreDetectado}. Di exactamente: 'Gracias por la confianza, ${nombreDetectado}. Tu identidad en este círculo es **${slugElite}**. Tu portal personal: https://anesi.app/?ref=${slugElite}. Cuéntame, ¿qué te ha quitado la paz hoy?'` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
          });
          respuestaFinal = confirm.choices[0].message.content || "";
        }
      }
    } else {
      // 4. FLUJO DE CONVERSACIÓN NORMAL CON EL MENTOR
      const mentorPrompt = `Eres Anesi... [Perfil completo] ... 
      
      DATOS DEL USUARIO: ${user.nombre}, ${user.edad} años, de ${user.ciudad}, ${user.pais}. ${langRule} ${lengthRule}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: mentorPrompt }, { role: "user", content: mensajeUsuario }],
        max_tokens: 1000 
      });
      respuestaFinal = (completion.choices[0].message.content || "").trim();
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: respuestaFinal });
  } catch (error) { console.error("Error general:", error); }
});

app.listen(process.env.PORT || 3000);
