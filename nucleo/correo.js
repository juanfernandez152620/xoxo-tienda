'use strict';
/* Correos de la tienda (@xoxotecno.com.ar): el aviso de compra al cliente y el aviso de venta a la tienda.
 *
 * Manda por SMTP con cualquier proveedor (Brevo, Zoho, el servidor de correo propio…), sin dependencias.
 * Cada correo entra en una cola (datos/correos/cola.json): si el servidor de correo no responde, se reintenta
 * solo (1 min, 5 min, 30 min, 2 h, 6 h). Lo enviado queda anotado en datos/correos/enviados.jsonl.
 * Sin SMTP configurado, los correos no salen: se guardan en datos/correos/vista/ y se ven en el panel.
 * Ver deploy/CORREO.md.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { CORREO, BASE_URL } = require('./entorno');
const { ruta, escribir, leerJson, aJson, agregarLinea, asegurarCarpeta } = require('./archivos');
const sitio = require('./sitio');

const DIR = ruta('correos');
const COLA = path.join(DIR, 'cola.json');
const ENVIADOS = path.join(DIR, 'enviados.jsonl');
const VISTA = path.join(DIR, 'vista');
const ESPERAS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3]; // después de la última, se da por fallido

const configurado = () => Boolean(CORREO.host && CORREO.de);
const direccion = s => (String(s || '').match(/<([^<>\s]+@[^<>\s]+)>/) || String(s || '').match(/([^\s<>"]+@[^\s<>"]+)/) || [])[1] || '';
const emailValido = s => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(s);

/* ---------- Armado del mensaje (MIME) ---------- */
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const lineas76 = s => s.replace(/.{1,76}/g, '$&\r\n');
// Encabezado con tildes o emojis: =?UTF-8?B?…?=
const encabezado = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
function remitente(s) {
  const email = direccion(s);
  const nombre = String(s || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  if (!nombre || nombre === email) return `<${email}>`;
  return `${/^[\x20-\x7e]*$/.test(nombre) ? `"${nombre}"` : `=?UTF-8?B?${b64(nombre)}?=`} <${email}>`;
}

function armar({ para, asunto, html, texto, responderA }) {
  const dominio = direccion(CORREO.de).split('@')[1] || 'localhost';
  const limite = `xoxo-${crypto.randomBytes(8).toString('hex')}`;
  const cabeza = [
    `From: ${remitente(CORREO.de)}`,
    `To: <${para}>`,
    ...(responderA ? [`Reply-To: <${direccion(responderA)}>`] : []),
    `Subject: ${encabezado(asunto)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${Date.now().toString(36)}.${crypto.randomBytes(6).toString('hex')}@${dominio}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${limite}"`,
  ];
  const parte = (tipo, cuerpo) => [
    `--${limite}`, `Content-Type: ${tipo}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', lineas76(b64(cuerpo)),
  ].join('\r\n');
  return `${cabeza.join('\r\n')}\r\n\r\n${parte('text/plain', texto)}\r\n${parte('text/html', html)}\r\n--${limite}--\r\n`;
}

/* ---------- SMTP ---------- */
// Una conversación SMTP: lee respuestas completas (las de varias líneas, "250-…", terminan en "250 …")
class Conexion {
  constructor(socket) { this.usar(socket); }
  usar(socket) {
    this.socket = socket;
    this.buffer = '';
    this.esperando = null;
    this.respuestas = [];
    socket.setEncoding('utf8');
    socket.setTimeout(30000, () => socket.destroy(new Error('el servidor de correo no respondió a tiempo')));
    socket.on('data', d => { this.buffer += d; this.revisar(); });
    socket.on('error', err => this.fallar(err));
    socket.on('close', () => this.fallar(new Error('el servidor de correo cortó la conexión')));
  }
  revisar() {
    let fin;
    while ((fin = this.buffer.match(/^(?:\d{3}-[^\n]*\n)*(\d{3})(?: [^\n]*)?\r?\n/))) {
      const bloque = fin[0];
      this.buffer = this.buffer.slice(bloque.length);
      this.respuestas.push({ code: Number(fin[1]), text: bloque.trim() });
    }
    if (this.esperando && this.respuestas.length) {
      const { resolve } = this.esperando;
      this.esperando = null;
      resolve(this.respuestas.shift());
    }
  }
  fallar(err) {
    this.error = this.error || err;
    if (this.esperando) {
      const { reject } = this.esperando;
      this.esperando = null;
      reject(this.error);
    }
  }
  leer() {
    if (this.respuestas.length) return Promise.resolve(this.respuestas.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => { this.esperando = { resolve, reject }; });
  }
  async cmd(linea, esperado, ocultar = false) {
    if (linea !== null) this.socket.write(`${linea}\r\n`);
    const r = await this.leer();
    if (!esperado.includes(r.code)) {
      const que = ocultar ? 'la autenticación' : (linea || 'la conexión').split(':')[0];
      throw Object.assign(new Error(`${que}: ${r.text.split('\n').pop().slice(0, 200)}`), { code: r.code });
    }
    return r;
  }
}

function conectar(cfg) {
  return new Promise((resolve, reject) => {
    const opts = { host: cfg.host, port: cfg.port, servername: cfg.host };
    const s = cfg.seguro === 'tls' ? tls.connect(opts) : net.connect(opts);
    s.once(cfg.seguro === 'tls' ? 'secureConnect' : 'connect', () => resolve(s));
    s.once('error', reject);
    s.setTimeout(20000, () => s.destroy(new Error(`no se pudo conectar con ${cfg.host}:${cfg.port}`)));
  });
}

// Se conecta, pasa a conexión cifrada si corresponde e inicia sesión. Devuelve la conexión lista para mandar.
async function abrir(cfg) {
  const c = new Conexion(await conectar(cfg));
  try {
    await c.cmd(null, [220]);
    const nombre = direccion(CORREO.de).split('@')[1] || 'localhost';
    let ehlo = await c.cmd(`EHLO ${nombre}`, [250]);
    if (cfg.seguro === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error('el servidor no ofrece STARTTLS (probá SMTP_SEGURO=tls con el puerto 465)');
      await c.cmd('STARTTLS', [220]);
      const plano = c.socket;
      plano.removeAllListeners('data');
      plano.removeAllListeners('close');
      plano.removeAllListeners('error');
      const seguro = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: plano, servername: cfg.host }, () => resolve(t));
        t.once('error', reject);
      });
      c.usar(seguro);
      ehlo = await c.cmd(`EHLO ${nombre}`, [250]);
    }
    if (cfg.usuario) {
      if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.text)) {
        await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.usuario}\0${cfg.clave}`).toString('base64')}`, [235], true);
      } else {
        await c.cmd('AUTH LOGIN', [334], true);
        await c.cmd(Buffer.from(cfg.usuario).toString('base64'), [334], true);
        await c.cmd(Buffer.from(cfg.clave).toString('base64'), [235], true);
      }
    }
    return c;
  } catch (err) {
    c.socket.destroy();
    throw err;
  }
}

async function smtp(cfg, para, raw) {
  const c = await abrir(cfg);
  try {
    await c.cmd(`MAIL FROM:<${direccion(CORREO.de)}>`, [250]);
    await c.cmd(`RCPT TO:<${para}>`, [250, 251]);
    await c.cmd('DATA', [354]);
    // Una línea que empieza con "." se manda con dos (así no corta el mensaje)
    const r = await c.cmd(`${raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')}\r\n.`, [250]);
    c.socket.write('QUIT\r\n');
    return r.text.slice(0, 200);
  } finally {
    setTimeout(() => c.socket.destroy(), 500).unref();
  }
}

