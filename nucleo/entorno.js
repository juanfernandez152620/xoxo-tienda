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
    if (!m || process.env[m[1]] !== undefined) continue;
    // Entre comillas dobles, \" y \\ son una comilla y una barra (como lo lee systemd)
    const v = m[2];
    process.env[m[1]] = /^".*"$/.test(v) ? v.slice(1, -1).replace(/\\(["\\])/g, '$1') : v.replace(/^'(.*)'$/, '$1');
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
  // Solo dentro del servidor: desde internet se entra por nginx (0.0.0.0 = abierto a la red)
  HOST: env('HOST', '127.0.0.1'),
  BASE_URL,
  HTTPS: BASE_URL.startsWith('https://'),
  // true cuando adelante hay un nginx (o Cloudflare): así se guarda la IP real de cada visitante
  DETRAS_DE_PROXY: env('DETRAS_DE_PROXY', 'false') === 'true',
  BACKUP_HORAS: Math.max(1, Math.floor(Number(env('BACKUP_HORAS', '1')) || 1)),
  PAGOS_DEMO: env('PAGOS_DEMO', 'false') === 'true',
  MP_TOKEN: env('MP_ACCESS_TOKEN'),
  // Clave secreta de los avisos de Mercado Pago (Tus integraciones → Webhooks): si está, se revisa la firma de cada aviso
  MP_WEBHOOK_SECRET: env('MP_WEBHOOK_SECRET'),
  GC: {
    email: env('GOCUOTAS_EMAIL'),
    password: env('GOCUOTAS_PASSWORD'),
    base: env('GOCUOTAS_SANDBOX', 'false') === 'true' ? 'https://sandbox.gocuotas.com' : 'https://www.gocuotas.com',
  },
  // Correos de la tienda (aviso de compra al cliente y de venta a la tienda) por SMTP. Ver deploy/CORREO.md.
  CORREO: {
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PUERTO', env('SMTP_SEGURO') === 'tls' ? '465' : '587')),
    // starttls (puerto 587, lo normal), tls (puerto 465) o no (solo para un servidor de correo en la misma máquina)
    seguro: ['tls', 'starttls', 'no'].includes(env('SMTP_SEGURO')) ? env('SMTP_SEGURO') : 'starttls',
    usuario: env('SMTP_USUARIO'),
    clave: env('SMTP_CLAVE'),
    // Quién manda: "XOXO Tecno <ventas@xoxotecno.com.ar>"
    de: env('CORREO_DE'),
    responderA: env('CORREO_RESPONDER'),
    // A quiénes avisar cada venta, separados por coma
    avisos: env('CORREO_AVISOS').split(',').map(s => s.trim()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
  },
  // Claude contesta solo el chat "Cambios por IA" del panel (Claude API). Sin clave, contesta Claude a mano.
  // Ingreso de clientes con Google (console.cloud.google.com → Credenciales → ID de cliente de OAuth). Ver xoxo-claves.
  GOOGLE: {
    clientId: env('GOOGLE_CLIENT_ID'),
    secret: env('GOOGLE_CLIENT_SECRET'),
  },
  IA: {
    key: env('ANTHROPIC_API_KEY'),
    modelo: env('CLAUDE_MODELO', 'claude-opus-5-5'),
  },
  // WhatsApp del socio (API de WhatsApp Business de Meta): recibe sus pedidos de cambios
  WA: {
    token: env('WA_TOKEN'),
    phoneId: env('WA_PHONE_ID'),
    appSecret: env('WA_APP_SECRET'),
    verifyToken: env('WA_VERIFY_TOKEN'),
    // Quiénes pueden escribirle, separados por coma: Juan:3815616404,Socio:3811234567
    numeros: env('SOCIO_NUMEROS'),
    api: `${env('WA_API_URL', 'https://graph.facebook.com').replace(/\/+$/, '')}/${env('WA_API_VERSION', 'v23.0')}`,
  },
};
