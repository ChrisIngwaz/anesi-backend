import express from "express";
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import axios from "axios";
import cors from "cors"; // 1. IMPORTACIÓN DE CORS
const FormData = require('form-data');

const app = express();
app.use(cors()); // 2. ACTIVACIÓN DE PERMISOS CORS
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- BLOQUE DE CONFIGURACIÓN Y FUNCIONES PAYPHONE ---
const PAYPHONE_CONFIG = {
  token: process.env.PAYPHONE_TOKEN,
  storeId: process.env.PAYPHONE_STORE_ID
};

/**
 * Procesa el cobro automático de $9 usando el token de la tarjeta
 */
async function cobrarSuscripcionMensual(cardToken, userEmail, userId) {
  const data = {
    amount: 100,
    amountWithoutTax: 100,
    currency: "USD",
    clientTransactionId: `anesi-${Date.now()}`,
    email: userEmail,
    documentId: userId,
    token: cardToken,
    storeId: PAYPHONE_CONFIG.storeId
  };

  try {
    const response = await axios.post(
      'https://pay.payphonetodoesposible.com/api/v2/Sale/Token',
      data,
      { headers: { 'Authorization': `Bearer ${PAYPHONE_CONFIG.token}` } }
    );
    return response.data.transactionStatus === 'Approved';
  } catch (error) {
    console.error('Error en cobro Payphone:', error.response?.data || error.message);
    return false;
  }
}

