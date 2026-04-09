const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

// ── CONFIGURACIÓN ──────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_KEY;

// ID del grupo familiar — se llena automático cuando el bot recibe el primer mensaje del grupo
let GROUP_CHAT_ID = null;

// ── INICIALIZAR ────────────────────────────────────────────────────────────
const bot      = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const claude   = new Anthropic({ apiKey: ANTHROPIC_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CATEGORÍAS ─────────────────────────────────────────────────────────────
const CATS = {
  vivienda:       { emoji: "🏠", label: "Vivienda",        budget: 2693000 },
  mercado:        { emoji: "🛒", label: "Mercado/Aseo",    budget: 1900000 },
  familia:        { emoji: "👨‍👩‍👧", label: "Familia",         budget: 2071000 },
  transporte:     { emoji: "⛽", label: "Transporte",      budget: 450000  },
  servicios:      { emoji: "💡", label: "Servicios",       budget: 395000  },
  celulares:      { emoji: "📱", label: "Celulares",       budget: 80000   },
  ocio:           { emoji: "🎮", label: "Ocio",            budget: 500000  },
  personalJ:      { emoji: "👤", label: "Personal Andres", budget: 400000  },
  personalD:      { emoji: "👤", label: "Personal Dani",   budget: 400000  },
  deudas:         { emoji: "💳", label: "Deudas",          budget: 470000  },
  fondoCarro:     { emoji: "🚗", label: "Fondo Carro",     budget: 500000  },
  fondoImpuestos: { emoji: "🏛️", label: "Fondo Impuestos", budget: 500000  },
  samuel:         { emoji: "👦", label: "Samuel",          budget: 500000  },
  imprevistos:    { emoji: "🆘", label: "Imprevistos",      budget: 200000  },
  jardinJuanpa:   { emoji: "🌿", label: "Jardín JuanPa",    budget: 1171000 },
  zeus:           { emoji: "🐕", label: "Zeús",             budget: 400000  },
  otros:          { emoji: "📦", label: "Otros",           budget: 0       },
};

const SUBCATS = {
  vivienda:       ["Arriendo","Hipotecario","Administración"],
  mercado:        ["Mercado","Aseo","Otros"],
  familia:        ["Cuidado JuanPa","Otros familia"],
  transporte:     ["Gasolina","Uber/Taxi","Otros transporte"],
  servicios:      ["Luz","Gas","Agua","Internet"],
  celulares:      ["Celular Dani","Cel Jaiver"],
  ocio:           ["Ocio general","Restaurante","Entretenimiento"],
  personalJ:      ["Gastos personales J"],
  personalD:      ["Gastos personales D"],
  deudas:         ["Davivienda","Falabella","Impuesto casa/Dian"],
  fondoCarro:     ["Fondo Carro"],
  fondoImpuestos: ["Fondo Impuestos"],
  samuel:         ["Samuel"],
  jardinJuanpa:   ["Jardín JuanPa"],
  zeus:           ["Zeús"],
  imprevistos:    ["Imprevistos"],
  otros:          [],
};

const INGRESOS_MENSUALES = 13848000;
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const fmt = (n) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", minimumFractionDigits: 0,
  }).format(n);

const bar = (pct) => {
  const f = Math.min(Math.round(pct / 10), 10);
  return "▓".repeat(f) + "░".repeat(10 - f) + ` ${Math.round(pct)}%`;
};

// ── ESTADO TEMPORAL ────────────────────────────────────────────────────────
const pendientes = {};
const editando   = {};

