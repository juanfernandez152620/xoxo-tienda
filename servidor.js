/* Servidor de la tienda de XOXO Tecno: publica los dos diseños, el panel /admin, las estadísticas,
 * el reparto de WhatsApp entre sucursales y el pago online con GO cuotas y Mercado Pago.
 *
 *   node servidor.js
 *
 * Los ajustes y las claves van en .env (copiá .env.example). No usa dependencias: alcanza con Node 18 o más
 * nuevo. Ver LEEME.md.
 */
'use strict';

const entorno = require('./nucleo/entorno');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PORT, HOST, BASE_URL, HTTPS, PUBLICO, DATOS, DETRAS_DE_PROXY } = entorno;
const { Problema, limite } = require('./nucleo/archivos');
const sitio = require('./nucleo/sitio');
const estadisticas = require('./nucleo/estadisticas');
const reparto = require('./nucleo/reparto');
const sesion = require('./nucleo/sesion');
const pagos = require('./nucleo/pagos');
const paginas = require('./nucleo/paginas');
const admin = require('./nucleo/admin');
const socio = require('./nucleo/socio');

const TIPOS = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
// Robots y herramientas que no cuentan como visitas
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|curl|wget|python/i;

/* ---------- Respuestas ---------- */
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
function enviar(res, status, body, type, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...BASE_HEADERS, ...extra });
  res.end(body);
}
const json = (res, status, data) => enviar(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
const html = (res, status, body, extra = {}) => enviar(res, status, body, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache', ...extra });
const texto = (res, status, body) => enviar(res, status, body, 'text/plain; charset=utf-8');
function redirigir(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function leerCrudo(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(new Problema('El pedido es demasiado grande', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function leerJson(req, limit) {
  const text = (await leerCrudo(req, limit)).toString('utf8');
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') return data;
  } catch {}
  // Algunos avisos de pago llegan como formulario
  const form = Object.fromEntries(new URLSearchParams(text));
  if (Object.keys(form).length) return form;
  throw new Problema('JSON inválido', 400);
}

function ipDe(req) {
  let ip = req.socket.remoteAddress || '';
  if (DETRAS_DE_PROXY) {
    const real = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0];
    if (real && real.trim()) ip = real.trim();
  }
  return ip.replace(/^::ffff:/, '').slice(0, 64);
}

/* ---------- Archivos públicos (publico/ y las fotos subidas en datos/subidas) ---------- */
function archivo(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return texto(res, 400, 'Dirección inválida'); }
  const subida = rel.match(/^\/media\/subidas\/([\w.-]+)$/);
  const base = subida ? admin.SUBIDAS : PUBLICO;
  const file = subida ? path.join(admin.SUBIDAS, subida[1]) : path.join(PUBLICO, rel);
  if (!file.startsWith(base + path.sep) || rel.includes('..')) return texto(res, 404, 'No encontrado');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return texto(res, 404, 'No encontrado');
    const ext = path.extname(file).toLowerCase();
    // Con ?v= (la fecha del archivo) se puede guardar mucho tiempo: cuando cambia, cambia la dirección
    const cache = url.searchParams.has('v') ? 'public, max-age=31536000, immutable'
      : ['.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, { 'Content-Type': TIPOS[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache, ...BASE_HEADERS });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- Eventos de las páginas (visitas, productos vistos, me gusta, checkout) ---------- */
async function evento(req, res) {
  const raw = (await leerCrudo(req, 4096).catch(() => Buffer.alloc(0))).toString('utf8');
  const ua = String(req.headers['user-agent'] || '');
  const ip = ipDe(req);
  let ev = null;
  if (raw && !BOTS.test(ua) && limite('eventos', ip, 600, 600)) {
    let data = null;
    try { data = JSON.parse(raw); } catch {}
    // Los clicks en WhatsApp los anota /api/whatsapp, que es el que elige la sucursal
    ev = data && data.tipo !== 'whatsapp' ? estadisticas.limpiarEvento(data, ua) : null;
    if (ev) {
      ev.ip = ip;
      estadisticas.anotar(ev);
    }
  }
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
  // Ya respondió: si pasó más de un minuto, pone al día los totales
  if (ev) setImmediate(() => { try { estadisticas.sincronizarSiToca(); } catch (err) { console.error('[estadísticas]', err.message); } });
}

/* ---------- WhatsApp: elige la sucursal, anota el click y manda a wa.me ---------- */
function whatsapp(req, res, url) {
  const param = k => url.searchParams.get(k) || '';
  const ua = String(req.headers['user-agent'] || '');
  const ip = ipDe(req);
  const real = !BOTS.test(ua) && limite('whatsapp', ip, 120, 600);
  const vid = /^[a-z0-9]{6,40}$/i.test(param('vid')) ? param('vid') : '';
  let branch;
  try {
    branch = reparto.elegir(sesion.cookies(req).tb_sucursal || '', vid, real);
  } catch (err) {
    // Pase lo que pase, el cliente tiene que poder escribir
    console.error('[reparto]', err.message);
    branch = { ...reparto.activas()[0], nuevo: false };
  }
  if (real) {
    try {
      const ev = estadisticas.limpiarEvento({
        tipo: 'whatsapp', v: param('v'), id: param('id'), vid: param('vid'), sid: param('sid'), src: param('src'), donde: param('donde'),
      }, ua);
      if (ev) {
        ev.suc = branch.id;
        if (branch.nuevo) ev.nuevo = true;
        ev.ip = ip;
        estadisticas.anotar(ev);
      }
    } catch (err) {
      console.error('[estadísticas]', err.message);
    }
  }
  const text = sitio.txt(param('m'), 1500);
  res.writeHead(302, {
    Location: `https://wa.me/${branch.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`,
    'Set-Cookie': `tb_sucursal=${branch.id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${HTTPS ? '; Secure' : ''}`,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  });
  res.end();
}

/* ---------- Rutas ---------- */
const DISENOS = { '/red-social/': 'red-social', '/minimalista/': 'minimalista' };

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return texto(res, 400, 'Dirección inválida'); }
  const p = url.pathname;
  const route = `${req.method} ${p}`;
  const get = req.method === 'GET' || req.method === 'HEAD';
  try {
    // Entrada y link de anuncio: reparten a cada visitante en un diseño
    if (get && p === '/') return html(res, 200, paginas.entrada(url, 'directo'), { 'Cache-Control': 'no-store' });
    if (get && p === '/anuncio/') return html(res, 200, paginas.entrada(url, 'anuncio'), { 'Cache-Control': 'no-store' });
    if (get && ['/anuncio', '/red-social', '/minimalista', '/admin'].includes(p)) return redirigir(res, `${p}/${url.search}`, 301);
    if (get && DISENOS[p]) {
      const out = paginas.diseno(DISENOS[p], url, sesion.esAdmin(req));
      return out.redirect ? redirigir(res, out.redirect) : html(res, 200, out.html);
    }
    if (get && p === '/admin/') {
      return html(res, 200, paginas.admin(), { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow' });
    }
    if (p === '/admin/api') {
      return await admin.api(req, res, url, {
        json: (status, data) => json(res, status, data),
        leerJson: limit => leerJson(req, limit),
        leerCrudo: limit => leerCrudo(req, limit),
        ip: ipDe(req),
      });
    }

    if (route === 'POST /api/evento') return await evento(req, res);
    if (route === 'GET /api/whatsapp') return whatsapp(req, res, url);

    // Pago online
    if (route === 'GET /api/checkout/config') return json(res, 200, pagos.configPublica());
    if (route === 'POST /api/checkout') {
      const [status, data] = await pagos.crear(await leerJson(req, 20000));
      return json(res, status, data);
    }
    const pedido = p.match(/^\/api\/pedidos\/([a-f0-9]{10})$/);
    if (get && pedido) {
      const [status, data] = await pagos.estado(pedido[1], url.searchParams.get('payment_id'));
      return json(res, status, data);
    }
    if (route === 'POST /api/webhooks/mercadopago' || route === 'POST /api/webhooks/gocuotas') {
      const body = await leerJson(req, 20000).catch(() => ({}));
      json(res, 200, { ok: true }); // la pasarela necesita la respuesta rápido; el chequeo sigue después
      return p.endsWith('mercadopago') ? pagos.avisoMercadoPago(body, url) : pagos.avisoGoCuotas(body);
    }
    // WhatsApp del socio: Meta verifica la dirección (GET) y después avisa cada mensaje (POST, firmado)
    if (route === 'GET /api/socio/whatsapp') {
      const [status, out] = socio.verificar(url);
      return texto(res, status, out);
    }
    if (route === 'POST /api/socio/whatsapp') {
      const raw = await leerCrudo(req, 1048576);
      if (!socio.firmaValida(raw, req.headers['x-hub-signature-256'])) {
        console.error(`[socio] Aviso de WhatsApp sin firma válida desde ${ipDe(req)}: se descarta`);
        return texto(res, 401, 'Firma inválida');
      }
      texto(res, 200, 'ok'); // Meta necesita la respuesta rápido; el mensaje se atiende después
      return socio.procesar(raw).catch(err => console.error('[socio]', err.message));
    }
    if (route === 'GET /api/demo/pagar' || route === 'GET /api/demo/resultado') {
      const [status, out] = pagos.demo(url.searchParams.get('pedido'), p.endsWith('pagar') ? 'pagar' : 'resultado', url.searchParams.get('r'));
      return status === 303 ? redirigir(res, out, 303) : html(res, status, out, { 'Cache-Control': 'no-store' });
    }

    if (get) return archivo(req, res, url);
    texto(res, 405, 'Método no permitido');
  } catch (err) {
    if (!(err instanceof Problema)) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err instanceof Problema ? err.message : 'Error interno del servidor' });
  }
});

server.listen(PORT, HOST, () => {
  sitio.cargar(); // la primera vez crea el contenido de fábrica
  sesion.config(); // y el usuario del panel
  console.log(`\nXOXO Tecno en ${BASE_URL}  (puerto ${PORT})`);
  console.log(`  Datos: ${DATOS}`);
  console.log(`  ${pagos.lineaArranque('gocuotas')}`);
  console.log(`  ${pagos.lineaArranque('mercadopago')}`);
  console.log(`  WhatsApp del socio: ${socio.configurado() ? 'conectado' : 'sin configurar'}`);
  console.log(`  Panel: ${BASE_URL}/admin/`);
  if (!HTTPS) console.log('  Aviso: con BASE_URL sin https los avisos de pago (webhooks) no pueden llegar desde internet.\n');
});
