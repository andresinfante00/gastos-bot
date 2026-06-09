// ============================================================
// PRESUPUESTO FAMILIAR 2026 — Bot Telegram
// Andrés & Daniela · Backend: Google Apps Script
// ============================================================
// CONFIGURACIÓN:
//   1. npm install node-telegram-bot-api node-fetch dotenv
//   2. Crea un archivo .env con:
//      BOT_TOKEN=tu_token_de_botfather
// ============================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const BOT_TOKEN  = process.env.BOT_TOKEN;
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzzjE-L2kvfauL0zF774yAjzIhYjfkZZrRsecEcVG4J0tp-CYEOGOSER4F5wSvb86Qj/exec';

if (!BOT_TOKEN) {
  console.error('❌ Falta BOT_TOKEN en el .env');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ---- Categorías ----
const CATS = {
  vivienda:       { emoji: '🏠', label: 'Vivienda' },
  mercado:        { emoji: '🛒', label: 'Mercado/Aseo' },
  familia:        { emoji: '👨‍👩‍👧', label: 'Familia' },
  transporte:     { emoji: '⛽', label: 'Transporte' },
  servicios:      { emoji: '💡', label: 'Servicios' },
  celulares:      { emoji: '📱', label: 'Celulares' },
  ocio:           { emoji: '🎮', label: 'Ocio' },
  personalJ:      { emoji: '👤', label: 'Personal Andrés' },
  personalD:      { emoji: '👤', label: 'Personal Dani' },
  deudas:         { emoji: '💳', label: 'Deudas' },
  fondoCarro:     { emoji: '🚗', label: 'Fondo Carro' },
  fondoImpuestos: { emoji: '🏛️', label: 'Fondo Impuestos' },
  samuel:         { emoji: '👦', label: 'Samuel' },
  jardinJuanpa:   { emoji: '🌿', label: 'Jardín JuanPa' },
  zeus:           { emoji: '🐕', label: 'Zeus' },
  imprevistos:    { emoji: '🆘', label: 'Imprevistos' },
  otros:          { emoji: '📦', label: 'Otros' }
};

const PRESUPUESTOS = {
  vivienda: 2693000, mercado: 1900000, familia: 2071000, transporte: 450000,
  servicios: 395000, celulares: 80000, ocio: 500000, personalJ: 400000,
  personalD: 400000, deudas: 470000, fondoCarro: 500000, fondoImpuestos: 500000,
  samuel: 500000, jardinJuanpa: 1171000, zeus: 400000, imprevistos: 200000
};

// ---- Sesiones de usuario (estado de conversación) ----
const sesiones = {};

// ---- Helpers ----
function fmt(n) {
  return '$ ' + new Intl.NumberFormat('es-CO').format(Math.round(Math.abs(n || 0)));
}

function hoy() {
  return new Date().toISOString().split('T')[0];
}

function mesActual() {
  const d = new Date();
  return { mes: d.getMonth() + 1, anio: d.getFullYear() };
}

async function apiGet(params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${SCRIPT_URL}?${qs}`);
  return r.json();
}

async function apiPost(body) {
  const r = await fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return r.json();
}

// ============================================================
// INICIO / AYUDA
// ============================================================
bot.onText(/\/start|\/ayuda|\/help/, (msg) => {
  const chat = msg.chat.id;
  const texto = `💼 *Presupuesto Familiar 2026*\n` +
    `Andrés & Daniela\n\n` +
    `*Comandos disponibles:*\n` +
    `📝 /gasto — Registrar un gasto\n` +
    `💵 /ingreso — Registrar un ingreso\n` +
    `📊 /resumen — Ver resumen del mes\n` +
    `📋 /categorias — Ver todas las categorías\n` +
    `❌ /cancelar — Cancelar operación actual\n\n` +
    `_También puedes escribir directamente:_\n` +
    `\`mercado 45000\` → registra gasto rápido\n` +
    `\`gasto transporte 15000 Daniela\``;
  bot.sendMessage(chat, texto, { parse_mode: 'Markdown' });
});

bot.onText(/\/cancelar/, (msg) => {
  const chat = msg.chat.id;
  delete sesiones[chat];
  bot.sendMessage(chat, '❌ Operación cancelada.');
});