// ── PEDIR SUBCATEGORÍA ──────────────────────────────────────────────────────
async function pedirSubcategoria(chatId, gasto) {
  const subs = SUBCATS[gasto.category] || [];
  const cat  = CATS[gasto.category];

  // Sin subcategorías definidas → guardar directo
  if (!subs.length) {
    gasto.subcategoria = null;
    const who = gasto._who || "Usuario";
    delete pendientes[gasto._userId];
    await guardarGasto(chatId, gasto, who);
    return;
  }

  gasto.paso = "subcategoria";

  let msg = `${cat.emoji} *${cat.label}* confirmado ✅

`;
  msg += `¿A qué subcategoría corresponde?

`;
  subs.forEach((s, i) => {
    msg += `*${i + 1}.* ${s}
`;
  });
  msg += `
*0.* Sin subcategoría (omitir)`;

  await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

// ── GUARDAR GASTO EN SUPABASE ───────────────────────────────────────────────
async function guardarGasto(chatId, gasto, who) {
  const cat = CATS[gasto.category] || CATS["otros"];

  const descFinal = gasto.subcategoria
    ? `${gasto.subcategoria} - ${gasto.description}`
    : gasto.description;

  await supabase.from("gastos").insert({
    monto:       gasto.amount,
    categoria:   gasto.category,
    descripcion: descFinal,
    quien:       who,
    fuente:      gasto.source,
    fecha:       gasto.fecha,
  });

  const fechaInicio = gasto.fecha.slice(0, 7) + "-01";

  const { data } = await supabase
    .from("gastos")
    .select("monto")
    .eq("categoria", gasto.category)
    .gte("fecha", fechaInicio)
    .lte("fecha", gasto.fecha.slice(0, 7) + "-31");

  const totalMes = (data || []).reduce((s, r) => s + r.monto, 0);
  const pct      = cat.budget > 0 ? (totalMes / cat.budget) * 100 : 0;
  const status   = pct > 100 ? "⚠️ EXCEDIDO"
                 : pct > 80  ? "⚡ Cuidado"
                 : "✅";
  const origen   = gasto.source === "applepay" ? `${who} (Apple Pay 💳)` : who;
  const mesNombre = MESES[parseInt(gasto.fecha.slice(5, 7)) - 1];
  const restante  = cat.budget - totalMes;

  let mensaje = `${status} *${origen}* · ${cat.emoji} ${cat.label}\n`;
  mensaje += `*${fmt(gasto.amount)}* registrado\n`;
  mensaje += `📝 ${gasto.description}\n`;
  mensaje += `📅 ${mesNombre} ${gasto.fecha.slice(0, 4)}\n\n`;

  if (cat.budget > 0) {
    mensaje += `💰 Gastado este mes: *${fmt(totalMes)}*\n`;
    mensaje += `🎯 Presupuesto:      *${fmt(cat.budget)}*\n`;
    if (restante >= 0) {
      mensaje += `✅ Te quedan:        *${fmt(restante)}*\n`;
    } else {
      mensaje += `⚠️ Te pasaste:       *${fmt(Math.abs(restante))}*\n`;
    }
    mensaje += `${bar(pct)}`;
  } else {
    mensaje += `📦 Gasto registrado en Otros`;
  }

  await bot.sendMessage(chatId, mensaje, { parse_mode: "Markdown" });
}

// ── RESUMEN MENSUAL ─────────────────────────────────────────────────────────
async function enviarResumenMensual(chatId, anio, mes) {
  const mesStr    = String(mes).padStart(2, "0");
  const fechaIni  = `${anio}-${mesStr}-01`;
  const fechaFin  = `${anio}-${mesStr}-31`;
  const mesNombre = MESES[mes - 1];

  const { data } = await supabase
    .from("gastos")
    .select("monto, categoria")
    .gte("fecha", fechaIni)
    .lte("fecha", fechaFin);

  if (!data || data.length === 0) return;

  const totalesCat = {};
  data.forEach(g => {
    totalesCat[g.categoria] = (totalesCat[g.categoria] || 0) + g.monto;
  });

  const totalGastado = data.reduce((s, g) => s + g.monto, 0);
  const ahorro       = INGRESOS_MENSUALES - totalGastado;

  let msg = `📊 *Resumen ${mesNombre} ${anio}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  Object.entries(CATS).forEach(([id, cat]) => {
    const gastado = totalesCat[id] || 0;
    if (gastado === 0 && cat.budget === 0) return;
    const pct   = cat.budget > 0 ? Math.round((gastado / cat.budget) * 100) : 0;
    const icono = pct > 100 ? "⚠️" : pct > 80 ? "⚡" : "✅";
    const linea = cat.budget > 0
      ? `${icono} ${cat.emoji} ${cat.label}: ${fmt(gastado)} de ${fmt(cat.budget)} · ${pct}%`
      : `📦 ${cat.emoji} ${cat.label}: ${fmt(gastado)}`;
    msg += linea + "\n";
  });

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💰 *Ingresos:* ${fmt(INGRESOS_MENSUALES)}\n`;
  msg += `💸 *Gastado:* ${fmt(totalGastado)}\n`;
  msg += ahorro >= 0
    ? `💚 *Ahorro del mes:* ${fmt(ahorro)} 🎉`
    : `🔴 *Déficit del mes:* ${fmt(Math.abs(ahorro))} ⚠️`;

  await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

// ── VERIFICAR FIN DE MES ────────────────────────────────────────────────────
function verificarFinDeMes() {
  setInterval(async () => {
    if (!GROUP_CHAT_ID) return;
    const ahora   = new Date();
    const maniana = new Date(ahora);
    maniana.setDate(ahora.getDate() + 1);
    if (maniana.getDate() === 1 && ahora.getHours() === 20) {
      const mes  = ahora.getMonth() + 1;
      const anio = ahora.getFullYear();
      await enviarResumenMensual(GROUP_CHAT_ID, anio, mes);
    }
  }, 60 * 60 * 1000);
}

// ── ESCUCHAR MENSAJES ───────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const text   = (msg.text || "").trim();
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const who    = msg.from.first_name || "Alguien";

  if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
    GROUP_CHAT_ID = chatId;
  }

  if (!text || text.startsWith("/")) {
    const cmd = text.split("@")[0].toLowerCase();

    if (cmd === "/resumen") {
      const ahora = new Date();
      await enviarResumenMensual(chatId, ahora.getFullYear(), ahora.getMonth() + 1);
    }

    if (cmd === "/ultimos") {
      const { data } = await supabase
        .from("gastos")
        .select("id, monto, categoria, descripcion, quien, fecha")
        .order("created_at", { ascending: false })
        .limit(5);

      if (!data || data.length === 0) {
        await bot.sendMessage(chatId, "No hay gastos registrados aún.");
        return;
      }

      let msg = "📋 *Últimos 5 gastos:*\n\n";
      data.forEach((g, i) => {
        const cat = CATS[g.categoria] || CATS["otros"];
        msg += `*${i + 1}.* ${cat.emoji} ${cat.label} — *${fmt(g.monto)}*\n`;
        msg += `   📝 ${g.descripcion} · ${g.quien} · ${g.fecha}\n`;
        msg += `   🆔 ID: \`${g.id}\`\n\n`;
      });
      msg += "Para borrar: /borrar ID\nPara editar: /editar ID";
      await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    if (cmd.startsWith("/borrar")) {
      const id = text.split(" ")[1] || text.split("@")[0].split(" ")[1];
      if (!id) {
        await bot.sendMessage(chatId, "Indica el ID del gasto. Ejemplo: /borrar 42\nUsa /ultimos para ver los IDs.");
        return;
      }
      const { error } = await supabase.from("gastos").delete().eq("id", id);
      if (error) {
        await bot.sendMessage(chatId, `Error al borrar: ${error.message}`);
      } else {
        await bot.sendMessage(chatId, `🗑️ Gasto ID ${id} borrado correctamente.`);
      }
    }

    if (cmd.startsWith("/editar")) {
      const id = text.split(" ")[1];
      if (!id) {
        await bot.sendMessage(chatId, "Indica el ID del gasto. Ejemplo: /editar 42\nUsa /ultimos para ver los IDs.");
        return;
      }
      const { data } = await supabase.from("gastos").select("*").eq("id", id).single();
      if (!data) {
        await bot.sendMessage(chatId, `No encontré el gasto con ID ${id}.`);
        return;
      }
      const cat = CATS[data.categoria] || CATS["otros"];
      editando[userId] = { id, gasto: data, paso: "elegir" };

      const listaCats = Object.entries(CATS)
        .map(([, c], i) => `${i + 1}. ${c.emoji} ${c.label}`)
        .join("\n");

      let msg = `✏️ *Editando gasto ID ${id}:*\n\n`;
      msg += `${cat.emoji} ${cat.label} — *${fmt(data.monto)}*\n`;
      msg += `📝 ${data.descripcion}\n\n`;
      msg += `¿Qué quieres cambiar?\n*1.* El monto\n*2.* La categoría`;
      await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    return;
  }

  // ── Edición en curso ───────────────────────────────────────────────────────
  if (editando[userId]) {
    const estado = editando[userId];

    if (estado.paso === "elegir") {
      if (text === "1") {
        estado.paso = "nuevo_monto";
        await bot.sendMessage(chatId, "¿Cuál es el nuevo monto? Escríbelo en pesos:");
        return;
      }
      if (text === "2") {
        estado.paso = "nueva_cat";
        const listaCats = Object.entries(CATS)
          .map(([, c], i) => `${i + 1}. ${c.emoji} ${c.label}`)
          .join("\n");
        await bot.sendMessage(chatId, `Elige la categoría correcta:\n\n${listaCats}`, { parse_mode: "Markdown" });
        return;
      }
      await bot.sendMessage(chatId, "Responde *1* para cambiar el monto o *2* para cambiar la categoría.", { parse_mode: "Markdown" });
      return;
    }

    if (estado.paso === "nuevo_monto") {
      const nuevoMonto = parseInt(text.replace(/[^0-9]/g, ""));
      if (isNaN(nuevoMonto) || nuevoMonto <= 0) {
        await bot.sendMessage(chatId, "No entendí el monto. Escríbelo así: 45000");
        return;
      }
      const { error } = await supabase.from("gastos").update({ monto: nuevoMonto }).eq("id", estado.id);
      delete editando[userId];
      if (error) {
        await bot.sendMessage(chatId, `Error: ${error.message}`);
      } else {
        await bot.sendMessage(chatId, `✅ Monto actualizado a *${fmt(nuevoMonto)}*`, { parse_mode: "Markdown" });
      }
      return;
    }

    if (estado.paso === "nueva_cat") {
      const catKeys = Object.keys(CATS);
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= catKeys.length) {
        const nuevaCat = catKeys[num - 1];
        const { error } = await supabase.from("gastos").update({ categoria: nuevaCat }).eq("id", estado.id);
        delete editando[userId];
        if (error) {
          await bot.sendMessage(chatId, `Error: ${error.message}`);
        } else {
          const cat = CATS[nuevaCat];
          await bot.sendMessage(chatId, `✅ Categoría actualizada a ${cat.emoji} *${cat.label}*`, { parse_mode: "Markdown" });
        }
        return;
      }
      await bot.sendMessage(chatId, "Escribe el número de la categoría de la lista.");
      return;
    }
  }

  // ── Confirmación de gasto pendiente ───────────────────────────────────────
  if (pendientes[userId]) {
    const gasto   = pendientes[userId];
    const catKeys = Object.keys(CATS);
    const num     = parseInt(text);

    if (text === "✅" || text.toLowerCase() === "si" || text.toLowerCase() === "sí") {
      delete pendientes[userId];
      await guardarGasto(chatId, gasto, who);
      return;
    }

    if (!isNaN(num) && num >= 1 && num <= catKeys.length) {
      gasto.category = catKeys[num - 1];
      delete pendientes[userId];
      await guardarGasto(chatId, gasto, who);
      return;
    }

    await bot.sendMessage(chatId,
      "Responde con ✅ para confirmar o escribe el número de la categoría correcta 👆",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // ── Procesar nuevo gasto ──────────────────────────────────────────────────
  const isApplePay = text.startsWith("💳 Apple Pay");
  const source     = isApplePay ? "applepay" : "telegram";
  const fechaHoy   = new Date().toISOString().split("T")[0];

  try {
    const catList = Object.entries(CATS)
      .map(([id, c], i) => `${i + 1}. ${c.emoji} ${c.label}`)
      .join(", ");

    const ai = await claude.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Eres un asistente de gastos familiares colombiano.
Extrae del mensaje:
1. Monto en pesos (soporta "45mil", "45.000", "$45000", "cuarenta y cinco mil")
2. La categoría MÁS apropiada de esta lista: ${catList}
3. Descripción corta y específica del gasto (máximo 40 caracteres)

Responde SOLO con JSON sin markdown:
{"amount": número, "category": "id_categoria", "description": "descripción"}

Los IDs de categoría son exactamente: ${Object.keys(CATS).join(", ")}

Mensaje: "${text}"`,
      }],
    });

    const rawText    = ai.content[0].text.trim().replace(/```json|```/g, "").trim();
    const resultado  = JSON.parse(rawText);
    const categoryId = Object.keys(CATS).includes(resultado.category) ? resultado.category : "otros";
    const cat        = CATS[categoryId];

    pendientes[userId] = {
      amount:      resultado.amount,
      category:    categoryId,
      description: resultado.description,
      source,
      fecha:       fechaHoy,
      subcategoria: null,
      paso:        "categoria",
      _userId:     userId,
      _who:        who,
    };

    const listaCats = Object.entries(CATS)
      .map(([, c], i) => `${i + 1}. ${c.emoji} ${c.label}`)
      .join("\n");

    const confirmMsg =
      `🤖 Detecté este gasto:\n\n` +
      `${cat.emoji} *${cat.label}*\n` +
      `💵 *${fmt(resultado.amount)}*\n` +
      `📝 ${resultado.description}\n\n` +
      `¿Es correcta la categoría?\n` +
      `Responde *✅* para confirmar o el *número* para cambiarla:\n\n` +
      `${listaCats}`;

    await bot.sendMessage(chatId, confirmMsg, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("Error:", err.message);
    delete pendientes[userId];
    await bot.sendMessage(chatId,
      "No entendí ese gasto 😅\nIntenta con: _\"45mil mercado\"_ o _\"Taxi 12000\"_",
      { parse_mode: "Markdown" }
    );
  }
});

// ── SERVIDOR HTTP + AUTO-PING RENDER ─────────────────────────────────────────
const http  = require("http");
const https = require("https");
const PORT  = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("GastosBot corriendo OK");
}).listen(PORT, () => {
  console.log("🌐 Servidor HTTP escuchando en puerto " + PORT);
});

const BOT_URL = process.env.RENDER_EXTERNAL_URL || "https://gastos-bot-csuv.onrender.com";
setInterval(() => {
  https.get(BOT_URL, (res) => {
    console.log(`🏓 Auto-ping Render OK — ${new Date().toLocaleTimeString("es-CO")}`);
  }).on("error", (err) => {
    console.log("⚠️ Auto-ping Render error:", err.message);
  });
}, 3 * 60 * 1000);

// ── PING A SUPABASE (evita que se pause el proyecto gratuito) ────────────────
// Supabase pausa proyectos sin actividad por 7 días. Este ping lo mantiene activo.
setInterval(async () => {
  try {
    await supabase.from("gastos").select("id").limit(1);
    console.log(`💾 Supabase ping OK — ${new Date().toLocaleTimeString("es-CO")}`);
  } catch (e) {
    console.log("⚠️ Supabase ping error:", e.message);
  }
}, 1000 * 60 * 60 * 24 * 3); // cada 3 días

// ── ARRANCAR ──────────────────────────────────────────────────────────────────
verificarFinDeMes();
console.log("🤖 GastosBot corriendo...");
console.log("📅 Resumen automático activado — se envía el último día del mes a las 8pm");
console.log("📊 Escribe /resumen en el grupo para ver el resumen en cualquier momento");
console.log("💾 Ping a Supabase activo — proyecto no se pausará");
