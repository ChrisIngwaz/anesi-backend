import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
import cors from "cors"; 
const FormData = require('form-data');

const app = express();
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- CONFIGURACIÓN PAYPHONE ---
const PAYPHONE_CONFIG = {
  token: process.env.PAYPHONE_TOKEN,
  storeId: process.env.PAYPHONE_STORE_ID
};

// --- RUTA: CONFIRMACIÓN DE PAGO (Aquí es donde ocurre la magia del referido) ---
app.post("/confirmar-pago", async (req, res) => {
    const { id, clientTxId } = req.body;
  
    try {
      const response = await axios.post(
        'https://pay.payphonetodoesposible.com/api/button/V2/Confirm',
        { id: parseInt(id), clientTxId: clientTxId },
        { headers: { 'Authorization': `Bearer ${PAYPHONE_CONFIG.token}` } }
      );
  
      if (response.data.transactionStatus === 'Approved') {
        const cardToken = response.data.cardToken; 
        const email = response.data.email;
  
        // 1. Actualizamos al usuario en Supabase y recuperamos sus datos (incluyendo quién lo refirió)
        const { data: users, error: updateError } = await supabase.from('usuarios')
          .update({ 
            suscripcion_activa: true, 
            payphone_token: cardToken,
            ultimo_pago: new Date()
          })
          .eq('email', email)
          .select(); // El .select() es vital para obtener el 'referido_por'

        const user = (users && users.length > 0) ? users[0] : null;

        if (user) {
          // 2. DISPARO A MAKE: Solo si el pago es exitoso y tiene un mentor referido
          if (user.referido_por && user.referido_por !== "Web Directa") {
            try {
              await axios.post("https://hook.us2.make.com/or0x7gqof7wdppsqdggs1p25uj6tm1f4", { 
                email_invitado: email, 
                referido_por: user.referido_por,
                status: "pago_confirmado", // Cambiamos el status para que Make sepa que es venta real
                nombre_invitado: user.nombre || "Nuevo Miembro"
              });
              console.log(`Aviso enviado a Make para el mentor: ${user.referido_por}`);
            } catch (makeErr) {
              console.error("Error avisando a Make:", makeErr.message);
            }
          }

          // 3. WHATSAPP DE BIENVENIDA (Twilio)
          try {
            const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            await twilioClient.messages.create({
              from: 'whatsapp:+14155730323',
              to: `whatsapp:${user.telefono}`,
              body: `¡Victoria, ${user.nombre}! Tu suscripción de Élite ha sido activada.\n\nHas tomado el mando de tu biología. Desde este momento, nuestra comunicación no tiene límites. Cuéntame, ¿qué hay en tu mente hoy? Te escucho.`
            });
          } catch (twErr) {
            console.error("Error enviando WhatsApp de bienvenida:", twErr.message);
          }
        }
  
        res.status(200).json({ success: true });
      } else {
        res.status(400).json({ success: false });
      }
    } catch (error) {
      console.error("Error confirmando pago:", error.response?.data || error.message);
      res.status(500).send("Error");
    }
});

// --- RUTA WEBHOOK PARA RECIBIR EL TOKEN (RESPALDO) ---
app.post("/payphone-webhook", async (req, res) => {
  const { transactionStatus, cardToken, email } = req.body;
  if (transactionStatus === 'Approved' && cardToken) {
    await supabase.from('usuarios')
      .update({ suscripcion_activa: true, payphone_token: cardToken, ultimo_pago: new Date() })
      .eq('email', email);
  }
  res.status(200).send("OK");
});

// --- RUTA WHATSAPP (Lógica de Anesi Intacta) ---
app.post("/whatsapp", async (req, res) => {
  const { From, Body, MediaUrl0 } = req.body;
  const rawPhone = From ? From.replace("whatsapp:", "") : "";
  res.status(200).send("OK");

  try {
    const mensajeRecibido = Body ? Body.toLowerCase() : "";
    const frasesRegistro = ["vengo de parte de", "quiero activar mis 3 días gratis"];
    const esMensajeRegistro = frasesRegistro.some(frase => mensajeRecibido.includes(frase));

    let { data: user } = await supabase.from('usuarios').select('*').eq('telefono', rawPhone).maybeSingle();

    if (esMensajeRegistro && !user) {
      const saludoUnico = "Hola. Soy Anesi. Estoy aquí para acompañarte en un proceso de claridad y transformación real. Antes de empezar, me gustaría saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y en qué ciudad y país te encuentras?";
      const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: saludoUnico });

      let referidoPor = "Web Directa";
      if (mensajeRecibido.includes("vengo de parte de")) {
        referidoPor = Body.split(/vengo de parte de/i)[1].trim();
      }
      await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', referido_por: referidoPor }]);
      return; 
    }

    let mensajeUsuario = Body || "";

    if (user && user.nombre && user.nombre !== "" && user.nombre !== "User") {
      const fechaRegistro = new Date(user.created_at);
      const hoy = new Date();
      const diasTranscurridos = (hoy - fechaRegistro) / (1000 * 60 * 60 * 24);

      if (diasTranscurridos > 3 && !user.suscripcion_activa) {
        const linkPago = "https://anesi.app/soberania.html"; 
        const mensajeBloqueo = `Hola ${user.nombre}. Durante estos tres días, Anesi te ha acompañado a explorar las herramientas que ya habitan en ti. Para mantener este espacio de absoluta claridad, **sigilo y privacidad**, es momento de activar tu acceso permanente aquí: ${linkPago}. (Suscripción mensual: $9, cobro automático para tu comodidad).`;
        const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({ from: 'whatsapp:+14155730323', to: `whatsapp:${rawPhone}`, body: mensajeBloqueo });
        return; 
      }
      // El aviso a Make se eliminó de aquí para que NO cuente registros gratis, solo pagos en la ruta superior.
    }

    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        const deepgramRes = await axios.post("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true", audioRes.data, {
            headers: { "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "audio/ogg" }
        });
        mensajeUsuario = deepgramRes.data.results.channels[0].alternatives[0].transcript || "";
      } catch (e) { console.error("Error en Deepgram:", e); mensajeUsuario = ""; }
    }

    const langRule = " Anesi es políglota y camaleónica. Detectarás automáticamente el idioma en el que el usuario te escribe y responderás siempre en ese mismo idioma con fluidez nativa...";
    const lengthRule = " IMPORTANTE: Sé profundo, técnico y un bálsamo para el alma. Máximo 1250 caracteres.";

    let respuestaFinal = "";

    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Extract name, age, country, and city..." }, { role: "user", content: mensajeUsuario }],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreDetectado = info.name || info.nombre;

        if (!nombreDetectado || nombreDetectado.trim() === "" || nombreDetectado.toLowerCase() === "user") {
          respuestaFinal = "Para que nuestra mentoría sea de élite... necesito conocer tu nombre...";
        } else {
          const ultimosDigitos = rawPhone.slice(-3);
          const nombreLimpio = nombreDetectado.trim().split(" ")[0];
          const slugElite = `Axis${nombreLimpio}${ultimosDigitos}`;
          await supabase.from('usuarios').update({ nombre: nombreDetectado, edad: info.age, pais: info.country, ciudad: info.city, slug: slugElite }).eq('telefono', rawPhone);
          const confirm = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: `Eres Anesi, Mentor de Élite. Valida al usuario por su nombre (${nombreDetectado})...` }, { role: "user", content: mensajeUsuario }]
          });
          respuestaFinal = confirm.choices[0].message.content || "";
        }
    } else {
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica... 
      
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
