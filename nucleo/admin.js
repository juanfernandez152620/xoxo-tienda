'use strict';
/* API del panel /admin. Todas las rutas van por ?r=, por ejemplo /admin/api?r=/estadisticas */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BACKUP_HORAS, DATOS, HTTPS, DETRAS_DE_PROXY } = require('./entorno');
const { Problema, asegurarCarpeta, leerJson, archivosJson, diaLocal, limite, limpiarLimite } = require('./archivos');
const sitio = require('./sitio');
const estadisticas = require('./estadisticas');
const reparto = require('./reparto');
const sesion = require('./sesion');
const pagos = require('./pagos');
const socio = require('./socio');
const chat = require('./chat');
const ia = require('./ia');
const correo = require('./correo');

const SUBIDAS = path.join(DATOS, 'subidas');
const MAX_FOTO = 8 * 1048576;
const MAX_VIDEO = 30 * 1048576;
const MAX_AUDIO = 15 * 1048576;

// Tipo real del archivo subido (por sus primeros bytes, no por el nombre)
function tipoDe(b) {
  if (b.length < 12) return null;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  return null;
}

// Audios grabados en el chat: WebM (Chrome, Android), Ogg (Firefox) o MP4/M4A (Safari, iPhone)
function tipoAudio(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (b.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (b.toString('latin1', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

function copiasInfo(dir) {
  return archivosJson(dir).map(name => {
    let st = null;
    try { st = fs.statSync(path.join(dir, name)); } catch {}
    return { name, size: st ? st.size : 0, date: st ? st.mtime.toISOString() : null };
  });
}

// h: { json, leerJson, leerCrudo, ip }
async function api(req, res, url, h) {
  const method = req.method;
  const ruta = `${method} ${url.searchParams.get('r') || ''}`;
  res.setHeader('X-Robots-Tag', 'noindex');

  if (method !== 'GET') {
    // Cambios solo desde el propio panel: el navegador manda Origin y el panel agrega X-TB
    const origin = req.headers.origin || '';
    let host = req.headers.host || '';
    if (origin) { try { host = new URL(origin).host; } catch { host = ''; } }
    if (host.toLowerCase() !== String(req.headers.host || '').toLowerCase() || req.headers['x-tb'] !== '1') {
      return h.json(403, { error: 'Origen no permitido' });
    }
  }

  if (ruta === 'POST /login') {
    const ip = h.ip;
    if (!limite('login', ip, 8, 900)) throw new Problema('Demasiados intentos. Esperá 15 minutos y probá de nuevo.', 429);
    const body = await h.leerJson(2000);
    if (!sesion.ingresar(body.user, body.password)) {
      console.error(`[admin] Intento de ingreso fallido desde ${ip}`);
      throw new Problema('Usuario o contraseña incorrectos.', 401);
    }
    limpiarLimite('login', ip);
    sesion.abrir(res);
    return h.json(200, { ok: true, user: sesion.config().usuario });
  }
  if (ruta === 'GET /sesion') {
    if (!sesion.esAdmin(req)) return h.json(401, { error: 'Sin sesión' });
    return h.json(200, { ok: true, user: sesion.config().usuario });
  }
  if (!sesion.esAdmin(req)) return h.json(401, { error: 'Tu sesión venció. Volvé a ingresar.' });
  sesion.estirar(req, res);

  switch (ruta) {
    case 'POST /logout':
      sesion.cerrar(res);
      return h.json(200, { ok: true });

    case 'GET /sitio':
      return h.json(200, sitio.cargar());

    case 'POST /sitio': {
      const body = await h.leerJson(2000000);
      return h.json(200, sitio.guardar(body.site, body.rev));
    }

    case 'POST /subir': {
      const data = await h.leerCrudo(MAX_VIDEO);
      const ext = tipoDe(data);
      if (!ext) throw new Problema('Solo se pueden subir fotos PNG, JPG, WEBP o GIF, o videos MP4.', 400);
      if (ext !== 'mp4' && data.length > MAX_FOTO) throw new Problema('La foto pesa más de 8 MB. Achicala y probá de nuevo.', 413);
      asegurarCarpeta(SUBIDAS);
      const name = `${diaLocal()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(SUBIDAS, name), data);
      return h.json(200, { url: `/media/subidas/${name}`, size: data.length });
    }

    case 'GET /estadisticas': {
      const s = estadisticas.sincronizar();
      return h.json(200, { ...estadisticas.resumen(s, pagos.leerPedidos()), reparto: reparto.resumen(s) });
    }

    case 'GET /reparto':
      return h.json(200, reparto.resumen(estadisticas.sincronizar()));

    case 'POST /estadisticas/recalcular': {
      const s = estadisticas.recalcular();
      return h.json(200, { ok: true, events: s.events });
    }

    case 'POST /estadisticas/reiniciar':
      estadisticas.reiniciar();
      reparto.reiniciar();
      return h.json(200, { ok: true });

    case 'GET /registro': {
      const days = estadisticas.archivosRegistro().map(f => f.slice(0, 10)).reverse();
      const pedido = url.searchParams.get('dia') || '';
      const day = /^\d{4}-\d{2}-\d{2}$/.test(pedido) ? pedido : days[0] || diaLocal();
      const type = url.searchParams.get('tipo') || '';
      const q = (url.searchParams.get('q') || '').trim();
      const all = estadisticas.leerRegistro(day).filter(e => {
        if (type && e.tipo !== type) return false;
        if (!q) return true;
        return ['ip', 'id', 'src', 'v', 'vid', 'suc'].some(k => String(e[k] || '').includes(q));
      });
      return h.json(200, { day, days, total: all.length, items: all.slice().reverse().slice(0, 500) });
    }

    case 'GET /registro/descargar': {
      const day = url.searchParams.get('dia') || '';
      const file = path.join(estadisticas.REGISTRO, `${day}.jsonl`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !fs.existsSync(file)) return h.json(404, { error: 'No hay registro de ese día' });
      const asJson = url.searchParams.get('formato') === 'json';
      res.writeHead(200, {
        'Content-Type': `${asJson ? 'application/json' : 'application/x-ndjson'}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="registro-${day}${asJson ? '.json' : '.jsonl'}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(asJson ? JSON.stringify(estadisticas.leerRegistro(day), null, 2) : fs.readFileSync(file));
    }

    case 'GET /backups':
      return h.json(200, { sitio: copiasInfo(sitio.COPIAS), estadisticas: copiasInfo(estadisticas.COPIAS), backupHours: BACKUP_HORAS });

    case 'POST /backups/restaurar': {
      const name = String((await h.leerJson(1000)).name || '');
      const file = path.join(sitio.COPIAS, name);
      if (!/^[\w.-]+\.json$/.test(name) || !fs.existsSync(file)) throw new Problema('No encontré esa copia', 404);
      return h.json(200, sitio.guardar(leerJson(file)));
    }

    case 'POST /backups/ahora':
      return h.json(200, { ok: true, name: estadisticas.copiaAhora() });

    case 'POST /clave': {
      const body = await h.leerJson(2000);
      sesion.cambiarClave(body.actual, body.nueva);
      sesion.abrir(res);
      return h.json(200, { ok: true });
    }

    // Seguimiento de un pedido: { id, paso: preparando | despachado | listo | entregado | cancelado | deshacer }
    case 'POST /pedidos/seguir': {
      const [status, data] = pagos.seguir(...(b => [b.id, b])(await h.leerJson(4000)));
      return h.json(status, data);
    }
    case 'POST /pedidos/nota': {
      const body = await h.leerJson(4000);
      const [status, data] = pagos.anotar(body.id, body.nota);
      return h.json(status, data);
    }

    case 'GET /clientes':
      return h.json(200, { clientes: require('./clientes').lista() });

    case 'GET /pedidos':
      return h.json(200, { pedidos: pagos.leerPedidos().slice().reverse(), config: pagos.configPublica(), pasarelas: pagos.estadoAdmin(), correo: correo.estado() });

    // Correos: un mail guardado (modo vista previa) o un ejemplo de cada uno, para verlo en otra pestaña
    case 'GET /correo/ver':
    case 'GET /correo/ejemplo': {
      const html = ruta.endsWith('ver') ? correo.vista(url.searchParams.get('archivo')) : correo.ejemplo(url.searchParams.get('tipo'));
      if (!html) return h.json(404, { error: 'No encontré ese correo' });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        // El mail se muestra como en un programa de correo: sin scripts ni pedidos a otros sitios
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src https: data:",
      });
      return res.end(html);
    }

    case 'POST /correo/probar': {
      if (!limite('probar-correo', h.ip, 10, 600)) throw new Problema('Demasiadas pruebas seguidas. Esperá unos minutos.', 429);
      const para = String((await h.leerJson(1000)).para || '').trim();
      return h.json(200, await correo.probar(para));
    }

    // Chat "Cambios por IA": el panel trae los mensajes nuevos cada pocos segundos
    case 'GET /chat':
      return h.json(200, { ...chat.leer(url.searchParams.get('despues') || ''), auto: ia.activo() });

    case 'POST /chat': {
      if (!limite('chat', h.ip, 40, 600)) throw new Problema('Mandaste muchos mensajes seguidos. Esperá unos minutos.', 429);
      const body = await h.leerJson(20000);
      const mensaje = chat.agregar({
        rol: 'equipo', de: body.de, texto: body.texto, adjuntos: body.adjuntos,
        audio: body.audio, duracion: body.duracion, transcripcion: body.transcripcion,
      });
      ia.avisar(); // si hay clave de Claude, contesta solo en unos segundos
      return h.json(200, { mensaje });
    }

    case 'POST /chat/audio': {
      if (!limite('chat-audio', h.ip, 30, 600)) throw new Problema('Mandaste muchos audios seguidos. Esperá unos minutos.', 429);
      const data = await h.leerCrudo(MAX_AUDIO);
      const ext = tipoAudio(data);
      if (!ext) throw new Problema('No se pudo guardar el audio: el formato no se reconoce.', 400);
      asegurarCarpeta(SUBIDAS);
      const name = `audio-${diaLocal()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(SUBIDAS, name), data);
      return h.json(200, { url: `/media/subidas/${name}`, size: data.length });
    }

    case 'POST /pagos/link-prueba': {
      if (!limite('link-prueba', h.ip, 10, 600)) throw new Problema('Demasiados links seguidos. Esperá unos minutos.', 429);
      const [status, data] = await pagos.linkPrueba(await h.leerJson(1000));
      return h.json(status, data);
    }

    case 'POST /pagos/probar':
      if (!limite('probar-pagos', h.ip, 20, 600)) throw new Problema('Demasiadas pruebas seguidas. Esperá unos minutos.', 429);
      return h.json(200, await pagos.probar());

    case 'GET /servidor': {
      const escribe = dir => { try { asegurarCarpeta(dir); fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } };
      const now = new Date();
      return h.json(200, {
        node: process.version,
        uploadLimit: MAX_VIDEO,
        dataOutside: true,
        dataWritable: escribe(DATOS),
        uploadsWritable: escribe(SUBIDAS),
        https: HTTPS,
        proxy: DETRAS_DE_PROXY,
        ip: h.ip,
        user: sesion.config().usuario,
        backupHours: BACKUP_HORAS,
        timezone: process.env.TZ,
        socio: socio.estado(),
        now: `${diaLocal(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      });
    }
    default:
      return h.json(404, { error: 'No encontrado' });
  }
}

module.exports = { api, SUBIDAS };
