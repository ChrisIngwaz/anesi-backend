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

    if (esMensajeRegistro) {
      const saludoUnico = "Hola. Soy Anesi. Estoy aquí para acompañarte en un proceso de claridad y transformación real. Antes de empezar, me gustaría saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y en qué ciudad y país te encuentras?";
      
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

    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
      if (!user) {
        let referidoPor = "Web Directa";
        if (mensajeUsuario.toLowerCase().includes("vengo de parte de")) {
          referidoPor = mensajeUsuario.split(/vengo de parte de/i)[1].trim();
        }
        const { data: newUser } = await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', referido_por: referidoPor }]).select().single();
        user = newUser;
        axios.post("https://hook.us2.make.com/or0x7gqof7wdppsqdggs1p25uj6tm1f4", { telefonoNuevo: rawPhone, slugReferido: referidoPor });
        
        const welcome = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Anesi, un Mentor de Élite. Saluda con calma. Di exactamente: 'Hola. Soy Anesi. Estoy aquí para iniciar un proceso de transformación real contigo. Antes de entrar en lo profundo, necesito saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y desde qué ciudad y país me escribes?'" + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
      } else {
        // --- EXTRACCIÓN MEJORADA Y NORMALIZADA ---
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Extract info from user message. Return ONLY JSON with keys: 'nombre', 'edad', 'pais', 'ciudad'. If a value is missing, use null." },
            { role: "user", content: mensajeUsuario }
          ],
          response_format: { type: "json_object" }
        });
        
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        
        // Mapeo defensivo para evitar NULLs por llaves en inglés o mayúsculas
        const n_nombre = info.nombre || info.name || info.Nombre || null;
        const n_edad = info.edad || info.age || info.Edad || null;
        const n_pais = info.pais || info.country || info.Pais || null;
        const n_ciudad = info.ciudad || info.city || info.Ciudad || null;

        if (!n_nombre) {
          respuestaFinal = "Para que nuestra mentoría sea de élite, necesito conocer tu nombre. ¿Cómo prefieres que te llame?";
        } else {
          const ultimosDigitos = rawPhone.slice(-3);
          const slugElite = `Axis${n_nombre.trim().split(" ")[0]}${ultimosDigitos}`;

          // Actualización forzada en Supabase
          const { data: updatedUser, error: updateError } = await supabase.from('usuarios').update({ 
            nombre: n_nombre, 
            edad: n_edad, 
            pais: n_pais, 
            ciudad: n_ciudad,
            slug: slugElite 
          }).eq('telefono', rawPhone).select().single();

          if (updateError) console.error("Error actualizando Supabase:", updateError);
          
          user = updatedUser || user;

          const confirm = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: `Eres Anesi, Mentor de Élite. Saluda a ${n_nombre}. Di exactamente: 'Gracias por la confianza, ${n_nombre}. Tu identidad en este círculo es **${slugElite}**. Desde ahora, este es tu portal de acceso personal para invitar a otros a recuperar su centro: https://anesi.app/?ref=${slugElite}. \n\nNo esperes de mí consejos rápidos ni juicios superficiales; mi labor es ayudarte a descifrar la conexión entre tu biología y tu historia. Cuéntame, ¿qué es eso que hoy te ha quitado la paz?'` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
          });
          respuestaFinal = confirm.choices[0].message.content || "";
        }
      }
    } else {
      const mentorPrompt = `Eres Anesi... [Resto del perfil largo que ya tienes] ... 
      
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
