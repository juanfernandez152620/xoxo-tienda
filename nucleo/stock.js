'use strict';
/* Stock de los productos (24/11/2026): un número total por producto, sin separar por sucursal.
 *
 * En datos/stock.json se guarda, por producto, cuántas había para vender cuando se cargaron en /admin → Stock
 * ("cantidad") y desde cuándo ("desde"). Lo vendido no se resta a mano: sale de los pedidos.
 *  - Vendidas: los pedidos pagados después de "desde", menos los cancelados en el panel.
 *  - Reservadas: los pedidos que alguien está pagando ahora (creados hace menos de RESERVA_MIN minutos y sin pagar).
 * Así un pago que avisa dos veces no descuenta dos veces, y al cancelar un pedido la unidad vuelve sola.
 * Un producto sin cantidad cargada no lleva control: se vende como siempre.
 * Cada carga del panel queda anotada en datos/stock-movimientos.jsonl.
 */

const fs = require('fs');
const { ruta, escribir, leerJson, aJson, Problema } = require('./archivos');

const ARCHIVO = ruta('stock.json');
const MOVIMIENTOS = ruta('stock-movimientos.jsonl');
const RESERVA_MIN = 30;
const AVISO = 3;
const MAX = 100000;

function leer() {
  const d = leerJson(ARCHIVO) || {};
  const productos = {};
  for (const [id, s] of Object.entries(d.productos && typeof d.productos === 'object' ? d.productos : {})) {
    if (s && Number.isInteger(s.cantidad) && s.cantidad >= 0 && !Number.isNaN(Date.parse(s.desde))) productos[id] = { cantidad: s.cantidad, desde: s.desde };
  }
  return { aviso: Number.isInteger(d.aviso) && d.aviso >= 0 && d.aviso <= 100 ? d.aviso : AVISO, productos };
}
const guardar = d => escribir(ARCHIVO, aJson({ aviso: d.aviso, productos: d.productos }, true));

// Los productos de un pedido: el carrito (items) o, en los pedidos de antes, uno solo
const itemsDe = o => (Array.isArray(o.items) && o.items.length ? o.items : o.product ? [{ id: o.product.id, name: o.product.name, n: 1 }] : []);
const cancelado = o => Boolean(o.seguimiento && o.seguimiento.estado === 'cancelado');
const pagado = o => ['approved', 'review'].includes(o.status);
const cuandoSePago = o => Date.parse(o.paidAt || o.updatedAt || o.createdAt);
// intentoAt: cuando vuelve a pagar un pedido viejo desde el seguimiento (nucleo/pagos.js → pagarDeNuevo)
const pagando = (o, ahora) => ['created', 'pending'].includes(o.status) && ahora - Date.parse(o.intentoAt || o.createdAt) < RESERVA_MIN * 60000;

// Cómo está cada producto con control: { id: { cantidad, desde, vendidas, reservadas, quedan } }
// quedan puede dar negativo si un pago llegó después de que se venció su reserva (se vendió de más)
function calcular(pedidos) {
  const { productos } = leer();
  const ahora = Date.now();
  const out = {};
  for (const [id, s] of Object.entries(productos)) out[id] = { ...s, vendidas: 0, reservadas: 0, quedan: 0 };
  for (const o of pedidos || []) {
    const vendido = pagado(o) && !cancelado(o);
    const reserva = !vendido && !cancelado(o) && pagando(o, ahora);
    if (!vendido && !reserva) continue;
    for (const it of itemsDe(o)) {
      const s = out[it.id];
      if (!s) continue;
      const n = Math.max(1, Math.floor(Number(it.n) || 1));
      if (reserva) s.reservadas += n;
      else if (cuandoSePago(o) >= Date.parse(s.desde)) s.vendidas += n;
    }
  }
  for (const s of Object.values(out)) s.quedan = s.cantidad - s.vendidas - s.reservadas;
  return out;
}

// La última unidad está reservada: alguien la está pagando y todavía no terminó
const soloReservado = s => s.quedan <= 0 && s.reservadas > 0 && s.cantidad - s.vendidas > 0;

