'use strict';
/* Contenido de la tienda (datos/sitio.json): se revisa antes de guardar, se copia antes de cada cambio
   y, si el archivo se daña, se vuelve a la última copia buena. Lo edita /admin. */

const fs = require('fs');
const path = require('path');
const { SEMILLA, BASE_URL } = require('./entorno');
const { ruta, Problema, fallar, escribir, leerJson, aJson, archivosJson, cuarentena, ahoraIso, sello } = require('./archivos');

const SITIO = ruta('sitio.json');
const COPIAS = ruta('backups', 'sitio');
// Diseños: A = Red social, B = Minimalista, C1 = Historia (animada con el scroll), C2 = Profesional (clásica, blanca)
const VARIANTS = ['red-social', 'minimalista', 'historia', 'profesional'];
// Las 3 categorías de la tienda (1, 2 y 3): cada diseño tiene una página para cada una (/historia/audio/…)
const CATS = ['ventilacion', 'contenido', 'audio'];
// El diseño de la página principal (xoxotecno.com.ar/ y /ventilacion/, /contenido/, /audio/), sin /historia/ en la dirección
const PRINCIPAL = 'historia';
// Los diseños de la prueba del anuncio (22/11/2026: Profesional se dejó de lado)
const EN_PRUEBA = ['red-social', 'minimalista', 'historia'];
const SPEC_ICONS = ['pantalla', 'camara', 'bateria', 'memoria', 'ram', 'parlante', 'update', 'carga'];
const EXTRA_ICONS = ['mic', 'tripode', 'luz', 'ventilador', 'ventilador-pie', 'ventilador-piso', 'ventilador-techo', 'parlante', 'auricular'];
// Categoría que corresponde a cada ícono, para los productos guardados antes de que existieran las categorías
const CAT_DE_ICONO = { ventilador: 'ventilacion', 'ventilador-pie': 'ventilacion', 'ventilador-piso': 'ventilacion', 'ventilador-techo': 'ventilacion', parlante: 'audio', auricular: 'audio' };

/* ---------- Revisión del contenido ---------- */
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function txt(v, max = 300) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return [...String(v).trim()].slice(0, max).join('');
}

function items(v, fn, max = 50) {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
  return list.slice(0, max).map((x, i) => fn(x, i));
}

function num(v, label, min = 0, max = 1e10) {
  if (typeof v === 'string') v = v.trim();
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) fallar(`${label}: tiene que ser un número${min ? ` mayor o igual a ${min}` : ''}`);
  return n;
}

function hexColor(v, label) {
  const s = txt(v, 9);
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) fallar(`${label}: el color "${s}" no es válido (usá el formato #rrggbb)`);
  return s;
}

