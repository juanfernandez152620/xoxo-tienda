'use strict';
/* Claude contesta solo el chat "Cambios por IA" del panel (Claude API, SDK oficial @anthropic-ai/sdk).
 *
 * Cuando el equipo manda un mensaje, espera un par de segundos (por si mandan varios seguidos), marca "Visto",
 * muestra "Claude está escribiendo…" y contesta en el mismo chat. Puede buscar en el catálogo y anotar pedidos
 * de cambio para que Juan los aplique; todavía no cambia nada de la tienda por su cuenta.
 *
 * Se prende con ANTHROPIC_API_KEY (en el VPS se carga con xoxo-claves). Modelo: CLAUDE_MODELO, Claude Opus 5.5
 * si no se indica otro.
 */
const fs = require('fs');
const crypto = require('crypto');
const { IA } = require('./entorno');
const { ruta, agregarLinea, ahoraIso } = require('./archivos');
const sitio = require('./sitio');
const chat = require('./chat');

const PEDIDOS = ruta('chat', 'pedidos-de-cambio.jsonl');
const MAX_POR_HORA = 40; // tope de respuestas, por si algo se descontrola
const ESPERA_MS = 2500; // junta los mensajes que llegan seguidos

/* ---------- SDK ---------- */
// Si falta node_modules (npm ci), la tienda sigue andando y el chat queda sin respuestas automáticas
let sdk;
function cargarSdk() {
  if (sdk !== undefined) return sdk;
  try {
    const mod = require('@anthropic-ai/sdk');
    sdk = { Anthropic: mod.default || mod, betaTool: require('@anthropic-ai/sdk/helpers/beta/json-schema').betaTool };
  } catch (err) {
    console.error(`[ia] No se pudo cargar @anthropic-ai/sdk (¿faltó npm ci?): ${err.message}`);
    sdk = null;
  }
  return sdk;
}
let cliente = null;
const cliente_ = () => (cliente || (cliente = new (cargarSdk().Anthropic)()));
const activo = () => Boolean(IA.key && cargarSdk());

/* ---------- Catálogo para las herramientas ---------- */
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nombreCompleto = p => (p.storage ? `${/^(moto|nubia)/i.test(p.name) ? '' : `${p.brand} `}${p.name} ${p.storage} GB` : p.name);
const plata = n => (Number(n) ? `$${new Intl.NumberFormat('es-AR').format(n)}` : null);

function ficha(p, tipo) {
  const cuotas = Object.fromEntries(Object.entries(p.cuotas || {}).map(([k, v]) => [`${k} cuotas`, plata(v)]));
  const total = p.price || (p.cuotas && p.cuotas[12] ? p.cuotas[12] * 12 : 0);
  return {
    id: p.id,
    nombre: nombreCompleto(p),
    tipo,
    ...(p.group ? { grupo: p.group } : {}),
    ...(p.ram ? { ram: `${p.ram} GB` } : {}),
    ...(Object.keys(cuotas).length ? { cuotas } : {}),
    ...(p.price ? { precio: plata(p.price) } : {}),
    ...(p.listPrice ? { precio_de_lista: plata(p.listPrice) } : {}),
    ...(total ? { total_pago_online: plata(total) } : {}),
    visible_en_la_tienda: !p.hidden,
    fotos: (p.gallery || []).length,
  };
}

function buscarProductos(texto) {
  const site = sitio.cargar();
  const todos = [
    ...site.products.map(p => ({ p, tipo: 'celular' })),
    ...site.extras.map(p => ({ p, tipo: 'otro producto' })),
  ];
  const palabras = sinTildes(texto).split(/[^a-z0-9]+/).filter(w => w && !['todos', 'todo', 'los', 'las', 'de', 'el', 'la'].includes(w));
  const hallados = palabras.length
    ? todos.filter(({ p }) => {
      const pajar = sinTildes(`${p.brand} ${p.name} ${p.storage || ''} ${p.group || ''} ${p.id}`);
      return palabras.every(w => pajar.includes(w));
    })
    : todos;
  if (!hallados.length) return `No encontré productos con "${texto}". Hay ${todos.length} en total: probá con otra palabra o con "todos".`;
  return JSON.stringify(hallados.slice(0, 60).map(({ p, tipo }) => ficha(p, tipo)));
}

function anotarPedido(resumen, detalle, de) {
  const pedido = {
    id: crypto.randomBytes(3).toString('hex'),
    at: ahoraIso(),
    de,
    resumen: String(resumen || '').trim().slice(0, 200),
    detalle: String(detalle || '').trim().slice(0, 2000),
    estado: 'pendiente',
  };
  agregarLinea(PEDIDOS, JSON.stringify(pedido));
  console.log(`[ia] Pedido de cambio anotado (${pedido.id}): ${pedido.resumen}`);
  return `Anotado con el número ${pedido.id}. Juan lo ve en su lista de pedidos y lo aplica.`;
}

