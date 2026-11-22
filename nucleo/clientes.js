'use strict';
/* Cuentas de clientes (22/11/2026): con email y contraseña o con Google. Sirven para ver "Mis compras", bajar los
 * comprobantes y no volver a escribir los datos al pagar. Comprar sin cuenta sigue siendo posible.
 *
 * Datos en datos/clientes.json. Las contraseñas se guardan cifradas (scrypt): nadie las puede leer, ni el panel.
 * La sesión es una cookie firmada (tb_cliente) que dura 30 días.
 * "Mis compras" muestra las compras hechas con la sesión iniciada y, si el email está confirmado (por el link del
 * mail o porque entró con Google), también las de antes con ese email. Así nadie ve compras ajenas registrándose
 * con un email que no es suyo.
 * Google: hace falta GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET (xoxo-claves). Sin eso, el botón no aparece.
 */

const crypto = require('crypto');
const { BASE_URL, HTTPS, GOOGLE } = require('./entorno');
const { ruta, escribir, leerJson, aJson, limite, Problema } = require('./archivos');
const correo = require('./correo');

const CLIENTES = ruta('clientes.json');
const DIAS = 30;
const vacio = () => ({ secreto: crypto.randomBytes(32).toString('hex'), clientes: [], tokens: [] });
function leer() {
  const d = leerJson(CLIENTES);
  if (d && Array.isArray(d.clientes) && d.secreto) return { tokens: [], ...d };
  const nuevo = vacio();
  guardar(nuevo);
  return nuevo;
}
const guardar = d => escribir(CLIENTES, `${aJson(d, true)}\n`);

