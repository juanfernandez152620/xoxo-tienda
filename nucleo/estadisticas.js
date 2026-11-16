'use strict';
/* Estadísticas para comparar los dos diseños.
 *
 * Cada evento (visita, vista, me gusta, WhatsApp, checkout) se anota primero en el registro del día
 * (datos/registro/AAAA-MM-DD.jsonl). Ese registro es la fuente de verdad: nunca se reescribe.
 * Los totales (datos/estadisticas.json) se calculan leyendo el registro desde donde quedaron la última vez
 * ("cursor"): se ponen al día como mucho una vez por minuto y cada vez que se abre /admin.
 * Cada BACKUP_HORAS se guarda una copia en datos/backups/estadisticas/. Si estadisticas.json se daña,
 * se arranca desde la última copia y se le suma lo que quedó en el registro: no se pierde nada.
 */

const fs = require('fs');
const path = require('path');
const { BACKUP_HORAS } = require('./entorno');
const {
  ruta, escribir, leerJson, aJson, archivosJson, cuarentena, agregarLinea, dos, diaLocal, diaRelativo, ahoraIso,
} = require('./archivos');
const sitio = require('./sitio');

const REGISTRO = ruta('registro');
const ESTADISTICAS = ruta('estadisticas.json');
const COPIAS = ruta('backups', 'estadisticas');
const { VARIANTS } = sitio;
const TIPOS = ['visita', 'vista', 'abrir', 'like', 'whatsapp', 'checkout'];
const PLACES = ['tarjeta', 'producto', 'video', 'encabezado', 'boton-flotante', 'pie', 'como-comprar', 'aviso', 'sin-resultados', 'otro'];

/* ---------- Eventos ---------- */
const limpio = (v, re, max) => (typeof v === 'string' && re.test(v) ? v.slice(0, max) : '');

// Revisa lo que manda la página: solo se anota lo que tiene sentido
function limpiarEvento(b, ua) {
  if (!b || typeof b !== 'object' || !TIPOS.includes(b.tipo) || !VARIANTS.includes(b.v)) return null;
  const vid = limpio(b.vid, /^[a-z0-9]{6,40}$/i, 40);
  const sid = limpio(b.sid, /^[a-z0-9]{6,40}$/i, 40);
  if (!vid || !sid) return null;
  let id = '';
  if (typeof b.id === 'string' && b.id) {
    const site = sitio.cargar();
    if ([...site.products, ...site.extras].some(p => p.id === b.id)) id = b.id;
  }
  if (['vista', 'abrir', 'like', 'checkout'].includes(b.tipo) && !id) return null;
  const e = { t: ahoraIso(), tipo: b.tipo, v: b.v, id, vid, sid, src: limpio(b.src, /^[\w.-]{1,40}$/, 40) || 'otro' };
  if (b.tipo === 'visita') {
    e.ref = typeof b.ref === 'string' ? b.ref.slice(0, 300) : '';
    e.ruta = typeof b.ruta === 'string' ? b.ruta.slice(0, 200) : '';
    e.pantalla = limpio(b.pantalla, /^\d{2,5}x\d{2,5}$/, 11);
    e.ua = String(ua || '').slice(0, 250);
  }
  if (b.tipo === 'vista') e.s = Math.min(3600, Math.max(0, Math.round(Number(b.s) || 0)));
  if (b.tipo === 'abrir') e.como = limpio(b.como, /^[a-z-]{1,20}$/, 20);
  if (b.tipo === 'like') e.on = b.on !== false;
  if (b.tipo === 'whatsapp') e.donde = PLACES.includes(b.donde) ? b.donde : 'otro';
  return e;
}

const anotar = e => agregarLinea(path.join(REGISTRO, `${diaLocal()}.jsonl`), `${JSON.stringify(e)}\n`);

/* ---------- Totales ---------- */
const contadores = () => ({ visits: 0, visitors: 0, views: 0, opens: 0, likes: 0, unlikes: 0, whatsapp: 0, whatsappVisitors: 0, checkouts: 0 });

