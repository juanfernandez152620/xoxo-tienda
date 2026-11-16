#!/usr/bin/env node
'use strict';
/* Lee y contesta el chat "Cambios por IA" del panel. Lo usa Claude desde la computadora del dueño:
 *
 *   ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js'              lo que espera respuesta
 *   ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js todo 30'      los últimos 30 mensajes
 *   ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js escribiendo'  "Claude está escribiendo…" (5 min)
 *   ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js responder' < texto.txt
 *
 * Leer los mensajes los marca como "Visto por Claude" en el panel.
 *
 * La respuesta se escribe por la entrada estándar (así no hay problemas con comillas ni saltos de línea) y aparece
 * en el chat del panel en unos segundos. En la computadora sirve igual, con la carpeta de datos del .env:
 *   node deploy/chat.js
 */
const fs = require('fs');

// En el VPS los ajustes están en /etc/xoxo-tienda.env (el usuario xoxo lo puede leer)
const AJUSTES = '/etc/xoxo-tienda.env';
if (!process.env.DATOS && fs.existsSync(AJUSTES)) {
  for (const line of fs.readFileSync(AJUSTES, 'utf8').split('\n')) {
    const m = line.match(/^\s*(DATOS|ZONA_HORARIA|BASE_URL)\s*=\s*"?(.*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
  // Si root crea la carpeta del chat, la tienda (usuario xoxo) después no puede escribir en ella
  if (process.getuid && process.getuid() === 0) {
    console.error('Corré esto como el usuario de la tienda: sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js …');
    process.exit(1);
  }
}

const { BASE_URL } = require('../nucleo/entorno');
const chat = require('../nucleo/chat');

const fecha = iso => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function mostrar(lista) {
  for (const m of lista) {
    console.log(`\n[${fecha(m.at)}] ${m.rol === 'claude' ? 'Claude' : m.de}${m.rol === 'claude' && m.de !== 'Claude' ? ` (${m.de})` : ''}:`);
    if (m.texto) console.log(m.texto.replace(/^/gm, '  '));
    for (const u of m.adjuntos || []) console.log(`  [foto] ${BASE_URL}${u}`);
    if (m.audio) {
      const d = m.duracion || 0;
      console.log(`  [audio ${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}] ${BASE_URL}${m.audio}`);
      console.log(m.transcripcion ? `  Transcripción: ${m.transcripcion}` : '  (sin transcripción: el navegador no lo pudo pasar a texto)');
    }
  }
}

const [cmd = 'pendientes', arg] = process.argv.slice(2);

if (cmd === 'pendientes') {
  const lista = chat.pendientes();
  if (!lista.length) console.log('No hay mensajes esperando respuesta.');
  else {
    console.log(`${lista.length} ${lista.length === 1 ? 'mensaje espera' : 'mensajes esperan'} respuesta:`);
    mostrar(lista);
  }
  chat.marcarVisto();
} else if (cmd === 'escribiendo') {
  chat.escribiendo(Math.max(10, Math.min(1800, Number(arg) || 300)));
  console.log('En el panel se ve "Claude está escribiendo…".');
} else if (cmd === 'todo') {
  const n = Math.max(1, Math.min(500, Number(arg) || 20));
  const { mensajes } = chat.leer('', n);
  if (!mensajes.length) console.log('El chat está vacío.');
  mostrar(mensajes);
  chat.marcarVisto();
} else if (cmd === 'responder') {
  let texto = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => (texto += d));
  process.stdin.on('end', () => {
    try {
      const m = chat.agregar({ rol: 'claude', de: 'Claude', texto });
      console.log(`Enviado al chat (${m.texto.length} caracteres).`);
    } catch (err) {
      console.error(`No se pudo enviar: ${err.message}`);
      process.exitCode = 1;
    }
  });
} else {
  console.error('Uso: node deploy/chat.js [pendientes | todo N | escribiendo [segundos] | responder < texto]');
  process.exitCode = 1;
}