function leerPedidos() {
  let text = '';
  try { text = fs.readFileSync(PEDIDOS, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function herramientas(de) {
  const { betaTool } = cargarSdk();
  return [
    betaTool({
      name: 'buscar_productos',
      description: 'Busca en el catálogo de la tienda (celulares y otros productos) y devuelve nombre, cuotas, precios y si se ve en la tienda. '
        + 'Usala siempre antes de hablar de un producto o un precio: nunca inventes datos. Con texto "todos" devuelve el catálogo entero.',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: { texto: { type: 'string', description: 'Palabras a buscar, por ejemplo "moto g06", "a16 128" o "todos".' } },
        required: ['texto'],
        additionalProperties: false,
      },
      run: ({ texto }) => buscarProductos(texto),
    }),
    betaTool({
      name: 'anotar_pedido',
      description: 'Anota un pedido de cambio para que Juan (el dueño) lo aplique: precios, productos, fotos, textos o algo que no anda. '
        + 'Usala solo cuando la persona ya confirmó qué quiere, con los datos exactos (producto, valor de antes y valor nuevo).',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: {
          resumen: { type: 'string', description: 'Una línea, por ejemplo: "Moto g06 128 GB: 12 cuotas de $44.858 a $44.857".' },
          detalle: { type: 'string', description: 'Todo lo necesario para hacer el cambio sin volver a preguntar.' },
        },
        required: ['resumen', 'detalle'],
        additionalProperties: false,
      },
      run: ({ resumen, detalle }) => anotarPedido(resumen, detalle, de),
    }),
  ];
}

/* ---------- Instrucciones y conversación ---------- */
function instrucciones() {
  const site = sitio.cargar();
  const sucursales = site.store.branches.filter(b => b.on !== false)
    .map(b => `- ${b.name}: ${b.address} (WhatsApp ${b.whatsapp})`).join('\n');
  return `Sos Claude, el asistente del equipo de ${site.store.name}, una tienda de celulares y accesorios de San Miguel de Tucumán. \
Estás en el chat "Cambios por IA" del panel de administración de la tienda. Te escriben Juan, el dueño, y su socio. \
Ninguno de los dos programa.

Para qué sirve este chat:
- Responder dudas sobre la tienda y el catálogo. Para productos y precios usá siempre la herramienta buscar_productos.
- Recibir pedidos de cambio para la tienda: precios, cuotas, productos nuevos, fotos, textos o algo que no funciona. \
Todavía no podés cambiar la tienda vos. Confirmá qué entendiste, con el producto exacto y el valor de antes y el nuevo. \
Si falta un dato, preguntalo. Cuando esté claro y la persona lo confirme, anotalo con anotar_pedido y avisá que Juan lo va a aplicar.

Cómo escribir:
- Español rioplatense, cálido y directo, como un compañero de trabajo. Respuestas cortas.
- Texto plano: el chat no muestra negritas, títulos ni tablas. Para listas usá guiones.
- Precios como en la tienda: $44.858 (punto para los miles).
- Cada mensaje del equipo llega como "Nombre (hora): texto".
- Los audios llegan con su transcripción. Si un audio llega sin transcripción, no lo podés escuchar: pedí que lo escriban \
o que lo dicten con el micrófono del teclado del celular.
- Las fotos que mandan las podés ver.

Datos de la tienda:
- Sucursales:
${sucursales}
- Financiación: ${site.store.financing || 'GO cuotas'}`;
}

const hora = iso => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const TIPOS_FOTO = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_FOTO_API = 3.7 * 1048576; // la API acepta hasta 5 MB en base64

function bloques(m, conFotos) {
  let texto = `${m.de} (${hora(m.at)}): ${m.texto || ''}`.trim();
  if (m.audio) {
    const d = m.duracion || 0;
    const dur = `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
    texto += m.transcripcion
      ? `\n[Audio de ${dur}. Lo que dijo: "${m.transcripcion}"]`
      : `\n[Mandó un audio de ${dur} sin transcripción: no lo podés escuchar]`;
  }
  const out = [];
  for (const u of m.adjuntos || []) {
    const name = u.split('/').pop();
    const file = ruta('subidas', name);
    const tipo = TIPOS_FOTO[name.split('.').pop().toLowerCase()];
    let ok = false;
    if (conFotos && tipo) {
      try {
        if (fs.statSync(file).size <= MAX_FOTO_API) {
          out.push({ type: 'image', source: { type: 'base64', media_type: tipo, data: fs.readFileSync(file).toString('base64') } });
          ok = true;
        }
      } catch {}
    }
    if (!ok) texto += '\n[Mandó una foto que no se puede mostrar]';
  }
  out.push({ type: 'text', text: texto });
  return out;
}

// Los últimos mensajes del chat, como conversación para la API (empieza siempre con un mensaje del equipo)
function conversacion() {
  const { mensajes } = chat.leer('', 40);
  const desde = mensajes.findIndex(m => m.rol === 'equipo');
  const lista = desde >= 0 ? mensajes.slice(desde) : [];
  const conFotos = new Set(lista.filter(m => m.adjuntos && m.adjuntos.length).slice(-4).map(m => m.id));
  return lista.map(m => (m.rol === 'claude'
    ? { role: 'assistant', content: m.texto || '(audio o foto)' }
    : { role: 'user', content: bloques(m, conFotos.has(m.id)) }));
}

/* ---------- Responder ---------- */
const hechas = [];
let ultimoAvisoError = 0;

// Un aviso en el chat cuando no se puede contestar (como mucho uno cada 30 minutos, para no llenar el chat)
function avisarProblema(texto) {
  chat.dejarDeEscribir();
  if (Date.now() - ultimoAvisoError < 30 * 60e3) return;
  ultimoAvisoError = Date.now();
  chat.agregar({ rol: 'claude', de: 'Claude', texto });
}

function explicarError(err) {
  const { Anthropic } = cargarSdk();
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return 'No puedo contestar: la clave de Claude que está cargada en el servidor no funciona. Juan la tiene que revisar con xoxo-claves.';
  }
  if (err instanceof Anthropic.RateLimitError) return 'Estoy recibiendo demasiados pedidos juntos. Mandame el mensaje de nuevo en un minuto.';
  if (err instanceof Anthropic.BadRequestError && /credit|balance/i.test(err.message)) {
    return 'No puedo contestar: se terminó el crédito de la cuenta de Claude. Juan tiene que cargar más en console.anthropic.com.';
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
    return 'No me pude conectar con Claude en este momento. Probá mandar el mensaje de nuevo en un rato.';
  }
  return 'Tuve un problema para contestar. Probá mandar el mensaje de nuevo; si sigue, avisale a Juan.';
}

async function responder() {
  const { mensajes } = chat.leer('', 1);
  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo || ultimo.rol !== 'equipo') return; // ya está contestado

  const ahora = Date.now();
  while (hechas.length && ahora - hechas[0] > 3600e3) hechas.shift();
  if (hechas.length >= MAX_POR_HORA) {
    return avisarProblema('Llegué al máximo de respuestas por hora que tengo configurado. En un rato vuelvo a contestar.');
  }
  hechas.push(ahora);

  chat.marcarVisto();
  chat.escribiendo(240);
  try {
    const final = await cliente_().beta.messages.toolRunner({
      model: IA.modelo,
      max_tokens: 16000,
      // Si el modelo rechaza un pedido por seguridad, la API lo reintenta con otro modelo en el mismo llamado
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: instrucciones(), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Hoy es ${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` },
      ],
      tools: herramientas(ultimo.de),
      messages: conversacion(),
      max_iterations: 8,
      thread: false,
    });
    let texto = final.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (final.stop_reason === 'refusal') texto = 'Eso no lo puedo responder. Si es un cambio para la tienda, contámelo de otra forma.';
    chat.agregar({ rol: 'claude', de: 'Claude', texto: texto || 'Perdón, no me salió la respuesta. ¿Me lo repetís?' });
  } catch (err) {
    console.error(`[ia] No se pudo contestar: ${err.message}`);
    avisarProblema(explicarError(err));
  }
}

