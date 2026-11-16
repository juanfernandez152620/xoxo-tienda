'use strict';
/* Contenido de la tienda (datos/sitio.json): se revisa antes de guardar, se copia antes de cada cambio
   y, si el archivo se daña, se vuelve a la última copia buena. Lo edita /admin. */

const fs = require('fs');
const path = require('path');
const { SEMILLA, BASE_URL } = require('./entorno');
const { ruta, Problema, fallar, escribir, leerJson, aJson, archivosJson, cuarentena, ahoraIso, sello } = require('./archivos');

const SITIO = ruta('sitio.json');
const COPIAS = ruta('backups', 'sitio');
const VARIANTS = ['red-social', 'minimalista'];
const SPEC_ICONS = ['pantalla', 'camara', 'bateria', 'memoria', 'ram', 'parlante', 'update', 'carga'];
const EXTRA_ICONS = ['mic', 'tripode', 'luz'];

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
function normalizarOtro(p, i, ids) {
  if (!p || typeof p !== 'object') fallar(`Otro producto ${i + 1}: formato inválido`);
  const label = `Otro producto ${i + 1}${p.name ? ` (${txt(p.name, 60)})` : ''}`;
  const id = codigo(p, label, ids, 'tripode-soul-j500');
  const lista = p.listPrice;
  return {
    id,
    hidden: Boolean(p.hidden),
    group: txt(p.group, 40) || fallar(`${label}: falta el tipo (ej. Micrófonos)`),
    brand: txt(p.brand, 40),
    name: txt(p.name, 60) || fallar(`${label}: falta el nombre`),
    icon: EXTRA_ICONS.includes(p.icon) ? p.icon : 'luz',
    price: num(p.price, `${label}: precio`, 1),
    listPrice: lista === '' || lista === null || lista === undefined ? 0 : num(lista, `${label}: precio normal`),
    pitch: txt(p.pitch, 200),
    details: lineas(p.details, 12, 120),
    gallery: items(p.gallery, (g, k) => mediaUrl(g, `${label}: foto ${k + 1}`), 12).filter(Boolean),
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
    if (!/^\d{11,15}$/.test(phone)) fallar(`Sucursal ${name}: el WhatsApp tiene que ser la característica y el número, sin 0 ni 15 (ej. 3813629235)`);
    return { id, name, whatsapp: phone, address: txt(b.address, 150), on: Boolean(b.on) };
  }, 6);
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

// Revisa y ordena el contenido antes de guardarlo: si algo está mal, devuelve un mensaje claro y no guarda.
function normalizar(s) {
  if (!s || typeof s !== 'object' || !s.store || typeof s.store !== 'object' || !Array.isArray(s.products)) {
    fallar('El contenido no tiene el formato esperado');
  }
  const st = s.store;
  const logo = obj(st.financingLogo);
  const closing = st.closing && typeof st.closing === 'object' ? st.closing : null;
  const plans = obj(st.plans);
  const vidriera = obj(st.extras);
  const store = {
    name: txt(st.name, 60) || fallar('Falta el nombre de la tienda'),
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
  if (!products.some(p => !p.hidden)) fallar('Dejá al menos un producto visible');
  const extras = items(s.extras, (p, i) => normalizarOtro(p, i, ids), 300);

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
  if (!['split', ...VARIANTS].includes(a.mode)) fallar('Anuncio: elegí qué diseño mostrar');
  const ab = {
    mode: a.mode,
    redSocialPercent: Math.round(num(a.redSocialPercent ?? 50, 'Anuncio: porcentaje', 0, 100)),
    round: Math.max(1, Math.round(num(a.round ?? 1, 'Anuncio: ronda', 1))),
  };
  return {
    rev: Math.max(1, Math.round(Number(s.rev) || 1)),
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
    store, texts, footer, ab, products, extras,
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
  const visibles = site.products.filter(p => !p.hidden);
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
  store.branches = store.branches.map(b => ({ name: b.name, address: b.address }));
  const visibles = list => list.filter(p => !p.hidden).map(({ hidden, ...p }) => p);
  return { store, products: visibles(site.products), extras: visibles(site.extras), site: { texts: site.texts, footer: site.footer } };
}

module.exports = { VARIANTS, SITIO, COPIAS, txt, normalizar, cargar, guardar, copiar, publico, ogImage, absoluta };
