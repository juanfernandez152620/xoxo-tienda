#!/usr/bin/env node
'use strict';
/* Carga las claves de la tienda en el VPS sin que pasen por el chat ni por GitHub: Mercado Pago, GO cuotas,
 * el pago simulado y el WhatsApp del socio.
 *
 *   ssh -t xoxo-vps xoxo-claves
 *
 * En el servidor está instalado en /usr/local/bin/xoxo-claves (esta es la copia de referencia) y corre como root.
 * Cada clave se prueba contra la pasarela antes de guardarla: si no anda, no se guarda. Al guardar deja una copia
 * del archivo anterior (/etc/xoxo-tienda.env.anterior) y reinicia la tienda.
 *
 * En la computadora sirve para el .env de prueba: node deploy/claves.js .env
 * No usa archivos del repositorio a propósito: root no ejecuta código que se pueda cambiar con un push.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ARCHIVO = path.resolve(process.argv[2] || '/etc/xoxo-tienda.env');
const EN_SERVIDOR = ARCHIVO === '/etc/xoxo-tienda.env';
const SERVICIO = 'xoxo-tienda';
const TTY = Boolean(process.stdin.isTTY);

/* ---------- Archivo de ajustes ---------- */
// Comentario que encabeza cada grupo la primera vez que se agrega al archivo
const GRUPOS = [
  { claves: ['MP_ACCESS_TOKEN'], titulo: '# Mercado Pago: Access Token (lo carga xoxo-claves)' },
  { claves: ['GOCUOTAS_EMAIL', 'GOCUOTAS_PASSWORD', 'GOCUOTAS_SANDBOX'], titulo: '# GO cuotas: usuario de sucursal con la API Redirect V1 (lo carga xoxo-claves)' },
  { claves: ['PAGOS_DEMO'], titulo: '# true = los medios sin clave muestran un pago simulado que no cobra' },
  { claves: ['WA_PHONE_ID', 'WA_TOKEN', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'SOCIO_NUMEROS'], titulo: '# WhatsApp del socio: API de WhatsApp Business de Meta (lo carga xoxo-claves)' },
];

function desenvolver(v) {
  if (v.length >= 2 && v[0] === '"' && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (v.length >= 2 && v[0] === "'" && v.endsWith("'")) return v.slice(1, -1);
  return v;
}
// Entre comillas dobles cuando hace falta (systemd y la tienda las leen igual)
const envolver = v => (/^[\w@.:,/+=-]*$/.test(v) ? v : `"${v.replace(/(["\\])/g, '\\$1')}"`);

function leerArchivo() {
  const text = fs.existsSync(ARCHIVO) ? fs.readFileSync(ARCHIVO, 'utf8') : '';
  const lineas = text.split(/\r?\n/);
  if (lineas[lineas.length - 1] === '') lineas.pop();
  const valores = {};
  for (const l of lineas) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) valores[m[1]] = desenvolver(m[2]);
  }
  return { lineas, valores };
}