let timer = null;
let corriendo = false;
let otraVez = false;
async function correr() {
  if (corriendo) { otraVez = true; return; }
  corriendo = true;
  try {
    do {
      otraVez = false;
      await responder();
    } while (otraVez);
  } catch (err) {
    console.error('[ia]', err.message);
  } finally {
    corriendo = false;
  }
}

// Lo llama el panel cada vez que el equipo manda un mensaje
function avisar() {
  if (!activo()) return;
  clearTimeout(timer);
  timer = setTimeout(correr, ESPERA_MS);
}

// Al arrancar la tienda: prueba la clave y contesta lo que haya quedado sin respuesta en las últimas horas
async function iniciar() {
  if (!IA.key) return void console.log('  Claude (chat del panel): sin clave, no contesta solo');
  if (!cargarSdk()) return;
  try {
    const m = await cliente_().models.retrieve(IA.modelo);
    console.log(`  Claude (chat del panel): conectado, contesta solo con ${m.display_name || IA.modelo}`);
  } catch (err) {
    return void console.error(`  Claude (chat del panel): la clave no anduvo (${err.status || ''} ${err.message})`);
  }
  const { mensajes } = chat.leer('', 1);
  const ultimo = mensajes[mensajes.length - 1];
  if (ultimo && ultimo.rol === 'equipo' && Date.now() - Date.parse(ultimo.at) < 6 * 3600e3) avisar();
}

module.exports = { activo, avisar, iniciar, leerPedidos, PEDIDOS };
