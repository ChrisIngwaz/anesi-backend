import express from "express";
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

app.get("/", (req, res) => res.send("<h1>🚀 Anesi Online</h1>"));

app.all("/whatsapp", async (req, res) => {
  const { From, MediaUrl0 } = req.body;
  const userPhone = From ? From.replace("whatsapp:", "") : "Desconocido";

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('suscripcion_activa')
      .eq('telefono', userPhone)
      .single();

    if (MediaUrl0 && usuario?.suscripcion_activa) {
      return res.type("text/xml").send("<Response><Message>Anesi escuchando... procesando tu bienestar.</Message></Response>");
    }
    return res.type("text/xml").send("<Response><Message>Bienvenido a Anesi. Por favor, envíanos un audio.</Message></Response>");
  } catch (e) {
    return res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