// Prueba la conexión y el usuario sin mandar ningún correo (la usa xoxo-claves)
async function verificar(cfg = CORREO) {
  const c = await abrir(cfg);
  c.socket.write('QUIT\r\n');
  setTimeout(() => c.socket.destroy(), 300).unref();
  return true;
}

/* ---------- Cola ---------- */
const leerCola = () => { const c = leerJson(COLA); return Array.isArray(c) ? c : []; };
const guardarCola = c => escribir(COLA, aJson(c, true));
const anotar = e => { asegurarCarpeta(DIR); agregarLinea(ENVIADOS, `${JSON.stringify({ t: new Date().toISOString(), ...e })}\n`); };

// Manda ya mismo un correo armado (sin cola). Sin SMTP lo guarda para verlo en el panel.
async function despachar(m) {
  if (!configurado()) {
    asegurarCarpeta(VISTA);
    const archivo = `${m.id}.html`;
    escribir(path.join(VISTA, archivo), m.html);
    return { modo: 'vista', archivo };
  }
  const respuesta = await smtp(CORREO, m.para, armar(m));
  return { modo: 'smtp', respuesta };
}

let corriendo = false;
async function procesar() {
  if (corriendo) return;
  corriendo = true;
  try {
    for (;;) {
      const ahora = Date.now();
      const m = leerCola().find(x => (x.proximo || 0) <= ahora);
      if (!m) break;
      let resto;
      try {
        const r = await despachar(m);
        anotar({ id: m.id, tipo: m.tipo, ref: m.ref, para: m.para, asunto: m.asunto, estado: r.modo === 'vista' ? 'vista' : 'enviado', archivo: r.archivo, intentos: (m.intentos || 0) + 1 });
        resto = leerCola().filter(x => x.id !== m.id);
      } catch (err) {
        const intentos = (m.intentos || 0) + 1;
        console.error(`[correo] No salió "${m.asunto}" a ${m.para} (intento ${intentos}): ${err.message}`);
        resto = leerCola().filter(x => x.id !== m.id);
        if (intentos > ESPERAS.length) anotar({ id: m.id, tipo: m.tipo, ref: m.ref, para: m.para, asunto: m.asunto, estado: 'fallido', error: err.message, intentos });
        else resto.push({ ...m, intentos, error: err.message, proximo: Date.now() + ESPERAS[intentos - 1] });
      }
      guardarCola(resto);
    }
  } finally {
    corriendo = false;
  }
}