/* ---------- Contraseñas y sesión ---------- */
function cifrar(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  return `scrypt$${sal}$${crypto.scryptSync(String(clave), sal, 64).toString('hex')}`;
}
function verificar(clave, guardada) {
  const [tipo, sal, hash] = String(guardada || '').split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(String(clave), sal, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const firmar = (d, id, exp) => crypto.createHmac('sha256', d.secreto).update(`tb_cliente|${id}|${exp}`).digest('hex');
function cookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}
const cookie = (nombre, valor, segundos) => `${nombre}=${encodeURIComponent(valor)}; Path=/; Max-Age=${segundos}; HttpOnly; SameSite=Lax${HTTPS ? '; Secure' : ''}`;
function abrir(res, c) {
  const d = leer();
  const exp = Math.floor(Date.now() / 1000) + DIAS * 86400;
  res.setHeader('Set-Cookie', cookie('tb_cliente', `${c.id}.${exp}.${firmar(d, c.id, exp)}`, DIAS * 86400));
}
const cerrar = res => res.setHeader('Set-Cookie', cookie('tb_cliente', '', 0));
// El cliente de la sesión, o null
function sesion(req) {
  const m = /^([a-f0-9]{12})\.(\d{10})\.([a-f0-9]{64})$/.exec(cookies(req).tb_cliente || '');
  if (!m || Number(m[2]) < Date.now() / 1000) return null;
  const d = leer();
  const esperado = Buffer.from(firmar(d, m[1], m[2]));
  const llego = Buffer.from(m[3]);
  if (esperado.length !== llego.length || !crypto.timingSafeEqual(esperado, llego)) return null;
  return d.clientes.find(c => c.id === m[1]) || null;
}

/* ---------- Datos públicos de la cuenta (lo que ve la página) ---------- */
const publico = c => (c ? {
  nombre: c.nombre, email: c.email, confirmado: Boolean(c.confirmado), google: Boolean(c.google),
  telefono: c.telefono || '', dni: c.dni || '', direccion: c.direccion || {},
} : null);
const limpio = (v, max) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/* ---------- Registro, ingreso, datos ---------- */
function registrar(body, ip) {
  if (!limite('cuenta-registro', ip, 10, 3600)) throw new Problema('Demasiados registros seguidos. Probá en un rato.', 429);
  const nombre = limpio(body.nombre, 80);
  const email = limpio(body.email, 120).toLowerCase();
  const clave = String(body.clave || '');
  if (nombre.length < 3) throw new Problema('Escribí tu nombre y apellido.');
  if (!emailOk(email)) throw new Problema('Revisá tu email.');
  if (clave.length < 8) throw new Problema('La contraseña tiene que tener al menos 8 caracteres.');
  const d = leer();
  if (d.clientes.some(c => c.email === email)) throw new Problema('Ya hay una cuenta con ese email. Ingresá, o tocá "Me olvidé la contraseña".', 409);
  const c = { id: crypto.randomBytes(6).toString('hex'), email, nombre, claveCifrada: cifrar(clave), confirmado: false, creado: new Date().toISOString() };
  d.clientes.push(c);
  guardar(d);
  mandarConfirmacion(c);
  return c;
}
function ingresar(body, ip) {
  const email = limpio(body.email, 120).toLowerCase();
  if (!limite('cuenta-ingreso', `${ip}|${email}`, 8, 900)) throw new Problema('Demasiados intentos. Esperá 15 minutos y probá de nuevo.', 429);
  const d = leer();
  const c = d.clientes.find(x => x.email === email);
  if (!c || !c.claveCifrada || !verificar(String(body.clave || ''), c.claveCifrada)) {
    throw new Problema(c && c.google && !c.claveCifrada ? 'Esa cuenta entra con Google: tocá "Continuar con Google".' : 'El email o la contraseña no son correctos.', 401);
  }
  c.ultimo = new Date().toISOString();
  guardar(d);
  return c;
}
function actualizarDatos(c, body) {
  const d = leer();
  const x = d.clientes.find(y => y.id === c.id);
  if (!x) throw new Problema('No encontré tu cuenta.', 404);
  if (body.nombre !== undefined) { const n = limpio(body.nombre, 80); if (n.length >= 3) x.nombre = n; }
  if (body.telefono !== undefined) x.telefono = String(body.telefono || '').replace(/[^\d]/g, '').slice(0, 15);
  if (body.dni !== undefined) x.dni = String(body.dni || '').replace(/[^\d]/g, '').slice(0, 9);
  if (body.direccion && typeof body.direccion === 'object') {
    const a = body.direccion;
    x.direccion = { address: limpio(a.address, 160), city: limpio(a.city, 80), province: limpio(a.province, 40), cp: limpio(a.cp, 8).toUpperCase() };
  }
  guardar(d);
  return x;
}

/* ---------- Tokens de un solo uso (confirmar email, nueva contraseña) ---------- */
function crearToken(d, c, tipo, horas) {
  const token = crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  d.tokens = (d.tokens || []).filter(t => t.hasta > Date.now() && !(t.id === c.id && t.tipo === tipo));
  d.tokens.push({ hash, id: c.id, tipo, hasta: Date.now() + horas * 3600e3 });
  return token;
}
function usarToken(d, token, tipo) {
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const t = (d.tokens || []).find(x => x.hash === hash && x.tipo === tipo && x.hasta > Date.now());
  if (!t) return null;
  d.tokens = d.tokens.filter(x => x !== t);
  return d.clientes.find(c => c.id === t.id) || null;
}
function mandarConfirmacion(c) {
  const d = leer();
  const token = crearToken(d, c, 'confirmar', 72);
  guardar(d);
  const link = `${BASE_URL}/cuenta?confirmar=${token}`;
  correo.cuenta(c, 'confirmar', link);
}
function confirmar(token) {
  const d = leer();
  const c = usarToken(d, token, 'confirmar');
  if (!c) throw new Problema('El link para confirmar venció o ya se usó. Ingresá y pedí otro.', 400);
  c.confirmado = true;
  guardar(d);
  return c;
}
function olvido(body, ip) {
  const email = limpio(body.email, 120).toLowerCase();
  if (!limite('cuenta-olvido', ip, 5, 3600)) throw new Problema('Demasiados pedidos seguidos. Probá en un rato.', 429);
  const d = leer();
  const c = d.clientes.find(x => x.email === email);
  // La respuesta es la misma exista o no la cuenta (así no se averigua quién tiene cuenta)
  if (c) {
    const token = crearToken(d, c, 'clave', 1);
    guardar(d);
    correo.cuenta(c, 'clave', `${BASE_URL}/cuenta?clave=${token}`);
  }
}
function nuevaClave(body) {
  const clave = String(body.clave || '');
  if (clave.length < 8) throw new Problema('La contraseña tiene que tener al menos 8 caracteres.');
  const d = leer();
  const c = usarToken(d, body.token, 'clave');
  if (!c) throw new Problema('El link para cambiar la contraseña venció o ya se usó. Pedí otro.', 400);
  c.claveCifrada = cifrar(clave);
  c.confirmado = true; // llegó al link: el email es suyo
  guardar(d);
  return c;
}

/* ---------- Google ---------- */
const googleActivo = () => Boolean(GOOGLE.clientId && GOOGLE.secret);
const vueltaGoogle = () => `${BASE_URL}/api/cuenta/google/vuelta`;
function irAGoogle(res) {
  if (!googleActivo()) throw new Problema('El ingreso con Google todavía no está configurado.', 503);
  const estado = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', cookie('tb_gestado', estado, 600));
  const q = new URLSearchParams({ client_id: GOOGLE.clientId, redirect_uri: vueltaGoogle(), response_type: 'code', scope: 'openid email profile', state: estado, prompt: 'select_account' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function volverDeGoogle(req, url) {
  if (!googleActivo()) throw new Problema('El ingreso con Google todavía no está configurado.', 503);
  const estado = cookies(req).tb_gestado;
  if (!estado || url.searchParams.get('state') !== estado) throw new Problema('El ingreso con Google venció. Probá de nuevo.');
  const code = url.searchParams.get('code');
  if (!code) throw new Problema('Google no confirmó el ingreso.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: GOOGLE.clientId, client_secret: GOOGLE.secret, redirect_uri: vueltaGoogle(), grant_type: 'authorization_code' }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.id_token) throw new Problema('Google no confirmó el ingreso. Probá de nuevo.', 502);
  // Google revisa la firma del id_token y nos dice de quién es
  const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tok.id_token)}`)).json().catch(() => ({}));
  if (info.aud !== GOOGLE.clientId || !info.email || String(info.email_verified) !== 'true') throw new Problema('No pudimos confirmar tu cuenta de Google.', 502);
  const email = String(info.email).toLowerCase();
  const d = leer();
  let c = d.clientes.find(x => x.google === info.sub) || d.clientes.find(x => x.email === email);
  if (!c) {
    c = { id: crypto.randomBytes(6).toString('hex'), email, nombre: limpio(info.name || email.split('@')[0], 80), creado: new Date().toISOString() };
    d.clientes.push(c);
  }
  c.google = info.sub;
  c.confirmado = true; // Google ya confirmó el email
  c.ultimo = new Date().toISOString();
  guardar(d);
  return c;
}

/* ---------- Mis compras ---------- */
// Las de la sesión (clienteId) y, con el email confirmado, las de ese email
function compras(c, pedidos) {
  return pedidos.filter(o => o.clienteId === c.id || (c.confirmado && String(o.buyer.email).toLowerCase() === c.email))
    .filter(o => o.status !== 'created')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// Para el panel: cuántos clientes hay (sin contraseñas)
const lista = () => leer().clientes.map(c => ({ id: c.id, nombre: c.nombre, email: c.email, telefono: c.telefono || '', confirmado: Boolean(c.confirmado), google: Boolean(c.google), creado: c.creado, ultimo: c.ultimo || '' }));

module.exports = {
  sesion, abrir, cerrar, publico, registrar, ingresar, actualizarDatos, confirmar, mandarConfirmacion, olvido, nuevaClave,
  googleActivo, irAGoogle, volverDeGoogle, compras, lista, Problema,
};