function vacias() {
  return {
    version: 2, since: '', resetAt: '', lastEventAt: null, savedAt: null, events: 0,
    // Hasta dónde se leyó el registro: los días hasta 'done' están leídos enteros; de los más nuevos, la posición en cada archivo
    cursor: { done: '', pos: {} },
    backupSlot: -1,
    variants: Object.fromEntries(VARIANTS.map(v => [v, contadores()])),
    days: {}, products: {}, sources: {}, places: {},
    // Clicks en WhatsApp de cada sucursal
    branches: {},
    // Visitantes distintos: id del navegador => qué diseños vio (1 Red social, 2 Minimalista) y en cuáles escribió (4, 8)
    visitors: {},
    // Visitantes distintos de cada día (solo de los días que todavía pueden recibir eventos)
    seen: {},
  };
}

const validas = s => Boolean(s && s.version === 2 && s.cursor && typeof s.cursor.done === 'string' && s.cursor.pos
  && s.variants && VARIANTS.every(v => s.variants[v]) && s.visitors && s.days && s.seen);

const sumar = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

// Suma un evento a los totales
function aplicar(s, ev, day) {
  const v = ev.v;
  if (!s.variants[v] || typeof ev.t !== 'string') return;
  if (s.resetAt && ev.t < s.resetAt) return; // antes de "Empezar de cero"
  if (!s.since || ev.t < s.since) s.since = ev.t;
  s.events++;
  if (!s.lastEventAt || ev.t > s.lastEventAt) s.lastEventAt = ev.t;
  const bit = v === 'red-social' ? 0 : 1;
  const seen = 1 << bit;
  const wa = 4 << bit;
  const vid = String(ev.vid || '');
  const id = String(ev.id || '');

  const c = s.variants[v];
  const d = ((s.days[day] = s.days[day] || {})[v] = s.days[day][v] || { visits: 0, visitors: 0, whatsapp: 0, whatsappVisitors: 0 });
  let m = s.visitors[vid] || 0;
  const daySeen = (s.seen[day] = s.seen[day] || {});
  let dm = daySeen[vid] || 0;
  if (!(m & seen)) { c.visitors++; m |= seen; }
  if (!(dm & seen)) { d.visitors++; dm |= seen; }

  switch (ev.tipo) {
    case 'visita':
      c.visits++;
      d.visits++;
      porOrigen(s, String(ev.src || 'otro'), v, 'visits');
      break;
    case 'vista':
      c.views++;
      porProducto(s, id, v, 'views');
      break;
    case 'abrir':
      c.opens++;
      porProducto(s, id, v, 'opens');
      break;
    case 'like': {
      const k = ev.on !== false ? 'likes' : 'unlikes';
      c[k]++;
      porProducto(s, id, v, k);
      break;
    }
    case 'checkout':
      sumar(c, 'checkouts');
      porProducto(s, id, v, 'checkouts');
      break;
    case 'whatsapp': {
      c.whatsapp++;
      d.whatsapp++;
      if (!(m & wa)) { c.whatsappVisitors++; m |= wa; }
      if (!(dm & wa)) { d.whatsappVisitors++; dm |= wa; }
      porOrigen(s, String(ev.src || 'otro'), v, 'whatsapp');
      porProducto(s, id, v, 'whatsapp');
      const place = PLACES.includes(ev.donde) ? ev.donde : 'otro';
      sumar((s.places[v] = s.places[v] || {}), place);
      if (ev.suc) sumar((s.branches = s.branches || {}), String(ev.suc));
      break;
    }
    default:
  }
  s.visitors[vid] = m;
  daySeen[vid] = dm;
}

function porProducto(s, id, v, key) {
  if (!id) return;
  const p = ((s.products[id] = s.products[id] || {})[v] = s.products[id][v] || { views: 0, opens: 0, likes: 0, unlikes: 0, whatsapp: 0, checkouts: 0 });
  sumar(p, key);
}

function porOrigen(s, src, v, key) {
  if (!s.sources[src] && Object.keys(s.sources).length >= 60) src = 'otro'; // por si alguien inventa orígenes de a miles
  const o = ((s.sources[src] = s.sources[src] || {})[v] = s.sources[src][v] || { visits: 0, whatsapp: 0 });
  sumar(o, key);
}

function archivosRegistro() {
  try {
    return fs.readdirSync(REGISTRO).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  } catch {
    return [];
  }
}

