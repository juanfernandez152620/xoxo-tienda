'use strict';
/* Pago online con GO cuotas y Mercado Pago, y los pedidos (datos/pedidos.json).
 *
 * El precio sale del contenido de la tienda, nunca del navegador. Un pago se da por aprobado solo después de
 * consultarlo en la API de la pasarela (al volver de pagar o cuando la pasarela avisa por webhook).
 * Si a un medio le falta su clave y PAGOS_DEMO=true, ese medio muestra un pago simulado que no cobra nada.
 */

const crypto = require('crypto');
const { BASE_URL, HTTPS, PAGOS_DEMO, MP_TOKEN, MP_WEBHOOK_SECRET, GC } = require('./entorno');
const { ruta, escribir, leerJson, aJson } = require('./archivos');
const sitio = require('./sitio');
const envios = require('./envios');
const correo = require('./correo');
const flash = require('../publico/shared/flash');

const PEDIDOS = ruta('pedidos.json');

// Mercado Pago es el medio principal (va primero y elegido); GO cuotas queda como segunda opción
const METHODS = {
  mercadopago: { name: 'Mercado Pago', live: () => Boolean(MP_TOKEN) },
  gocuotas: { name: 'GO cuotas', live: () => Boolean(GC.email && GC.password) },
};
function estadoMedio(key) {
  const live = METHODS[key].live();
  return { enabled: live || PAGOS_DEMO, demo: !live && PAGOS_DEMO };
}
// Con al menos un medio activo, las páginas muestran "Comprar"; si no, solo WhatsApp
const activo = () => Object.keys(METHODS).some(k => estadoMedio(k).enabled);
const configPublica = () => ({ methods: Object.fromEntries(Object.keys(METHODS).map(k => [k, estadoMedio(k)])) });