// ============================================================
// RESUMEN DEL MES
// ============================================================
bot.onText(/\/resumen/, async (msg) => {
  const chat = msg.chat.id;
  try {
    bot.sendMessage(chat, '⏳ Consultando Google Sheets...');
    const { mes, anio } = mesActual();
    const [rG, rI] = await Promise.all([
      apiGet({ action: 'query', sheet: 'gastos',   mes, anio }),
      apiGet({ action: 'query', sheet: 'ingresos', mes, anio })
    ]);
    const gastos   = rG.data  || [];
    const ingresos = rI.data  || [];

    const bycat = {};
    let totReal = 0;
    gastos.forEach(r => {
      const c = (r.categoria || 'otros').trim();
      bycat[c] = (bycat[c] || 0) + parseFloat(r.monto || 0);
      totReal  += parseFloat(r.monto || 0);
    });
    const totPto = Object.values(PRESUPUESTOS).reduce((a, v) => a + v, 0);
    const totIng = ingresos.reduce((a, r) => a + parseFloat(r.monto || 0), 0);
    const ING_TOTAL = 13848000;

    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    let txt = `📊 *Resumen ${meses[mes-1]} ${anio}*\n\n`;
    txt += `💰 Ingresos recibidos: *${fmt(totIng)}* / ${fmt(ING_TOTAL)}\n`;
    txt += `💸 Total gastado: *${fmt(totReal)}* / ${fmt(totPto)}\n`;
    txt += `✅ Disponible: *${fmt(ING_TOTAL - totReal)}*\n\n`;
    txt += `*Por categoría:*\n`;

    Object.entries(bycat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([cat, val]) => {
        const c   = CATS[cat] || CATS.otros;
        const pto = PRESUPUESTOS[cat] || 0;
        const pct = pto > 0 ? Math.round(val / pto * 100) : 0;
        const emoji = pct >= 100 ? '🔴' : pct >= 85 ? '🟡' : '🟢';
        txt += `${emoji} ${c.emoji} ${c.label}: *${fmt(val)}*`;
        if (pto > 0) txt += ` (${pct}% de ${fmt(pto)})`;
        txt += '\n';
      });

    txt += `\n_${gastos.length} transacciones este mes_`;
    bot.sendMessage(chat, txt, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chat, '❌ Error al consultar: ' + e.message);
  }
});

// ============================================================
// VER CATEGORÍAS
// ============================================================
bot.onText(/\/categorias/, (msg) => {
  const chat = msg.chat.id;
  let txt = '📋 *Categorías disponibles:*\n\n';
  Object.entries(CATS).forEach(([id, c]) => {
    const pto = PRESUPUESTOS[id];
    txt += `${c.emoji} \`${id}\` — ${c.label}`;
    if (pto) txt += ` _(${fmt(pto)})_`;
    txt += '\n';
  });
  txt += '\n_Usa el código en tus mensajes de gasto rápido_';
  bot.sendMessage(chat, txt, { parse_mode: 'Markdown' });
});

// ============================================================
// REGISTRAR GASTO — Flujo conversacional
// ============================================================
bot.onText(/\/gasto/, (msg) => {
  const chat = msg.chat.id;
  sesiones[chat] = { tipo: 'gasto', paso: 'quien' };
  bot.sendMessage(chat,
    '💸 *Nuevo gasto*\n¿Quién realiza el gasto?',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [['Andrés', 'Daniela', 'Ambos']],
        resize_keyboard: true, one_time_keyboard: true
      }
    }
  );
});

// ============================================================
// REGISTRAR INGRESO — Flujo conversacional
// ============================================================
bot.onText(/\/ingreso/, (msg) => {
  const chat = msg.chat.id;
  sesiones[chat] = { tipo: 'ingreso', paso: 'fuente' };
  bot.sendMessage(chat, '💵 *Nuevo ingreso*\n¿Fuente del ingreso?', {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [
        ['Salario Andres', 'Salario Daniela'],
        ['Arriendo Casa', 'Arriendo Apto'],
        ['Otro ingreso']
      ],
      resize_keyboard: true, one_time_keyboard: true
    }
  });
});