// Lee el registro desde el cursor y suma lo nuevo. Devuelve cuántos eventos sumó.
// Ayer y hoy quedan "abiertos": un evento anotado justo a la medianoche en el archivo de ayer también se suma.
function ponerAlDia(s) {
  let added = 0;
  const ayer = diaRelativo(-1);
  for (const file of archivosRegistro()) {
    const day = file.slice(0, 10);
    if (day <= s.cursor.done) continue; // ya leído entero
    let pos = Number(s.cursor.pos[day] || 0);
    const full = path.join(REGISTRO, file);
    let size = 0;
    try { size = fs.statSync(full).size; } catch { break; }
    if (size > pos) {
      const buf = Buffer.alloc(size - pos);
      const fd = fs.openSync(full, 'r');
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 10) continue;
        const line = buf.toString('utf8', start, i);
        start = i + 1;
        let ev = null;
        try { ev = JSON.parse(line); } catch {} // una línea cortada se saltea
        if (ev && typeof ev === 'object') { aplicar(s, ev, day); added++; }
      }
      pos += start; // lo que quedó sin "\n" se está escribiendo: queda para la próxima
    }
    s.cursor.pos[day] = pos;
    // Los días de antes de ayer ya no reciben eventos: se cierran
    if (day < ayer) {
      s.cursor.done = day;
      delete s.cursor.pos[day];
      delete s.seen[day];
    }
  }
  for (const day of Object.keys(s.seen)) if (day < ayer) delete s.seen[day];
  return added;
}

// Carga los totales. Si el archivo está dañado: última copia buena + lo que quedó en el registro.
function cargar() {
  const s = leerJson(ESTADISTICAS);
  if (validas(s)) return { s, from: 'estadisticas.json' };
  if (!fs.existsSync(ESTADISTICAS) && !archivosJson(COPIAS).length) return { s: vacias(), from: 'nuevo' };
  if (fs.existsSync(ESTADISTICAS)) console.error(`[estadísticas] estadisticas.json está dañado. Se guardó como ${cuarentena(ESTADISTICAS)}`);
  for (const nombre of archivosJson(COPIAS)) {
    const b = leerJson(path.join(COPIAS, nombre));
    if (validas(b)) return { s: b, from: `la copia ${nombre}` };
  }
  return { s: vacias(), from: 'cero (recalculado desde el registro)' };
}

function guardar(s) {
  s.savedAt = ahoraIso();
  escribir(ESTADISTICAS, aJson(s));
}

// Copia de las estadísticas cada BACKUP_HORAS. Se guardan todas las de los últimos 7 días
// y, de antes, la primera de cada día durante 90 días.
function copiar(s, force = false) {
  const slot = Math.floor(Date.now() / (BACKUP_HORAS * 3600e3));
  if (!force && s.backupSlot === slot) return null;
  s.backupSlot = slot;
  guardar(s);
  const nombre = `${diaLocal()}_${dos(new Date().getHours())}.json`;
  escribir(path.join(COPIAS, nombre), aJson(s));
  const semana = diaRelativo(-7);
  const trimestre = diaRelativo(-90);
  const guardadas = new Set();
  for (const f of archivosJson(COPIAS).reverse()) { // la más vieja primero
    const day = f.slice(0, 10);
    if (day >= semana) continue;
    if (day < trimestre || guardadas.has(day)) {
      try { fs.unlinkSync(path.join(COPIAS, f)); } catch {}
    } else guardadas.add(day);
  }
  return nombre;
}

// Pone las estadísticas al día
function sincronizar() {
  const { s, from } = cargar();
  const added = ponerAlDia(s);
  if (!s.since) s.since = ahoraIso();
  if (added || from !== 'estadisticas.json' || !fs.existsSync(ESTADISTICAS)) {
    if (from !== 'estadisticas.json' && from !== 'nuevo') console.error(`[estadísticas] Cargadas desde ${from} + ${added} eventos del registro`);
    guardar(s);
  }
  copiar(s);
  return s;
}

// Después de anotar un evento: como mucho una vez por minuto, se ponen al día los totales
function sincronizarSiToca() {
  try {
    if (Date.now() - fs.statSync(ESTADISTICAS).mtimeMs < 60e3) return;
  } catch {}
  sincronizar();
}

// Vuelve a sumar todo el registro desde cero (respeta "Empezar de cero")
function recalcular() {
  const old = cargar().s;
  const s = vacias();
  s.resetAt = s.since = old.resetAt || '';
  s.backupSlot = old.backupSlot;
  ponerAlDia(s);
  if (!s.since) s.since = ahoraIso();
  guardar(s);
  return s;
}