const priceOf = p => p.price || p.cuotas[12] * 12;
// El mismo nombre que arma shared/checkout.js: con él la página reconoce el producto al volver de pagar
const fullName = p => (p.storage ? `${/^(moto|nubia)/i.test(p.name) ? '' : `${p.brand} `}${p.name} ${p.storage} GB` : p.name);
const money = n => `$${new Intl.NumberFormat('es-AR').format(n)}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class ErrorPasarela extends Error {
  constructor(gateway, status, detail) {
    super(`${gateway} respondió con un error${detail ? `: ${detail}` : ''} (${status})`);
    this.status = 502;
  }
}

/* ---------- Pedidos ---------- */
const leerPedidos = () => {
  const list = leerJson(PEDIDOS);
  return Array.isArray(list) ? list : [];
};
const guardarPedidos = list => escribir(PEDIDOS, aJson(list, true));
const buscar = id => leerPedidos().find(o => o.id === id) || null;
function actualizar(id, patch) {
  const list = leerPedidos();
  const order = list.find(o => o.id === id);
  if (!order) return null;
  const antes = order.status;
  Object.assign(order, patch, { updatedAt: new Date().toISOString() });
  // Pago aprobado por primera vez: se manda el correo de la compra (y el aviso de venta a la tienda)
  const avisar = patch.status === 'approved' && antes !== 'approved' && !(order.emails && order.emails.compra);
  if (avisar) order.emails = { ...(order.emails || {}), compra: new Date().toISOString() };
  guardarPedidos(list);
  if (patch.status) console.log(`[pedido ${order.ref}] ${order.method}: ${patch.status}`);
  if (avisar) correo.compraAprobada(order);
  return order;
}
const tienda = () => sitio.cargar().store.name;
const volver = (order, result) => `${BASE_URL}/${order.version === sitio.PRINCIPAL ? '' : `${order.version}/`}?pago=${result}&pedido=${order.id}`;
const pedidoPublico = o => ({
  id: o.id, ref: o.ref, status: o.status, method: o.method, product: o.product.name,
  amount: o.amount, plan: o.plan, demo: Boolean(o.gateway && o.gateway.demo),
  envio: o.envio ? o.envio.nombre : '', email: Boolean(o.emails && o.emails.compra),
});

/* ---------- Datos del comprador ---------- */
function validar(body) {
  const b = body.buyer || {};
  const d = body.delivery || {};
  const clean = s => String(s || '').trim().replace(/\s+/g, ' ');
  const buyer = {
    name: clean(b.name).slice(0, 80),
    email: clean(b.email).toLowerCase().slice(0, 120),
    phone: String(b.phone || '').replace(/[^\d]/g, '').slice(0, 15),
    dni: String(b.dni || '').replace(/[^\d]/g, '').slice(0, 9),
  };
  // type: 'retiro' o la forma de envío elegida en la calculadora (andreani-domicilio, correo-sucursal…)
  const type = /^(retiro|(andreani|correo)-(domicilio|sucursal))$/.test(d.type) ? d.type : d.type === 'envio' ? 'andreani-domicilio' : 'retiro';
  const delivery = {
    type,
    address: clean(d.address).slice(0, 160),
    city: clean(d.city).slice(0, 80),
    province: clean(d.province).slice(0, 40),
    cp: clean(d.cp).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8),
    branch: clean(d.branch).slice(0, 40),
  };
  if (buyer.name.length < 3) return { error: 'Escribí tu nombre y apellido.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyer.email)) return { error: 'Revisá tu email.' };
  if (buyer.phone.length < 8) return { error: 'Escribí tu celular con característica (ej: 381 5123456).' };
  if (buyer.dni && (buyer.dni.length < 7 || buyer.dni.length > 9)) return { error: 'Revisá tu DNI.' };
  if (type !== 'retiro') {
    if (delivery.cp.length < 4) return { error: 'Escribí el código postal para el envío.' };
    if (delivery.city.length < 2) return { error: 'Escribí la localidad para el envío.' };
    if (type.endsWith('domicilio') && delivery.address.length < 5) return { error: 'Escribí la dirección para el envío.' };
  }
  return { buyer, delivery };
}

/* ---------- Mercado Pago (Checkout Pro) ---------- */
async function mpCrear(order, product) {
  const [first, ...rest] = order.buyer.name.split(' ');
  const photo = product.gallery && product.gallery[0];
  const body = {
    items: [{
      id: product.id,
      title: fullName(product),
      description: `${fullName(product)} · ${tienda()}`,
      category_id: product.cuotas ? 'phones' : 'electronics',
      quantity: 1,
      currency_id: 'ARS',
      unit_price: order.productAmount ?? order.amount,
      ...(photo && HTTPS ? { picture_url: sitio.absoluta(photo) } : {}),
    },
    // El envío va como un ítem aparte, así se ve claro en el resumen de Mercado Pago
    ...(order.envio && order.envio.costo ? [{
      id: `envio-${order.envio.tipo}`, title: order.envio.nombre, description: `Envío del pedido ${order.ref}`,
      category_id: 'services', quantity: 1, currency_id: 'ARS', unit_price: order.envio.costo,
    }] : [])],
    payer: {
      name: first,
      surname: rest.join(' '),
      email: order.buyer.email,
      phone: { number: order.buyer.phone },
      ...(order.buyer.dni ? { identification: { type: 'DNI', number: order.buyer.dni } } : {}),
    },
    external_reference: order.id,
    back_urls: { success: volver(order, 'ok'), failure: volver(order, 'error'), pending: volver(order, 'pendiente') },
    // Mercado Pago es el medio principal: hasta 12 cuotas para todo (el interés depende de la cuenta de MP)
    payment_methods: { installments: 12 },
    statement_descriptor: tienda().toUpperCase().slice(0, 22),
    metadata: { pedido: order.ref },
  };
  // Mercado Pago solo acepta volver solo y avisar pagos a direcciones públicas con https
  if (HTTPS) {
    body.auto_return = 'approved';
    body.notification_url = `${BASE_URL}/api/webhooks/mercadopago`;
  }
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': order.id },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorPasarela('Mercado Pago', res.status, data.message || data.error);
  const url = MP_TOKEN.startsWith('TEST-') && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;
  if (!url) throw new ErrorPasarela('Mercado Pago', res.status, 'no devolvió la dirección de pago');
  return { url, gateway: { preferenceId: data.id } };
}

async function mpConsultar(paymentId) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` },
  });
  if (!res.ok) throw new ErrorPasarela('Mercado Pago', res.status, 'no se pudo consultar el pago');
  return res.json();
}

