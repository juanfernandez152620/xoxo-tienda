'use strict';
/* Reparto de los mensajes de WhatsApp entre las sucursales (datos/reparto.json).
 *
 * Cada persona nueva que toca WhatsApp va a la sucursal que hoy recibió menos personas; si empatan, a la que
 * recibió menos en total. Así los mensajes quedan parejos en el día y en el acumulado.
 * La misma persona sigue siempre con la misma sucursal: se la reconoce por la cookie tb_sucursal y, si la
 * cookie no llegó a guardarse (dos toques seguidos, un navegador que la borra), por el código de su navegador.
 *
 * Si el archivo se daña, se vuelve a contar desde el registro: cada persona nueva queda anotada ahí con
 * "nuevo": true y su sucursal.
 */

const fs = require('fs');
const { ruta, escribir, leerJson, aJson, cuarentena, diaLocal } = require('./archivos');
const sitio = require('./sitio');
const estadisticas = require('./estadisticas');

const REPARTO = ruta('reparto.json');
const MAX_PERSONAS = 20000;

const vacio = () => ({ dia: diaLocal(), hoy: {}, total: {}, personas: {} });
// Reciben mensajes las que tienen WhatsApp y la casilla prendida. Si ninguna la tiene prendida,
// cualquiera con WhatsApp (el botón de WhatsApp siempre tiene que llevar a alguien).
const activas = () => {
  const conNumero = sitio.cargar().store.branches.filter(b => b.whatsapp);
  const prendidas = conNumero.filter(b => b.on);
  return prendidas.length ? prendidas : conNumero;
};

// Vuelve a contar desde el registro (respeta "Empezar de cero")
function contar() {
  const r = vacio();
  const stats = leerJson(estadisticas.ESTADISTICAS) || {};
  const reset = String(stats.resetAt || '');
  for (const file of estadisticas.archivosRegistro()) {
    const day = file.slice(0, 10);
    for (const ev of estadisticas.leerRegistro(day)) {
      if (ev.tipo !== 'whatsapp' || !ev.suc || String(ev.t || '') < reset) continue;
      if (ev.vid) r.personas[ev.vid] = [String(ev.suc), day];
      if (ev.nuevo !== true) continue;
      r.total[ev.suc] = (r.total[ev.suc] || 0) + 1;
      if (day === r.dia) r.hoy[ev.suc] = (r.hoy[ev.suc] || 0) + 1;
    }
  }
  podar(r);
  return r;
}

function cargar() {
  let r = leerJson(REPARTO);
  if (!r || !r.total || !r.hoy || typeof r.dia !== 'string') {
    if (fs.existsSync(REPARTO)) console.error(`[reparto] reparto.json está dañado. Se guardó como ${cuarentena(REPARTO)}`);
    r = contar();
  }
  if (!r.personas || typeof r.personas !== 'object') r.personas = {};
  if (r.dia !== diaLocal()) {
    r.dia = diaLocal();
    r.hoy = {};
  }
  return r;
}

const guardar = r => escribir(REPARTO, aJson(r));

// Si se recuerdan demasiadas personas, se olvidan las que escribieron hace más tiempo
function podar(r) {
  const lista = Object.entries(r.personas);
  if (lista.length <= MAX_PERSONAS) return;
  lista.sort((a, b) => (a[1][1] < b[1][1] ? -1 : 1));
  for (const [vid] of lista.slice(0, lista.length - MAX_PERSONAS * 0.75)) delete r.personas[vid];
}

// La sucursal que menos personas recibió hoy; si empatan, la que menos recibió en total
function mejor(lista, r) {
  let best = null;
  let min = null;
  for (const b of lista) {
    const k = [r.hoy[b.id] || 0, r.total[b.id] || 0];
    if (!min || k[0] < min[0] || (k[0] === min[0] && k[1] < min[1])) {
      best = b;
      min = k;
    }
  }
  return best;
}

// Sucursal para esta persona. actual: la de su cookie. vid: el código de su navegador.
// contar = false: no suma (robots o demasiados clicks).
function elegir(actual, vid, contarla = true) {
  const lista = activas();
  if (!lista.length) return null; // ninguna sucursal tiene WhatsApp
  const r = cargar();
  const recordada = vid && r.personas[vid] ? r.personas[vid][0] : '';
  const conocida = lista.find(b => b.id === actual) || lista.find(b => b.id === recordada);
  if (conocida) {
    if (contarla && vid && (recordada !== conocida.id || r.personas[vid][1] !== r.dia)) {
      r.personas[vid] = [conocida.id, r.dia];
      guardar(r);
    }
    return { ...conocida, nuevo: false };
  }
  const b = mejor(lista, r);
  if (contarla) {
    r.hoy[b.id] = (r.hoy[b.id] || 0) + 1;
    r.total[b.id] = (r.total[b.id] || 0) + 1;
    if (vid) r.personas[vid] = [b.id, r.dia];
    podar(r);
    guardar(r);
  }
  return { ...b, nuevo: contarla };
}

function reiniciar() {
  guardar(vacio());
}

// Para /admin: personas de hoy y en total, clicks y a quién le toca la próxima persona
function resumen(stats) {
  const r = cargar();
  const branches = (stats && stats.branches) || {};
  const sucursales = sitio.cargar().store.branches.map(b => ({
    id: b.id, name: b.name, on: Boolean(b.on && b.whatsapp), hoy: r.hoy[b.id] || 0, total: r.total[b.id] || 0, clicks: branches[b.id] || 0,
  }));
  const siguiente = mejor(activas(), r);
  return { sucursales, siguiente: siguiente ? siguiente.name : '' };
}

module.exports = { elegir, activas, reiniciar, resumen };
