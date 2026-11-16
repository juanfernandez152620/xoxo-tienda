'use strict';
/* Ajustes del servidor. Vienen del archivo .env de esta carpeta (copiá .env.example) o de las
   variables del sistema, que tienen prioridad. */

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
cargarEnv(path.join(APP, '.env'));

function cargarEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = (key, fallback = '') => String(process.env[key] ?? fallback).trim();

// Fechas y horas en la hora de la tienda: los archivos del registro y las copias se nombran así
process.env.TZ = env('ZONA_HORARIA', 'America/Argentina/Buenos_Aires');

const PORT = Number(env('PORT', '3000'));
const BASE_URL = env('BASE_URL', `http://localhost:${PORT}`).replace(/\/+$/, '');

module.exports = {
  APP,
  PUBLICO: path.join(APP, 'publico'),
  PLANTILLAS: path.join(APP, 'plantillas'),
  SEMILLA: path.join(APP, 'semilla', 'sitio.inicial.json'),
  // Contenido editado, estadísticas, pedidos y fotos subidas. En el servidor conviene que esté fuera de la
  // carpeta del código, así una actualización nunca la pisa.
  DATOS: path.resolve(APP, env('DATOS', 'datos')),
  PORT,
  BASE_URL,
  HTTPS: BASE_URL.startsWith('https://'),
  // true cuando adelante hay un nginx (o Cloudflare): así se guarda la IP real de cada visitante
  DETRAS_DE_PROXY: env('DETRAS_DE_PROXY', 'false') === 'true',
  BACKUP_HORAS: Math.max(1, Math.floor(Number(env('BACKUP_HORAS', '1')) || 1)),
  PAGOS_DEMO: env('PAGOS_DEMO', 'false') === 'true',
  MP_TOKEN: env('MP_ACCESS_TOKEN'),
  GC: {
    email: env('GOCUOTAS_EMAIL'),
    password: env('GOCUOTAS_PASSWORD'),
    base: env('GOCUOTAS_SANDBOX', 'false') === 'true' ? 'https://sandbox.gocuotas.com' : 'https://www.gocuotas.com',
  },
};