async function mpSincronizar(order, paymentId) {
  const pay = await mpConsultar(paymentId);
  if (pay.external_reference !== order.id) return order; // el pago es de otro pedido
  const amountOk = Math.abs(Number(pay.transaction_amount) - order.amount) < 1;
  const status = pay.status === 'approved' ? (amountOk ? 'approved' : 'review')
    : ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(pay.status) ? 'rejected' : 'pending';
  return actualizar(order.id, {
    status,
    gateway: { ...order.gateway, paymentId: String(pay.id), gatewayStatus: pay.status, installments: pay.installments || null },
  });
}

/* ---------- GO cuotas (API Redirect V1) ---------- */
let gcToken = null;
let gcTokenAt = 0;

async function gcIngresar(force = false) {
  if (gcToken && !force && Date.now() - gcTokenAt < 45 * 60e3) return gcToken;
  const url = `${GC.base}/api_redirect/v1/authentication?email=${encodeURIComponent(GC.email)}&password=${encodeURIComponent(GC.password)}`;
  const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  const token = data.token || data.access_token || data.auth_token || (data.data && data.data.token);
  if (!res.ok || !token) {
    throw new ErrorPasarela('GO cuotas', res.status, data.message || data.error || 'no se pudo iniciar sesión: revisá el email y la contraseña del usuario de sucursal');
  }
  gcToken = token;
  gcTokenAt = Date.now();
  return token;
}