// Empieza de cero: guarda una copia de lo actual y desde ahora cuenta solo lo nuevo (el registro no se borra)
function reiniciar() {
  const old = cargar().s;
  ponerAlDia(old);
  copiar(old, true);
  const s = vacias();
  s.resetAt = s.since = ahoraIso();
  s.cursor = old.cursor;
  s.backupSlot = old.backupSlot;
  guardar(s);
  return s;
}

function copiaAhora() {
  const { s } = cargar();
  ponerAlDia(s);
  return copiar(s, true);
}

/* ---------- Resumen para /admin ---------- */
const ratio = (a, b) => (b ? a / b : 0);

// ¿La diferencia de conversión entre los dos diseños es real o puede ser casualidad? (prueba z de dos proporciones)
function compararDisenos(a, b) {
  const n1 = a.visitors, n2 = b.visitors, x1 = a.whatsappVisitors, x2 = b.whatsappVisitors;
  if (!n1 || !n2) return { z: 0, significant: false, enough: false };
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  const z = se ? (x1 / n1 - x2 / n2) / se : 0;
  const enough = n1 >= 30 && n2 >= 30 && x1 + x2 >= 10;
  return { z: Math.round(z * 100) / 100, significant: enough && Math.abs(z) >= 1.96, enough };
}

// pedidos: los de la tienda (pagos.js), para sumar las compras de cada diseño
function resumen(s, pedidos = []) {
  const site = sitio.cargar();
  const variants = {};
  for (const v of VARIANTS) {
    const c = { ...contadores(), ...s.variants[v] };
    const suyos = pedidos.filter(o => o.version === v && (!s.since || o.createdAt >= s.since));
    variants[v] = {
      ...c,
      likesNet: c.likes - c.unlikes,
      conversion: ratio(c.whatsappVisitors, c.visitors),
      clicksPerVisit: ratio(c.whatsapp, c.visits),
      orders: suyos.length,
      paid: suyos.filter(o => o.status === 'approved').length,
    };
  }
  const zero = { visits: 0, visitors: 0, whatsapp: 0, whatsappVisitors: 0 };
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const day = diaRelativo(-i);
    const row = { day };
    for (const v of VARIANTS) row[v] = { ...zero, ...((s.days[day] || {})[v] || {}) };
    days.push(row);
  }
  const byId = Object.fromEntries([...site.products, ...site.extras].map(p => [p.id, p]));
  const ids = [...new Set([...Object.keys(byId), ...Object.keys(s.products)])];
  const products = ids.map(id => {
    const p = byId[id];
    const per = {};
    for (const v of VARIANTS) {
      const x = { views: 0, opens: 0, likes: 0, unlikes: 0, whatsapp: 0, checkouts: 0, ...((s.products[id] || {})[v] || {}) };
      per[v] = { views: x.views, opens: x.opens, likes: x.likes - x.unlikes, whatsapp: x.whatsapp, checkouts: x.checkouts };
    }
    return {
      id, name: p ? `${p.name}${p.storage ? ` ${p.storage} GB` : ''}` : id, brand: p ? p.brand : '',
      hidden: p ? p.hidden : true, deleted: !p, per,
    };
  });
  const sources = Object.entries(s.sources).map(([src, per]) => ({ src, per }));
  const places = Object.fromEntries(VARIANTS.map(v => [v, s.places[v] || {}]));
  const copias = archivosJson(COPIAS);
  return {
    since: s.since, savedAt: s.savedAt, lastEventAt: s.lastEventAt, events: s.events,
    variants, test: compararDisenos(s.variants['red-social'], s.variants.minimalista),
    days, products, sources, places, ab: site.ab,
    backupHours: BACKUP_HORAS, lastBackup: copias[0] || null,
  };
}

function leerRegistro(day) {
  try {
    return fs.readFileSync(path.join(REGISTRO, `${day}.jsonl`), 'utf8').split('\n')
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && typeof e === 'object'); // una línea cortada se saltea
  } catch {
    return [];
  }
}

module.exports = {
  REGISTRO, ESTADISTICAS, COPIAS, PLACES, limpiarEvento, anotar, sincronizar, sincronizarSiToca, recalcular, reiniciar,
  copiaAhora, resumen, archivosRegistro, leerRegistro,
};