function escribirArchivo(lineas, cambios) {
  const faltan = new Map(Object.entries(cambios));
  const out = lineas.map(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!m || !faltan.has(m[1])) return l;
    const v = faltan.get(m[1]);
    faltan.delete(m[1]);
    return `${m[1]}=${envolver(v)}`;
  });
  for (const g of GRUPOS) {
    const nuevas = g.claves.filter(k => faltan.has(k));
    if (!nuevas.length) continue;
    out.push('', g.titulo, ...nuevas.map(k => `${k}=${envolver(faltan.get(k))}`));
    nuevas.forEach(k => faltan.delete(k));
  }
  for (const [k, v] of faltan) out.push(`${k}=${envolver(v)}`);

  // Mismo dueño y permisos que el original (en el VPS: root:xoxo 640), copia del anterior y cambio atómico
  const st = fs.existsSync(ARCHIVO) ? fs.statSync(ARCHIVO) : null;
  const igualar = file => {
    fs.chmodSync(file, st ? st.mode & 0o777 : 0o600);
    if (st && process.getuid && process.getuid() === 0) fs.chownSync(file, st.uid, st.gid);
  };
  if (st) {
    fs.copyFileSync(ARCHIVO, `${ARCHIVO}.anterior`);
    igualar(`${ARCHIVO}.anterior`);
  }
  const tmp = `${ARCHIVO}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, out.join('\n') + '\n', { mode: 0o600 });
  igualar(tmp);
  fs.renameSync(tmp, ARCHIVO);
}

/* ---------- Teclado: lo que se pega como clave no se ve en pantalla ---------- */
const cola = [];
let avisar = null;
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { cola.push(...d); if (avisar) avisar(); });
process.stdin.on('end', () => { cola.push('\u0004'); if (avisar) avisar(); });
if (TTY) process.stdin.setRawMode(true);

function salir(code) {
  if (TTY) process.stdin.setRawMode(false);
  // Sin process.exit: el programa termina solo al cerrar el teclado (en Windows, exit con la entrada abierta se cuelga)
  process.exitCode = code;
  process.stdin.destroy();
}

function preguntar(texto, { oculto = false } = {}) {
  process.stdout.write(texto);
  let valor = '';
  let esc = 0; // 1 = vino ESC, 2 = dentro de una secuencia ESC [ … (flechas, pegado)
  return new Promise(resolve => {
    const seguir = () => {
      while (cola.length) {
        const ch = cola.shift();
        if (esc === 1) { esc = ch === '[' ? 2 : ch === 'O' ? 3 : 0; continue; }
        if (esc === 3) { esc = 0; continue; }
        if (esc === 2) { if (ch >= '@' && ch <= '~') esc = 0; continue; }
        if (ch === '\u001b') { esc = 1; continue; }
        if (ch === '\u0003' || (ch === '\u0004' && !valor)) {
          process.stdout.write('\nSalí sin guardar.\n');
          return salir(1);
        }
        if (ch === '\u0004') continue;
        if (ch === '\r' || ch === '\n') {
          if (ch === '\r' && cola[0] === '\n') cola.shift();
          avisar = null;
          process.stdout.write(oculto && valor ? `  (${valor.length} caracteres)\n` : '\n');
          return resolve(valor.trim());
        }
        if (ch === '\u007f' || ch === '\b') {
          if (valor) {
            valor = [...valor].slice(0, -1).join('');
            if (TTY) process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;
        valor += ch;
        if (TTY) process.stdout.write(oculto ? '•' : ch);
      }
      avisar = seguir;
    };
    seguir();
  });
}
const siNo = async texto => /^s/i.test(await preguntar(`${texto} (s/n) `));

/* ---------- Pruebas contra cada servicio (las mismas consultas que usa la tienda) ---------- */
const conTiempo = (url, opciones = {}) => fetch(url, { ...opciones, signal: AbortSignal.timeout(15000) });
const fallo = err => ({ ok: false, error: `no se pudo conectar (${err.cause ? err.cause.code || err.cause.message : err.message})` });

async function probarMp(token) {
  try {
    const res = await conTiempo('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: res.status === 401 ? 'Mercado Pago dice que la clave no es válida' : `Mercado Pago respondió con un error (${res.status})` };
    const prueba = token.startsWith('TEST-') || (Array.isArray(d.tags) && d.tags.includes('test_user')) || /^TEST/i.test(d.nickname || '');
    return { ok: true, cuenta: d.nickname || String(d.id || ''), prueba, pais: d.site_id || '' };
  } catch (err) { return fallo(err); }
}

async function probarGo(email, password, sandbox) {
  const base = sandbox ? 'https://sandbox.gocuotas.com' : 'https://www.gocuotas.com';
  try {
    const res = await conTiempo(`${base}/api_redirect/v1/authentication?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`, {
      method: 'POST', headers: { Accept: 'application/json' },
    });
    const d = await res.json().catch(() => ({}));
    const token = d.token || d.access_token || d.auth_token || (d.data && d.data.token);
    if (!res.ok || !token) return { ok: false, error: `GO cuotas no aceptó el usuario${d.message || d.error ? `: ${d.message || d.error}` : ''} (${res.status})` };
    return { ok: true };
  } catch (err) { return fallo(err); }
}

async function probarWa(v) {
  const api = `${(v.WA_API_URL || 'https://graph.facebook.com').replace(/\/+$/, '')}/${v.WA_API_VERSION || 'v23.0'}`;
  // appsecret_proof: así Meta confirma el token y la clave secreta de la app en la misma consulta
  const proof = crypto.createHmac('sha256', v.WA_APP_SECRET).update(v.WA_TOKEN).digest('hex');
  try {
    const res = await conTiempo(`${api}/${encodeURIComponent(v.WA_PHONE_ID)}?fields=display_phone_number,verified_name&appsecret_proof=${proof}`, {
      headers: { Authorization: `Bearer ${v.WA_TOKEN}` },
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Meta respondió: ${(d.error && d.error.message) || res.status}` };
    return { ok: true, numero: `${d.display_phone_number || '?'}${d.verified_name ? ` (${d.verified_name})` : ''}` };
  } catch (err) { return fallo(err); }
}