// ============================================================
// GASTO RÁPIDO: "mercado 45000" o "gasto transporte 15000 Daniela"
// ============================================================
function esGastoRapido(texto) {
  const patrones = [
    /^([a-zA-ZáéíóúÁÉÍÓÚñÑ]+)\s+(\d[\d.,]*)(\s+(andrés?|daniela|ambos))?$/i,
    /^gasto\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ]+)\s+(\d[\d.,]*)(\s+(andrés?|daniela|ambos))?$/i
  ];
  for (const p of patrones) {
    const m = texto.match(p);
    if (m) return m;
  }
  return null;
}

// ============================================================
// MANEJADOR PRINCIPAL DE MENSAJES
// ============================================================
bot.on('message', async (msg) => {
  const chat  = msg.chat.id;
  const texto = (msg.text || '').trim();

  if (texto.startsWith('/')) return;

  const sesion = sesiones[chat];

  if (sesion && sesion.tipo === 'gasto') {
    await manejarFlujoGasto(chat, texto, sesion);
    return;
  }

  if (sesion && sesion.tipo === 'ingreso') {
    await manejarFlujoIngreso(chat, texto, sesion);
    return;
  }

  // ---- Gasto rápido ----
  const match = esGastoRapido(texto);
  if (match) {
    const esConPrefijo = texto.toLowerCase().startsWith('gasto');
    const catRaw   = match[1];
    const montoRaw = match[2];
    const quienRaw = match[4];

    const cat   = catRaw.toLowerCase()
      .replace(/ó/g,'o').replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ú/g,'u');
    const catId = Object.keys(CATS).find(k => k.toLowerCase() === cat) || 'otros';
    const monto = parseFloat(montoRaw.replace(',', '.'));
    const quien = quienRaw
      ? (quienRaw.toLowerCase().includes('dani') ? 'Daniela' : quienRaw.toLowerCase().includes('ambo') ? 'Ambos' : 'Andres')
      : 'Andres';

    if (isNaN(monto) || monto <= 0) {
      bot.sendMessage(chat, '❌ Monto no válido. Ejemplo: `mercado 45000`', { parse_mode: 'Markdown' });
      return;
    }

    try {
      const r = await apiPost({ action: 'insert', sheet: 'gastos', data: {
        monto, categoria: catId, descripcion: CATS[catId].label, quien, fuente: 'telegram', fecha: hoy()
      }});
      if (!r.ok) throw new Error(r.error);
      const c = CATS[catId];
      bot.sendMessage(chat,
        `✅ Gasto registrado\n${c.emoji} *${c.label}* · ${fmt(monto)}\n👤 ${quien}`,
        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
      );
    } catch (e) {
      bot.sendMessage(chat, '❌ Error: ' + e.message);
    }
    return;
  }

  bot.sendMessage(chat,
    '💡 No entendí ese mensaje.\n\nPrueba:\n• `/gasto` para registrar con menú\n• `mercado 45000` para gasto rápido\n• `/resumen` para ver el mes\n• `/ayuda` para todos los comandos',
    { parse_mode: 'Markdown' }
  );
});