function mediaUrl(v, label) {
  const s = txt(v, 500);
  if (s !== '' && (!/^(\/media\/[\w./%-]+|https:\/\/[^\s"'<>\\]+)$/.test(s) || s.includes('..'))) {
    fallar(`${label}: la dirección tiene que empezar con /media/ o https://`);
  }
  return s;
}

function codigo(p, label, ids, ejemplo) {
  const id = txt(p.id, 60).toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fallar(`${label}: el código solo puede tener letras, números y guiones (ej. ${ejemplo})`);
  if (ids.has(id)) fallar(`${label}: el código "${id}" está repetido`);
  ids.add(id);
  return id;
}

const lineas = (v, max, largo) => items(v, d => txt(d, largo), max).filter(Boolean);

function normalizarCelular(p, i, ids) {
  if (!p || typeof p !== 'object') fallar(`Producto ${i + 1}: formato inválido`);
  const label = `Producto ${i + 1}${p.name ? ` (${txt(p.name, 60)})` : ''}`;
  const id = codigo(p, label, ids, 'moto-g06-128');
  const cuotas = obj(p.cuotas);
  const out = {
    id,
    hidden: Boolean(p.hidden),
    brand: txt(p.brand, 40) || fallar(`${label}: falta la marca`),
    name: txt(p.name, 60) || fallar(`${label}: falta el nombre`),
    storage: num(p.storage, `${label}: memoria`, 1, 4096),
    cuotas: {
      9: num(cuotas[9], `${label}: valor de la cuota en 9`, 1),
      12: num(cuotas[12], `${label}: valor de la cuota en 12`, 1),
    },
    specs: items(p.specs, s => {
      s = obj(s);
      return { icon: SPEC_ICONS.includes(s.icon) ? s.icon : 'pantalla', v: txt(s.v, 12), u: txt(s.u, 8), l: txt(s.l, 30) };
    }, 4).filter(s => s.v !== '' || s.l !== ''),
    highlights: lineas(p.highlights, 5, 60),
    pitch: txt(p.pitch, 200),
    details: lineas(p.details, 12, 120),
    gallery: items(p.gallery, (g, k) => mediaUrl(g, `${label}: foto ${k + 1}`), 12).filter(Boolean),
    palette: items(p.palette, (c, k) => hexColor(c, `${label}: color de fondo ${k + 1}`), 6),
    color: items(p.color, (c, k) => hexColor(c, `${label}: color del celular ${k + 1}`), 2),
    video: mediaUrl(p.video, `${label}: video`),
    poster: mediaUrl(p.poster, `${label}: portada del video`),
  };
  if (Number(p.ram)) out.ram = num(p.ram, `${label}: RAM`, 1, 64);
  if (!out.highlights.length) fallar(`${label}: poné al menos un título para el video`);
  if (out.color.length < 2) out.color = ['#1c2330', '#8b97a8'];
  if (!out.palette.length) out.palette = out.color;
  return out;
}

// Productos que no son celulares: tienen un solo precio y se ven en la vidriera
// Cuotas con crédito que puede ofrecer un producto (Mercado Pago): el máximo, elegido en /admin
const CUOTAS_CREDITO = [1, 3, 6, 9, 12];
function normalizarOtro(p, i, ids) {
  if (!p || typeof p !== 'object') fallar(`Otro producto ${i + 1}: formato inválido`);
  const label = `Otro producto ${i + 1}${p.name ? ` (${txt(p.name, 60)})` : ''}`;
  const id = codigo(p, label, ids, 'tripode-soul-j500');
  const lista = p.listPrice;
  const icon = EXTRA_ICONS.includes(p.icon) ? p.icon : 'luz';
  const peso = p.weight === '' || p.weight === null || p.weight === undefined ? 0 : num(p.weight, `${label}: peso`, 0, 100);
  return {
    id,
    hidden: Boolean(p.hidden),
    // Producto de ejemplo (para ver el diseño): se reemplaza por los reales
    ...(p.example ? { example: true } : {}),
    cat: CATS.includes(p.cat) ? p.cat : CAT_DE_ICONO[icon] || 'contenido',
    group: txt(p.group, 40) || fallar(`${label}: falta el tipo (ej. Micrófonos)`),
    brand: txt(p.brand, 40),
    name: txt(p.name, 60) || fallar(`${label}: falta el nombre`),
    icon,
    // Peso con la caja, en kg: lo usa la calculadora de envíos (0 = el de su categoría)
    weight: Math.round(peso * 100) / 100,
    price: num(p.price, `${label}: precio`, 1),
    listPrice: lista === '' || lista === null || lista === undefined ? 0 : num(lista, `${label}: precio normal`),
    pitch: txt(p.pitch, 200),
    details: lineas(p.details, 12, 120),
    gallery: items(p.gallery, (g, k) => mediaUrl(g, `${label}: foto ${k + 1}`), 12).filter(Boolean),
    // Video del producto (.mp4): se ve en la tarjeta y es lo primero de la ficha
    video: mediaUrl(p.video, `${label}: video`),
    // Cuotas de este producto (22/11/2026): con crédito, hasta cuántas; con débito en GO cuotas, si se acepta
    credito: CUOTAS_CREDITO.includes(Number(p.credito)) ? Number(p.credito) : 12,
    debito: p.debito !== false,
  };
}

// Sucursales: nombre, WhatsApp, dirección y si reciben mensajes
function normalizarSucursales(list) {
  const ids = new Set();
  const out = items(list, (b, i) => {
    b = obj(b);
    const name = txt(b.name, 40) || fallar(`Sucursal ${i + 1}: falta el nombre`);
    const id = txt(b.id, 40);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fallar(`Sucursal ${name}: el código solo puede tener letras, números y guiones`);
    if (ids.has(id)) fallar(`Sucursal ${name}: el código "${id}" está repetido`);
    ids.add(id);
    let phone = txt(b.whatsapp, 30).replace(/\D/g, '');
    if (phone.length === 10) phone = `549${phone}`; // característica + número
    const on = Boolean(b.on);
    // Una sucursal que no recibe mensajes puede no tener WhatsApp (solo se muestra en la página)
    if ((on || phone) && !/^\d{11,15}$/.test(phone)) fallar(`Sucursal ${name}: el WhatsApp tiene que ser la característica y el número, sin 0 ni 15 (ej. 3813629235)`);
    return {
      id, name, province: txt(b.province, 40), whatsapp: phone, address: txt(b.address, 150), photo: mediaUrl(b.photo, `Sucursal ${name}: foto del local`), on,
      // 22/11/2026: horarios y teléfono fijo (se ven en el seguimiento, el comprobante y el mail de "listo para retirar")
      hours: txt(b.hours, 120), phone: txt(b.phone, 30),
    };
  }, 30);
  if (!out.some(b => b.on)) fallar('Dejá al menos una sucursal recibiendo mensajes');
  return out;
}

function pasos(list, nombre) {
  return items(list, (h, i) => {
    h = obj(h);
    const n = i + 1;
    return {
      icon: txt(h.icon, 8) || '📱', title: txt(h.title, 60), text: txt(h.text, 200),
      bg: hexColor(h.bg, `${nombre}, paso ${n}: fondo`), fg: hexColor(h.fg, `${nombre}, paso ${n}: letra`),
    };
  }, 6);
}

// Códigos de descuento propios (/admin → Tienda y textos): los que reparten por redes o WhatsApp.
// code: minúsculas, números y guiones · percent: 1 a 90 · until: hasta qué día vale (vacío = sin fecha)
// max: cuántos pedidos pagados pueden usarlo (0 = sin límite) · on: activo. No van a la página: se validan acá.
function normalizarCodigos(list) {
  const vistos = new Set();
  return items(list, (c, i) => {
    c = obj(c);
    const label = `Código de descuento ${i + 1}`;
    const code = String(c.code || '').trim().toLowerCase();
    if (!code && !c.percent) return null;
    if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(code)) fallar(`${label}: el código va con letras, números y guiones (de 3 a 30)`);
    if (/^xoxo-(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)$/.test(code)) fallar(`${label}: ese es el código del descuento flash`);
    if (vistos.has(code)) fallar(`${label}: el código "${code}" está repetido`);
    vistos.add(code);
    const until = String(c.until || '').trim();
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) fallar(`${label}: la fecha va como 2026-12-31`);
    return {
      code, percent: Math.round(num(c.percent, `${label}: porcentaje`, 1, 90)), until,
      max: Math.round(num(c.max === '' || c.max === undefined || c.max === null ? 0 : c.max, `${label}: usos`, 0, 100000)),
      on: c.on !== false, note: txt(c.note, 80),
    };
  }, 50).filter(Boolean);
}

// Las 3 categorías, siempre en el mismo orden (1 ventilación, 2 contenido, 3 audio)
function normalizarCategorias(list) {
  const porId = Object.fromEntries(items(list, c => [txt(obj(c).id, 20), obj(c)], 10));
  return CATS.map((id, i) => {
    const c = porId[id] || {};
    const name = txt(c.name, 40) || fallar(`Categoría ${i + 1}: falta el nombre`);
    // Contenido propio de la home de cada categoría: "Título | texto" por renglón
    const pares = (v, max) => lineas(v, max, 300);
    return {
      id, num: i + 1, name, short: txt(c.short, 20) || name,
      title: txt(c.title, 90), text: txt(c.text, 400),
      color: hexColor(c.color || '#7c3aed', `Categoría ${name}: color`),
      // Foto de fondo del banner de la home de la categoría (gente usando los productos)
      banner: mediaUrl(c.banner, `Categoría ${name}: foto del banner`),
      benefits: pares(c.benefits, 6),
      guideTitle: txt(c.guideTitle, 90),
      guide: pares(c.guide, 6),
      faq: pares(c.faq, 8),
      // Los 3 productos destacados de la categoría (códigos), en el orden en que se muestran
      destacados: items(c.destacados, x => txt(x, 60), 3).filter(Boolean),
    };
  });
}

// Descuento flash: cada visitante tiene unos minutos con el cupón xoxo-<mes>. El precio cobrado es el de la página.
function normalizarFlash(f) {
  f = obj(f);
  return {
    on: f.on !== false,
    percent: Math.round(num(f.percent ?? 20, 'Descuento flash: porcentaje', 5, 70)),
    minutes: Math.round(num(f.minutes ?? 60, 'Descuento flash: minutos', 5, 1440)),
  };
}

// Calculadora de envíos: precio por zona (1 Tucumán, 2 NOA, 3 centro, 4 sur) para cada empresa y servicio
const EMPRESAS = { andreani: 'Andreani', correo: 'Correo Argentino' };
function normalizarEnvios(e) {
  e = obj(e);
  const r = obj(e.rates);
  const zonas = (v, label) => {
    const a = items(v, (x, i) => Math.round(num(x, `${label}, zona ${i + 1}`, 0, 1e7)), 4);
    if (a.length !== 4) fallar(`${label}: faltan precios (son 4 zonas)`);
    return a;
  };
  const rates = {};
  for (const [k, nombre] of Object.entries(EMPRESAS)) {
    const x = obj(r[k]);
    rates[k] = {
      on: x.on !== false,
      domicilio: zonas(x.domicilio, `Envíos ${nombre} a domicilio`),
      sucursal: zonas(x.sucursal, `Envíos ${nombre} a sucursal`),
      extraKg: Math.round(num(x.extraKg ?? 0, `Envíos ${nombre}: cada kg de más`, 0, 1e6)),
    };
  }
  const days = items(e.days, (d, i) => {
    const a = items(d, x => Math.round(num(x, `Envíos: días de la zona ${i + 1}`, 0, 60)), 2);
    return [a[0] ?? 1, Math.max(a[1] ?? a[0] ?? 3, a[0] ?? 1)];
  }, 4);
  while (days.length < 4) days.push([3, 7]);
  return {
    pickup: e.pickup !== false,
    freeFrom: Math.round(num(e.freeFrom ?? 0, 'Envío gratis desde', 0, 1e9)),
    rates, days,
  };
}

// Textos de la página Historia (diseño C): los socios, el equipo, las sucursales y la garantía
function normalizarHistoria(h) {
  h = obj(h);
  const persona = (p, label) => {
    p = obj(p);
    return { name: txt(p.name, 40), role: txt(p.role, 60), photo: mediaUrl(p.photo, `${label}: foto`) };
  };
  return {
    kicker: txt(h.kicker, 60), title: txt(h.title, 120), text: txt(h.text, 600),
    foundersTitle: txt(h.foundersTitle, 90), foundersText: txt(h.foundersText, 600),
    founders: items(h.founders, (p, i) => persona(p, `Socio ${i + 1}`), 3),
    // Una sola foto de los 3 socios juntos (Historia → Ventilación)
    foundersPhoto: mediaUrl(h.foundersPhoto, 'Historia: foto de los 3 socios'),
    teamTitle: txt(h.teamTitle, 90), teamText: txt(h.teamText, 400),
    team: items(h.team, (p, i) => persona(p, `Equipo ${i + 1}`), 12),
    branchesTitle: txt(h.branchesTitle, 90), branchesText: txt(h.branchesText, 400),
    warrantyDays: Math.round(num(h.warrantyDays ?? 3, 'Garantía: días', 0, 3650)),
    warrantyTitle: txt(h.warrantyTitle, 90), warrantyText: txt(h.warrantyText, 400),
    stats: items(h.stats, x => ({ v: txt(obj(x).v, 12), l: txt(obj(x).l, 40) }), 4).filter(x => x.v || x.l),
  };
}

// Contenido guardado antes de las categorías (16/11/2026): suma lo nuevo desde el contenido de fábrica.
// Pasa una sola vez: al guardar, el contenido ya tiene "categories".
function migrar(s) {
  if (Array.isArray(s.categories)) {
    // Categorías guardadas antes de tener su home propia (17/11/2026): se completan desde el contenido de fábrica
    if (s.categories.every(c => c && c.faq !== undefined)) return s;
    const semilla = leerJson(SEMILLA) || {};
    const fab = Object.fromEntries((semilla.categories || []).map(c => [c.id, c]));
    return { ...s, categories: s.categories.map(c => ({ ...(fab[c && c.id] || {}), ...c, ...Object.fromEntries(['benefits', 'guideTitle', 'guide', 'faq'].filter(k => !c || c[k] === undefined).map(k => [k, (fab[c && c.id] || {})[k]])) })) };
  }
  const semilla = leerJson(SEMILLA) || {};
  const out = { ...s, store: { ...s.store } };
  for (const k of ['categories', 'flash', 'shipping', 'story']) if (out[k] === undefined) out[k] = semilla[k];
  const ids = new Set([...(s.products || []), ...(s.extras || [])].map(p => p && p.id));
  out.extras = [...(Array.isArray(s.extras) ? s.extras : []), ...(semilla.extras || []).filter(p => p.example && !ids.has(p.id))];
  const sucursales = Array.isArray(s.store.branches) ? s.store.branches : [];
  const sucIds = new Set(sucursales.map(b => b && b.id));
  out.store.branches = [...sucursales, ...((semilla.store || {}).branches || []).filter(b => !b.on && !sucIds.has(b.id))];
  return out;
}

// 17/11/2026: los 3 ventiladores reales (con fotos y video) reemplazan a los 4 de ejemplo, y la categoría
// Ventilación suma su banner. Pasa una sola vez: queda anotada en "migraciones" (si después se borra un
// ventilador a mano, no vuelve).
// 17/11/2026: cada ventilador con el dibujo de su tipo (pie, piso, techo) y el Kanji con la foto de fondo blanco primero
function migrarVentiladores2(s) {
  const hechas = Array.isArray(s.migraciones) ? s.migraciones : [];
  if (hechas.includes('ventiladores-v2')) return s;
  const icono = { 'ventilador-pie-delhi-18': 'ventilador-pie', 'ventilador-piso-exahome-turbo-20': 'ventilador-piso', 'ventilador-techo-kanji': 'ventilador-techo' };
  const extras = (Array.isArray(s.extras) ? s.extras : []).map(p => {
    if (!p || !icono[p.id]) return p;
    const out = { ...p, icon: p.icon === 'ventilador' || !p.icon ? icono[p.id] : p.icon };
    const blanca = '/media/ventiladores/kanji-techo/foto-3.webp';
    if (p.id === 'ventilador-techo-kanji' && Array.isArray(p.gallery) && p.gallery[0] !== blanca && p.gallery.includes(blanca)) {
      out.gallery = [blanca, ...p.gallery.filter(g => g !== blanca)];
    }
    return out;
  });
  return { ...s, extras, migraciones: [...hechas, 'ventiladores-v2'] };
}

// El envío cuesta lo mismo para cualquier producto (17/11/2026): sin recargo por kg. Pasa una sola vez; si
// después se vuelve a poner un recargo en /admin → Envíos, se respeta.
function migrarEnvioParejo(s) {
  const hechas = Array.isArray(s.migraciones) ? s.migraciones : [];
  if (hechas.includes('envio-parejo') || !s.shipping || !s.shipping.rates) return s;
  const rates = Object.fromEntries(Object.entries(s.shipping.rates).map(([k, r]) => [k, r && typeof r === 'object' ? { ...r, extraKg: 0 } : r]));
  return { ...s, shipping: { ...s.shipping, rates }, migraciones: [...hechas, 'envio-parejo'] };
}

// 22/11/2026: los 21 productos SOUL (con video) reemplazan a los de creación de contenido y audio, y cada
// categoría suma sus 3 destacados. Pasa una sola vez (queda anotada en "migraciones").
function migrarSoul(s) {
  const hechas = Array.isArray(s.migraciones) ? s.migraciones : [];
  if (hechas.includes('soul-21')) return s;
  const semilla = leerJson(SEMILLA) || {};
  const nuevos = (semilla.extras || []).filter(p => ['contenido', 'audio'].includes(p.cat));
  if (!nuevos.length) return s;
  const fab = Object.fromEntries((semilla.categories || []).map(c => [c.id, c]));
  const extras = [...(Array.isArray(s.extras) ? s.extras : []).filter(p => !p || !['contenido', 'audio'].includes(p.cat)), ...nuevos];
  // Los textos de contenido y audio que todavía son de ejemplo (lorem ipsum o vacíos) pasan a los de fábrica
  const relleno = v => (Array.isArray(v) ? !v.length || v.every(x => /lorem ipsum/i.test(String(x))) : !v || /^\s*lorem ipsum/i.test(String(v)));
  const textos = (c, f) => Object.fromEntries(['title', 'text', 'benefits', 'guideTitle', 'guide', 'faq']
    .filter(k => f[k] && (relleno(c[k]) || (k === 'title' && c.title === 'Todo para crear y grabar'))).map(k => [k, f[k]]));
  // (migrar() pudo haber copiado ya los destacados de fábrica: se respetan los que haya)
  const categories = Array.isArray(s.categories) ? s.categories.map(c => (c && fab[c.id] && fab[c.id].destacados
    ? { ...c, ...textos(c, fab[c.id]), destacados: Array.isArray(c.destacados) && c.destacados.length ? c.destacados : fab[c.id].destacados }
    : c)) : s.categories;
  return { ...s, extras, categories, migraciones: [...hechas, 'soul-21'] };
}

// 22/11/2026: el título de fábrica de la historia ya no habla de los socios (si nadie lo cambió en /admin)
function migrarSinSocios(s) {
  const hechas = Array.isArray(s.migraciones) ? s.migraciones : [];
  if (hechas.includes('sin-socios')) return s;
  const story = s.story && s.story.title === 'Tres socios, una idea y sucursales en tres provincias' ? { ...s.story, title: 'Tecnología en cuotas, con sucursales en tres provincias' } : s.story;
  return { ...s, story, migraciones: [...hechas, 'sin-socios'] };
}

function migrarSinCelulares(s) {
  const t = s.texts || {};
  const viejo = {
    seoTitle: 'XOXO Tecno · Celulares en cuotas en Tucumán',
    seoDescription: 'Celulares en 12 cuotas sin interés con tarjeta de crédito o hasta 9 con tu tarjeta de débito en GO cuotas. Comprá online o pedilo por WhatsApp.',
  };
  const nuevo = { seoTitle: "XOXO Tecno · Ventilación, creación de contenido y audio en cuotas", seoDescription: "Ventiladores, micrófonos, luces, parlantes y auriculares en hasta 12 cuotas con Mercado Pago o con tu débito en GO cuotas. Envíos a todo el país y 30 días de garantía." };
  const texts = { ...t };
  for (const k of Object.keys(viejo)) if (t[k] === viejo[k]) texts[k] = nuevo[k];
  const store = { ...s.store };
  if (store.greeting === '¡Hola! Quiero consultar por un celular.') store.greeting = "¡Hola! Quiero hacer una consulta.";
  return { ...s, texts, store };
}

function migrarVentiladores(s) {
  const hechas = Array.isArray(s.migraciones) ? s.migraciones : [];
  if (hechas.includes('ventiladores-reales')) return s;
  const semilla = leerJson(SEMILLA) || {};
  const reales = (semilla.extras || []).filter(p => p.cat === 'ventilacion' && !p.example);
  const extras = (Array.isArray(s.extras) ? s.extras : []).filter(p => !(p && p.example && p.cat === 'ventilacion'));
  const ids = new Set(extras.map(p => p && p.id));
  const fab = (semilla.categories || []).find(c => c.id === 'ventilacion') || {};
  return {
    ...s,
    migraciones: [...hechas, 'ventiladores-reales'],
    extras: [...reales.filter(p => !ids.has(p.id)), ...extras],
    categories: Array.isArray(s.categories) ? s.categories.map(c => (c && c.id === 'ventilacion' ? {
      ...c,
      banner: c.banner || fab.banner,
      // Textos de ejemplo (lorem ipsum) o que nombraban ventiladores que ya no están: pasan a los de fábrica
      ...(/^Lorem ipsum/.test(c.text || '') || /de torre|de escritorio y de mano/.test(c.text || '') ? { text: fab.text, title: fab.title } : {}),
      ...(JSON.stringify(c.benefits || []).includes('en la mano') ? { benefits: fab.benefits } : {}),
      // La guía de antes hablaba de ventiladores de torre y de mano, que ya no están
      ...(JSON.stringify(c.guide || []).includes('De torre') ? { guideTitle: fab.guideTitle, guide: fab.guide } : {}),
    } : c)) : s.categories,
  };
}

// Revisa y ordena el contenido antes de guardarlo: si algo está mal, devuelve un mensaje claro y no guarda.
function normalizar(s) {
  if (!s || typeof s !== 'object' || !s.store || typeof s.store !== 'object' || !Array.isArray(s.products)) {
    fallar('El contenido no tiene el formato esperado');
  }
  s = migrarSinSocios(migrarSoul(migrarEnvioParejo(migrarSinCelulares(migrarVentiladores2(migrarVentiladores(migrar(s)))))));
  const st = s.store;
  const logo = obj(st.financingLogo);
  const closing = st.closing && typeof st.closing === 'object' ? st.closing : null;
  const plans = obj(st.plans);
  const vidriera = obj(st.extras);
  const store = {
    name: txt(st.name, 60) || fallar('Falta el nombre de la tienda'),
    // ¿Se venden celulares? Desde el 17/11/2026 no: Red social y Minimalista muestran las 3 categorías.
    // Prendido, vuelve el catálogo de celulares (con sus videos y cuotas).
    phones: st.phones === true,
    tag: txt(st.tag, 20),
    city: txt(st.city, 60),
    greeting: txt(st.greeting, 300),
    financing: txt(st.financing, 40),
    financingLogo: {
      color: mediaUrl(logo.color, 'Logo de la financiera'),
      icon: mediaUrl(logo.icon, 'Ícono de la financiera'),
    },
    sinInteres: Boolean(st.sinInteres),
    budgets: items(st.budgets, (b, i) => num(b, `Botón de cuota ${i + 1}`, 1), 6),
    featured: txt(st.featured, 60),
    closing: {
      show: closing !== null && closing.show !== false,
      title: txt(closing && closing.title, 120),
      text: txt(closing && closing.text, 160),
    },
    hashtags: items(st.hashtags, h => txt(h, 40).replace(/^#/, '').replace(/\s+/gu, ''), 10).filter(Boolean),
    howto: pasos(st.howto, 'Cómo comprar'),
    howtoPay: pasos(st.howtoPay, 'Cómo comprar con pago online'),
    plans: {
      12: txt(plans[12], 60) || fallar('Falta con qué se pagan las 12 cuotas'),
      9: txt(plans[9], 60) || fallar('Falta con qué se pagan las 9 cuotas'),
    },
    extras: {
      title: txt(vidriera.title, 60) || fallar('Otros productos: falta el título de la sección'),
      short: txt(vidriera.short, 20) || fallar('Otros productos: falta el nombre corto de la sección'),
      eyebrow: txt(vidriera.eyebrow, 40),
      cuotas: Math.round(num(vidriera.cuotas, 'Cuotas de los otros productos', 1, 48)),
    },
    branches: normalizarSucursales(st.branches),
  };
  if (!store.howto.length) fallar('"Cómo comprar" necesita al menos un paso');

  const ids = new Set();
  const products = items(s.products, (p, i) => normalizarCelular(p, i, ids), 300);
  if (store.phones && !products.some(p => !p.hidden)) fallar('Dejá al menos un celular visible (o apagá "Vendemos celulares")');
  const extras = items(s.extras, (p, i) => normalizarOtro(p, i, ids), 300);
  if (![...(store.phones ? products : []), ...extras].some(p => !p.hidden)) fallar('Dejá al menos un producto visible');

  const t = obj(s.texts);
  const texts = {
    seoTitle: txt(t.seoTitle, 120), seoDescription: txt(t.seoDescription, 300),
    ogImage: mediaUrl(t.ogImage, 'Imagen para compartir'),
    heroLogo: mediaUrl(t.heroLogo, 'Logo de la portada'), heroDebito: txt(t.heroDebito, 200),
    heroTitle1: txt(t.heroTitle1, 60), heroTitle2: txt(t.heroTitle2, 60),
    heroSub: txt(t.heroSub, 200), heroText: txt(t.heroText, 300),
    notices: lineas(t.notices, 6, 120),
    budgetQuestion: txt(t.budgetQuestion, 80),
  };
  const f = obj(s.footer);
  const footer = {
    about: txt(f.about, 300), hours: txt(f.hours, 150), email: txt(f.email, 100),
    instagram: txt(f.instagram, 200), facebook: txt(f.facebook, 200), tiktok: txt(f.tiktok, 200), legal: txt(f.legal, 200),
  };
  if (footer.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(footer.email)) fallar('El email del pie de página no es válido');
  const a = obj(s.ab);
  // "Solo Profesional" de antes vuelve a la prueba entre los 3
  if (a.mode === 'profesional') a.mode = 'split';
  if (!['split', ...EN_PRUEBA].includes(a.mode)) fallar('Anuncio: elegí qué diseño mostrar');
  // Reparto entre los 3 diseños, en partes (no hace falta que sumen 100). Antes había solo un porcentaje para A.
  const w = obj(a.weights);
  const viejo = a.weights === undefined && a.redSocialPercent !== undefined;
  const weights = Object.fromEntries(VARIANTS.map(v => [v, v === 'profesional' ? 0 : Math.round(num(
    // Contenido de antes: A y B como estaban y la parte de C dividida entre C1 y C2
    w[v] ?? (viejo || a.weights ? { 'red-social': 34, minimalista: 33, historia: 17, profesional: 16 }[v] ?? 16 : 1),
    `Anuncio: parte de ${v}`, 0, 100))]));
  // El reparto de fábrica de antes (Historia 17 y Profesional 16) pasa a partes iguales entre los 3
  if (w.historia === 17 && w.profesional === 16) weights.historia = 33;
  if (a.mode === 'split' && !Object.values(weights).some(Boolean)) fallar('Anuncio: poné al menos un diseño con más de 0');
  const ab = {
    mode: a.mode,
    weights,
    round: Math.max(1, Math.round(num(a.round ?? 1, 'Anuncio: ronda', 1))),
  };
  return {
    rev: Math.max(1, Math.round(Number(s.rev) || 1)),
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
    store, texts, footer, ab, products, extras,
    migraciones: items(s.migraciones, m => txt(m, 40), 20).filter(Boolean),
    categories: normalizarCategorias(s.categories),
    codes: normalizarCodigos(s.codes),
    flash: normalizarFlash(s.flash),
    shipping: normalizarEnvios(s.shipping),
    story: normalizarHistoria(s.story),
  };
}

/* ---------- Leer y guardar ---------- */
const sitioJson = site => `${aJson(site, true)}\n`;
const revDe = nombre => Number((nombre.match(/_rev(\d+)\.json$/) || [])[1] || 0);

let cache = null;
let cacheMtime = 0;

function mtime() {
  try { return fs.statSync(SITIO).mtimeMs; } catch { return 0; }
}

function cargar(fresco = false) {
  // Si alguien cambió el archivo a mano, se vuelve a leer
  if (cache && !fresco && mtime() === cacheMtime) return cache;
  try {
    cache = normalizar(leerJson(SITIO));
    cacheMtime = mtime();
    return cache;
  } catch (err) {
    if (!(err instanceof Problema)) throw err;
    if (fs.existsSync(SITIO)) console.error(`[sitio] sitio.json está dañado (${err.message}). Se guardó como ${cuarentena(SITIO)}`);
  }
  // Las copias, de la versión más nueva a la más vieja (por el número de rev del nombre)
  const nombres = archivosJson(COPIAS).sort((a, b) => revDe(b) - revDe(a) || b.localeCompare(a));
  for (const nombre of nombres) {
    try {
      const site = normalizar(leerJson(path.join(COPIAS, nombre)));
      escribir(SITIO, sitioJson(site));
      console.error(`[sitio] Restaurado desde la copia ${nombre}`);
      cache = site;
      cacheMtime = mtime();
      return site;
    } catch (err) {
      if (!(err instanceof Problema)) throw err;
    }
  }
  // Primera vez (o nada se pudo usar): el contenido de fábrica
  cache = normalizar(leerJson(SEMILLA));
  escribir(SITIO, sitioJson(cache));
  cacheMtime = mtime();
  return cache;
}

// Cada versión del contenido queda copiada en backups/sitio/ (también la actual): si sitio.json se daña,
// se vuelve a la última. rev evita pisar cambios hechos desde otra pestaña.
function copiar(site) {
  if (!archivosJson(COPIAS).some(n => n.endsWith(`_rev${site.rev}.json`))) {
    escribir(path.join(COPIAS, `${sello()}_rev${site.rev}.json`), sitioJson(site));
  }
}

function guardar(input, revEsperada = null) {
  const actual = cargar(true);
  if (revEsperada !== null && revEsperada !== undefined && Number(revEsperada) !== actual.rev) {
    throw new Problema('Alguien guardó cambios mientras editabas. Recargá la página para ver la última versión.', 409);
  }
  const next = normalizar(input);
  copiar(actual);
  next.rev = actual.rev + 1;
  next.updatedAt = ahoraIso();
  escribir(SITIO, sitioJson(next));
  copiar(next);
  for (const viejo of archivosJson(COPIAS).slice(100)) {
    try { fs.unlinkSync(path.join(COPIAS, viejo)); } catch {}
  }
  return cargar(true);
}

/* ---------- Lo que leen las páginas ---------- */
const absoluta = u => (u === '' || u.startsWith('https://') ? u : BASE_URL + u);

function ogImage() {
  const site = cargar();
  if (site.texts.ogImage) return absoluta(site.texts.ogImage);
  // Sin celulares: la foto del primer producto con foto
  const visibles = (site.store.phones ? site.products : site.extras).filter(p => !p.hidden && (p.gallery || []).length);
  const pick = visibles.find(p => p.id === site.store.featured) || visibles[0];
  return pick && pick.gallery.length ? absoluta(pick.gallery[0]) : '';
}

// window.STORE, window.PRODUCTS, window.EXTRAS y window.SITE: solo los productos visibles.
// Los teléfonos de las sucursales no se publican: los usa /api/whatsapp para repartir los mensajes.
function publico() {
  const site = cargar();
  const { closing, financingLogo, ...store } = site.store;
  store.closing = closing.show && closing.title ? { title: closing.title, text: closing.text } : null;
  store.financingLogo = financingLogo.color ? { color: financingLogo.color, icon: financingLogo.icon || financingLogo.color } : null;
  store.branches = store.branches.map(b => ({ id: b.id, name: b.name, province: b.province, address: b.address, photo: b.photo || '', hours: b.hours || '', phone: b.phone || '' }));
  const visibles = list => list.filter(p => !p.hidden).map(({ hidden, ...p }) => p);
  return {
    store, products: site.store.phones ? visibles(site.products) : [], extras: visibles(site.extras),
    site: {
      texts: site.texts, footer: site.footer, categories: site.categories, flash: site.flash,
      shipping: site.shipping, story: site.story,
    },
  };
}

module.exports = { CUOTAS_CREDITO, VARIANTS, EN_PRUEBA, CATS, PRINCIPAL, EMPRESAS, SITIO, COPIAS, txt, normalizar, cargar, guardar, copiar, publico, ogImage, absoluta };