/* ---------- Estado ---------- */
const enmascarar = t => (t ? `${t.slice(0, t.startsWith('APP_USR-') ? 8 : t.startsWith('TEST-') ? 5 : 4)}…${t.slice(-4)}` : '');
const nombres = s => String(s || '').split(',').map(x => x.split(':')[0].trim()).filter(Boolean);
const listo = v => ({
  mp: Boolean(v.MP_ACCESS_TOKEN),
  go: Boolean(v.GOCUOTAS_EMAIL && v.GOCUOTAS_PASSWORD),
  wa: Boolean(v.WA_TOKEN && v.WA_PHONE_ID && v.WA_APP_SECRET),
});

function resumen(v, probado, cambios) {
  const l = listo(v);
  const mp = l.mp ? `${enmascarar(v.MP_ACCESS_TOKEN)}${probado.mp ? ` · cuenta ${probado.mp.cuenta}${probado.mp.prueba ? ' de PRUEBA' : ' REAL'}` : ''}` : 'sin cargar';
  const go = l.go ? `${v.GOCUOTAS_EMAIL}${v.GOCUOTAS_SANDBOX === 'true' ? ' · sandbox (prueba)' : ' · REAL'}` : 'sin cargar';
  const demo = v.PAGOS_DEMO === 'true'
    ? `prendido${l.mp && l.go ? ' (no se usa: los dos medios tienen clave)' : ': los medios sin clave muestran un pago de prueba'}`
    : `apagado${l.mp || l.go ? '' : ': sin claves, la tienda queda solo con WhatsApp'}`;
  const wa = l.wa ? `cargado · autorizados: ${nombres(v.SOCIO_NUMEROS).join(', ') || 'nadie todavía'}` : 'sin cargar';
  const n = Object.keys(cambios).length;
  console.log(`
Claves de la tienda XOXO Tecno · ${ARCHIVO}

  1) Mercado Pago     ${mp}
  2) GO cuotas        ${go}
  3) Pago simulado    ${demo}
  4) WhatsApp socio   ${wa}
  5) Probar todo lo cargado

  g) Guardar${EN_SERVIDOR ? ' y reiniciar la tienda' : ''}    s) Salir sin guardar${n ? `\n\n  Hay ${n} ${n === 1 ? 'cambio' : 'cambios'} sin guardar.` : ''}
`);
}

/* ---------- Secciones ---------- */
const AYUDA_VACIO = 'Enter solo = dejar lo que está · un guion (-) = borrarlo.';

