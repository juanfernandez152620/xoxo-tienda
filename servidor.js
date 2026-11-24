/* Servidor de la tienda de XOXO Tecno: publica los dos diseños, el panel /admin, las estadísticas,
 * el reparto de WhatsApp entre sucursales y el pago online con GO cuotas y Mercado Pago.
 *
 *   node servidor.js
 *
 * Los ajustes y las claves van en .env (copiá .env.example). Necesita Node 20 o más nuevo y una sola dependencia,
 * el SDK de Anthropic para que Claude conteste el chat del panel (npm ci). Ver LEEME.md.
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
const comprobante = require('./nucleo/comprobante');
const clientes = require('./nucleo/clientes');
const paginas = require('./nucleo/paginas');
const admin = require('./nucleo/admin');
const socio = require('./nucleo/socio');
const ia = require('./nucleo/ia');
const envios = require('./nucleo/envios');
const correo = require('./nucleo/correo');

const TIPOS = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
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
    const headers = { 'Content-Type': TIPOS[ext] || 'application/octet-stream', 'Cache-Control': cache, 'Accept-Ranges': 'bytes', ...BASE_HEADERS };
    // Pedazos del archivo (Range): Safari los necesita para reproducir audios y videos
    const range = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      const total = st.size;
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      if (start >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}`, ...BASE_HEADERS });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
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
  // Ninguna sucursal tiene WhatsApp cargado: vuelve a la tienda en vez de abrir un WhatsApp sin número
  if (!branch || !branch.whatsapp) {
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    return res.end();
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

/* ---------- Cuenta del cliente (/api/cuenta/…) ---------- */
async function cuentaApi(req, res, url, route) {
  const ip = ipDe(req);
  try {
    if (route === 'GET /api/cuenta') {
      return json(res, 200, { cliente: clientes.publico(clientes.sesion(req)), google: clientes.googleActivo() });
    }
    if (route === 'POST /api/cuenta/registro') {
      const c = clientes.registrar(await leerJson(req, 4000), ip);
      clientes.abrir(res, c);
      return json(res, 200, { cliente: clientes.publico(c) });
    }
    if (route === 'POST /api/cuenta/ingresar') {
      const c = clientes.ingresar(await leerJson(req, 4000), ip);
      clientes.abrir(res, c);
      return json(res, 200, { cliente: clientes.publico(c) });
    }
    if (route === 'POST /api/cuenta/salir') { clientes.cerrar(res); return json(res, 200, { ok: true }); }
    if (route === 'POST /api/cuenta/olvido') { clientes.olvido(await leerJson(req, 2000), ip); return json(res, 200, { ok: true }); }
    if (route === 'POST /api/cuenta/clave') {
      const c = clientes.nuevaClave(await leerJson(req, 2000));
      clientes.abrir(res, c);
      return json(res, 200, { cliente: clientes.publico(c) });
    }
    if (route === 'POST /api/cuenta/confirmar') {
      const c = clientes.confirmar((await leerJson(req, 2000)).token);
      clientes.abrir(res, c);
      return json(res, 200, { cliente: clientes.publico(c) });
    }
    if (route === 'GET /api/cuenta/google') {
      // Google vuelve siempre a BASE_URL (xoxotecno.com.ar): si entraron por otra dirección (www), se arranca desde
      // ahí, así la cookie del ingreso queda en la misma dirección a la que vuelve Google
      if (String(req.headers.host || '').toLowerCase() !== new URL(BASE_URL).host) return redirigir(res, `${BASE_URL}/api/cuenta/google`);
      return redirigir(res, clientes.irAGoogle(res));
    }
    if (route === 'GET /api/cuenta/google/vuelta') {
      try {
        const c = await clientes.volverDeGoogle(req, url);
        clientes.abrir(res, c);
        return redirigir(res, '/cuenta');
      } catch (err) {
        return redirigir(res, `/cuenta?error=${encodeURIComponent(err.message)}`);
      }
    }
    // De acá en adelante, con la sesión iniciada
    const c = clientes.sesion(req);
    if (!c) return json(res, 401, { error: 'Ingresá a tu cuenta.' });
    if (route === 'POST /api/cuenta/datos') return json(res, 200, { cliente: clientes.publico(clientes.actualizarDatos(c, await leerJson(req, 4000))) });
    if (route === 'POST /api/cuenta/reenviar') {
      if (!limite('cuenta-reenviar', ip, 3, 3600)) return json(res, 429, { error: 'Ya te mandamos el mail. Revisá también la carpeta de spam.' });
      clientes.mandarConfirmacion(c);
      return json(res, 200, { ok: true });
    }
    if (route === 'GET /api/cuenta/compras') {
      const lista = clientes.compras(c, pagos.leerPedidos()).map(o => ({ id: o.id, ...pagos.seguimientoPublico(o) }));
      return json(res, 200, { compras: lista, confirmado: Boolean(c.confirmado) });
    }
    // Pagar una compra que quedó sin pagar (Mis compras → Pagar ahora): solo las de esta cuenta
    if (route === 'POST /api/cuenta/pagar') {
      if (!limite('pagar', ip, 10, 600)) return json(res, 429, { error: 'Demasiados intentos seguidos. Esperá unos minutos.' });
      const body = await leerJson(req, 1000);
      const o = clientes.compras(c, pagos.leerPedidos()).find(x => x.id === String((body && body.id) || ''));
      if (!o) return json(res, 404, { error: 'No encontramos esa compra en tu cuenta. Recargá la página.' });
      const [status, data] = await pagos.pagarDeNuevo(o);
      return json(res, status, data);
    }
    return json(res, 404, { error: 'No encontrado' });
  } catch (err) {
    if (err.status) return json(res, err.status, { error: err.message });
    throw err;
  }
}