// ============================================================
// FLUJO GASTO — paso a paso
// ============================================================
async function manejarFlujoGasto(chat, texto, sesion) {
  if (sesion.paso === 'quien') {
    const mapa = { 'andrés': 'Andres', 'andres': 'Andres', 'daniela': 'Daniela', 'ambos': 'Ambos' };
    sesion.quien = mapa[texto.toLowerCase()] || 'Andres';
    sesion.paso  = 'categoria';
    const filas = [];
    const catIds = Object.keys(CATS);
    for (let i = 0; i < catIds.length; i += 3) {
      filas.push(catIds.slice(i, i+3).map(id => CATS[id].emoji + ' ' + id));
    }
    bot.sendMessage(chat, '📂 ¿Categoría del gasto?', {
      parse_mode: 'Markdown',
      reply_markup: { keyboard: filas, resize_keyboard: true, one_time_keyboard: true }
    });
    return;
  }

  if (sesion.paso === 'categoria') {
    const raw   = texto.replace(/[^\w]/g, ' ').trim().split(/\s+/).pop().toLowerCase();
    const catId = Object.keys(CATS).find(k => k.toLowerCase() === raw) || 'otros';
    sesion.catId = catId;
    sesion.paso  = 'descripcion';
    bot.sendMessage(chat,
      `${CATS[catId].emoji} *${CATS[catId].label}*\n\n¿Descripción del gasto?`,
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  if (sesion.paso === 'descripcion') {
    sesion.descripcion = texto;
    sesion.paso = 'monto';
    bot.sendMessage(chat, '💰 ¿Cuánto fue el gasto? (solo el número)');
    return;
  }

  if (sesion.paso === 'monto') {
    const monto = parseFloat(texto.replace(/\./g, '').replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      bot.sendMessage(chat, '❌ Escribe solo el número, ejemplo: `45000`', { parse_mode: 'Markdown' });
      return;
    }
    sesion.monto = monto;
    sesion.paso  = 'confirmar';
    const c = CATS[sesion.catId];
    bot.sendMessage(chat,
      `📋 *Confirmar gasto:*\n\n` +
      `${c.emoji} Categoría: *${c.label}*\n` +
      `📝 Descripción: *${sesion.descripcion}*\n` +
      `💰 Monto: *${fmt(monto)}*\n` +
      `👤 Quién: *${sesion.quien}*\n` +
      `📅 Fecha: *${hoy()}*\n\n` +
      `¿Confirmar?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [['✅ Confirmar', '❌ Cancelar']],
          resize_keyboard: true, one_time_keyboard: true
        }
      }
    );
    return;
  }

  if (sesion.paso === 'confirmar') {
    if (texto.includes('Confirmar') || texto === '✅') {
      try {
        const r = await apiPost({ action: 'insert', sheet: 'gastos', data: {
          monto: sesion.monto, categoria: sesion.catId,
          descripcion: sesion.descripcion, quien: sesion.quien,
          fuente: 'telegram', fecha: hoy()
        }});
        if (!r.ok) throw new Error(r.error);
        bot.sendMessage(chat,
          `✅ *Gasto guardado en Google Sheets*\n${CATS[sesion.catId].emoji} ${fmt(sesion.monto)}`,
          { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
        );
      } catch (e) {
        bot.sendMessage(chat, '❌ Error al guardar: ' + e.message, { reply_markup: { remove_keyboard: true } });
      }
    } else {
      bot.sendMessage(chat, '❌ Gasto cancelado.', { reply_markup: { remove_keyboard: true } });
    }
    delete sesiones[chat];
    return;
  }
}

// ============================================================
// FLUJO INGRESO — paso a paso
// ============================================================
async function manejarFlujoIngreso(chat, texto, sesion) {
  if (sesion.paso === 'fuente') {
    sesion.fuente = texto;
    sesion.quien  = texto.includes('Daniela') ? 'Daniela' : 'Andres';
    sesion.paso   = 'monto';
    bot.sendMessage(chat,
      `💵 *${texto}*\n¿Cuánto fue el ingreso?`,
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  if (sesion.paso === 'monto') {
    const monto = parseFloat(texto.replace(/\./g, '').replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      bot.sendMessage(chat, '❌ Escribe solo el número, ejemplo: `3780000`', { parse_mode: 'Markdown' });
      return;
    }
    try {
      const r = await apiPost({ action: 'insert', sheet: 'ingresos', data: {
        fuente: sesion.fuente, monto, fecha: hoy(), quien: sesion.quien, frecuencia: 'manual'
      }});
      if (!r.ok) throw new Error(r.error);
      bot.sendMessage(chat,
        `✅ *Ingreso guardado*\n💵 ${sesion.fuente}: *${fmt(monto)}*`,
        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
      );
    } catch (e) {
      bot.sendMessage(chat, '❌ Error: ' + e.message, { reply_markup: { remove_keyboard: true } });
    }
    delete sesiones[chat];
    return;
  }
}

// ============================================================
// INICIO
// ============================================================
console.log('🤖 Bot de Presupuesto Familiar iniciado');
console.log('📊 Backend: Google Sheets via Apps Script');
console.log('🔗 Script URL:', SCRIPT_URL);
console.log('✅ Escuchando mensajes...');
