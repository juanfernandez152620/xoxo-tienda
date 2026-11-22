'use strict';
/* Páginas: la principal (Historia en /), la entrada que reparte a los visitantes entre los diseños (/anuncio/), los diseños y el panel.
   Las plantillas (plantillas/*.html) tienen marcas {{...}} que se completan con el contenido de la tienda. */

const fs = require('fs');
const path = require('path');
const { PUBLICO, PLANTILLAS } = require('./entorno');
const sitio = require('./sitio');
const pagos = require('./pagos');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Datos dentro de un <script>: sin "<", ">" ni "&" que puedan cerrar la etiqueta
const js = v => JSON.stringify(v)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const plantillas = new Map();
function plantilla(nombre) {
  const file = path.join(PLANTILLAS, nombre);
  const mtime = fs.statSync(file).mtimeMs;
  const hit = plantillas.get(nombre);
  if (hit && hit.mtime === mtime) return hit.html;
  const html = fs.readFileSync(file, 'utf8');
  plantillas.set(nombre, { mtime, html });
  return html;
}

// Dirección de un archivo con su fecha: el navegador baja la versión nueva cuando cambia
function asset(p) {
  let v = '';
  try { v = `?v=${Math.floor(fs.statSync(path.join(PUBLICO, p)).mtimeMs)}`; } catch {}
  return esc(p + v);
}

// Logo arriba del título (se elige en /admin → Tienda y textos; vacío no muestra nada)
const heroLogo = site => (site.texts.heroLogo ? `<img class="cyber-logo" src="${esc(site.texts.heroLogo)}" alt="" width="150" height="121">` : '');

// Sucursales con su dirección y el link para llegar
function sucursales(site) {
  return site.store.branches.map(b => {
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}`;
    // "Dirección a confirmar" (sucursal de ejemplo) no lleva el link al mapa
    const real = b.address && !/a confirmar/i.test(b.address);
    return `<li class="suc"><b>Sucursal ${esc(b.name)}</b>${b.address
      ? `<span>${esc(b.address)}</span>${real ? `<a href="${esc(maps)}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}`
      : `<span>${esc(site.store.city)}</span>`}</li>`;
  }).join('');
}

// Los datos de la tienda para las páginas. cat: la categoría de la página (/historia/audio/), o vacío en el inicio.
function datos(pago, cat, diseno) {
  const d = sitio.publico();
  return `<script>window.TB_BASE = "";
    window.TB_DISENO = ${js(diseno || '')};
    window.STORE = ${js(d.store)};
    window.PRODUCTS = ${js(d.products)};
    window.EXTRAS = ${js(d.extras)};
    window.SITE = ${js(d.site)};
    window.CATEGORIA = ${js(cat || '')};${pago ? "\n    window.TB_MODE = 'pago';" : ''}</script>\n`;
}

// Título de la pestaña: en las páginas de categoría va la categoría adelante
function titulo(site, cat) {
  const c = cat && site.categories.find(x => x.id === cat);
  return c ? `${c.name} · ${site.store.name}` : site.texts.seoTitle;
}

function render(nombre, cat = '') {
  const site = sitio.cargar();
  const pago = pagos.activo();
  const c = cat && site.categories.find(x => x.id === cat);
  return plantilla(nombre).replace(/\{\{(\w+)(?::([^}]+))?\}\}/g, (marca, clave, arg) => {
    switch (clave) {
      case 'texto': return esc(site.texts[arg] ?? '');
      case 'titulo': return esc(titulo(site, cat));
      case 'descripcion': return esc(c ? `${c.title}. ${site.texts.seoDescription}` : site.texts.seoDescription);
      case 'asset': return asset(arg);
      case 'og_image': return esc(sitio.ogImage());
      case 'hero_logo': return heroLogo(site);
      case 'sucursales': return sucursales(site);
      case 'datos': return datos(pago, cat, nombre.replace(/\.html$/, ''));
      case 'pago': return pago ? `<script src="${asset('/shared/checkout.js')}"></script>` : '';
      case 'cat': return esc(cat);
      default: return marca;
    }
  });
}

// Un diseño (y sus páginas de categoría): si en /admin se eligió mostrar solo otro, redirige
// (salvo para el admin o con ?ver)
function diseno(variant, url, esAdmin, cat = '') {
  const { mode } = sitio.cargar().ab;
  if (mode !== 'split' && mode !== variant && !url.searchParams.has('ver') && !esAdmin) {
    return { redirect: `/${mode}/${cat ? `${cat}/` : ''}` };
  }
  return { html: render(`${variant}.html`, cat) };
}

// La página principal: el diseño de sitio.PRINCIPAL (Historia) en / y en /<categoría>/, sin redirigir
const principal = (cat = '') => render(`${sitio.PRINCIPAL}.html`, cat);

// Entrada (/anuncio/ y /anuncio/<categoría>/): elige el diseño en el navegador, lo guarda en localStorage y
// redirige. El mismo visitante ve siempre el mismo diseño, salvo que en /admin se cambie la ronda o el modo.
function entrada(url, origen, cat = '') {
  const site = sitio.cargar();
  const limpio = v => (typeof v === 'string' && /^[\w.-]{1,40}$/.test(v) ? v : '');
  const src = limpio(url.searchParams.get('src')) || limpio(url.searchParams.get('utm_source')) || origen;
  const cfg = { mode: site.ab.mode, weights: site.ab.weights, round: site.ab.round, src, base: '', cat };
  const t = site.texts;
  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.seoTitle)}</title>
<meta name="description" content="${esc(t.seoDescription)}">
<meta property="og:title" content="${esc(t.seoTitle)}">
<meta property="og:description" content="${esc(t.seoDescription)}">
<meta property="og:image" content="${esc(sitio.ogImage())}">
<link rel="icon" href="/media/marca/xoxo-avatar.svg">
<style>html{background:#fff}</style>
<script>
(function (c) {
  var key = 'tb:variante', a = null;
  try { a = JSON.parse(localStorage.getItem(key)); } catch (e) {}
  var names = Object.keys(c.weights).filter(function (k) { return c.weights[k] > 0; });
  var allowed = c.mode === 'split' ? names : [c.mode];
  if (!a || allowed.indexOf(a.v) < 0 || a.r !== c.round) {
    var v = c.mode;
    if (c.mode === 'split') {
      // Sorteo según la parte de cada diseño
      var total = 0, i;
      for (i = 0; i < names.length; i++) total += c.weights[names[i]];
      var r = Math.random() * total;
      for (i = 0; i < names.length; i++) { v = names[i]; r -= c.weights[names[i]]; if (r < 0) break; }
    }
    a = { v: v, r: c.round, t: Date.now() };
    try { localStorage.setItem(key, JSON.stringify(a)); } catch (e) {}
  }
  try { sessionStorage.setItem('tb:entrada', JSON.stringify({ src: c.src, ref: document.referrer })); } catch (e) {}
  location.replace(c.base + '/' + a.v + '/' + (c.cat ? c.cat + '/' : '') + location.hash);
})(${js(cfg)});
</script>
</head>
<body><noscript><p><a href="/${cat ? `${esc(cat)}/` : ''}">Entrar a la tienda</a></p></noscript></body>
</html>
`;
}

const admin = () => render('admin.html');

module.exports = { diseno, entrada, principal, admin, esc };
