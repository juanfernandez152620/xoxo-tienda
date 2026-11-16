'use strict';
/* WhatsApp del socio (etapa 5): recibe sus mensajes por la API de WhatsApp Business de Meta.
 *
 * Por ahora prueba la conexión: anota cada mensaje en datos/socio/mensajes.jsonl y le contesta que llegó.
 * El paso siguiente es que Claude lea esos pedidos, prepare el cambio con vista previa y lo publique cuando el socio
 * confirme.
 *
 * Seguridad: Meta firma cada aviso con la clave secreta de la app (X-Hub-Signature-256) y se atiende solo a los
 * números de SOCIO_NUMEROS. Los demás se descartan sin contestar.
 */
const crypto = require('crypto');
const { WA, BASE_URL } = require('./entorno');
const { ruta, agregarLinea, ahoraIso } = require('./archivos');

const MENSAJES = ruta('socio', 'mensajes.jsonl');
const configurado = () => Boolean(WA.token && WA.phoneId && WA.appSecret && WA.verifyToken);

// SOCIO_NUMEROS=Juan:3815616404,Socio:3811234567 → se compara por los últimos 10 dígitos (característica + número)
const ultimos10 = s => String(s || '').replace(/\D/g, '').slice(-10);
const autorizados = () => WA.numeros.split(',').map(x => {
  const [nombre, num] = x.split(':');
  return { nombre: String(nombre || '').trim() || 'Socio', num: ultimos10(num) };
}).filter(a => a.num.length === 10);
const quien = waId => autorizados().find(a => a.num === ultimos10(waId)) || null;

const enmascarar = n => `…${String(n).slice(-4)}`;
let ultimoMensaje = null;
let ultimoError = null;
function anotarError(msg) {
  ultimoError = { at: ahoraIso(), msg };
  console.error(`[socio] ${msg}`);
}

/* ---------- Verificación de Meta ---------- */
const igual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Al guardar el webhook en Meta: GET con hub.verify_token, que tiene que coincidir con WA_VERIFY_TOKEN
function verificar(url) {
  const q = k => url.searchParams.get(k) || '';
  if (!WA.verifyToken) return [403, 'Falta cargar WA_VERIFY_TOKEN en el servidor (xoxo-claves)'];
  if (q('hub.mode') === 'subscribe' && igual(q('hub.verify_token'), WA.verifyToken)) {
    console.log('[socio] Meta verificó el webhook de WhatsApp');
    return [200, q('hub.challenge')];
  }
  return [403, 'Token de verificación incorrecto'];
}

function firmaValida(raw, firma) {
  if (!WA.appSecret || !firma) return false;
  return igual(`sha256=${crypto.createHmac('sha256', WA.appSecret).update(raw).digest('hex')}`, firma);
}

/* ---------- Enviar ---------- */
const prueba = () => crypto.createHmac('sha256', WA.appSecret).update(WA.token).digest('hex');
async function llamar(payload) {
  const res = await fetch(`${WA.api}/${encodeURIComponent(WA.phoneId)}/messages?appsecret_proof=${prueba()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error || (res.ok ? null : { message: `HTTP ${res.status}` }) };
}

// Celulares de Argentina: Meta avisa desde 549XXXXXXXXXX, pero a veces solo acepta contestar en otro formato
// (sin el 9, o con el 15 después de la característica). Se prueba en orden y se recuerda el que anduvo.
function formatos(waId) {
  const out = [waId];
  const m = String(waId).match(/^549(\d{10})$/);
  if (m) {
    const n = m[1];
    out.push(`54${n}`, ...[2, 3, 4].map(k => `54${n.slice(0, k)}15${n.slice(k)}`));
  }
  return out;
}
const formatoBueno = new Map();

async function enviar(waId, texto) {
  const lista = formatoBueno.has(waId) ? [formatoBueno.get(waId)] : formatos(waId);
  let error = null;
  for (const to of lista) {
    const r = await llamar({ recipient_type: 'individual', to, type: 'text', text: { body: texto.slice(0, 4000), preview_url: false } });
    if (r.ok) {
      if (!formatoBueno.has(waId) && to !== waId) console.log(`[socio] WhatsApp acepta ${enmascarar(waId)} con el formato ${to.slice(0, 4)}…`);
      formatoBueno.set(waId, to);
      return true;
    }
    error = r.error;
    if (error.code !== 131030) break; // otro formato solo si Meta dice que ese número no está en la lista permitida
  }
  anotarError(`No se pudo contestar por WhatsApp a ${enmascarar(waId)}: ${error.message || error.code}`);
  return false;
}

/* ---------- Recibir ---------- */
const vistos = new Set(); // Meta reintenta los avisos: cada mensaje se atiende una sola vez
const QUE = { image: 'una foto', video: 'un video', audio: 'un audio', document: 'un archivo', sticker: 'un sticker', location: 'una ubicación' };

function textoDe(m) {
  if (m.type === 'text') return (m.text && m.text.body) || '';
  if (m.type === 'button') return (m.button && m.button.text) || '';
  if (m.type === 'interactive') {
    const i = m.interactive || {};
    return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '';
  }
  return (m[m.type] && m[m.type].caption) || '';
}

async function atender(m) {
  if (!m.id || vistos.has(m.id)) return;
  vistos.add(m.id);
  if (vistos.size > 1000) vistos.delete(vistos.values().next().value);

  const socio = quien(m.from);
  if (!socio) return void console.log(`[socio] Mensaje de un número no autorizado (${enmascarar(m.from)}): no se contesta`);

  const texto = textoDe(m).slice(0, 4000);
  const media = m[m.type] && m[m.type].id ? { tipo: m.type, id: m[m.type].id, mime: m[m.type].mime_type || '' } : null;
  agregarLinea(MENSAJES, JSON.stringify({
    at: ahoraIso(), id: m.id, de: socio.nombre, wa: m.from, tipo: m.type, texto, ...(media ? { media } : {}),
  }));
  ultimoMensaje = { at: ahoraIso(), de: socio.nombre };
  console.log(`[socio] Mensaje de ${socio.nombre} (${m.type})`);

  llamar({ status: 'read', message_id: m.id }).catch(() => {}); // los dos tildes azules
  const recibido = texto ? `"${texto.length > 300 ? `${texto.slice(0, 300)}…` : texto}"` : (QUE[m.type] || 'tu mensaje');
  await enviar(m.from, `Hola ${socio.nombre}! Me llegó ${texto ? 'tu mensaje' : recibido}${texto ? `:\n${recibido}` : ''}\n\n`
    + 'La conexión con la tienda funciona ✅. Todavía no hago cambios: eso se suma en el próximo paso.');
}

async function procesar(raw) {
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return; }
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      // Los avisos de prueba del panel de Meta traen otro número de la tienda: se ignoran
      if (ch.field !== 'messages' || !v.metadata || String(v.metadata.phone_number_id) !== WA.phoneId) continue;
      for (const st of v.statuses || []) {
        if (st.status === 'failed') {
          const e = (st.errors || [])[0] || {};
          anotarError(`WhatsApp no pudo entregar un mensaje a ${enmascarar(st.recipient_id)}: ${e.title || e.message || e.code || 'sin detalle'}`);
        }
      }
      for (const m of v.messages || []) {
        try { await atender(m); } catch (err) { anotarError(err.message); }
      }
    }
  }
}

const estado = () => ({
  configurado: configurado(),
  webhook: `${BASE_URL}/api/socio/whatsapp`,
  autorizados: autorizados().map(a => a.nombre),
  ultimoMensaje,
  ultimoError,
});

module.exports = { configurado, verificar, firmaValida, procesar, estado };