// Para las páginas (window.STOCK): solo los productos con pocas unidades o sin stock.
// { id: { quedan: 2 } | { reservado: true } | { agotado: true } }
function publico(pedidos) {
  const { aviso } = leer();
  const out = {};
  for (const [id, s] of Object.entries(calcular(pedidos))) {
    if (s.quedan > aviso) continue;
    out[id] = s.quedan > 0 ? { quedan: s.quedan } : soloReservado(s) ? { reservado: true } : { agotado: true };
  }
  return out;
}

// Antes de crear un pedido: que alcance lo que queda. lineas: [{ id, n, nombre }]. Devuelve el error o null.
function alcanza(lineas, pedidos) {
  const st = calcular(pedidos);
  for (const l of lineas) {
    const s = st[l.id];
    if (!s || l.n <= s.quedan) continue;
    if (s.quedan > 0) return `De ${l.nombre} ${s.quedan === 1 ? 'queda 1' : `quedan ${s.quedan}`}. Cambiá la cantidad en el carrito y probá de nuevo.`;
    if (soloReservado(s)) return `Alguien está pagando la última unidad de ${l.nombre}. Si no completa el pago, se libera en unos minutos.`;
    return `${l.nombre} se quedó sin stock. Sacalo del carrito o consultanos por WhatsApp.`;
  }
  return null;
}

/* ---------- Panel (/admin → Stock) ---------- */
function anotar(mov) {
  try { fs.appendFileSync(MOVIMIENTOS, `${JSON.stringify(mov)}\n`); } catch (err) { console.error('[stock] No se pudo anotar el movimiento:', err.message); }
}
function leerMovimientos() {
  try {
    return fs.readFileSync(MOVIMIENTOS, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// Carga lo que hay para vender ahora de un producto. cantidad: número, o null = sin control de stock.
function cargar({ id, cantidad, nombre }, pedidos) {
  const d = leer();
  const antes = calcular(pedidos)[id] || null;
  const sinControl = cantidad === null || cantidad === '' || cantidad === undefined;
  const n = Number(cantidad);
  if (!sinControl && (!Number.isInteger(n) || n < 0 || n > MAX)) throw new Problema('Escribí cuántas hay: un número entero, 0 o más.');
  if (sinControl) {
    if (!d.productos[id]) return { ok: true };
    delete d.productos[id];
  } else d.productos[id] = { cantidad: n, desde: new Date().toISOString() };
  guardar(d);
  anotar({ at: new Date().toISOString(), id, nombre: String(nombre || id).slice(0, 80), antes: antes ? antes.quedan : null, cantidad: sinControl ? null : n });
  return { ok: true };
}

function configurar({ aviso }) {
  const n = Number(aviso);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new Problema('El aviso de "quedan pocas" va de 0 a 100.');
  const d = leer();
  d.aviso = n;
  guardar(d);
  return { ok: true };
}

// Todo lo del panel: cada producto del catálogo con su stock y los últimos movimientos (cargas y ventas)
function admin(catalogo, pedidos) {
  const d = leer();
  const st = calcular(pedidos);
  const productos = catalogo.map(p => {
    const s = st[p.id];
    return {
      id: p.id, nombre: p.name, foto: (p.gallery || [])[0] || '', oculto: Boolean(p.hidden),
      control: Boolean(s), ...(s ? { cantidad: s.cantidad, desde: s.desde, vendidas: s.vendidas, reservadas: s.reservadas, quedan: s.quedan } : {}),
    };
  });
  const ventas = [];
  for (const o of pedidos || []) {
    if (!pagado(o)) continue;
    for (const it of itemsDe(o)) {
      const s = st[it.id];
      if (!s || cuandoSePago(o) < Date.parse(s.desde)) continue;
      ventas.push({ at: new Date(cuandoSePago(o)).toISOString(), tipo: 'venta', id: it.id, nombre: it.name || it.id, n: Math.max(1, Number(it.n) || 1), ref: o.ref, cancelado: cancelado(o) });
    }
  }
  const cargas = leerMovimientos().map(m => ({ ...m, tipo: 'carga' }));
  const movimientos = [...ventas, ...cargas].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 80);
  return { aviso: d.aviso, reservaMin: RESERVA_MIN, productos, movimientos };
}

module.exports = { calcular, publico, alcanza, cargar, configurar, admin, RESERVA_MIN };