function encolar({ para, asunto, html, texto, tipo = 'otro', ref = '', responderA = CORREO.responderA }) {
  if (!emailValido(para)) return null;
  const m = { id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, para, asunto, html, texto, tipo, ref, responderA, creado: new Date().toISOString(), intentos: 0 };
  guardarCola([...leerCola(), m]);
  setImmediate(() => procesar().catch(err => console.error('[correo]', err.message)));
  return m.id;
}

/* ---------- Plantillas ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `$${new Intl.NumberFormat('es-AR').format(Math.round(n))}`;
const fecha = iso => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

// Marco común: encabezado con la marca, contenido y pie. Funciona en Gmail, Outlook y Apple Mail (claro y oscuro).
function marco({ previa, titulo, cuerpo, pie = '' }) {
  const site = sitio.cargar();
  const tienda = site.store.name;
  const sucursales = site.store.branches.map(b => b.name).join(' · ');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(titulo)}</title>
<style>
  body{margin:0;padding:0;background:#f4f1fb}
  a{color:#7c3aed}
  @media (prefers-color-scheme:dark){
    body,.fondo{background:#0f0b1a!important}
    .caja{background:#1b1530!important;border-color:#2e2650!important}
    .txt,.txt td{color:#ece8f8!important} .suave{color:#a9a1c7!important} .linea{border-color:#2e2650!important}
  }
</style></head>
<body>
<span style="display:none!important;max-height:0;overflow:hidden;opacity:0">${esc(previa)}</span>
<table role="presentation" class="fondo" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1fb;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="background:#7c3aed;background-image:linear-gradient(120deg,#ec4899,#7c3aed 60%,#4f46e5);border-radius:20px 20px 0 0;padding:28px 28px 24px">
      <div style="font:900 30px/1 Arial,Helvetica,sans-serif;letter-spacing:6px;color:#ffffff">XOXO</div>
      <div style="font:600 12px/1.4 Arial,Helvetica,sans-serif;letter-spacing:4px;color:#f5e8ff;text-transform:uppercase;margin-top:6px">Tecno</div>
    </td></tr>
    <tr><td class="caja txt" style="background:#ffffff;border:1px solid #ebe5f7;border-top:0;border-radius:0 0 20px 20px;padding:28px;font:15px/1.55 Arial,Helvetica,sans-serif;color:#1d1730">
      <h1 style="margin:0 0 14px;font:800 24px/1.25 Arial,Helvetica,sans-serif">${esc(titulo)}</h1>
      ${cuerpo}
    </td></tr>
    <tr><td class="suave" style="padding:18px 12px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#7a7194;text-align:center">
      ${pie}${esc(tienda)} · Sucursales ${esc(sucursales)}<br>
      <a href="${esc(BASE_URL)}" style="color:#7a7194">${esc(BASE_URL.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const fila = (a, b, fuerte = false) => `<tr><td class="txt" style="padding:6px 0;${fuerte ? 'font-weight:800;font-size:17px' : ''}">${a}</td><td class="txt" align="right" style="padding:6px 0;white-space:nowrap;${fuerte ? 'font-weight:800;font-size:17px' : ''}">${b}</td></tr>`;
const boton = (href, texto) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="background:#7c3aed;border-radius:999px"><a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font:700 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">${esc(texto)}</a></td></tr></table>`;
const METODOS = { mercadopago: 'Mercado Pago', gocuotas: 'GO cuotas' };

function detalle(o) {
  const envio = o.envio || { nombre: o.delivery && o.delivery.type === 'envio' ? 'Envío' : 'Retiro en sucursal', costo: 0 };
  const producto = o.productAmount ?? o.amount - (envio.costo || 0);
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="linea" style="border-top:1px solid #ebe5f7;border-bottom:1px solid #ebe5f7;margin:18px 0">
    ${(o.items || [{ name: o.product.name, n: 1, price: o.discount ? producto + o.discount.amount : producto }]).map(x => fila(esc(`${x.n > 1 ? `${x.n} × ` : ''}${x.name}`), money(x.price * x.n))).join('')}
    ${o.discount ? fila(`<span class="suave" style="color:#7a7194">Código ${esc(o.discount.code)} (${o.discount.percent}% off)</span>`, `<span style="color:#16a34a">−${money(o.discount.amount)}</span>`) : ''}
    ${o.plan > 1 ? fila(`<span class="suave" style="color:#7a7194;font-size:13px">${o.plan} cuotas con ${esc(METODOS[o.method] || o.method)}</span>`, '') : ''}
    ${o.coupon ? fila(`<span class="suave" style="color:#7a7194">Descuento flash (cupón ${esc(o.coupon)})</span>`, '<span style="color:#16a34a">aplicado</span>') : ''}
    ${fila(esc(envio.nombre), envio.costo ? money(envio.costo) : 'Gratis')}
    ${fila('Total pagado', money(o.amount), true)}
  </table>`;
}

function entrega(o, site) {
  const e = o.envio;
  if (!e || e.tipo === 'retiro') {
    const suc = site.store.branches.find(b => b.id === (e && e.sucursal)) || site.store.branches[0];
    return `<p style="margin:0 0 8px"><b>Retiro en sucursal ${esc(suc.name)}</b><br><span class="suave" style="color:#7a7194">${esc(suc.address)}</span></p>
      <p style="margin:0">Te avisamos por WhatsApp cuando esté listo para retirar.</p>`;
  }
  const d = o.delivery || {};
  const dias = e.dias ? ` · llega en ${e.dias[0]} a ${e.dias[1]} días hábiles` : '';
  return `<p style="margin:0 0 8px"><b>${esc(e.nombre)}</b>${esc(dias)}<br><span class="suave" style="color:#7a7194">${esc([d.address, d.city, e.provincia, d.cp && `CP ${d.cp}`].filter(Boolean).join(', '))}</span></p>
    <p style="margin:0">Cuando lo despachemos te mandamos el número de seguimiento.</p>`;
}

function compra(o) {
  const site = sitio.cargar();
  const nombre = o.buyer.name.split(' ')[0];
  const dias = site.story.warrantyDays;
  const demo = o.gateway && o.gateway.demo;
  const wa = `${BASE_URL}/api/whatsapp?m=${encodeURIComponent(`¡Hola! Hice el pedido #${o.ref} en la web.`)}&v=${encodeURIComponent(o.version)}&donde=otro`;
  const html = marco({
    previa: `Recibimos tu pago del pedido #${o.ref}.`,
    titulo: `¡Gracias por tu compra, ${nombre}!`,
    cuerpo: `
      ${demo ? '<p style="margin:0 0 14px;padding:10px 14px;border-radius:12px;background:#fff3c4;color:#7a5b00;font-weight:700">PRUEBA: pago simulado, no se cobró nada.</p>' : ''}
      <p style="margin:0">Recibimos tu pago con ${esc(METODOS[o.method] || o.method)}. Tu pedido es el <b>#${esc(o.ref)}</b> del ${esc(fecha(o.createdAt))}.</p>
      ${detalle(o)}
      <h2 style="margin:0 0 8px;font:800 17px Arial,Helvetica,sans-serif">Entrega</h2>
      ${entrega(o, site)}
      ${dias ? `<p style="margin:18px 0 0;padding:12px 14px;border-radius:12px;background:#f3edff;color:#4c1d95" class="caja">🛡️ Tu compra tiene <b>${dias} días de garantía</b>. Si algo no anda, escribinos.</p>` : ''}
      ${boton(`${BASE_URL}/api/pedidos/${o.id}/comprobante.pdf`, 'Descargar el comprobante (PDF)')}
      <p style="margin:6px 0 0">Seguí tu pedido cuando quieras en <a href="${esc(`${BASE_URL}/seguimiento?pedido=${o.ref}&email=${encodeURIComponent(o.buyer.email)}`)}">${esc(BASE_URL.replace(/^https?:\/\//, ''))}/seguimiento</a> con el código <b>#${esc(o.ref)}</b>.</p>
      ${boton(wa, 'Escribinos por WhatsApp')}`,
    pie: 'Recibiste este correo porque compraste en nuestra tienda online.<br>',
  });
  const texto = [
    `¡Gracias por tu compra, ${nombre}!`, '',
    `Recibimos tu pago. Pedido #${o.ref} (${fecha(o.createdAt)}).`, demo ? 'PRUEBA: pago simulado, no se cobró nada.' : '',
    `${o.product.name}: ${money(o.productAmount ?? o.amount)}`,
    o.envio ? `${o.envio.nombre}: ${o.envio.costo ? money(o.envio.costo) : 'gratis'}` : '',
    `Total pagado: ${money(o.amount)}`, '',
    dias ? `Tu compra tiene ${dias} días de garantía.` : '',
    `¿Dudas? Escribinos por WhatsApp: ${wa}`, '', site.store.name,
  ].filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  return { para: o.buyer.email, asunto: `Recibimos tu pago · pedido #${o.ref}`, html, texto, tipo: 'compra', ref: o.ref };
}

function venta(o, para) {
  const site = sitio.cargar();
  const b = o.buyer;
  const html = marco({
    previa: `${o.product.name} · ${money(o.amount)} · ${b.name}`,
    titulo: `Nueva venta pagada #${o.ref}`,
    cuerpo: `
      ${o.gateway && o.gateway.demo ? '<p style="margin:0 0 14px;padding:10px 14px;border-radius:12px;background:#fff3c4;color:#7a5b00;font-weight:700">Pago simulado (modo demo).</p>' : ''}
      ${detalle(o)}
      <h2 style="margin:0 0 8px;font:800 17px Arial,Helvetica,sans-serif">Cliente</h2>
      <p style="margin:0">${esc(b.name)}<br>${esc(b.email)}<br>WhatsApp ${esc(b.phone)}${b.dni ? `<br>DNI ${esc(b.dni)}` : ''}</p>
      <h2 style="margin:18px 0 8px;font:800 17px Arial,Helvetica,sans-serif">Entrega</h2>
      ${entrega(o, site)}
      ${boton(`${BASE_URL}/admin/#pedidos`, 'Ver el pedido en el panel')}`,
  });
  const texto = `Nueva venta pagada #${o.ref}\n${o.product.name} · ${money(o.amount)}\n${b.name} · ${b.email} · ${b.phone}\n${BASE_URL}/admin/#pedidos`;
  return { para, asunto: `Venta #${o.ref}: ${o.product.name} · ${money(o.amount)}`, html, texto, tipo: 'venta', ref: o.ref, responderA: b.email };
}

function prueba(para) {
  const html = marco({
    previa: 'Si te llegó este correo, la tienda ya puede mandar mails.',
    titulo: 'Correo de prueba',
    cuerpo: `<p style="margin:0">Si te llegó este correo, la tienda ya puede mandar los avisos de compra desde <b>${esc(direccion(CORREO.de) || 'la tienda')}</b>.</p>
      <p style="margin:12px 0 0" class="suave">Mandado el ${esc(new Date().toLocaleString('es-AR'))}.</p>`,
  });
  return { para, asunto: 'Prueba de correo de la tienda', html, texto: 'Si te llegó este correo, la tienda ya puede mandar mails.', tipo: 'prueba' };
}

// Avisos de la entrega: el pedido salió (con el número de seguimiento) o está listo para retirar
const SITIOS_ENVIO = { andreani: ['Andreani', 'https://www.andreani.com/'], correo: ['Correo Argentino', 'https://www.correoargentino.com.ar/'] };
function entregaAviso(o, paso) {
  const site = sitio.cargar();
  const nombre = o.buyer.name.split(' ')[0];
  const seg = o.seguimiento || {};
  const link = `${BASE_URL}/seguimiento?pedido=${encodeURIComponent(o.ref)}&email=${encodeURIComponent(o.buyer.email)}`;
  let titulo, previa, cuerpo, texto;
  if (paso === 'despachado') {
    const [empresa, web] = SITIOS_ENVIO[seg.empresa] || ['la empresa de envíos', ''];
    titulo = `¡Tu pedido ya salió, ${nombre}!`;
    previa = `El pedido #${o.ref} va en camino con ${empresa}.`;
    cuerpo = `<p style="margin:0">Despachamos tu pedido <b>#${esc(o.ref)}</b> con <b>${esc(empresa)}</b>.</p>
      <p style="margin:14px 0 0;padding:12px 14px;border-radius:12px;background:#f3edff;color:#4c1d95" class="caja">Número de seguimiento: <b>${esc(seg.numero || '')}</b>${web ? `<br>Buscalo en <a href="${esc(web)}">${esc(web.replace(/^https:\/\/(www\.)?|\/$/g, ''))}</a>` : ''}</p>`;
    texto = `Despachamos tu pedido #${o.ref} con ${empresa}. Número de seguimiento: ${seg.numero || ''}${web ? ` (buscalo en ${web})` : ''}.`;
  } else {
    const suc = site.store.branches.find(b => b.id === (o.envio && o.envio.sucursal)) || site.store.branches[0] || {};
    titulo = `¡Tu pedido está listo, ${nombre}!`;
    previa = `El pedido #${o.ref} ya se puede retirar.`;
    cuerpo = `<p style="margin:0">Tu pedido <b>#${esc(o.ref)}</b> está listo para retirar en la sucursal <b>${esc(suc.name || '')}</b>.</p>
      <p style="margin:14px 0 0" class="suave">${esc(suc.address || '')}${suc.hours ? `<br>${esc(suc.hours)}` : ''}</p>
      <p style="margin:14px 0 0">Llevá el código <b>#${esc(o.ref)}</b> (o el comprobante) y tu DNI.</p>`;
    texto = `Tu pedido #${o.ref} está listo para retirar en la sucursal ${suc.name || ''}: ${suc.address || ''}. Llevá el código #${o.ref} y tu DNI.`;
  }
  const html = marco({ previa, titulo, cuerpo: `${cuerpo}${boton(link, 'Ver el estado de mi pedido')}`, pie: 'Recibiste este correo porque compraste en nuestra tienda online.<br>' });
  return { para: o.buyer.email, asunto: `${paso === 'despachado' ? 'Tu pedido salió' : 'Tu pedido está listo para retirar'} · #${o.ref}`, html, texto: `${titulo}\n\n${texto}\n\nSeguí tu pedido: ${link}\n\n${site.store.name}`, tipo: paso, ref: o.ref };
}
function avisoEntrega(o, paso) {
  try { encolar(entregaAviso(o, paso)); } catch (err) { console.error('[correo]', err.message); }
}

// Mails de la cuenta del cliente: confirmar el email y crear una contraseña nueva
function cuentaMail(c, tipo, link) {
  const nombre = String(c.nombre || '').split(' ')[0];
  const site = sitio.cargar();
  const confirmar = tipo === 'confirmar';
  const titulo = confirmar ? `¡Hola, ${nombre}! Confirmá tu email` : 'Creá una contraseña nueva';
  const cuerpo = confirmar
    ? `<p style="margin:0">Creaste tu cuenta en ${esc(site.store.name)}. Confirmá que este email es tuyo y en "Mis compras" vas a ver también las compras que hiciste antes con él.</p>`
    : '<p style="margin:0">Pediste cambiar la contraseña de tu cuenta. El link vale por una hora. Si no fuiste vos, ignorá este mail: tu contraseña sigue igual.</p>';
  const html = marco({ previa: titulo, titulo, cuerpo: `${cuerpo}${boton(link, confirmar ? 'Confirmar mi email' : 'Crear una contraseña nueva')}`, pie: 'Recibiste este correo por tu cuenta en nuestra tienda online.<br>' });
  return { para: c.email, asunto: confirmar ? `Confirmá tu email · ${site.store.name}` : `Tu contraseña · ${site.store.name}`, html, texto: `${titulo}\n\n${link}\n\n${site.store.name}`, tipo: confirmar ? 'cuenta' : 'clave' };
}
function cuenta(c, tipo, link) {
  try { encolar(cuentaMail(c, tipo, link)); } catch (err) { console.error('[correo]', err.message); }
}

/* ---------- Lo que usan el resto de la tienda y el panel ---------- */
// Pago aprobado: correo al cliente y aviso a la tienda (una sola vez por pedido)
function compraAprobada(o) {
  try {
    encolar(compra(o));
    for (const para of CORREO.avisos) encolar(venta(o, para));
  } catch (err) {
    console.error('[correo]', err.message);
  }
}

