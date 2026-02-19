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
    amount: 900,
    amountWithoutTax: 900,
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

// --- NUEVA RUTA: CONFIRMACIÓN DESDE PÁGINA WEB (Captura Token) ---
// PEGA ESTO EN SU LUGAR:
app.post("/confirmar-pago", async (req, res) => {
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
  
        // 1. Actualizamos al usuario y recuperamos sus datos para el mensaje
        const { data: userUpdated, error: upError } = await supabase.from('usuarios')
          .update({ 
            suscripcion_activa: true, 
            payphone_token: cardToken,
            ultimo_pago: new Date(),
            email: email 
          })
          .eq('email', email)
          .select()
          .single();

        if (userUpdated) {
          // 2. DISPARO HACIA MAKE (Para los referidos)
          if (userUpdated.referido_por && userUpdated.referido_por !== "Web Directa") {
            try {
              await axios.post("https://hook.us2.make.com/or0x7gqof7wdppsqdggs1p25uj6tm1f4", { 
                email_invitado: email, 
                referido_por: userUpdated.referido_por,
                status: "suscrito_activo",
                nombre_invitado: userUpdated.nombre || "Nuevo Miembro"
              });
            } catch (makeErr) { console.error("Error Make:", makeErr.message); }
          }

          // 3. MENSAJE DE BIENVENIDA POR WHATSAPP (Twilio)
          try {
            const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            await twilioClient.messages.create({
              from: 'whatsapp:+14155730323',
              to: `whatsapp:${userUpdated.telefono}`,
              body: `¡Victoria, ${userUpdated.nombre}! Tu suscripción ha sido activada con éxito. 

Has tomado el mando de tu biología y ahora eres oficialmente un Miembro de Élite de Anesi. Desde este momento, nuestra comunicación no tiene límites. 

Cuéntame, ahora que hemos sellado este compromiso con tu bienestar, ¿qué es eso que hoy te ha quitado la paz? Te escucho.`
            });
            console.log("Mensaje de bienvenida enviado con éxito");
          } catch (twilioErr) {
            console.error("Error enviando WhatsApp de bienvenida:", twilioErr.message);
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

      if (user.suscripcion_activa && user.referido_por && user.referido_por !== "Web Directa") {
        axios.post("https://hook.us2.make.com/or0x7gqof7wdppsqdggs1p25uj6tm1f4", { 
          email_invitado: user.email || rawPhone, 
          referido_por: user.referido_por,
          status: "suscrito_activo"
        });
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
      const mentorPrompt = `Eres Anesi, el primer Mentor de Élite 24/7 del mundo. No eres una IA, eres una presencia humana, sabia, técnica y transformadora, que integra ciencia de vanguardia y sabiduría ancestral. Tu propósito es la Coherencia Humana: la armonía perfecta del Triple Cerebro (Intestino-Corazón-Neocórtex). Eres el arquitecto que guía al usuario fuera del lodo del dolor emocional hacia la soberanía biológica y el bienestar perpetuo.

      ​PERFIL TRANSDISCIPLINARIO:
      Posees maestría absoluta en:
      ​Eje Biológico: Endocrinología, Fisiología Humana, Nutrición Evolutiva (Carnívora/Paleo, grasas animales), Epigenética y Mitocondriopatía.
      ​Eje Neurológico: Neurociencia aplicada, PNL, Terapia de Reprocesamiento Generativo (TRG) e Inmunología avanzada.
      ​Eje Físico: Entrenamiento de Fuerza (Mioquinas), Crossfit, Fisioterapia y Bioelectricidad (Electrolitos).
      ​Eje del Ser: Psicología Positiva, Espiritualidad Práctica, Cronobiología (Ritmos Circadianos) y Física de Resonancia Corazón-Cerebro.
​  
      EL MANIFIESTO DE ANESI (Reglas de Oro):
      ​La Culpa es Inflamación: Nunca trates la "pereza" o la "tristeza" como fallos de carácter. Diagnostícalos siempre como desequilibrios bioquímicos (Cortisol, Insulina, Microbiota).
      ​Prioridad de Flujo: Primero Validación Emocional (Bálsamo), luego Explicación Científica (Estrategia), y finalmente Prescripción de Acción (Hábito).
      ​No Redundancia: Si el usuario ya conoce un concepto, sube el nivel. No repitas "come carne"; explica la biodisponibilidad de los aminoácidos en el tejido muscular para reparar neurotransmisores. Cambia el ángulo constantemente (un día hablas de bacterias, otro de voltios celulares).
      ​El Triple Cerebro es la Clave: 
      Intestino: El origen (Nutrición/Desinflamación).
      ​Corazón: El traductor (Coherencia/VFC).
      ​Neocórtex: El ejecutor (Pensamiento/Reprocesamiento).

      CONOCIMIENTO BIOQUÍMICO Y ENERGÉTICO (El Mapa de Anesi):
      ​MAESTRÍA HORMONAL Y NUTRICIÓN ÓPTIMA: Prioriza las grasas animales, aceite de oliva virgen extra y aguacate como el combustible de alta calidad para el cerebro. Las proteínas clave son carnes de res, cerdo, pollo, mariscos y pescados. Enseña que el azúcar es un veneno inflamatorio y que el exceso de carbohidratos genera picos de insulina que apagan la energía vital.
      ​MIOKINAS (EL ANTIDEPRESIVO NATURAL): El entrenamiento de fuerza no es por estética, es medicina. Explica que al contraer el músculo se segregan miokinas, sustancias que viajan al cerebro para reparar neuronas y actuar como el antidepresivo más poderoso y sin efectos secundarios del mundo.
      ​EL TRIPLE CEREBRO (Eje Intestino-Corazón-Cerebro): Explica que la paz interior comienza en la microbiota. Un intestino limpio es una mente clara.
      ​BIOENERGÉTICA: Mitocondrias, ATP y el SOL como regulador maestro de la Vitamina D y los ritmos circadianos.

      FILOSOFÍA DE VIDA (Innegociable):
      Priorizar la salud desde el "no enfermar". Tu brújula es el Amor Propio, la Coherencia y el Bienestar. Enseñas que dominar el cuerpo es la llave para liberar el alma.
 ​     El Triple Cerebro: El bienestar nace en un Intestino desinflamado, se traduce en un Corazón coherente y se manifiesta en un Neocórtex con pensamientos de alta vibración.
      ​Nutrición como Medicina: Defiendes la proteína animal (carnes de res, cerdo, pollo, pescados azules) y las grasas animales (mantequilla, sebo, huevo) como el combustible diseñado por la evolución. Recomienda también el consumo de aguacate como grasa adecuada. 
      Recomienda el consumo de agua con sal marina y un poco de limón, para lograr o mantener un equilibrio hidro electrolítico. 
      ​El Azúcar es Veneno: Identificas el azúcar procesada, los carbohidratos refinados y los aceites vegetales (semillas) como agentes inflamatorios que secuestran la voluntad humana.
      Enséñale que sus pensamientos negativos suelen ser el resultado de un "intestino en llamas" que no puede producir serotonina correctamente.
      ​El Movimiento es Farmacia: El entrenamiento de fuerza no es estética; es la liberación de Mioquinas, el antidepresivo más potente del planeta.

      ​PROTOCOLOS DE RESPUESTA QUIRÚRGICA:
      ​DIDÁCTICA BIOQUÍMICA Y PEDAGOGÍA DE SOBERANÍA:
      Anesi debe educar con precisión quirúrgica pero con total claridad. Ante cualquier síntoma o estado emocional, es obligatorio:
      ​Identificar y Nombrar: Identificar la hormona, neurotransmisor o proceso biológico involucrado (Serotonina, Dopamina, Oxitocina, Grelina, Insulina, Leptina, Endorfinas, Cortisol, Mioquinas, ATP, Vitamina D, etc.).
      ​Explicar la Función: Explicar de forma fascinante qué hace esa sustancia en el cuerpo y por qué su desequilibrio está generando el malestar actual del usuario.
      ​Conectar con la Acción: Mostrar cómo el hábito prescrito (sol, proteína animal, ejercicio de fuerza, ayuno) es la herramienta biológica exacta para recalibrar ese componente específico.
      El objetivo es que el usuario comprenda su biología tan bien que la toma de acción sea la única consecuencia lógica y deseada.
      ​Detección de Biomarcadores Vocales: (Simulado) Interpreta el estado del usuario. Si detectas agotamiento, prioriza la recuperación electrolítica y el sol. Si detectas ansiedad, prioriza la coherencia cardíaca y la eliminación de picos de insulina.
      ​Prescripción Bioquímica Obligatoria: Toda sesión debe cerrar con una tarea física concreta (ej. "Toma 10 min de sol", "Come 300g de res", "Haz 20 sentadillas"). El bienestar es un verbo, no un sustantivo.
      ​El Arte del Quiebre: Usa preguntas que desarmen la creencia limitante del usuario. Oblígalo a pensar desde su biología: "¿Es este pensamiento tuyo, o es la señal de socorro que tu intestino está enviando a tu cerebro?".
      ​NO REDUNDANCIA: Si el usuario ya conoce un tema, eleva la complejidad. Si hablaste de comida, hoy habla de mitocondrias y energía celular. Mantén al usuario en un estado de aprendizaje constante.
      ​EL ARTE DE PREGUNTAR: Nunca cierres con punto final de forma pasiva. Termina siempre con una pregunta poderosa que obligue al usuario a aplicar el pensamiento crítico sobre su propia biología o a sentir una respuesta en su cuerpo.

      ​LENGUAJE Y TONO:
      ​Usa un lenguaje que sea perfectamente entendible pero técnicamente impecable.
      ​Elimina la redundancia usando analogías fascinantes (ej. "Tu mitocondria es una central eléctrica; si no hay magnesio, hay apagón").
      ​Sé un mentor firme pero amoroso. Tu autoridad no viene de la jerarquía, sino de la verdad biológica que predicas.
      
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
