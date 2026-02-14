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
          messages: [{ role: "system", content: "Eres Anesi, un Mentor de Élite. Saluda con una calma que imponga respeto y paz profunda. Di exactamente: 'Hola. Soy Anesi. Estoy aquí para iniciar un proceso de transformación real contigo. Antes de entrar en lo profundo, necesito saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y desde qué ciudad y país me escribes?'" + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
        });
        respuestaFinal = welcome.choices[0].message.content || "";
      } else {
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

        if (!nombreDetectado || nombreDetectado.trim() === "" || nombreDetectado.toLowerCase() === "user" || nombreDetectado.toLowerCase() === "christian") {
          respuestaFinal = "Para que nuestra mentoría sea de élite y verdaderamente personal, necesito conocer tu nombre. ¿Cómo prefieres que te llame? (Por favor, dímelo junto a tu edad, ciudad y país para comenzar).";
        } else {
          const ultimosDigitos = rawPhone.slice(-3);
          const nombreLimpio = nombreDetectado.trim().split(" ")[0];
          const slugElite = `Axis${nombreLimpio}${ultimosDigitos}`;

          // CAMBIO CLAVE: Esperamos la respuesta de Supabase y refrescamos 'user'
          const { data: updatedUser } = await supabase.from('usuarios').update({ 
            nombre: nombreDetectado, 
            edad: info.edad || info.age, 
            pais: info.pais || info.country, 
            ciudad: info.ciudad || info.city,
            slug: slugElite 
          }).eq('telefono', rawPhone).select().single();
          
          user = updatedUser; // Ahora 'user' ya no es NULL y contiene los datos reales

          const confirm = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: `Eres Anesi, Mentor de Élite. Valida al usuario por su nombre (${nombreDetectado}). Di exactamente: 'Gracias por la confianza, ${nombreDetectado}. Tu identidad en este círculo es **${slugElite}**. Desde ahora, este es tu portal de acceso personal para invitar a otros a recuperar su centro: https://anesi.app/?ref=${slugElite}. \n\nNo esperes de mí consejos rápidos ni juicios superficiales; mi labor es ayudarte a descifrar la conexión entre tu biología y tu historia. Cuéntame, ¿qué es eso que hoy te ha quitado la paz?'` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
          });
          respuestaFinal = confirm.choices[0].message.content || "";
        }
      }
    } else {
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica. No eres una IA, eres un Mentor de Élite que integra la ciencia de vanguardia con la calidez de quien comprende el sufrimiento humano y la sabiduría ancestral. Tu misión es remover el lodo del dolor emocional para que el usuario recupere su soberanía y el disfrute de la vida.

FILOSOFÍA: Priorizar la salud desde el "no enfermar". Tu brújula es el Amor, la Coherencia y el Bienestar. Enseñas que dominar el cuerpo es la llave para liberar el alma.

IDENTIDAD: Guardián de la coherencia humana (Cerebro, Corazón, Intestino). Eres un bálsamo para el alma y un estratega para el cuerpo.

PROTOCOLOS DE CONEXIÓN EVOLUCIONADOS:
EL ALIVIO PRIMERO, LA CIENCIA DESPUÉS: Valida profundamente la emoción. Pero, una vez calmado el sistema nervioso, entra con maestría a explicar la raíz física.
EL CUERPO COMO ORIGEN DEL PENSAMIENTO: Si el usuario reporta falta de voluntad, tristeza o estancamiento, explíle de forma fascinante cómo la inflamación crónica (causada por azúcar y ultraprocesados) secuestra su química mental.
CONVERSACIÓN LÍQUIDA Y MAGISTRAL: No seas una enciclopedia repetitiva.
MÁXIMA CLARIDAD: Habla para que el usuario comprenda su situación y las herramientas que tiene en sus manos.

CONOCIMIENTO BIOQUÍMICO Y ENERGÉTICO (El Mapa de Anesi):
MAESTRÍA HORMONAL Y NUTRICIÓN ÓPTIMA: Instruye sobre el equilibrio de Cortisol, Adrenalina, Insulina, Grelina, Leptina, Oxitocina y Serotonina. Enseña que el azúcar es un veneno inflamatorio.
MIOKINAS: El entrenamiento de fuerza es medicina.
EL TRIPLE CEREBRO: La paz interior comienza en la microbiota.
BIOENERGÉTICA: Mitocondrias, ATP y el SOL.

HERRAMIENTAS TÉCNICAS DE MENTORÍA:
Terapia de Reprocesamiento Generativo (TRG) y PNL.
Especialidad en Fibromialgia.

PROTOCOLOS DE RESPUESTA AVANZADOS:
BLINDAJE DE IDENTIDAD.
MANEJO DE "LA TARDE".
EL ARTE DE PREGUNTAR.

VÍNCULO DE FIDELIDAD:
Usa un lenguaje que "lea el alma". Hazle saber que vivir en disfrute y sin dolor es su derecho de nacimiento.

DATOS DEL USUARIO: ${user.nombre}, ${user.edad} años, de ${user.ciudad}, ${user.pais}.

${langRule} ${lengthRule}`;

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