/* ---------- Rutas ---------- */
const DISENOS = Object.fromEntries(sitio.VARIANTS.map(v => [`/${v}/`, v]));
// Categorías de la página principal (/audio/), de cada diseño (/historia/audio/) y links de anuncio (/anuncio/audio/)
const CATEGORIA_PRINCIPAL = new RegExp(`^/(${sitio.CATS.join('|')})(/?)$`);
// Páginas de categoría de cada diseño (/historia/audio/) y links de anuncio por categoría (/anuncio/audio/)
const CATEGORIA = new RegExp(`^/(${sitio.VARIANTS.join('|')}|anuncio)/(${sitio.CATS.join('|')})(/?)$`);

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return texto(res, 400, 'Dirección inválida'); }
  const p = url.pathname;
  const route = `${req.method} ${p}`;
  const get = req.method === 'GET' || req.method === 'HEAD';
  try {
    // La página principal muestra Historia ahí mismo (sin /historia/ en la dirección); el link de anuncio
    // reparte a cada visitante en un diseño, según /admin → Anuncio
    if (get && p === '/') return html(res, 200, paginas.principal());
    const catPrincipal = get && p.match(CATEGORIA_PRINCIPAL);
    if (catPrincipal) return catPrincipal[2] ? html(res, 200, paginas.principal(catPrincipal[1])) : redirigir(res, `${p}/${url.search}`, 301);
    if (get && p === '/anuncio/') return html(res, 200, paginas.entrada(url, 'anuncio'), { 'Cache-Control': 'no-store' });
    if (get && ['/anuncio', '/admin', ...sitio.VARIANTS.map(v => `/${v}`)].includes(p)) return redirigir(res, `${p}/${url.search}`, 301);
    if (get && DISENOS[p]) {
      const out = paginas.diseno(DISENOS[p], url, sesion.esAdmin(req));
      return out.redirect ? redirigir(res, out.redirect) : html(res, 200, out.html);
    }
    const cat = get && p.match(CATEGORIA);
    if (cat) {
      if (!cat[3]) return redirigir(res, `${p}/${url.search}`, 301);
      if (cat[1] === 'anuncio') return html(res, 200, paginas.entrada(url, 'anuncio', cat[2]), { 'Cache-Control': 'no-store' });
      const out = paginas.diseno(cat[1], url, sesion.esAdmin(req), cat[2]);
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

    // Calculadora de envíos (Andreani y Correo Argentino)
    if (route === 'GET /api/envios') {
      if (!limite('envios', ipDe(req), 120, 600)) return json(res, 429, { error: 'Esperá un momento y probá de nuevo.' });
      return json(res, 200, envios.cotizar({
        provincia: url.searchParams.get('provincia'), cp: url.searchParams.get('cp'),
        productId: url.searchParams.get('producto'), cat: url.searchParams.get('cat'),
      }));
    }

    // Pago online
    if (route === 'GET /api/checkout/config') return json(res, 200, pagos.configPublica());
    // Cuenta del cliente: la página y la API (con email y contraseña o con Google)
    if (get && p === '/cuenta') return html(res, 200, paginas.cuenta(), { 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
    if (p.startsWith('/api/cuenta')) return await cuentaApi(req, res, url, route);
    // Seguí tu compra: la página y la consulta (código + email), y el comprobante en PDF
    if (get && p === '/seguimiento') return html(res, 200, paginas.seguimiento(), { 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
    if (route === 'GET /api/seguimiento') {
      if (!limite('seguimiento', ipDe(req), 40, 600)) return json(res, 429, { error: 'Demasiadas consultas seguidas. Esperá unos minutos.' });
      const [status, data] = pagos.consultarSeguimiento({ pedido: url.searchParams.get('pedido'), email: url.searchParams.get('email') });
      return json(res, status, data);
    }
    // Pagar un pedido que quedó sin pagar (con el código y el email, como la consulta)
    if (route === 'POST /api/seguimiento/pagar') {
      if (!limite('pagar', ipDe(req), 10, 600)) return json(res, 429, { error: 'Demasiados intentos seguidos. Esperá unos minutos.' });
      const [status, data] = await pagos.pagarPorSeguimiento(await leerJson(req, 2000));
      return json(res, status, data);
    }
    const pdfId = get && p.match(/^\/api\/pedidos\/([a-f0-9]{10})\/comprobante\.pdf$/);
    if (pdfId || (get && p === '/api/comprobante')) {
      if (!limite('comprobante', ipDe(req), 40, 600)) return texto(res, 429, 'Demasiadas descargas seguidas. Esperá unos minutos.');
      const o = pdfId ? pagos.buscarPedido(pdfId[1]) : pagos.porRefYEmail(url.searchParams.get('pedido'), url.searchParams.get('email'));
      if (!o) return texto(res, 404, 'No encontramos esa compra.');
      if (o.status !== 'approved') return texto(res, 409, 'El comprobante está disponible cuando el pago se aprueba.');
      const buf = comprobante.comprobante(o);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Content-Disposition': `inline; filename="comprobante-${o.ref}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : buf);
    }
    if (route === 'POST /api/codigo') {
      if (!limite('codigo', ipDe(req), 20, 600)) return json(res, 429, { error: 'Demasiados intentos. Esperá unos minutos.' });
      const [status, data] = pagos.consultarCodigo(await leerJson(req, 2000));
      return json(res, status, data);
    }
    if (route === 'POST /api/checkout') {
      const cli = clientes.sesion(req);
      const [status, data] = await pagos.crear(await leerJson(req, 20000), { clienteId: cli && cli.id });
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
      return p.endsWith('mercadopago') ? pagos.avisoMercadoPago(body, url, req.headers) : pagos.avisoGoCuotas(body);
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
  console.log(`  ${correo.lineaArranque()}`);
  console.log(`  Panel: ${BASE_URL}/admin/`);
  ia.iniciar().catch(err => console.error('[ia]', err.message));
  if (!HTTPS) console.log('  Aviso: con BASE_URL sin https los avisos de pago (webhooks) no pueden llegar desde internet.\n');
});