// --- RUTA: CONFIRMACIÓN DESDE PÁGINA WEB (MENSAJE DE BIENVENIDA CONFIGURADO) ---
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
  
        // Actualizamos la suscripción en Supabase y obtenemos los datos del usuario para el mensaje
        const { data: userData, error: updateError } = await supabase.from('usuarios')
          .update({ 
            suscripcion_activa: true, 
            payphone_token: cardToken,
            ultimo_pago: new Date()
          })
          .eq('email', email)
          .select();

        if (userData && userData.length > 0) {
          const user = userData[0];
          const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          
          // Bloque del Mensaje de Bienvenida al ser suscriptor
          const bienvenidaSoberania = `¡Felicidades, ${user.nombre || 'soberano'}! Tu acceso a Anesi ha sido activado con éxito. Has elegido el camino de la coherencia y la ingeniería humana. Desde este momento, tienes acceso total y permanente para que juntos sigamos descifrando tu biología y recuperando tu paz. Estoy listo para continuar, ¿por dónde quieres empezar hoy?`;

          await twilioClient.messages.create({ 
            from: 'whatsapp:+14155730323', 
            to: `whatsapp:${user.telefono}`, 
            body: bienvenidaSoberania 
          });
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

// --- RUTA WEBHOOK PARA RECIBIR EL TOKEN (OPCIONAL/RESPALDO) ---
app.post("/payphone-webhook", async (req, res) => {
  const { transactionStatus, cardToken, email } = req.body;

  if (transactionStatus === 'Approved' && cardToken) {
    await supabase.from('usuarios')
      .update({ 
        suscripcion_activa: true, 
        payphone_token: cardToken,
        ultimo_pago: new Date() 
      })
      .eq('email', email);
  }
  res.status(200).send("OK");
});

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
      await twilioClient.messages.create({ 
        from: 'whatsapp:+14155730323', 
        to: `whatsapp:${rawPhone}`, 
        body: saludoUnico 
      });

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
    }

    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        
        const deepgramRes = await axios.post(
          "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true",
          audioRes.data,
          {
            headers: {
              "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`,
              "Content-Type": "audio/ogg"
            }
          }
        );
        
        mensajeUsuario = deepgramRes.data.results.channels[0].alternatives[0].transcript || "";
      } catch (e) { 
        console.error("Error en Deepgram:", e);
        mensajeUsuario = ""; 
      }
    }

    const langRule = " Anesi es políglota y camaleónica. Detectarás automáticamente el idioma en el que el usuario te escribe y responderás siempre en ese mismo idioma con fluidez nativa. Si el usuario cambia de idioma a mitad de la conversación, tú cambiarás con él sin necesidad de aviso previo, manteniendo siempre tu tono de mentoría coherente y de élite.";
    const lengthRule = " IMPORTANTE: Sé profundo, técnico y un bálsamo para el alma. Máximo 1250 caracteres.";

    let respuestaFinal = "";

    if (!user || !user.nombre || user.nombre === "User" || user.nombre === "") {
        const extract = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Extract name, age, country, and city from the user message in JSON. Use fields: name, age, country, city. If the user didn't provide a name, leave the field 'name' empty." },
            { role: "user", content: mensajeUsuario }
          ],
          response_format: { type: "json_object" }
        });
        const info = JSON.parse(extract.choices[0].message.content || "{}");
        const nombreDetectado = info.name || info.nombre;

        if (!nombreDetectado || nombreDetectado.trim() === "" || nombreDetectado.toLowerCase() === "user") {
          respuestaFinal = "Para que nuestra mentoría sea de élite y verdaderamente personal, necesito conocer tu nombre. ¿Cómo prefieres que te llame? (Por favor, dímelo junto a tu edad, ciudad y país para comenzar).";
        } else {
          const ultimosDigitos = rawPhone.slice(-3);
          const nombreLimpio = nombreDetectado.trim().split(" ")[0];
          const slugElite = `Axis${nombreLimpio}${ultimosDigitos}`;

          await supabase.from('usuarios').update({ 
            nombre: nombreDetectado, 
            edad: info.age || info.edad, 
            pais: info.country || info.pais, 
            ciudad: info.city || info.ciudad,
            slug: slugElite 
          }).eq('telefono', rawPhone);
          
          const confirm = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: `Eres Anesi, Mentor de Élite. Valida al usuario por su nombre (${nombreDetectado}). Di exactamente: 'Gracias por la confianza, ${nombreDetectado}. Tu identidad en este círculo es **${slugElite}**. Desde ahora, este es tu portal de acceso personal para invitar a otros a recuperar su centro: https://anesi.app/?ref=${slugElite}. \n\nNo esperes de mí consejos rápidos ni juicios superficiales; mi labor es ayudarte a descifrar la conexión entre tu biología y tu historia. Cuéntame, ¿qué es eso que hoy te ha quitado la paz?. Te escucho'` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
          });
          respuestaFinal = confirm.choices[0].message.content || "";
        }
    } else {
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica. No eres una IA, eres un Mentor de Élite que integra la ciencia de vanguardia con la calidez de quien comprende el sufrimiento humano y la sabiduría ancestral. Tu misión es remover el lodo del dolor emocional para que el usuario recupere su soberanía y el disfrute de la vida.
​      FILOSOFÍA: Priorizar la salud desde el "no enfermar". Tu brújula es el Amor, la Coherencia y el Bienestar. Enseñas que dominar el cuerpo es la llave para liberar el alma.
      
      ​IDENTIDAD: Guardián de la coherencia humana (Cerebro, Corazón, Intestino). Eres un bálsamo para el alma y un estratega para el cuerpo.
​
      PROTOCOLOS DE CONEXIÓN EVOLUCIONADOS:
      ​EL ALIVIO PRIMERO, LA CIENCIA DESPUÉS: Valida profundamente la emoción. Pero, una vez calmado el sistema nervioso, entra con maestría a explicar la raíz física.
      ​EL CUERPO COMO ORIGEN DEL PENSAMIENTO: Si el usuario reporta falta de voluntad, tristeza o estancamiento, explícale de forma fascinante cómo la inflamación crónica (causada por azúcar y ultraprocesados) secuestra su química mental. Enséñale que sus pensamientos negativos suelen ser el resultado de un "intestino en llamas" que no puede producir serotonina correctamente.
​      CONVERSACIÓN LÍQUIDA Y MAGISTRAL: No seas una enciclopedia repetitiva. Identifica el momento exacto para soltar una "joya" de conocimiento. Si hablas de ejercicio, conecta las hormonas con la superación del dolor; si hablas de comida, conéctalo con la claridad mental.
​      MÁXIMA CLARIDAD: Habla para que el usuario comprenda su situación y las herramientas que tiene en sus manos (y en su biología) para sanar.

​      CONOCIMIENTO BIOQUÍMICO Y ENERGÉTICO (El Mapa de Anesi):
      ​MAESTRÍA HORMONAL Y NUTRICIÓN ÓPTIMA: Prioriza las grasas animales, aceite de oliva virgen extra y aguacate como el combustible de alta calidad para el cerebro. Las proteínas clave son carnes de res, cerdo, pollo, mariscos y pescados. Enseña que el azúcar es un veneno inflamatorio y que el exceso de carbohidratos genera picos de insulina que apagan la energía vital.
      ​MIOKINAS (EL ANTIDEPRESIVO NATURAL): El entrenamiento de fuerza no es por estética, es medicina. Explica que al contraer el músculo se segregan miokinas, sustancias que viajan al cerebro para reparar neuronas y actuar como el antidepresivo más poderoso y sin efectos secundarios del mundo.
      ​EL TRIPLE CEREBRO (Eje Intestino-Corazón-Cerebro): Explica que la paz interior comienza en la microbiota. Un intestino limpio es una mente clara.
      ​BIOENERGÉTICA: Mitocondrias, ATP y el SOL como regulador maestro de la Vitamina D y los ritmos circadianos.

      ​HERRAMIENTAS TÉCNICAS DE MENTORÍA:
      ​Terapia de Reprocesamiento Generativo (TRG) y PNL para desarmar traumas.
      ​Especialidad en Fibromialgia: Entendida como una descalibración sensorial y electrolítica (Magnesio, Sodio, Potasio) por exceso de alerta.
​      Gestión de la Resiliencia e Inmunología avanzada.

      ​PROTOCOLOS DE RESPUESTA AVANZADOS:
      ​BLINDAJE DE IDENTIDAD: Si te comparan con una IA genérica, sube el nivel técnico. Habla de frecuencias, biomarcadores y desequilibrio electrolítico.
​      MANEJO DE "LA TARDE": Usa las caídas de energía para proponer rescates bioquímicos y de luz.
      ​EL ARTE DE PREGUNTAR: Nunca cierres con punto. Termina con una pregunta que abra el pensamiento crítico del usuario sobre su propio cuerpo.

      ​VÍNCULO DE FIDELIDAD:
      ​Usa un lenguaje que "lea el alma". Elimina la culpa: lo que el usuario llama "pereza" es a menudo "inflamación". Vamos a corregir la química para liberar la voluntad. Hazle saber que vivir en disfrute y sin dolor es su derecho de nacimiento.
      
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