async function seccionMp(v, set, probado) {
  console.log(`
Mercado Pago · Access Token
  mercadopago.com.ar/developers → Tus integraciones → tu aplicación.
  Para probar sin cobrar: "Credenciales de prueba" (las de la cuenta vendedora de prueba).
  Para cobrar de verdad: "Credenciales de producción".
  Pegalo y apretá Enter: en pantalla solo se ven puntos. ${AYUDA_VACIO}`);
  const t = await preguntar('Access Token: ', { oculto: true });
  if (!t) return;
  if (t === '-') { set('MP_ACCESS_TOKEN', ''); delete probado.mp; return console.log('Se borra al guardar.'); }
  if (/\s/.test(t) || t.length < 20) return console.log('Eso no parece un Access Token. No lo guardo.');
  process.stdout.write('Probando con Mercado Pago… ');
  const r = await probarMp(t);
  if (!r.ok) return console.log(`no anduvo: ${r.error}. No lo guardo.`);
  console.log(`anda. Cuenta ${r.cuenta}${r.pais && r.pais !== 'MLA' ? ` (OJO: es de ${r.pais}, no de Argentina)` : ''}.`);
  console.log(r.prueba ? '  Es una cuenta DE PRUEBA: los pagos no cobran de verdad.' : '  Es una cuenta REAL: los pagos van a cobrar de verdad.');
  if (!r.prueba && !(await siNo('¿La guardo igual?'))) return;
  set('MP_ACCESS_TOKEN', t);
  probado.mp = r;
}

async function seccionGo(v, set) {
  console.log(`
GO cuotas · usuario de sucursal
  Se crea en el panel de GO cuotas → Otros → Sucursales → Nueva. Para que funcione, integraciones@gocuotas.com
  tiene que habilitar la "API Redirect V1" en esa sucursal. Para probar, pediles un usuario del sandbox.
  ${AYUDA_VACIO}`);
  const email = await preguntar(`Email${v.GOCUOTAS_EMAIL ? ` [${v.GOCUOTAS_EMAIL}]` : ''}: `);
  if (email === '-') {
    set('GOCUOTAS_EMAIL', '');
    set('GOCUOTAS_PASSWORD', '');
    return console.log('Se borra al guardar.');
  }
  const nuevoEmail = email || v.GOCUOTAS_EMAIL;
  if (!nuevoEmail) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoEmail)) return console.log('Ese email no parece válido. No lo guardo.');
  const pass = (await preguntar('Contraseña: ', { oculto: true })) || v.GOCUOTAS_PASSWORD;
  if (!pass) return console.log('Falta la contraseña. No lo guardo.');
  const sandbox = await siNo('¿Es un usuario de prueba (sandbox.gocuotas.com)?');
  process.stdout.write(`Probando con GO cuotas${sandbox ? ' (sandbox)' : ''}… `);
  const r = await probarGo(nuevoEmail, pass, sandbox);
  if (!r.ok) return console.log(`no anduvo: ${r.error}. No lo guardo.`);
  console.log(sandbox ? 'anda. Es de prueba: no cobra de verdad.' : 'anda. Es REAL: los pagos van a cobrar de verdad.');
  set('GOCUOTAS_EMAIL', nuevoEmail);
  set('GOCUOTAS_PASSWORD', pass);
  set('GOCUOTAS_SANDBOX', sandbox ? 'true' : 'false');
}

async function seccionDemo(v, set) {
  console.log(`
Pago simulado
  Prendido: el medio que todavía no tiene clave muestra una pantalla de pago de prueba que no cobra.
  Apagado: ese medio no aparece. Si ninguno tiene clave, la tienda queda solo con WhatsApp.
  Antes de abrir la tienda al público conviene apagarlo.`);
  set('PAGOS_DEMO', (await siNo('¿Lo dejo prendido?')) ? 'true' : 'false');
}

function leerNumeros(texto) {
  const lista = [];
  for (const parte of texto.split(',')) {
    const digitos = parte.replace(/\D/g, '');
    if (!digitos) continue;
    if (digitos.length < 10) return { error: `"${parte.trim()}" tiene pocos números: poné la característica (ej: 381 5616404).` };
    const nombre = parte.replace(/[\d+()-]/g, ' ').replace(/[:=]/g, ' ').trim().replace(/\s+/g, ' ') || `Número ${lista.length + 1}`;
    lista.push(`${nombre.slice(0, 30)}:${digitos}`);
  }
  return { valor: lista.join(',') };
}

