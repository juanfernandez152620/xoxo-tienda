'use strict';
/* Archivos de datos: escrituras seguras, JSON, líneas del registro, fechas y límites por IP. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATOS } = require('./entorno');

const ruta = (...partes) => path.join(DATOS, ...partes);

// Error con un mensaje para mostrar en /admin (status = código HTTP)
class Problema extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fallar = msg => { throw new Problema(msg, 400); };

const asegurarCarpeta = dir => fs.mkdirSync(dir, { recursive: true });

// Escritura segura: primero a un archivo temporal y después se reemplaza (nunca queda un archivo a medias)
function escribir(file, text) {
  asegurarCarpeta(path.dirname(file));
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    throw new Problema(`No se pudo guardar ${path.basename(file)}. Revisá que la carpeta de datos tenga permiso de escritura y que haya espacio.`, 500);
  }
}

function leerJson(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}
const aJson = (data, lindo = false) => JSON.stringify(data, null, lindo ? 2 : 0);

// Archivos .json de una carpeta, el más nuevo primero (los nombres empiezan con la fecha)
function archivosJson(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  } catch {
    return [];
  }
}

// Un archivo dañado no se borra: se renombra para poder revisarlo
function cuarentena(file) {
  const to = `${file}.danado-${sello()}`;
  try { fs.renameSync(file, to); } catch {}
  return path.basename(to);
}

// Agrega una línea al final. Si la anterior quedó cortada (un corte de luz, el disco lleno), la cierra antes.
function agregarLinea(file, line) {
  asegurarCarpeta(path.dirname(file));
  let antes = '';
  try {
    const { size } = fs.statSync(file);
    if (size > 0) {
      const fd = fs.openSync(file, 'r');
      const ultimo = Buffer.alloc(1);
      fs.readSync(fd, ultimo, 0, 1, size - 1);
      fs.closeSync(fd);
      if (ultimo[0] !== 10) antes = '\n';
    }
  } catch {}
  fs.appendFileSync(file, antes + line);
}

/* ---------- Fechas (en la hora de la tienda: ver entorno.js) ---------- */
const dos = n => String(n).padStart(2, '0');
const diaLocal = (d = new Date()) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const sello = (d = new Date()) => `${diaLocal(d)}_${dos(d.getHours())}-${dos(d.getMinutes())}-${dos(d.getSeconds())}`;
const ahoraIso = () => new Date().toISOString();
function diaRelativo(dias) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + dias);
  return diaLocal(d);
}

/* ---------- Límite de pedidos por IP (ingreso a /admin, eventos, WhatsApp) ---------- */
const limites = new Map();
function limite(nombre, ip, max, segundos) {
  const key = `${nombre}|${ip}`;
  const now = Date.now();
  let h = limites.get(key);
  if (!h || h.hasta < now) h = { n: 0, hasta: now + segundos * 1000 };
  h.n++;
  limites.set(key, h);
  return h.n <= max;
}
const limpiarLimite = (nombre, ip) => limites.delete(`${nombre}|${ip}`);
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of limites) if (h.hasta < now) limites.delete(k);
}, 10 * 60e3).unref();

module.exports = {
  ruta, Problema, fallar, asegurarCarpeta, escribir, leerJson, aJson, archivosJson, cuarentena, agregarLinea,
  dos, diaLocal, diaRelativo, sello, ahoraIso, limite, limpiarLimite,
};
