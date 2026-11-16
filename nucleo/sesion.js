'use strict';
/* Usuario y sesión del panel /admin.
 *
 * datos/config.json guarda el usuario y la contraseña. La primera vez que arranca el servidor se crea con una
 * contraseña al azar en "clave"; al entrar por primera vez se cifra ("claveCifrada") y "clave" queda vacía.
 * ¿Te la olvidaste? Escribí una nueva en "clave" (12 caracteres o más) y entrá con esa.
 *
 * La sesión es una cookie firmada que dura 12 horas. Cambiar la contraseña cierra todas las sesiones. */

const fs = require('fs');
const crypto = require('crypto');
const { HTTPS } = require('./entorno');
const { ruta, Problema, escribir, leerJson, aJson } = require('./archivos');

const CONFIG = ruta('config.json');
const HORAS = 12;

let cache = null;
let cacheMtime = 0;
const mtime = () => { try { return fs.statSync(CONFIG).mtimeMs; } catch { return 0; } };

function config() {
  if (cache && mtime() === cacheMtime) return cache;
  let c = leerJson(CONFIG);
  if (!c) {
    c = { usuario: 'admin', clave: crypto.randomBytes(15).toString('base64url'), claveCifrada: '', secreto: '' };
    console.log(`  Panel: usuario "admin", la contraseña inicial está en ${CONFIG} ("clave")`);
  }
  if (typeof c.secreto !== 'string' || c.secreto.length < 32) {
    c.secreto = crypto.randomBytes(32).toString('hex');
    guardarConfig(c);
  }
  cache = { usuario: String(c.usuario || 'admin'), clave: String(c.clave || ''), claveCifrada: String(c.claveCifrada || ''), secreto: c.secreto };
  cacheMtime = mtime();
  return cache;
}

function guardarConfig(c) {
  escribir(CONFIG, `${aJson({ usuario: c.usuario, clave: c.clave, claveCifrada: c.claveCifrada, secreto: c.secreto }, true)}\n`);
  cache = null;
}

const iguales = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

function cifrar(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  return `scrypt$${sal}$${crypto.scryptSync(String(clave), sal, 64).toString('hex')}`;
}
function verificar(clave, guardada) {
  const [tipo, sal, hash] = String(guardada).split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  return iguales(crypto.scryptSync(String(clave), sal, 64).toString('hex'), hash);
}

/* ---------- Sesión ---------- */
function firmar(exp) {
  const c = config();
  return crypto.createHmac('sha256', `${c.secreto}|${c.usuario}|${c.claveCifrada}`).update(`tb_admin|${exp}`).digest('hex');
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Vence (segundos) si hay una sesión válida, 0 si no
function sesion(req) {
  const m = /^(\d{10})\.([a-f0-9]{64})$/.exec(cookies(req).tb_admin || '');
  if (!m) return 0;
  const exp = Number(m[1]);
  if (exp < Date.now() / 1000 || !iguales(firmar(exp), m[2])) return 0;
  return exp;
}
const esAdmin = req => sesion(req) > 0;

const cookie = (valor, segundos) => `tb_admin=${valor}; Path=/; Max-Age=${segundos}; HttpOnly; SameSite=Strict${HTTPS ? '; Secure' : ''}`;
function abrir(res) {
  const exp = Math.floor(Date.now() / 1000) + HORAS * 3600;
  res.setHeader('Set-Cookie', cookie(`${exp}.${firmar(exp)}`, HORAS * 3600));
}
const cerrar = res => res.setHeader('Set-Cookie', cookie('', 0));

// Mientras se usa el panel, la sesión se estira
function estirar(req, res) {
  const exp = sesion(req);
  if (exp && exp - Date.now() / 1000 < (HORAS - 1) * 3600) abrir(res);
}

// Revisa usuario y contraseña. La contraseña escrita en config.json ("clave") se cifra la primera vez que se usa.
function ingresar(usuario, clave) {
  const c = config();
  if (!c.clave && !c.claveCifrada) throw new Problema('Falta la contraseña. Escribila en datos/config.json (en "clave") y volvé a probar.', 503);
  // Se revisan las dos cosas siempre, para no dar pistas de cuál estaba mal
  const okUsuario = iguales(String(usuario || '').trim(), c.usuario);
  const okClave = c.clave ? iguales(clave, c.clave) : verificar(clave, c.claveCifrada);
  if (!okUsuario || !okClave) return false;
  if (c.clave) guardarConfig({ ...c, clave: '', claveCifrada: cifrar(clave) });
  return true;
}

function cambiarClave(actual, nueva) {
  const c = config();
  const ok = c.clave ? iguales(actual, c.clave) : verificar(actual, c.claveCifrada);
  if (!ok) throw new Problema('La contraseña actual no es correcta.', 400);
  nueva = String(nueva || '');
  if (nueva.length < 12) throw new Problema('La contraseña nueva tiene que tener al menos 12 caracteres.', 400);
  if (iguales(nueva, c.usuario)) throw new Problema('La contraseña no puede ser igual al usuario.', 400);
  guardarConfig({ ...c, clave: '', claveCifrada: cifrar(nueva) });
}

module.exports = { CONFIG, config, cookies, esAdmin, abrir, cerrar, estirar, ingresar, cambiarClave };