async function seccionWa(v, set) {
  console.log(`
WhatsApp del socio · API de WhatsApp Business de Meta
  Todo sale de developers.facebook.com → tu app → WhatsApp → Configuración de la API, salvo la clave secreta
  (Configuración de la app → Básica) y el token permanente (usuario del sistema en business.facebook.com).
  ${AYUDA_VACIO}`);
  const id = await preguntar(`Identificador del número de teléfono${v.WA_PHONE_ID ? ` [${v.WA_PHONE_ID}]` : ''}: `);
  if (id === '-') {
    ['WA_PHONE_ID', 'WA_TOKEN', 'WA_APP_SECRET'].forEach(k => set(k, ''));
    return console.log('Se borra al guardar.');
  }
  if (id && !/^\d{6,20}$/.test(id)) return console.log('El identificador son solo números. No lo guardo.');
  const token = await preguntar(`Token permanente${v.WA_TOKEN ? ` [${enmascarar(v.WA_TOKEN)}]` : ''}: `, { oculto: true });
  const secreto = await preguntar(`Clave secreta de la app${v.WA_APP_SECRET ? ' [cargada]' : ''}: `, { oculto: true });
  const actual = v.SOCIO_NUMEROS ? v.SOCIO_NUMEROS.replace(/:/g, ' ').replace(/,/g, ', ') : '';
  console.log('Números que pueden escribirle, con nombre y separados por coma (ej: Juan 3815616404, Socio 3811234567).');
  const nums = await preguntar(`Números autorizados${actual ? ` [${actual}]` : ''}: `);

  const nuevo = {
    WA_PHONE_ID: id || v.WA_PHONE_ID || '',
    WA_TOKEN: token || v.WA_TOKEN || '',
    WA_APP_SECRET: secreto || v.WA_APP_SECRET || '',
    WA_API_URL: v.WA_API_URL, WA_API_VERSION: v.WA_API_VERSION,
  };
  let numeros = v.SOCIO_NUMEROS || '';
  if (nums === '-') numeros = '';
  else if (nums) {
    const r = leerNumeros(nums);
    if (r.error) return console.log(`${r.error} No guardo nada de WhatsApp.`);
    numeros = r.valor;
  }
  if (!nuevo.WA_PHONE_ID || !nuevo.WA_TOKEN || !nuevo.WA_APP_SECRET) {
    return console.log('Faltan datos: hacen falta el identificador, el token y la clave secreta. No guardo nada de WhatsApp.');
  }
  process.stdout.write('Probando con Meta… ');
  const r = await probarWa(nuevo);
  if (!r.ok) return console.log(`no anduvo: ${r.error}. No guardo nada de WhatsApp.`);
  console.log(`anda. Número de la tienda: ${r.numero}.`);
  ['WA_PHONE_ID', 'WA_TOKEN', 'WA_APP_SECRET'].forEach(k => { if (nuevo[k] !== v[k]) set(k, nuevo[k]); });
  if (numeros !== (v.SOCIO_NUMEROS || '')) set('SOCIO_NUMEROS', numeros);
  if (!v.WA_VERIFY_TOKEN) set('WA_VERIFY_TOKEN', crypto.randomBytes(18).toString('base64url'));
  if (!numeros) console.log('Ojo: sin números autorizados no le contesta a nadie.');
  console.log(`
Para Meta → WhatsApp → Configuración → Webhook → Editar (después de guardar acá):
  URL de devolución de llamada:  ${(v.BASE_URL || 'https://tu-tienda').replace(/\/+$/, '')}/api/socio/whatsapp
  Token de verificación:         ${v.WA_VERIFY_TOKEN}
  Y en "Campos del webhook" suscribite a: messages`);
}