// Ejemplo de cada correo, para verlo en el panel sin comprar
function ejemplo(tipo) {
  const site = sitio.cargar();
  const p = site.extras.find(x => !x.hidden) || site.products[0];
  const o = {
    ref: 'A1B2C3', version: 'historia', createdAt: new Date().toISOString(), method: 'mercadopago', plan: 1,
    product: { id: p.id, name: p.name }, productAmount: p.price || p.cuotas[12] * 12, coupon: 'xoxo-noviembre',
    envio: { tipo: 'andreani-domicilio', nombre: 'Andreani a domicilio', provincia: 'Catamarca', costo: 9500, dias: [2, 4] },
    delivery: { address: 'Calle Falsa 123', city: 'San Fernando del Valle', cp: '4700' },
    buyer: { name: 'Lorem Ipsum', email: 'cliente@example.com', phone: '3815123456', dni: '' },
    gateway: {},
  };
  o.amount = o.productAmount + o.envio.costo;
  return (tipo === 'venta' ? venta(o, 'ventas@xoxotecno.com.ar') : tipo === 'prueba' ? prueba('vos@example.com') : compra(o)).html;
}

async function probar(para) {
  if (!emailValido(para)) return { ok: false, error: 'Ese email no es válido.' };
  const m = { id: `prueba-${Date.now().toString(36)}`, ...prueba(para) };
  try {
    const r = await despachar(m);
    anotar({ id: m.id, tipo: 'prueba', para, asunto: m.asunto, estado: r.modo === 'vista' ? 'vista' : 'enviado', archivo: r.archivo, intentos: 1 });
    return { ok: true, modo: r.modo };
  } catch (err) {
    anotar({ id: m.id, tipo: 'prueba', para, asunto: m.asunto, estado: 'fallido', error: err.message, intentos: 1 });
    return { ok: false, error: err.message };
  }
}

