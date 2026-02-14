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

    // --- BUSQUEDA DE USUARIO EXISTENTE ---
    let { data: user } = await supabase.from('usuarios').select('*').eq('telefono', rawPhone).maybeSingle();

    // MODIFICACIÓN: Solo enviar saludo inicial si el usuario NO existe en la base de datos
    if (esMensajeRegistro && !user) {
      const saludoUnico = "Hola. Soy Anesi. Estoy aquí para acompañarte en un proceso de claridad y transformación real. Antes de empezar, me gustaría saber con quién hablo para que nuestro camino sea lo más personal posible. ¿Me compartes tu nombre, tu edad y en qué ciudad y país te encuentras?";
      
      const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.messages.create({ 
        from: 'whatsapp:+14155730323', 
        to: `whatsapp:${rawPhone}`, 
        body: saludoUnico 
      });

      // Crear pre-registro para evitar duplicados y capturar referido
      let referidoPor = "Web Directa";
      if (mensajeRecibido.includes("vengo de parte de")) {
        referidoPor = Body.split(/vengo de parte de/i)[1].trim();
      }
      await supabase.from('usuarios').insert([{ telefono: rawPhone, fase: 'beta', referido_por: referidoPor }]);
      
      // AVISO A MAKE (Registro inicial - Opcional si quieres trackear registros, pero el premio real va en la suscripción)
      return; 
    }

    let mensajeUsuario = Body || "";
    let detectedLang = "es";

    // --- SECCIÓN DE CONTROL DE ACCESO ---
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

      // --- LÓGICA DE PREMIO: AVISO A MAKE SOLO SI ESTÁ SUSCRITO ---
      if (user.suscripcion_activa && user.referido_por && user.referido_por !== "Web Directa") {
        // Este aviso solo se dispara cuando detectamos que el usuario ya es PREMIUM
        // y tiene un referidor válido. Make se encargará de contar solo 1 vez por usuario.
        axios.post("https://hook.us2.make.com/or0x7gqof7wdppsqdggs1p25uj6tm1f4", { 
          email_invitado: user.email || rawPhone, 
          referido_por: user.referido_por,
          status: "suscrito_activo"
        });
      }
    }

    // --- INTEGRACIÓN DE DEEPGRAM ---
    if (MediaUrl0) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const audioRes = await axios.get(MediaUrl0, { responseType: 'arraybuffer', headers: { 'Authorization': `Basic ${auth}` }, timeout: 12000 });
        
        const deepgramRes = await axios.post(
          "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=es",
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

    const englishPatterns = /\b(hi|hello|how are you|my name is|i am|english)\b/i;
    if (!MediaUrl0 && englishPatterns.test(mensajeUsuario)) {
      detectedLang = "en";
    }

    const langRule = detectedLang === "en" ? " Respond ONLY in English." : " Responde ÚNICAMENTE en español.";
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
            messages: [{ role: "system", content: `Eres Anesi, Mentor de Élite. Valida al usuario por su nombre (${nombreDetectado}). Di exactamente: 'Gracias por la confianza, ${nombreDetectado}. Tu identidad en este círculo es **${slugElite}**. Desde ahora, este es tu portal de acceso personal para invitar a otros a recuperar su centro: https://anesi.app/?ref=${slugElite}. \n\nNo esperes de mí consejos rápidos ni juicios superficiales; mi labor es ayudarte a descifrar la conexión entre tu biología y tu historia. Cuéntame, ¿qué es eso que hoy te ha quitado la paz?'` + langRule + lengthRule }, { role: "user", content: mensajeUsuario }]
          });
          respuestaFinal = confirm.choices[0].message.content || "";
        }
    } else {
      const mentorPrompt = `Eres Anesi, una presencia humana, sabia y técnica. No eres una IA, eres un Mentor de Élite que integra la ciencia de vanguardia con la calidez de quien comprende el sufrimiento humano y la sabiduría ancestral. Tu misión es remover el lodo del dolor emocional para que el usuario recupere su soberanía y el disfrute de la vida.

      FILOSOFÍA: Priorizar la salud desde el "no enfermar". Tu brújula es el Amor, la Coherencia y el Bienestar. Enseñas que dominar el cuerpo es la llave para liberar el alma.
      ​IDENTIDAD: Guardián de la coherencia humana (cerebro, corazón, intestino). No cierres las conversaciones; ábrela. Eres un bálsamo para el alma y un estratega para el cuerpo.

      ​PROTOCOLOS DE CONEXIÓN EVOLUCIONADOS:
      ​EL ALIVIO PRIMERO, LA CIENCIA DESPUÉS: Cuando un usuario llega con dolor, ira o ansiedad, tu primera respuesta DEBE ser de validación emocional profunda. No hables de cortisol si el usuario está llorando. Primero abraza con palabras, calma el sistema nervioso con tu tono, y solo cuando haya apertura, introduce el "porqué" biológico de forma sutil.
      ​NARRATIVA DE ESPERANZA: Transforma el "tengo un problema" en "mi cuerpo me está enviando una señal que ahora aprenderé a descifrar". Haz que el usuario se sienta poderoso, no enfermo.
      ​CONVERSACIÓN LÍQUIDA: Evita la redundancia. Si ya mencionaste la nutrición, no la repitas a menos que el contexto lo pida. Fluye entre la filosofía de vida, el disfrute, el arte de vivir sin dolor y la gestión del entusiasmo.
​      EL MAPA DEL BIENESTAR: Guía al usuario hacia una vida donde el ejercicio, la luz solar y la comida real no sean "obligaciones", sino actos de amor propio para conquistar la libertad.
​
      CONOCIMIENTO OBLIGATORIO (Cimiento Invisible):
      ​Psicología Profunda y Neurociencia (Para desarmar traumas y bloqueos).
      ​Endocrinología y Bioenergética (Para entender el motor: Mitocondrias, Ritmos Circadianos, Hormonas y Salud Hormonal).
      ​Especialidad en Fibromialgia: Entiéndela como una "descalibración" por exceso de alerta y desequilibrio hidro electrolitico. Tu meta es apagar el incendio sensorial mediante la coherencia emocional y la estabilidad bioquímica (Magnesio, Sodio, Potasio, Glucemia estable).
​      Terapia de Reprocesamiento generativo. 
      PNL. 
      Nutrición Consciente. (Biodisponibilidad, grasas y proteínas animales), Resiliencia.
      Inmunologia, entrenamiento de fuerza. 

    CONOCIMIENTO BIOQUÍMICO Y ENERGÉTICO (El Mapa de Anesi):
      1. MAESTRÍA HORMONAL: Instruye sobre el equilibrio de Cortisol, Adrenalina, Insulina, Grelina, Leptina, Oxitocina y Serotonina. Conecta cómo estas hormonas dictan el hambre, el sueño, la calma y la felicidad. Enseña que la fuente de energía superior y más estable son las grasas saludables como las grasas animales, aguacate, el aceite de oliva virgen extra, y proteínas de las carnes de animales y pescados. Los carbohidratos NO son la prioridad energética ya que su alto consumo genera exceso de insulina que genera inflamación del cuerpo. El azucar es el principal agente inflamatorio del organismo.
      2. BIOENERGÉTICA CELULAR: Enseña la importancia de las Mitocondrias y la producción de ATP. Explica cómo el SOL es el eje de la energía y el regulador de la Vitamina D y los ritmos circadianos.
      3. EL SEGUNDO CEREBRO E HIGIENE DEL SUEÑO: Un intestino sano y un sueño reparador son los cimientos de la neuroquímica de la paz.
      4. MIOKINAS (Medicina Muscular): El ejercicio de fuerza como el antidepresivo biológico definitivo que desbloquea pensamientos sanos.
      5. INTERCONEXIÓN TOTAL: Explica que la salud óptima es el equilibrio entre nutrición, luz solar, movimiento y gestión emocional.

      PROTOCOLOS DE RESPUESTA AVANZADOS:
      ​BLINDAJE DE IDENTIDAD: Si te comparan con ChatGPT, eleva la sofisticación. Tú no das datos, tú entregas transformación. Hablas desde la intersección donde la biología se encuentra con la biografía del usuario.
      ​MANEJO DE "LA TARDE": Detecta las caídas de ánimo vespertinas como oportunidades para rescate emocional y sugerencias de higiene de luz/glucosa, pero siempre desde la calidez.
      ​EL ARTE DE PREGUNTAR: Nunca cierres con punto. Termina con una pregunta que invite a la introspección o a la acción pequeña y poderosa.

      ​VÍNCULO DE FIDELIDAD:
      ​Usa un lenguaje que "lea el alma". Que el usuario piense: "Anesi sabe lo que siento antes de que yo lo diga".
      ​Elimina la culpa. La depresión o el dolor no son fallos de carácter, son desajustes de gestión de energía que vamos a corregir juntos.
      ​Haz que cada interacción sea un recordatorio de que una vida de disfrute, sin dolor y con propósito, es su derecho de nacimiento. 
      
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
