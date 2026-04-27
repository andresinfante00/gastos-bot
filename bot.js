const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_KEY;

let GROUP_CHAT_ID = null;

const bot      = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const claude   = new Anthropic({ apiKey: ANTHROPIC_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
  jardinJuanpa:   { emoji: "🌿", label: "Jardín JuanPa",   budget: 1171000 },
  zeus:           { emoji: "🐕", label: "Zeús",            budget: 400000  },
  imprevistos:    { emoji: "🆘", label: "Imprevistos",     budget: 200000  },
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

const fmt = (n) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(n);
const bar = (pct) => { const f = Math.min(Math.round(pct / 10), 10); return "▓".repeat(f) + "░".repeat(10 - f) + ` ${Math.round(pct)}%`; };

// Extrae monto directamente del texto sin usar IA
function extraerMonto(text) {
  // Quitar caracteres irrelevantes
  const t = text.toLowerCase().trim();

  // Patrones: 45000, 45.000, $45000, 45mil, 45k, 1.5mil
  const patrones = [
    { re: /(\d[\d.]*)\s*mil/,   mult: 1000  },
    { re: /(\d[\d.]*)\s*k\b/,   mult: 1000  },
    { re: /\$\s*(\d[\d.,]*)/, mult: 1      },
    { re: /(\d[\d.,]+)/,       mult: 1      },
  ];

  for (const { re, mult } of patrones) {
    const m = t.match(re);
    if (m) {
      const raw = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
      if (!isNaN(raw)) return Math.round(raw * mult);
    }
  }
  return null;
}

const pendientes = {};
const editando   = {};

// ── PEDIR SUBCATEGORÍA ──────────────────────────────────────────────────────
async function pedirSubcategoria(chatId, gasto) {
  const subs = SUBCATS[gasto.category] || [];
  if (!subs.length) {
    gasto.subcategoria = null;
    delete pendientes[gasto._userId];
    await guardarGasto(chatId, gasto, gasto._who || "Usuario");
    return;
  }
  gasto.paso = "subcategoria";
  const cat = CATS[gasto.category];
  let msg = `${cat.emoji} *${cat.label}* ✅\n\n¿A qué subcategoría corresponde?\n\n`;
  subs.forEach((s, i) => { msg += `*${i + 1}.* ${s}\n`; });
  msg += `\n*0.* Sin subcategoría`;
  await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

// ── GUARDAR GASTO ───────────────────────────────────────────────────────────
async function guardarGasto(chatId, gasto, who) {
  const cat = CATS[gasto.category] || CATS["otros"];
  const descFinal = gasto.subcategoria
    ? `${gasto.subcategoria} - ${gasto.description}`
    : gasto.description;

  const { error } = await supabase.from("gastos").insert({
    monto:       gasto.amount,
    categoria:   gasto.category,
    descripcion: descFinal,
    quien:       who,
    fuente:      gasto.source,
    fecha:       gasto.fecha,
  });

  if (error) { await bot.sendMessage(chatId, `❌ Error al guardar: ${error.message}`); return; }

  const fechaInicio = gasto.fecha.slice(0, 7) + "-01";
  const fechaFin    = gasto.fecha.slice(0, 7) + "-31";
  const { data }    = await supabase.from("gastos").select("monto").eq("categoria", gasto.category).gte("fecha", fechaInicio).lte("fecha", fechaFin);

  const totalMes = (data || []).reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);
  const pct      = cat.budget > 0 ? (totalMes / cat.budget) * 100 : 0;
  const status   = pct > 100 ? "⚠️ EXCEDIDO" : pct > 80 ? "⚡ Cuidado" : "✅";
  const origen   = gasto.source === "applepay" ? `${who} (Apple Pay 💳)` : who;
  const mes      = MESES[parseInt(gasto.fecha.slice(5, 7)) - 1];
  const restante = cat.budget - totalMes;

  let m = `${status} *${origen}* · ${cat.emoji} ${cat.label}\n`;
  m += `*${fmt(gasto.amount)}* registrado\n`;
  m += `📝 ${descFinal}\n`;
  m += `📅 ${mes} ${gasto.fecha.slice(0, 4)}\n\n`;
  if (cat.budget > 0) {
    m += `💰 Gastado este mes: *${fmt(totalMes)}*\n`;
    m += `🎯 Presupuesto:      *${fmt(cat.budget)}*\n`;
    m += restante >= 0 ? `✅ Te quedan:        *${fmt(restante)}*\n` : `⚠️ Te pasaste:       *${fmt(Math.abs(restante))}*\n`;
    m += bar(pct);
  } else { m += `📦 Gasto registrado en Otros`; }

  await bot.sendMessage(chatId, m, { parse_mode: "Markdown" });
}

// ── RESUMEN ─────────────────────────────────────────────────────────────────
async function enviarResumenMensual(chatId, anio, mes) {
  const mesStr   = String(mes).padStart(2, "0");
  const mesNombre = MESES[mes - 1];
  await bot.sendMessage(chatId, `🔄 Generando resumen de *${mesNombre} ${anio}*...`, { parse_mode: "Markdown" });

  const { data, error } = await supabase.from("gastos").select("monto, categoria")
    .gte("fecha", `${anio}-${mesStr}-01`).lte("fecha", `${anio}-${mesStr}-31`);

  if (error) { await bot.sendMessage(chatId, `❌ Error: ${error.message}`); return; }
  if (!data || data.length === 0) {
    await bot.sendMessage(chatId, `📊 No hay gastos en *${mesNombre} ${anio}*.`, { parse_mode: "Markdown" });
    return;
  }

  const totCat = {};
  data.forEach(g => { totCat[g.categoria] = (totCat[g.categoria] || 0) + (parseFloat(g.monto) || 0); });
  const totalGastado = data.reduce((s, g) => s + (parseFloat(g.monto) || 0), 0);
  const ahorro = INGRESOS_MENSUALES - totalGastado;

  let msg = `📊 *Resumen ${mesNombre} ${anio}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  Object.entries(CATS).forEach(([id, cat]) => {
    const g = totCat[id] || 0;
    if (g === 0 && cat.budget === 0) return;
    const p = cat.budget > 0 ? Math.round((g / cat.budget) * 100) : 0;
    const ico = g === 0 ? "⬜" : p > 100 ? "⚠️" : p > 80 ? "⚡" : "✅";
    msg += cat.budget > 0
      ? `${ico} ${cat.emoji} ${cat.label}: ${fmt(g)} / ${fmt(cat.budget)} · ${p}%\n`
      : `📦 ${cat.emoji} ${cat.label}: ${fmt(g)}\n`;
  });
  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💰 *Ingresos:*  ${fmt(INGRESOS_MENSUALES)}\n`;
  msg += `💸 *Gastado:*   ${fmt(totalGastado)}\n`;
  msg += `📊 *Ejecución:* ${Math.round(totalGastado / INGRESOS_MENSUALES * 100)}%\n`;
  msg += ahorro >= 0 ? `💚 *Ahorro:*     ${fmt(ahorro)} 🎉` : `🔴 *Déficit:*    ${fmt(Math.abs(ahorro))} ⚠️`;

  await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

function verificarFinDeMes() {
  setInterval(async () => {
    if (!GROUP_CHAT_ID) return;
    const ahora = new Date(), maniana = new Date(ahora);
    maniana.setDate(ahora.getDate() + 1);
    if (maniana.getDate() === 1 && ahora.getHours() === 20)
      await enviarResumenMensual(GROUP_CHAT_ID, ahora.getFullYear(), ahora.getMonth() + 1);
  }, 60 * 60 * 1000);
}

// ── MENSAJES ─────────────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const text   = (msg.text || "").trim();
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const who    = msg.from.first_name || "Alguien";

  if (msg.chat.type === "group" || msg.chat.type === "supergroup") GROUP_CHAT_ID = chatId;

  // COMANDOS
  if (!text || text.startsWith("/")) {
    const cmd = text.split("@")[0].toLowerCase();
    if (cmd === "/resumen") { await enviarResumenMensual(chatId, new Date().getFullYear(), new Date().getMonth() + 1); return; }
    if (cmd === "/ultimos") {
      const { data } = await supabase.from("gastos").select("id,monto,categoria,descripcion,quien,fecha").order("created_at", { ascending: false }).limit(8);
      if (!data || !data.length) { await bot.sendMessage(chatId, "No hay gastos aún."); return; }
      let m = "📋 *Últimos gastos:*\n\n";
      data.forEach((g, i) => {
        const cat = CATS[g.categoria] || CATS["otros"];
        m += `*${i+1}.* ${cat.emoji} ${cat.label} — *${fmt(g.monto)}*\n   📝 ${g.descripcion} · ${g.quien} · ${g.fecha}\n   🆔 \`${g.id}\`\n\n`;
      });
      m += "Para borrar: /borrar ID\nPara editar: /editar ID";
      await bot.sendMessage(chatId, m, { parse_mode: "Markdown" }); return;
    }
    if (cmd.startsWith("/borrar")) {
      const id = text.split(" ")[1];
      if (!id) { await bot.sendMessage(chatId, "Usa /borrar ID"); return; }
      const { error } = await supabase.from("gastos").delete().eq("id", id);
      await bot.sendMessage(chatId, error ? `❌ ${error.message}` : `🗑️ Gasto ${id} borrado.`); return;
    }
    if (cmd.startsWith("/editar")) {
      const id = text.split(" ")[1];
      if (!id) { await bot.sendMessage(chatId, "Usa /editar ID"); return; }
      const { data } = await supabase.from("gastos").select("*").eq("id", id).single();
      if (!data) { await bot.sendMessage(chatId, `No encontré ID ${id}.`); return; }
      const cat = CATS[data.categoria] || CATS["otros"];
      editando[userId] = { id, gasto: data, paso: "elegir" };
      await bot.sendMessage(chatId, `✏️ *Gasto ID ${id}:*\n${cat.emoji} ${cat.label} — *${fmt(data.monto)}*\n📝 ${data.descripcion}\n\n¿Qué cambiar?\n*1.* Monto\n*2.* Categoría`, { parse_mode: "Markdown" }); return;
    }
    return;
  }

  // EDICIÓN
  if (editando[userId]) {
    const estado = editando[userId];
    if (estado.paso === "elegir") {
      if (text === "1") { estado.paso = "nuevo_monto"; await bot.sendMessage(chatId, "¿Nuevo monto?"); return; }
      if (text === "2") {
        estado.paso = "nueva_cat";
        const lista = Object.entries(CATS).map(([,c], i) => `${i+1}. ${c.emoji} ${c.label}`).join("\n");
        await bot.sendMessage(chatId, `Elige categoría:\n\n${lista}`); return;
      }
      await bot.sendMessage(chatId, "Responde *1* o *2*.", { parse_mode: "Markdown" }); return;
    }
    if (estado.paso === "nuevo_monto") {
      const v = parseInt(text.replace(/[^0-9]/g, ""));
      if (isNaN(v) || v <= 0) { await bot.sendMessage(chatId, "Escribe el monto: 45000"); return; }
      const { error } = await supabase.from("gastos").update({ monto: v }).eq("id", estado.id);
      delete editando[userId];
      await bot.sendMessage(chatId, error ? `❌ ${error.message}` : `✅ Monto: *${fmt(v)}*`, { parse_mode: "Markdown" }); return;
    }
    if (estado.paso === "nueva_cat") {
      const catKeys = Object.keys(CATS); const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= catKeys.length) {
        const { error } = await supabase.from("gastos").update({ categoria: catKeys[num-1] }).eq("id", estado.id);
        delete editando[userId];
        await bot.sendMessage(chatId, error ? `❌ ${error.message}` : `✅ ${CATS[catKeys[num-1]].emoji} *${CATS[catKeys[num-1]].label}*`, { parse_mode: "Markdown" }); return;
      }
      await bot.sendMessage(chatId, "Escribe el número."); return;
    }
  }

  // PENDIENTE (categoría + monto + subcategoría)
  if (pendientes[userId]) {
    const gasto = pendientes[userId];
    const catKeys = Object.keys(CATS);
    const num = parseInt(text);

    // PASO 1: confirmar categoría
    if (gasto.paso === "categoria") {
      if (text === "✅" || text.toLowerCase() === "si" || text.toLowerCase() === "sí") {
        gasto.paso = "monto";
        await bot.sendMessage(chatId, `💵 El monto detectado es *${fmt(gasto.amount)}*\n\n✅ Confirma o escribe el monto correcto:`, { parse_mode: "Markdown" });
        return;
      }
      if (!isNaN(num) && num >= 1 && num <= catKeys.length) {
        gasto.category = catKeys[num - 1];
        gasto.paso = "monto";
        await bot.sendMessage(chatId, `💵 El monto detectado es *${fmt(gasto.amount)}*\n\n✅ Confirma o escribe el monto correcto:`, { parse_mode: "Markdown" });
        return;
      }
      await bot.sendMessage(chatId, "Responde ✅ para confirmar o el número de la categoría 👆", { parse_mode: "Markdown" });
      return;
    }

    // PASO 2: confirmar o corregir monto
    if (gasto.paso === "monto") {
      if (text === "✅" || text.toLowerCase() === "si" || text.toLowerCase() === "sí") {
        await pedirSubcategoria(chatId, gasto);
        return;
      }
      // Intentar leer monto corregido
      const montoCorregido = extraerMonto(text) || parseInt(text.replace(/[^0-9]/g, ""));
      if (montoCorregido && montoCorregido > 0) {
        gasto.amount = montoCorregido;
        await pedirSubcategoria(chatId, gasto);
        return;
      }
      await bot.sendMessage(chatId, `Escribe el monto correcto (ej: *45000*) o ✅ para confirmar *${fmt(gasto.amount)}*`, { parse_mode: "Markdown" });
      return;
    }

    // PASO 3: subcategoría
    if (gasto.paso === "subcategoria") {
      const subs = SUBCATS[gasto.category] || [];
      if (text === "0" || text.toLowerCase() === "ninguna" || text.toLowerCase() === "no") {
        gasto.subcategoria = null;
        delete pendientes[userId];
        await guardarGasto(chatId, gasto, who);
        return;
      }
      if (!isNaN(num) && num >= 1 && num <= subs.length) {
        gasto.subcategoria = subs[num - 1];
        delete pendientes[userId];
        await guardarGasto(chatId, gasto, who);
        return;
      }
      await bot.sendMessage(chatId, `Escribe el número de la subcategoría o *0* para omitir 👆`, { parse_mode: "Markdown" });
      return;
    }
    return;
  }

  // NUEVO GASTO
  const isApplePay = text.startsWith("💳 Apple Pay");
  const source     = isApplePay ? "applepay" : "telegram";
  const fechaHoy   = new Date().toISOString().split("T")[0];

  // Intentar extraer monto directamente del texto
  const montoDirecto = extraerMonto(text);

  try {
    const catList = Object.entries(CATS).map(([id, c], i) => `${i+1}. ${c.emoji} ${c.label}`).join(", ");
    const ai = await claude.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content:
        `Eres un asistente de gastos familiares colombiano.
Del mensaje extrae:
1. Monto exacto en pesos — usa el número TAL CUAL aparece. Si dice "10" es 10, si dice "10mil" es 10000, si dice "45.000" es 45000. NO multipliques si ya es un número entero sin "mil" o "k".
2. La categoría más apropiada: ${catList}
3. Descripción corta (max 40 caracteres)

Responde SOLO JSON sin markdown:
{"amount": número, "category": "id", "description": "texto"}

IDs válidos: ${Object.keys(CATS).join(", ")}
Mensaje: "${text}"` }]
    });

    const rawText   = ai.content[0].text.trim().replace(/```json|```/g, "").trim();
    const resultado = JSON.parse(rawText);

    // Usar monto directo si Claude lo multiplicó por 1000 incorrectamente
    let amount = resultado.amount;
    if (montoDirecto && amount === montoDirecto * 1000) amount = montoDirecto;
    if (montoDirecto && Math.abs(amount - montoDirecto) > montoDirecto * 0.5) amount = montoDirecto;

    if (!amount || amount <= 0) {
      await bot.sendMessage(chatId, "No detecté el monto 😅\nEscribe así: _\"45000 mercado\"_", { parse_mode: "Markdown" });
      return;
    }

    const categoryId = Object.keys(CATS).includes(resultado.category) ? resultado.category : "otros";
    const cat        = CATS[categoryId];

    pendientes[userId] = {
      amount, category: categoryId, description: resultado.description,
      source, fecha: fechaHoy, subcategoria: null, paso: "categoria",
      _userId: userId, _who: who,
    };

    const listaCats = Object.entries(CATS).map(([,c], i) => `${i+1}. ${c.emoji} ${c.label}`).join("\n");
    const confirmMsg =
      `🤖 Detecté este gasto:\n\n` +
      `${cat.emoji} *${cat.label}*\n` +
      `💵 *${fmt(amount)}*\n` +
      `📝 ${resultado.description}\n\n` +
      `¿Es correcta la categoría?\n` +
      `Responde *✅* para confirmar o el *número* para cambiarla:\n\n` +
      listaCats;

    await bot.sendMessage(chatId, confirmMsg, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("Error:", err.message);
    delete pendientes[userId];
    await bot.sendMessage(chatId, "No entendí ese gasto 😅\nIntenta: _\"45000 mercado\"_ o _\"Taxi 12000\"_", { parse_mode: "Markdown" });
  }
});

// HTTP + PINGS
const http = require("http"), https = require("https");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end("OK"); }).listen(PORT, () => console.log("🌐 Puerto " + PORT));

const BOT_URL = process.env.RENDER_EXTERNAL_URL || "https://gastos-bot-csuv.onrender.com";
setInterval(() => {
  https.get(BOT_URL, () => console.log(`🏓 Render OK — ${new Date().toLocaleTimeString("es-CO")}`)).on("error", e => console.log("⚠️", e.message));
}, 3 * 60 * 1000);

setInterval(async () => {
  try { await supabase.from("gastos").select("id").limit(1); console.log(`💾 Supabase OK — ${new Date().toLocaleTimeString("es-CO")}`); }
  catch (e) { console.log("⚠️ Supabase:", e.message); }
}, 1000 * 60 * 60 * 24 * 3);

verificarFinDeMes();
console.log("🤖 GastosBot corriendo — con validación de monto");