function ultimos(n = 30) {
  try {
    return fs.readFileSync(ENVIADOS, 'utf8').trim().split('\n').slice(-n).reverse()
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function estado() {
  return {
    modo: configurado() ? 'smtp' : 'vista',
    de: CORREO.de || '', host: CORREO.host || '', avisos: CORREO.avisos,
    pendientes: leerCola().map(({ html, texto, ...m }) => m),
    ultimos: ultimos(),
  };
}

// Un correo guardado en modo vista previa, para abrirlo desde el panel
function vista(archivo) {
  if (!/^[\w-]+\.html$/.test(String(archivo || ''))) return null;
  try { return fs.readFileSync(path.join(VISTA, archivo), 'utf8'); } catch { return null; }
}

function lineaArranque() {
  return configurado() ? `Correo: SMTP ${CORREO.host}:${CORREO.port} como ${direccion(CORREO.de)}` : 'Correo: sin SMTP (los mails se guardan para verlos en el panel)';
}

// Reintentos pendientes (por ejemplo, después de reiniciar)
setInterval(() => procesar().catch(err => console.error('[correo]', err.message)), 60e3).unref();
setTimeout(() => procesar().catch(err => console.error('[correo]', err.message)), 5e3).unref();

module.exports = { configurado, compraAprobada, avisoEntrega, cuenta, encolar, procesar, probar, estado, ejemplo, vista, lineaArranque, armar, smtp, verificar, emailValido };
