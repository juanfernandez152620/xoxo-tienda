'use strict';
/* Chat "Cambios por IA" del panel: tu socio (o vos) le pide cambios a Claude y Claude contesta en el mismo chat.
 *
 * Cada mensaje es una línea de datos/chat/mensajes.jsonl:
 *   { id, at, rol: "equipo" | "claude", de: "Socio", texto, adjuntos?: ["/media/subidas/…"],
 *     audio?: "/media/subidas/audio-….webm", duracion?: segundos, transcripcion?: "lo que dijo" }
 * El panel escribe con POST /admin/api?r=/chat. Claude lee y contesta desde el servidor con deploy/chat.js.
 * datos/chat/estado.json guarda hasta qué mensaje vio Claude y si está escribiendo (el panel lo muestra).
 */
const fs = require('fs');
const crypto = require('crypto');
const { ruta, agregarLinea, ahoraIso, escribir, Problema } = require('./archivos');

const ARCHIVO = ruta('chat', 'mensajes.jsonl');
const ESTADO = ruta('chat', 'estado.json');
const ROLES = ['equipo', 'claude'];
const FOTO = /^\/media\/subidas\/([\w-]+\.(?:png|jpe?g|webp|gif))$/i;
const AUDIO = /^\/media\/subidas\/(audio-[\w-]+\.(?:webm|ogg|m4a))$/;

function leerTodos() {
  let text;
  try { text = fs.readFileSync(ARCHIVO, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m && m.id && ROLES.includes(m.rol)) out.push(m);
    } catch {}
  }
  return out;
}

/* ---------- Visto y escribiendo ---------- */
function leerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')) || {}; } catch { return {}; }
}
const guardarEstado = cambios => escribir(ESTADO, JSON.stringify({ ...leerEstado(), ...cambios }));
// Claude leyó todo lo que hay hasta ahora
function marcarVisto() {
  const todos = leerTodos();
  if (todos.length) guardarEstado({ visto: todos[todos.length - 1].id, vistoAt: ahoraIso() });
}
// "Claude está escribiendo…" en el panel por unos minutos (o hasta que contesta)
const escribiendo = (segundos = 300) => guardarEstado({ escribiendoHasta: new Date(Date.now() + segundos * 1000).toISOString() });
function estado() {
  const e = leerEstado();
  return { visto: e.visto || '', escribiendo: Boolean(e.escribiendoHasta && Date.parse(e.escribiendoHasta) > Date.now()) };
}

// Los mensajes después de `despues` (el último que ya tiene el panel). Si no lo encuentra, los últimos `max`
// con completo = true: el panel reemplaza lo que tenía.
function leer(despues, max = 300) {
  const todos = leerTodos();
  const i = despues ? todos.findIndex(m => m.id === despues) : -1;
  if (i >= 0) return { mensajes: todos.slice(i + 1), completo: false, estado: estado() };
  return { mensajes: todos.slice(-max), completo: true, estado: estado() };
}

// Lo que espera respuesta: todo lo que llegó después del último mensaje de Claude
function pendientes() {
  const todos = leerTodos();
  let i = todos.length;
  while (i > 0 && todos[i - 1].rol !== 'claude') i--;
  return todos.slice(i);
}

const nuevoId = () => `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

const limpiarTexto = s => String(s ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  .replace(/\n{4,}/g, '\n\n\n')
  .trim()
  .slice(0, 4000);

function agregar({ rol, de, texto, adjuntos, audio, duracion, transcripcion }) {
  if (!ROLES.includes(rol)) throw new Problema('Quién escribe no es válido.', 400);
  const t = limpiarTexto(texto);
  // Solo fotos que se subieron a la tienda (botón Foto del chat)
  const fotos = (Array.isArray(adjuntos) ? adjuntos : [])
    .map(String)
    .filter(u => { const m = u.match(FOTO); return m && fs.existsSync(ruta('subidas', m[1])); })
    .slice(0, 6);
  // Audio grabado en el chat (botón Grabar audio), con lo que se entendió si el navegador lo pudo pasar a texto
  const am = String(audio || '').match(AUDIO);
  const voz = am && fs.existsSync(ruta('subidas', am[1])) ? am[0] : '';
  if (!t && !fotos.length && !voz) throw new Problema('Escribí un mensaje, agregá una foto o grabá un audio.', 400);
  const nombre = String(de ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const m = {
    id: nuevoId(),
    at: ahoraIso(),
    rol,
    de: nombre || (rol === 'claude' ? 'Claude' : 'Equipo'),
    texto: t,
    ...(fotos.length ? { adjuntos: fotos } : {}),
    ...(voz ? {
      audio: voz,
      duracion: Math.max(0, Math.min(3600, Math.round(Number(duracion) || 0))),
      ...(limpiarTexto(transcripcion) ? { transcripcion: limpiarTexto(transcripcion) } : {}),
    } : {}),
  };
  agregarLinea(ARCHIVO, JSON.stringify(m));
  if (rol === 'claude') guardarEstado({ visto: m.id, vistoAt: m.at, escribiendoHasta: null });
  console.log(`[chat] Mensaje de ${m.de}${rol === 'claude' ? ' (respuesta)' : ''}`);
  return m;
}

module.exports = { ARCHIVO, leer, pendientes, agregar, marcarVisto, escribiendo, estado };