async function gcPedir(pathname, options = {}, retry = true) {
  const token = await gcIngresar();
  const res = await fetch(`${GC.base}/api_redirect/v1${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (res.status === 401 && retry) {
    gcToken = null;
    return gcPedir(pathname, options, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorPasarela('GO cuotas', res.status, data.message || data.error);
  return data;
}

async function gcCrear(order) {
  const data = await gcPedir('/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      amount_in_cents: Math.round(order.amount * 100),
      order_reference_id: order.id,
      url_success: volver(order, 'ok'),
      url_failure: volver(order, 'error'),
      webhook_url: `${BASE_URL}/api/webhooks/gocuotas`,
      email: order.buyer.email,
      phone_number: order.buyer.phone,
    }),
  });
  const checkout = data.checkout || data;
  if (!checkout.url_init) throw new ErrorPasarela('GO cuotas', 502, 'no devolvió la dirección de pago (url_init)');
  return { url: checkout.url_init, gateway: { checkoutId: checkout.id || null } };
}

// El aviso de GO cuotas se confirma consultando la orden en su API antes de darla por paga.
async function gcSincronizar(order, gcOrderId) {
  const data = await gcPedir(`/orders/${encodeURIComponent(gcOrderId)}`);
  const o = data.order || data;
  const ref = o.order_reference_id || o.reference_id || o.reference;
  if (ref && ref !== order.id) return order;
  const cents = Number(o.amount_in_cents);
  const amountOk = !cents || Math.abs(cents - order.amount * 100) < 100;
  const s = String(o.status || '').toLowerCase();
  const status = s === 'approved' ? (amountOk ? 'approved' : 'review')
    : ['denied', 'rejected', 'cancelled', 'canceled', 'refunded'].includes(s) ? 'rejected' : 'pending';
  return actualizar(order.id, {
    status,
    gateway: { ...order.gateway, gcOrderId: String(gcOrderId), gatewayStatus: s, installments: o.number_of_installments || null },
  });
}

/* ---------- Pago simulado (modo demo, solo para los medios que todavía no tienen clave) ---------- */
const demoCrear = order => ({ url: `${BASE_URL}/api/demo/pagar?pedido=${order.id}`, gateway: { demo: true } });

function demoPagina(order) {
  const method = METHODS[order.method].name;
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Pago de prueba · ${esc(method)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f4f5;color:#111;font:16px/1.5 system-ui,sans-serif}
  main{width:min(420px,100%);padding:28px;border-radius:18px;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,.12)}
  .tag{display:inline-block;padding:4px 10px;border-radius:999px;background:#fff3c4;color:#7a5b00;font-size:12px;font-weight:700}
  h1{margin:12px 0 4px;font-size:22px} p{margin:0;color:#555} .amount{margin:18px 0;font-size:30px;font-weight:800;color:#111}
  a{display:block;margin-top:10px;padding:14px;border-radius:999px;text-align:center;font-weight:700;text-decoration:none}
  .ok{background:#111;color:#fff} .no{border:1.5px solid #ddd;color:#111}
</style></head><body><main>
  <span class="tag">MODO DEMO · no se cobra nada</span>
  <h1>Pagar con ${esc(method)}</h1>
  <p>${esc(order.product.name)} · pedido #${esc(order.ref)}</p>
  <p class="amount">${money(order.amount)}</p>
  <p>Esta pantalla reemplaza a ${esc(method)} mientras no esté cargada su clave.</p>
  <a class="ok" href="/api/demo/resultado?pedido=${order.id}&r=ok">Simular pago aprobado</a>
  <a class="no" href="/api/demo/resultado?pedido=${order.id}&r=error">Simular pago rechazado</a>
</main></body></html>`;
}

/* ---------- Rutas (/api/checkout, /api/pedidos/…, webhooks y pago simulado) ---------- */
async function crear(body) {
  const method = body.method;
  if (!METHODS[method]) return [400, { error: 'Elegí cómo querés pagar.' }];
  const state = estadoMedio(method);
  if (!state.enabled) return [503, { error: `El pago con ${METHODS[method].name} todavía no está configurado en el servidor.` }];
  if (!sitio.VARIANTS.includes(body.version)) return [400, { error: 'Versión de la tienda desconocida.' }];

  const site = sitio.cargar();
  const product = [...(site.store.phones ? site.products : []), ...site.extras].find(p => !p.hidden && p.id === body.productId);
  if (!product) return [404, { error: 'Ese producto ya no está en el catálogo.' }];
  const check = validar(body);
  if (check.error) return [400, { error: check.error }];
  // El envío lo cotiza el servidor con la tabla de /admin → Envíos
  const d = check.delivery;
  const env = envios.precio(product, { tipo: d.type, provincia: d.province, cp: d.cp, sucursal: d.branch });
  if (env.error) return [400, { error: env.error }];
  // Cupón del descuento flash: se anota en el pedido. El precio cobrado es el de la página.
  const coupon = flash.cuponValido(body.coupon, site.flash) ? flash.cupon() : '';

  const id = crypto.randomBytes(5).toString('hex');
  const productAmount = priceOf(product);
  const order = {
    id,
    ref: id.slice(0, 6).toUpperCase(),
    createdAt: new Date().toISOString(),
    version: body.version,
    method,
    product: { id: product.id, name: fullName(product) },
    plan: [1, 3, 6, 9, 12].includes(Number(body.plan)) ? Number(body.plan) : 12,
    productAmount,
    amount: productAmount + env.envio.costo,
    envio: env.envio,
    ...(coupon ? { coupon } : {}),
    buyer: check.buyer,
    delivery: d,
    status: 'created',
    gateway: {},
  };
  guardarPedidos([...leerPedidos(), order]);

  try {
    const result = state.demo ? demoCrear(order) : method === 'mercadopago' ? await mpCrear(order, product) : await gcCrear(order);
    actualizar(id, { status: 'pending', gateway: result.gateway });
    return [200, { url: result.url, pedido: id }];
  } catch (err) {
    actualizar(id, { status: 'error', error: err.message });
    console.error(`[pedido ${order.ref}]`, err.message);
    return [err.status || 500, { error: `No pudimos conectar con ${METHODS[method].name}. Probá de nuevo en un rato o escribinos por WhatsApp.` }];
  }
}

async function estado(id, paymentId) {
  let order = buscar(id);
  if (!order) return [404, { error: 'Pedido no encontrado' }];
  // Al volver de Mercado Pago llega el número de pago: se verifica en el momento
  if (paymentId && order.method === 'mercadopago' && MP_TOKEN && order.status !== 'approved') {
    try { order = await mpSincronizar(order, paymentId); } catch (err) { console.error(err.message); }
  }
  return [200, pedidoPublico(order)];
}

// Último aviso (webhook) de cada pasarela desde que arrancó la tienda: sirve para ver que llegan
const ultimoAviso = {};

// x-signature: "ts=…,v1=…". Se firma "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con la clave secreta del webhook.
function firmaMercadoPago(headers, url, body) {
  // Sin clave secreta, o un aviso que no trae firma (los de notification_url pueden no traerla): se acepta igual,
  // porque el pago siempre se confirma consultándolo en la API de Mercado Pago
  if (!MP_WEBHOOK_SECRET || !headers['x-signature']) return true;
  const partes = Object.fromEntries(String(headers['x-signature'] || '').split(',').map(p => p.trim().split('=')));
  const id = String(url.searchParams.get('data.id') || (body.data && body.data.id) || '');
  if (!partes.ts || !partes.v1) return false;
  const manifiesto = `${id ? `id:${/^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id};` : ''}${headers['x-request-id'] ? `request-id:${headers['x-request-id']};` : ''}ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifiesto).digest('hex');
  return esperado.length === partes.v1.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1));
}

async function avisoMercadoPago(body, url, headers = {}) {
  ultimoAviso.mercadopago = new Date().toISOString();
  if (!firmaMercadoPago(headers, url, body)) return console.error('[webhook Mercado Pago] aviso con firma inválida: se ignora');
  const type = body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic');
  const paymentId = (body.data && body.data.id) || url.searchParams.get('data.id') || (type === 'payment' && url.searchParams.get('id'));
  if (type !== 'payment' || !paymentId || !MP_TOKEN) return;
  try {
    const pay = await mpConsultar(paymentId);
    const order = pay.external_reference && buscar(pay.external_reference);
    if (order) await mpSincronizar(order, paymentId);
  } catch (err) {
    console.error('[webhook Mercado Pago]', err.message);
  }
}

async function avisoGoCuotas(body) {
  ultimoAviso.gocuotas = new Date().toISOString();
  const order = body.order_reference_id && buscar(String(body.order_reference_id));
  if (!order || order.method !== 'gocuotas') return;
  if (!body.order_id) return void actualizar(order.id, { status: 'review' });
  try {
    await gcSincronizar(order, body.order_id);
  } catch (err) {
    // Si no se pudo confirmar con GO cuotas, queda marcado para revisar a mano en su panel
    actualizar(order.id, { status: 'review', gateway: { ...order.gateway, gcOrderId: String(body.order_id) } });
    console.error('[webhook GO cuotas]', err.message);
  }
}

// Pago simulado: devuelve [status, html] o [303, url]
function demo(id, paso, resultado) {
  const order = buscar(id || '');
  if (!order || !(order.gateway && order.gateway.demo)) return [404, '<h1>Pedido de prueba no encontrado</h1>'];
  if (paso === 'pagar') return [200, demoPagina(order)];
  const ok = resultado === 'ok';
  actualizar(order.id, { status: ok ? 'approved' : 'rejected' });
  return [303, volver(order, ok ? 'ok' : 'error')];
}

function lineaArranque(key) {
  const s = estadoMedio(key);
  const extra = key === 'gocuotas' && GC.base.includes('sandbox') && METHODS.gocuotas.live() ? ' · sandbox'
    : key === 'mercadopago' && MP_TOKEN.startsWith('TEST-') ? ' · credenciales de prueba' : '';
  return `${METHODS[key].name.padEnd(13)} ${s.demo ? 'pago simulado (falta la clave)' : s.enabled ? 'activo' : 'apagado (falta la clave)'}${extra}`;
}

/* ---------- Estado para el panel ---------- */
// modo: real (cobra), prueba (credenciales o sandbox de prueba), demo (pago simulado) o apagado
function modoDe(key) {
  const s = estadoMedio(key);
  if (s.demo) return 'demo';
  if (!s.enabled) return 'apagado';
  if (key === 'gocuotas') return GC.base.includes('sandbox') ? 'prueba' : 'real';
  if (MP_TOKEN.startsWith('TEST-')) return 'prueba';
  return probado.mercadopago ? (probado.mercadopago.prueba ? 'prueba' : 'real') : 'sin-probar';
}
const probado = {};
const estadoAdmin = () => Object.fromEntries(Object.keys(METHODS).map(k => [k, {
  name: METHODS[k].name, modo: modoDe(k), ultimoAviso: ultimoAviso[k] || null,
  cuenta: k === 'mercadopago' && probado.mercadopago ? probado.mercadopago.cuenta : k === 'gocuotas' && METHODS.gocuotas.live() ? GC.email : null,
  webhook: `${BASE_URL}/api/webhooks/${k}`,
}]));

// Link de pago de prueba (panel → Pedidos): crea un pedido real por un monto chico con Mercado Pago.
// Al pagarlo se prueba todo: la página de pago, el aviso (webhook), el pedido aprobado y los correos.
async function linkPrueba({ monto, email }) {
  if (!MP_TOKEN) return [400, { error: 'Primero cargá el Access Token de Mercado Pago con xoxo-claves (opción 1).' }];
  const amount = Math.round(Number(monto));
  if (!(amount >= 10 && amount <= 100000)) return [400, { error: 'Poné un monto entre $10 y $100.000.' }];
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return [400, { error: 'Escribí tu email: ahí llega el mail de la compra.' }];
  const id = crypto.randomBytes(5).toString('hex');
  const product = { id: 'prueba-de-pago', name: 'Prueba de pago', gallery: [] };
  const order = {
    id, ref: id.slice(0, 6).toUpperCase(), createdAt: new Date().toISOString(), version: 'profesional', method: 'mercadopago',
    product: { id: product.id, name: product.name }, plan: 1, productAmount: amount, amount, prueba: true,
    envio: { tipo: 'retiro', nombre: 'Retiro en sucursal (prueba)', costo: 0 },
    buyer: { name: 'Prueba del panel', email: mail, phone: '00000000', dni: '' }, delivery: { type: 'retiro' },
    status: 'created', gateway: {},
  };
  guardarPedidos([...leerPedidos(), order]);
  try {
    const r = await mpCrear(order, product);
    actualizar(id, { status: 'pending', gateway: r.gateway });
    return [200, { url: r.url, pedido: order.ref }];
  } catch (err) {
    actualizar(id, { status: 'error', error: err.message });
    return [502, { error: err.message }];
  }
}

// "Probar conexión" del panel: inicia sesión en cada pasarela con su clave, sin crear ningún pago
async function probar() {
  const out = {};
  if (MP_TOKEN) {
    try {
      const res = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${MP_TOKEN}` }, signal: AbortSignal.timeout(15000) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 401 ? 'la clave no es válida' : `respondió con un error (${res.status})`);
      probado.mercadopago = {
        cuenta: d.nickname || String(d.id || ''),
        prueba: MP_TOKEN.startsWith('TEST-') || (Array.isArray(d.tags) && d.tags.includes('test_user')) || /^TEST/i.test(d.nickname || ''),
      };
      out.mercadopago = { ok: true };
    } catch (err) { out.mercadopago = { ok: false, error: err.message }; }
  }
  if (METHODS.gocuotas.live()) {
    try {
      await gcIngresar(true);
      out.gocuotas = { ok: true };
    } catch (err) { out.gocuotas = { ok: false, error: err.message }; }
  }
  return { probado: out, pasarelas: estadoAdmin() };
}

module.exports = {
  estadoAdmin, probar, linkPrueba,
  METHODS, activo, configPublica, leerPedidos, crear, estado, avisoMercadoPago, avisoGoCuotas, demo, lineaArranque,
};
