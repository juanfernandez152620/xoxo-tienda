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
const calcEnvios = require('../publico/shared/envios');
const { diaLocal } = require('./archivos');

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
  // Cuándo se pagó (para la historia del pedido en el panel y en el seguimiento)
  if (patch.status === 'approved' && antes !== 'approved' && !order.paidAt) order.paidAt = new Date().toISOString();
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
async function mpCrear(order, lines) {
  const [first, ...rest] = order.buyer.name.split(' ');
  const foto = p => (p.gallery && p.gallery[0] && HTTPS ? { picture_url: sitio.absoluta(p.gallery[0]) } : {});
  // Con un código de descuento va un solo renglón con el total (Mercado Pago no acepta precios negativos)
  const renglones = order.discount
    ? [{
      id: `pedido-${order.ref}`, title: `Pedido ${order.ref}: ${order.product.name}`,
      description: `Con el código ${order.discount.code} (${order.discount.percent}% off) · ${tienda()}`,
      category_id: 'electronics', quantity: 1, currency_id: 'ARS', unit_price: order.productAmount, ...foto(lines[0].p),
    }]
    : lines.map(l => ({
      id: l.p.id, title: fullName(l.p), description: `${fullName(l.p)} · ${tienda()}`,
      category_id: l.p.cuotas ? 'phones' : 'electronics', quantity: l.n, currency_id: 'ARS', unit_price: priceOf(l.p), ...foto(l.p),
    }));
  const body = {
    items: [...renglones,
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
    // Hasta las cuotas que permiten todos los productos del pedido en /admin. El interés depende de la cuenta de MP
    payment_methods: { installments: order.credito || 12 },
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

/* ---------- Seguimiento de la entrega (/admin → Pedidos) ---------- */
// Después de pagado: Preparando → Despachado (con empresa y número) o Listo para retirar → Entregado.
// Cancelado, con el motivo, en cualquier momento. Cada paso queda en la historia con fecha y hora.
const PASOS = { preparando: 'Preparando', despachado: 'Despachado', listo: 'Listo para retirar', entregado: 'Entregado', cancelado: 'Cancelado' };
const EMPRESAS = { andreani: 'Andreani', correo: 'Correo Argentino', otra: 'Otra' };
const corto = (v, max) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);
function seguir(id, body = {}) {
  const o = buscar(String(id || ''));
  if (!o) return [404, { error: 'No encontré ese pedido.' }];
  const seg = o.seguimiento || { estado: '', historial: [] };
  const historial = seg.historial || [];
  let nuevo;
  if (body.paso === 'deshacer') {
    if (!historial.length) return [400, { error: 'No hay pasos para deshacer.' }];
    const quedan = historial.slice(0, -1);
    const ultimo = quedan[quedan.length - 1];
    const envio = [...quedan].reverse().find(h => h.paso === 'despachado');
    nuevo = { estado: ultimo ? ultimo.paso : '', historial: quedan, ...(envio ? { empresa: envio.empresa, numero: envio.numero } : {}) };
  } else {
    const paso = String(body.paso || '');
    if (!PASOS[paso]) return [400, { error: 'Paso desconocido.' }];
    if (paso !== 'cancelado' && o.status !== 'approved') return [400, { error: 'Ese pedido todavía no está pagado.' }];
    if (seg.estado === 'cancelado') return [400, { error: 'El pedido está cancelado. Deshacé la cancelación primero.' }];
    const retiro = !o.envio || o.envio.tipo === 'retiro';
    if (paso === 'listo' && !retiro) return [400, { error: 'Este pedido va por envío: marcalo como Despachado.' }];
    if (paso === 'despachado' && retiro) return [400, { error: 'Este pedido se retira en la sucursal: marcalo como Listo para retirar.' }];
    const h = { paso, at: new Date().toISOString() };
    if (paso === 'despachado') {
      h.empresa = EMPRESAS[body.empresa] ? body.empresa : (o.envio && o.envio.empresa) || 'otra';
      h.numero = corto(body.numero, 40);
      if (h.numero.length < 4) return [400, { error: 'Escribí el número de seguimiento del envío.' }];
    }
    if (paso === 'cancelado') {
      h.motivo = corto(body.motivo, 200);
      if (h.motivo.length < 3) return [400, { error: 'Escribí el motivo de la cancelación.' }];
    }
    nuevo = { estado: paso, historial: [...historial, h], ...(paso === 'despachado' ? { empresa: h.empresa, numero: h.numero } : seg.numero ? { empresa: seg.empresa, numero: seg.numero } : {}) };
  }
  const order = actualizar(o.id, { seguimiento: nuevo });
  console.log(`[pedido ${order.ref}] seguimiento: ${nuevo.estado || 'sin pasos'}`);
  // Mail al cliente: cuando se despacha y cuando queda listo para retirar (una vez por paso)
  if (['despachado', 'listo'].includes(nuevo.estado) && body.paso !== 'deshacer' && !(order.emails && order.emails[nuevo.estado])) {
    actualizar(o.id, { emails: { ...(order.emails || {}), [nuevo.estado]: new Date().toISOString() } });
    correo.avisoEntrega(order, nuevo.estado);
  }
  return [200, { ok: true, seguimiento: nuevo }];
}
// La nota interna de un pedido (solo la ven en el panel)
function anotar(id, nota) {
  const o = actualizar(String(id || ''), { nota: corto(nota, 500) });
  return o ? [200, { ok: true }] : [404, { error: 'No encontré ese pedido.' }];
}

/* ---------- Consulta pública del pedido (/seguimiento) ---------- */
// Se pide el código y el email de la compra: con solo el código nadie ve un pedido ajeno
function porRefYEmail(ref, email) {
  const r = String(ref || '').trim().replace(/^#/, '').toUpperCase();
  const e = String(email || '').trim().toLowerCase();
  if (!/^[A-F0-9]{6}$/.test(r) || !e) return null;
  return leerPedidos().find(o => o.ref === r && String(o.buyer.email).toLowerCase() === e) || null;
}
function seguimientoPublico(o) {
  const site = sitio.cargar();
  const seg = o.seguimiento || {};
  const retiro = !o.envio || o.envio.tipo === 'retiro';
  const suc = retiro ? site.store.branches.find(b => b.id === (o.envio && o.envio.sucursal)) || null : null;
  const d = o.delivery || {};
  return {
    ref: o.ref,
    nombre: String(o.buyer.name || '').split(' ')[0],
    fecha: o.createdAt,
    pagadoEl: o.status === 'approved' ? o.paidAt || o.createdAt : null,
    pago: o.status,
    items: (o.items || [{ name: o.product.name, n: 1, price: o.productAmount ?? o.amount }]).map(x => ({ name: x.name, n: x.n, price: x.price })),
    descuento: o.discount ? { code: o.discount.code, percent: o.discount.percent, amount: o.discount.amount } : null,
    envio: o.envio ? { nombre: o.envio.nombre, costo: o.envio.costo, tipo: o.envio.tipo, dias: o.envio.dias || null } : null,
    total: o.amount,
    medio: METHODS[o.method] ? METHODS[o.method].name : o.method,
    cuotas: o.method === 'gocuotas' ? o.plan : (o.gateway && o.gateway.installments) || null,
    sucursal: suc ? { name: suc.name, address: suc.address, hours: suc.hours || '' } : null,
    direccion: retiro ? '' : [d.address, d.city, o.envio.provincia, d.cp && `CP ${d.cp}`].filter(Boolean).join(', '),
    seguimiento: { estado: seg.estado || '', historial: (seg.historial || []).map(h => ({ paso: h.paso, at: h.at, empresa: h.empresa, numero: h.numero, motivo: h.motivo })), empresa: seg.empresa || '', numero: seg.numero || '' },
    demo: Boolean(o.gateway && o.gateway.demo),
  };
}
function consultarSeguimiento(q) {
  const o = porRefYEmail(q.pedido, q.email);
  if (!o) return [404, { error: 'No encontramos una compra con ese código y ese email. Revisá los dos (el código está en el mail de la compra).' }];
  return [200, seguimientoPublico(o)];
}

/* ---------- Códigos de descuento propios (/admin → Tienda y textos) ---------- */
// Vale si está activo, no venció y no se usó en más pedidos pagados que los permitidos
function codigoValido(texto, site = sitio.cargar()) {
  const code = String(texto || '').trim().toLowerCase();
  if (!code) return null;
  const c = (site.codes || []).find(x => x.code === code);
  // Un código que no existe (o el del flash, o uno de otro mes) no frena la compra: se ignora, como antes
  if (!c) return null;
  if (!c.on) return { error: 'Ese código ya no está activo.' };
  if (c.until && c.until < diaLocal()) return { error: 'Ese código ya venció.' };
  if (c.max && leerPedidos().filter(o => o.status === 'approved' && o.discount && o.discount.code === code).length >= c.max) {
    return { error: 'Ese código ya se usó todas las veces que se podía.' };
  }
  return { code, percent: c.percent };
}
// Para el carrito: /api/codigo { code } → { code, percent } (el pedido lo vuelve a revisar al crearse)
function consultarCodigo(body) {
  const r = codigoValido(body && body.code);
  if (!r) return [404, { error: 'Ese código no existe. Revisá cómo lo escribiste.' }];
  if (r.error) return [400, { error: r.error }];
  return [200, r];
}

/* ---------- Rutas (/api/checkout, /api/pedidos/…, webhooks y pago simulado) ---------- */
async function crear(body, extra = {}) {
  const method = body.method;
  if (!METHODS[method]) return [400, { error: 'Elegí cómo querés pagar.' }];
  const state = estadoMedio(method);
  if (!state.enabled) return [503, { error: `El pago con ${METHODS[method].name} todavía no está configurado en el servidor.` }];
  if (!sitio.VARIANTS.includes(body.version)) return [400, { error: 'Versión de la tienda desconocida.' }];

  const site = sitio.cargar();
  // Los productos: el carrito (items: [{id, n}]) o, como antes, uno solo (productId)
  const pedido = Array.isArray(body.items) && body.items.length ? body.items : [{ id: body.productId, n: 1 }];
  if (pedido.length > 20) return [400, { error: 'El carrito tiene demasiados productos.' }];
  const catalogo = [...(site.store.phones ? site.products : []), ...site.extras].filter(p => !p.hidden);
  const lines = [];
  for (const it of pedido) {
    const p = catalogo.find(x => x.id === String((it && it.id) || ''));
    if (!p) return [404, { error: 'Uno de los productos ya no está en el catálogo. Sacalo del carrito y probá de nuevo.' }];
    const n = Math.min(10, Math.max(1, Math.floor(Number(it.n) || 1)));
    const ya = lines.find(l => l.p === p);
    if (ya) ya.n = Math.min(10, ya.n + n); else lines.push({ p, n });
  }
  // Cuotas: Mercado Pago, hasta las que permitan todos; GO cuotas, solo si todos aceptan débito
  if (method === 'gocuotas' && lines.some(l => l.p.debito === false)) {
    const no = lines.find(l => l.p.debito === false).p;
    return [400, { error: `${fullName(no)} no se puede pagar con débito en GO cuotas. Elegí Mercado Pago o sacalo del carrito.` }];
  }
  const credito = Math.min(...lines.map(l => (l.p.cuotas ? 12 : Number(l.p.credito) || 12)));
  const check = validar(body);
  if (check.error) return [400, { error: check.error }];
  const subtotal = lines.reduce((s, l) => s + priceOf(l.p) * l.n, 0);
  // El envío lo cotiza el servidor con la tabla de /admin → Envíos: un envío por pedido, con el peso de todo
  const d = check.delivery;
  const paquete = { weight: lines.reduce((s, l) => s + calcEnvios.peso(l.p) * l.n, 0), price: subtotal, cat: lines[0].p.cat };
  const env = envios.precio(paquete, { tipo: d.type, provincia: d.province, cp: d.cp, sucursal: d.branch });
  if (env.error) return [400, { error: env.error }];
  // Un solo código por pedido: uno propio (baja el precio) o, si no, el del descuento flash (se anota; el precio
  // de la página ya es el del flash)
  const propio = body.coupon ? codigoValido(body.coupon, site) : null;
  if (propio && propio.error) return [400, { error: propio.error }];
  const discount = propio ? { code: propio.code, percent: propio.percent, amount: Math.round(subtotal * propio.percent / 100) } : null;
  const coupon = !discount && flash.cuponValido(body.coupon, site.flash) ? flash.cupon() : '';

  const id = crypto.randomBytes(5).toString('hex');
  const productAmount = subtotal - (discount ? discount.amount : 0);
  const nombres = lines.map(l => `${l.n > 1 ? `${l.n} × ` : ''}${fullName(l.p)}`);
  const order = {
    id,
    ref: id.slice(0, 6).toUpperCase(),
    createdAt: new Date().toISOString(),
    version: body.version,
    method,
    // product: el resumen (lo usan el panel y los mails de antes); items: cada producto con su cantidad y precio
    product: { id: lines[0].p.id, name: nombres.length > 2 ? `${nombres.slice(0, 2).join(', ')} y ${nombres.length - 2} más` : nombres.join(' y ') },
    items: lines.map(l => ({ id: l.p.id, name: fullName(l.p), n: l.n, price: priceOf(l.p) })),
    plan: method === 'gocuotas' ? (lines[0].p.cuotas ? 9 : Number(site.store.extras.cuotas) || 6) : 1,
    credito,
    productAmount,
    ...(discount ? { discount } : {}),
    amount: productAmount + env.envio.costo,
    envio: env.envio,
    ...(coupon ? { coupon } : {}),
    ...(extra.clienteId ? { clienteId: extra.clienteId } : {}),
    buyer: check.buyer,
    delivery: d,
    status: 'created',
    gateway: {},
  };
  guardarPedidos([...leerPedidos(), order]);

  try {
    const result = state.demo ? demoCrear(order) : method === 'mercadopago' ? await mpCrear(order, lines) : await gcCrear(order);
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
  METHODS, activo, configPublica, leerPedidos, crear, estado, avisoMercadoPago, avisoGoCuotas, demo, lineaArranque, consultarCodigo,
  PASOS, EMPRESAS, seguir, anotar, porRefYEmail, seguimientoPublico, consultarSeguimiento, buscarPedido: buscar,
};