async function probarTodo(v, probado) {
  const l = listo(v);
  if (!l.mp && !l.go && !l.wa) return console.log('\nTodavía no hay nada cargado para probar.');
  console.log('');
  if (l.mp) {
    const r = await probarMp(v.MP_ACCESS_TOKEN);
    if (r.ok) probado.mp = r;
    console.log(`Mercado Pago   ${r.ok ? `anda · cuenta ${r.cuenta}${r.prueba ? ' de PRUEBA' : ' REAL'}` : r.error}`);
  }
  if (l.go) {
    const r = await probarGo(v.GOCUOTAS_EMAIL, v.GOCUOTAS_PASSWORD, v.GOCUOTAS_SANDBOX === 'true');
    console.log(`GO cuotas      ${r.ok ? `anda${v.GOCUOTAS_SANDBOX === 'true' ? ' · sandbox' : ' · REAL'}` : r.error}`);
  }
  if (l.wa) {
    const r = await probarWa(v);
    console.log(`WhatsApp       ${r.ok ? `anda · ${r.numero}` : r.error}`);
  }
}

async function guardarYReiniciar(lineas, v, cambios) {
  escribirArchivo(lineas, cambios);
  console.log(`\nGuardado en ${ARCHIVO}${fs.existsSync(`${ARCHIVO}.anterior`) ? ` (el anterior quedó en ${path.basename(ARCHIVO)}.anterior)` : ''}.`);
  if (!EN_SERVIDOR) return console.log('Reiniciá la tienda para que tome los cambios.');
  process.stdout.write('Reiniciando la tienda… ');
  try {
    execFileSync('systemctl', ['restart', SERVICIO], { stdio: 'ignore' });
  } catch {
    return console.log(`no se pudo reiniciar. Mirá: journalctl -u ${SERVICIO} -n 30`);
  }
  const url = `http://127.0.0.1:${v.PORT || 3000}/red-social/`;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      if ((await conTiempo(url)).ok) {
        console.log('lista.\n');
        // Las líneas de arranque dicen cómo quedó cada medio de pago
        try {
          const log = execFileSync('journalctl', ['-u', SERVICIO, '-n', '8', '--no-pager', '-o', 'cat'], { encoding: 'utf8' });
          const desde = log.lastIndexOf('XOXO Tecno en');
          if (desde >= 0) console.log(log.slice(desde).trimEnd());
        } catch {}
        return;
      }
    } catch {}
  }
  console.log(`no responde. Para volver a las claves anteriores: cp ${ARCHIVO}.anterior ${ARCHIVO} && systemctl restart ${SERVICIO}`);
}

async function main() {
  if (!TTY && !process.env.XOXO_CLAVES_SIN_TERMINAL) {
    console.error('Abrilo desde una terminal, así lo que pegás no queda a la vista:  ssh -t xoxo-vps xoxo-claves');
    process.exit(1);
  }
  if (EN_SERVIDOR && process.getuid && process.getuid() !== 0) {
    console.error('xoxo-claves tiene que correr como root.');
    process.exit(1);
  }
  const { lineas, valores } = leerArchivo();
  const v = { ...valores };
  const cambios = {};
  const probado = {};
  const set = (k, val) => { v[k] = val; cambios[k] = val; };

  for (;;) {
    resumen(v, probado, cambios);
    const op = (await preguntar('Elegí una opción: ')).toLowerCase();
    if (op === '1') await seccionMp(v, set, probado);
    else if (op === '2') await seccionGo(v, set);
    else if (op === '3') await seccionDemo(v, set);
    else if (op === '4') await seccionWa(v, set);
    else if (op === '5') await probarTodo(v, probado);
    else if (op === 'g') {
      if (!Object.keys(cambios).length) console.log('\nNo hay cambios para guardar.');
      else await guardarYReiniciar(lineas, v, cambios);
      return salir(0);
    } else if (op === 's') {
      if (Object.keys(cambios).length && !(await siNo('Hay cambios sin guardar. ¿Salgo igual?'))) continue;
      return salir(0);
    }
  }
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  salir(1);
});
