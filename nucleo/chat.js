'use strict';
/* Chat "Cambios por IA" del panel: tu socio (o vos) le pide cambios a Claude y Claude contesta en el mismo chat.
 *
 * Cada mensaje es una línea de datos/chat/mensajes.jsonl:
 *   { id, at, rol: "equipo" | "claude", de: "Socio", texto, adjuntos?: ["/media/subidas/…"],
 *     audio?: "/media/subidas/audio-….webm", duracion?: segundos, transcripcion?: "lo que dijo" }
 * El panel escribe con POST /admin/api?r=/chat. Claude lee y contesta desde el servidor con deploy/chat.js.
 */
const fs = require('fs');
const crypto = require('crypto');
const { ruta, agregarLinea, ahoraIso, Problema } = require('./archivos');

const ARCHIVO = ruta('chat', 'mensajes.jsonl');
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

// Los mensajes después de `despues` (el último que ya tiene el panel). Si no lo encuentra, los últimos `max`
// con completo = true: el panel reemplaza lo que tenía.
function leer(despues, max = 300) {
  const todos = leerTodos();
  const i = despues ? todos.findIndex(m => m.id === despues) : -1;
  if (i >= 0) return { mensajes: todos.slice(i + 1), completo: false };
  return { mensajes: todos.slice(-max), completo: true };
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
  console.log(`[chat] Mensaje de ${m.de}${rol === 'claude' ? ' (respuesta)' : ''}`);
  return m;
}

module.exports = { ARCHIVO, leer, pendientes, agregar };
