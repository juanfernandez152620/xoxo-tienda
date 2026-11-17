/* Secciones que comparten los cuatro diseños (window.Secciones):
 *  - El menú de las 4 vistas de cada diseño: Inicio (todo) y la home de cada categoría.
 *  - La home de una categoría: portada, beneficios, productos, guía para elegir, cómo comprar, calculadora de
 *    envíos, garantía y preguntas frecuentes. Cada categoría tiene sus propios textos (/admin → Tienda y textos).
 *  - Los bloques de "comprá tranquilo" para el inicio: garantía, cómo comprar y calculadora de envíos.
 * Las clases empiezan con sx-. Cada diseño las pinta con sus variables (shared/secciones.css).
 * Necesita shared/vidriera.js (tarjetas y ficha de producto) y shared/envios.js (calculadora).
 */
(() => {
  'use strict';

  const { STORE, SITE = {}, EXTRAS = [] } = window;
  const CATS = SITE.categories || [];
  const STORY = SITE.story || {};
  const SHIP = SITE.shipping || null;
  const V = window.Vidriera;
  const EN = window.Envios;
  const PAY = window.TB_MODE === 'pago' && Boolean(window.Checkout);

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => '$' + fmt.format(n);
  const plano = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const par = s => { const [a, ...b] = String(s).split('|'); return { t: a.trim(), x: b.join('|').trim() }; };
  const email = (SITE.footer && SITE.footer.email) || 'ventas@xoxotecno.com.ar';
  const dias = () => STORY.warrantyDays || 30;

  const line = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    shield: line('<path d="M12 2.8 4.5 5.6v6.1c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V5.6z"/><path d="m8.6 12.2 2.3 2.3 4.6-4.8"/>'),
    truck: line('<path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
    card: line('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 15h4"/>'),
    mail: line('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>'),
    store: line('<path d="M3.5 9.5h17l-1.2-4.8a1.5 1.5 0 0 0-1.5-1.2H6.2a1.5 1.5 0 0 0-1.5 1.2zM4.5 9.5v10h15v-10M9.5 19.5v-5h5v5"/>'),
    check: line('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    arrow: line('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    plus: line('<path d="M12 5v14M5 12h14"/>'),
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l10.5-6.5z"/></svg>',
    mute: line('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
    sound: line('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  };
  const CAT_ICON = { ventilacion: 'ventilador-pie', contenido: 'mic', audio: 'auricular' };
  const catIcon = c => (V && V.icon(CAT_ICON[c.id])) || '';
  const catOf = id => CATS.find(c => c.id === id) || null;

  /* ---------- Menú de las 4 vistas ---------- */
  function nav(base, actual = '') {
    const link = (href, label, on, color = '') => `<a href="${href}"${on ? ' aria-current="page"' : ''}${color ? ` style="--sx-dot:${esc(color)}"` : ''}>${color ? '<i aria-hidden="true"></i>' : ''}${esc(label)}</a>`;
    return `<nav class="sx-nav" aria-label="Secciones de la tienda">
      ${link(`${base}/`, 'Inicio', !actual)}
      ${CATS.map(c => link(`${base}/${c.id}/`, c.short || c.name, actual === c.id, c.color)).join('')}
    </nav>`;
  }

  /* ---------- Piezas ---------- */
  const head = (kicker, title, text = '') => `
    <header class="sx-head">
      ${kicker ? `<p class="sx-kicker">${esc(kicker)}</p>` : ''}
      <h2 class="sx-title">${esc(title)}</h2>
      ${text ? `<p class="sx-text">${esc(text)}</p>` : ''}
    </header>`;

  // "Ventiladores de pie" → "De pie": el nombre corto del tipo de producto
  const corto = p => { const g = String(p.group || p.name).replace(/^(ventiladores|parlantes|auriculares|micrófonos|luces|trípodes)\s+/i, ''); return g.charAt(0).toUpperCase() + g.slice(1); };

  // Banner con foto de fondo (gente usando los productos), la marca, el título y los productos en círculos
  function banner(c) {
    const list = V ? V.byCat(c.id) : [];
    const conVideo = list.some(p => p.video);
    return `
      <section class="sx-banner" style="--sx-accent:${esc(c.color)};--sx-foto:url('${esc(c.banner)}')">
        <div class="sx-banner-in">
          <div class="sx-banner-copy">
            <p class="sx-banner-brand"><img src="/media/marca/xoxo-avatar.svg" alt=""><span><b>${esc(STORE.name)} · ${esc(c.name)}</b>
              <small>${list.length} producto${list.length === 1 ? '' : 's'} · ${esc(dias())} días de garantía</small></span></p>
            <h1 class="sx-banner-title">${esc(c.title || c.name)}</h1>
            <p class="sx-banner-text">${esc(c.text)}</p>
            <div class="sx-ctas">
              ${conVideo ? `<a class="sx-btn sx-btn-light" href="#sx-videos" data-sx-go="sx-videos">${I.play}Mirá los videos</a>` : ''}
              <a class="sx-btn ${conVideo ? 'sx-btn-glass' : 'sx-btn-light'}" href="#sx-productos" data-sx-go="sx-productos">Ver los productos ${I.arrow}</a>
            </div>
          </div>
          ${list.length ? `<div class="sx-banner-prods" aria-label="Productos de ${esc(c.name)}">${list.slice(0, 3).map(p => `
            <a class="sx-bp js-ficha" href="#x=${esc(p.id)}" data-x="${esc(p.id)}">
              <span class="sx-bp-img sx-bp-svg">${(V && V.icon(p.icon)) || catIcon(c)}</span>
              <span class="sx-bp-name">${esc(corto(p))}</span>
            </a>`).join('')}</div>` : ''}
        </div>
      </section>`;
  }

  function hero(c) {
    if (c.banner) return banner(c);
    const n = V ? V.byCat(c.id).length : 0;
    return `
      <section class="sx-hero" style="--sx-accent:${esc(c.color)}">
        <div class="sx-hero-copy">
          <p class="sx-kicker">${esc(STORE.name)} · ${n} producto${n === 1 ? '' : 's'}</p>
          <h1 class="sx-hero-title">${esc(c.name)}</h1>
          <p class="sx-hero-sub">${esc(c.title)}</p>
          <p class="sx-text">${esc(c.text)}</p>
          <div class="sx-ctas">
            <a class="sx-btn" href="#sx-productos" data-sx-go="sx-productos">Ver los productos ${I.arrow}</a>
            <a class="sx-btn ghost" href="#sx-envios" data-sx-go="sx-envios">Calculá tu envío</a>
          </div>
        </div>
        <div class="sx-hero-art" aria-hidden="true"><span class="sx-ring"></span><span class="sx-ico">${catIcon(c)}</span></div>
      </section>`;
  }

  function beneficios(c) {
    const list = (c.benefits || []).map(par);
    if (!list.length) return '';
    return `
      <section class="sx-benefits" style="--sx-accent:${esc(c.color)}" aria-label="Por qué elegir ${esc(c.name)} en ${esc(STORE.name)}">
        ${list.map(b => `<div class="sx-benefit"><span class="sx-bico">${/garant/i.test(b.t) ? I.shield : I.check}</span><b>${esc(b.t)}</b><span>${esc(b.x)}</span></div>`).join('')}
      </section>`;
  }

  function productos(c) {
    const list = V ? V.byCat(c.id) : [];
    const grupos = [...new Set(list.map(p => p.group))];
    return `
      <section class="sx-products" id="sx-productos" style="--sx-accent:${esc(c.color)}">
        <div class="sx-products-head">
          <h2 class="sx-title">${esc(c.name)}</h2>
          ${grupos.length > 1 ? `<div class="sx-chips" role="group" aria-label="Filtrar">${['', ...grupos].map(g => `<button type="button" class="sx-chip" data-g="${esc(g)}" data-cat="${esc(c.id)}" aria-pressed="${!g}">${esc(g || 'Todos')}</button>`).join('')}</div>` : ''}
        </div>
        <div class="sx-grid">${list.length ? V.gridHTML('', c.id) : '<p class="sx-empty">Muy pronto vas a ver los productos de esta categoría acá.</p>'}</div>
      </section>`;
  }

  // Videos de cada producto, como reels: arrancan solos y sin sonido; el botón activa el sonido
  // o.title cambia el título; o.lista: en el celular van uno debajo del otro en vez de deslizarse de costado
  function videos(c, o = {}) {
    const list = (V ? (c ? V.byCat(c.id) : EXTRAS) : []).filter(p => p.video);
    if (!list.length) return '';
    return `
      <section class="sx-videos${o.lista ? ' sx-videos-lista' : ''}" id="sx-videos" style="--sx-accent:${esc(c ? c.color : 'var(--sx-accent)')}">
        ${head('Mirá cómo funcionan', o.title || 'Los videos de cada producto')}
        <div class="sx-reels">
          ${list.map(p => `
            <article class="sx-reel">
              <a class="sx-reel-media js-ficha" href="#x=${esc(p.id)}" data-x="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
                ${V.coverHTML(p)}${V.previewHTML(p)}
              </a>
              <div class="sx-reel-info">
                <p class="sx-kicker">${esc(p.group || (c && c.name) || '')}${p.brand ? ` · ${esc(p.brand)}` : ''}</p>
                <h3><a class="js-ficha" href="#x=${esc(p.id)}" data-x="${esc(p.id)}">${esc(p.name)}</a></h3>
                ${V.priceHTML(p)}
                <div class="sx-reel-ctas">${PAY ? V.buyButton(p, 'Comprar') : V.waLink(p, 'Pedilo')}
                  <a class="sx-more js-ficha" href="#x=${esc(p.id)}" data-x="${esc(p.id)}">Ver detalles</a></div>
              </div>
            </article>`).join('')}
        </div>
      </section>`;
  }

  // Guía para elegir: cada tarjeta muestra, si lo hay, el producto que le corresponde (por el nombre)
  function guia(c) {
    const list = (c.guide || []).map(par);
    if (!list.length) return '';
    const prods = V ? V.byCat(c.id) : [];
    const STOP = new Set(['de', 'el', 'la', 'en', 'tu', 'mas', 'muy', 'sin', 'por', 'para', 'kit', 'solo', 'todo', 'dia', 'que', 'con', 'una', 'los', 'las', 'del', 'como', 'sabes', 'elegir', 'empezar', 'vos', 'juntada', 'llevar']);
    const match = t => {
      const words = plano(t).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w));
      return prods.find(p => words.some(w => plano(p.name).includes(w)));
    };
    return `
      <section class="sx-guide" style="--sx-accent:${esc(c.color)}">
        ${head('Guía', c.guideTitle || `Cómo elegir en ${c.name}`)}
        <div class="sx-guide-grid">
          ${list.map(g => {
            const p = match(g.t);
            return `<article class="sx-gcard">
              <h3>${esc(g.t)}</h3><p>${esc(g.x)}</p>
              ${p ? `<a class="sx-gprod js-ficha" href="#x=${esc(p.id)}" data-x="${esc(p.id)}"><span>${esc(p.name)}</span><b>${money(p.price)}</b></a>` : ''}
            </article>`;
          }).join('')}
        </div>
      </section>`;
  }

  function pasos() {
    const list = [
      [I.card, 'Comprás online', 'Pagás con Mercado Pago: tarjeta en cuotas, débito, dinero en cuenta o efectivo.'],
      [I.truck, 'Elegís el envío', 'Andreani o Correo Argentino a tu casa o a la sucursal, o retirás gratis en una de nuestras sucursales.'],
      [I.mail, 'Te llega el mail', `Apenas se acredita el pago te escribimos desde ${email} con el detalle y el seguimiento.`],
    ];
    return `
      <section class="sx-steps">
        ${head('Cómo comprar', 'Simple y seguro')}
        <ol class="sx-steps-list">${list.map(([ico, t, x]) => `<li><span class="sx-sico">${ico}</span><h3>${esc(t)}</h3><p>${esc(x)}</p></li>`).join('')}</ol>
      </section>`;
  }

  function garantia() {
    return `
      <section class="sx-warranty">
        <span class="sx-wico">${I.shield}</span>
        <div><h2 class="sx-title">${esc(dias())} días de garantía</h2>
          <p class="sx-text">En todos los productos. Si algo falla, lo resolvemos en la sucursal o por WhatsApp.</p></div>
      </section>`;
  }

  // El envío cuesta lo mismo para cualquier producto (17/11/2026): alcanza con la provincia o el código postal
  function calculadora() {
    if (!SHIP || !EN || !V) return '';
    return `
      <section class="sx-calc" id="sx-envios">
        <div class="sx-calc-copy">
          ${head('Envíos a todo el país', 'Calculá tu envío', 'Con Andreani y Correo Argentino, a domicilio o a sucursal. O retirás gratis en una de nuestras sucursales.')}
        </div>
        <form class="sx-calc-form" novalidate>
          <div class="sx-fld-row">
            <label class="sx-fld"><span>Provincia</span>
              <select name="provincia"><option value="">Elegí…</option>${EN.PROVINCIAS.map(p => `<option>${esc(p.nombre)}</option>`).join('')}</select></label>
            <label class="sx-fld"><span>Código postal</span><input name="cp" maxlength="8" placeholder="4000" autocomplete="postal-code"></label>
          </div>
          <div class="sx-calc-out" aria-live="polite"></div>
        </form>
      </section>`;
  }

  function faq(c) {
    const list = (c.faq || []).map(par);
    if (!list.length) return '';
    return `
      <section class="sx-faq" style="--sx-accent:${esc(c.color)}">
        ${head('Preguntas frecuentes', `Sobre ${c.name.toLowerCase()}`)}
        <div class="sx-faq-list">${list.map(q => `<details><summary>${esc(q.t)}<span aria-hidden="true">${I.plus}</span></summary><p>${esc(q.x)}</p></details>`).join('')}</div>
      </section>`;
  }

  function otras(c, base) {
    const list = CATS.filter(x => x.id !== c.id);
    return `
      <section class="sx-others">
        ${head('Seguí mirando', 'Otras categorías')}
        <div class="sx-others-grid">
          ${list.map(x => `<a class="sx-ocard" href="${base}/${x.id}/" style="--sx-accent:${esc(x.color)}">
            <span class="sx-oico">${catIcon(x)}</span><b>${esc(x.name)}</b><span>${esc(x.title)}</span><em>Ver ${I.arrow}</em></a>`).join('')}
          <a class="sx-ocard" href="${base}/"><span class="sx-oico">${I.store}</span><b>Todo ${esc(STORE.name)}</b><span>Todas las categorías</span><em>Ver ${I.arrow}</em></a>
        </div>
      </section>`;
  }

  // La home completa de una categoría
  // o.videos: opciones de la sección de videos de ese diseño (ver videos())
  function categoria(c, base, o = {}) {
    return `<div class="sx-page" style="--sx-accent:${esc(c.color)}" data-sx-cat="${esc(c.id)}">
      ${hero(c)}${videos(c, o.videos)}${beneficios(c)}${productos(c)}${guia(c)}${pasos()}${calculadora(c.id)}${garantia()}${faq(c)}${otras(c, base)}
    </div>`;
  }

  /* ---------- Inicio sin celulares: toda la tienda en una página ---------- */
  function portadaInicio(base) {
    const provs = [...new Set((STORE.branches || []).map(b => b.province).filter(Boolean))];
    const donde = provs.length ? `Sucursales en ${provs.join(', ').replace(/, ([^,]*)$/, ' y $1')}` : STORE.city;
    return `
      <section class="sx-banner sx-banner-inicio">
        <div class="sx-banner-in">
          <div class="sx-banner-copy">
            <p class="sx-banner-brand"><img src="/media/marca/xoxo-avatar.svg" alt=""><span><b>${esc(STORE.name)}</b><small>${esc(donde)}</small></span></p>
            <h1 class="sx-banner-title">${esc(CATS.map(c => c.name).join(', ').replace(/, ([^,]*)$/, ' y $1'))}</h1>
            <p class="sx-banner-text">Pagalo en hasta 12 cuotas con Mercado Pago o en cuotas con tu tarjeta de débito en ${esc(STORE.financing || 'GO cuotas')}. Envíos a todo el país y ${esc(dias())} días de garantía.</p>
            <div class="sx-ctas">
              <a class="sx-btn sx-btn-light" href="#sx-categorias" data-sx-go="sx-categorias">Ver productos ${I.arrow}</a>
              <a class="sx-btn sx-btn-glass" href="#sx-envios" data-sx-go="sx-envios">Calculá tu envío</a>
            </div>
          </div>
          <div class="sx-banner-prods" aria-label="Categorías">${CATS.map(c => `
            <a class="sx-bp" href="${base}/${c.id}/" style="--sx-accent:${esc(c.color)}">
              <span class="sx-bp-img sx-bp-cat">${catIcon(c)}</span><span class="sx-bp-name">${esc(c.short || c.name)}</span>
            </a>`).join('')}</div>
        </div>
      </section>`;
  }

  function beneficiosInicio() {
    const fin = STORE.financing || 'GO cuotas';
    const list = [
      [I.card, 'Hasta 12 cuotas', 'Con tarjeta de crédito en Mercado Pago.'],
      [I.card, 'Cuotas con débito', `Con tu tarjeta de débito en ${fin}.`],
      [I.truck, 'Envíos a todo el país', 'Andreani y Correo Argentino, o retiro gratis.'],
      [I.shield, `${dias()} días de garantía`, 'En todos los productos.'],
    ];
    return `<section class="sx-benefits" aria-label="Por qué comprar en ${esc(STORE.name)}">${list.map(([i, t, x]) => `
      <div class="sx-benefit"><span class="sx-bico">${i}</span><b>${esc(t)}</b><span>${esc(x)}</span></div>`).join('')}</section>`;
  }

  function categoriasInicio(base) {
    return `
      <section class="sx-cats" id="sx-categorias">
        ${head('Nuestras categorías', '¿Qué estás buscando?')}
        <div class="sx-others-grid">${CATS.map(c => {
          const n = V ? V.byCat(c.id).length : 0;
          return `<a class="sx-ocard" href="${base}/${c.id}/" style="--sx-accent:${esc(c.color)}">
            <span class="sx-oico">${catIcon(c)}</span><b>${esc(c.name)}</b><span>${esc(c.title)}</span><em>${n} producto${n === 1 ? '' : 's'} ${I.arrow}</em></a>`;
        }).join('')}</div>
      </section>`;
  }

  function estantes(base) {
    return CATS.map(c => {
      const list = V ? V.byCat(c.id) : [];
      if (!list.length) return '';
      return `
        <section class="sx-products sx-shelf" style="--sx-accent:${esc(c.color)}">
          <div class="sx-products-head"><h2 class="sx-title">${esc(c.name)}</h2><a class="sx-seeall" href="${base}/${c.id}/">Ver todo ${I.arrow}</a></div>
          <div class="sx-grid"><div class="xgrid">${list.slice(0, 4).map(V.cardHTML).join('')}</div></div>
        </section>`;
    }).join('');
  }

  function sucursales() {
    const porProv = {};
    for (const b of STORE.branches || []) (porProv[b.province || STORE.city] = porProv[b.province || STORE.city] || []).push(b);
    const provs = Object.entries(porProv);
    if (!provs.length) return '';
    return `
      <section class="sx-branches" id="sx-sucursales">
        ${head('Sucursales', 'Vení a conocernos')}
        <div class="sx-prov-grid">${provs.map(([prov, list]) => `
          <div class="sx-prov"><h3>${esc(prov)}</h3><ul>${list.map(b => `<li><b>${esc(b.name)}</b><span>${esc(b.address)}</span>
            ${b.address && !/a confirmar/i.test(b.address) ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}</li>`).join('')}</ul></div>`).join('')}</div>
      </section>`;
  }

  // El inicio completo, para los diseños que antes mostraban celulares (Red social y Minimalista)
  function inicio(base, o = {}) {
    return `<div class="sx-page sx-inicio">
      ${portadaInicio(base)}${beneficiosInicio()}${categoriasInicio(base)}${estantes(base)}${videos(null, o.videos)}${sucursales()}${pasos()}${calculadora()}${garantia()}
    </div>`;
  }

  // Para el inicio de cada diseño: garantía, cómo comprar y calculadora
  const info = () => `<div class="sx-page sx-info">${garantia()}${pasos()}${calculadora()}</div>`;

  /* ---------- Comportamiento ---------- */
  function calc(form) {
    const out = $('.sx-calc-out', form);
    try {
      const b = JSON.parse(localStorage.getItem('cc:buyer') || 'null') || {};
      if (b.province) form.elements.provincia.value = b.province;
      if (b.cp) form.elements.cp.value = b.cp;
    } catch {}
    const recordar = () => {
      try {
        const b = JSON.parse(localStorage.getItem('cc:buyer') || 'null') || {};
        localStorage.setItem('cc:buyer', JSON.stringify({ ...b, province: form.elements.provincia.value, cp: form.elements.cp.value }));
      } catch {}
    };
    // Si en /admin → Envíos se vuelve a poner un recargo por kg, los precios se muestran "desde" (1 kg)
    const porKg = Object.values(SHIP.rates || {}).filter(r => r && r.on && r.extraKg > 0);
    function pintar() {
      const prov = EN.provincia(form.elements.provincia.value);
      if (!prov) { out.innerHTML = '<p class="sx-hint">Elegí tu provincia o escribí tu código postal.</p>'; return; }
      const ops = EN.opciones(SHIP, prov.zona, 1, 0);
      const cerca = (STORE.branches || []).filter(b => b.province && EN.provincia(b.province) && EN.provincia(b.province).nombre === prov.nombre);
      out.innerHTML = `
        <table class="sx-quotes"><tbody>
          ${SHIP.pickup ? `<tr><td><b>Retiro en sucursal</b><small>${cerca.length ? `${cerca.length} sucursal${cerca.length === 1 ? '' : 'es'} en ${esc(prov.nombre)}` : 'En nuestras sucursales'}</small></td><td>Gratis</td></tr>` : ''}
          ${ops.map(o => `<tr class="sx-q-${o.empresa}"><td><b>${esc(o.nombre)}</b><small>Llega en ${esc(EN.diasTexto(o.dias))}</small></td><td>${o.costo ? `${porKg.length ? 'Desde ' : ''}${money(o.costo)}` : 'Gratis'}</td></tr>`).join('')}
        </tbody></table>
        <p class="sx-note">${porKg.length ? 'Precio para productos de hasta 1 kg; los más pesados suman un poco más.' : 'El mismo precio para cualquier producto.'}
          ${SHIP.freeFrom > 0 ? `Gratis en compras desde ${money(SHIP.freeFrom)}.` : ''} El total exacto lo ves antes de pagar.</p>`;
    }
    form.addEventListener('change', () => { pintar(); recordar(); });
    form.elements.cp.addEventListener('input', () => {
      const prov = EN.provinciaDeCp(form.elements.cp.value);
      if (prov) form.elements.provincia.value = prov.nombre;
      pintar();
      recordar();
    });
    form.addEventListener('submit', e => e.preventDefault());
    pintar();
  }

  // Videos: tocar el producto abre su ficha (foto y detalles). El video arranca solo y sin sonido al pasar
  // el mouse o cuando queda en el medio de la pantalla del celular (shared/vidriera.js); con sonido, en la ficha.

  // Los botones "Ver los productos" y "Calculá tu envío" bajan sin tocar la dirección (los diseños usan el # para navegar)
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-sx-go]');
    if (!a) return;
    const el = document.getElementById(a.dataset.sxGo);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  // Activa lo que haya en root: calculadoras y filtros de productos
  function init(root = document) {
    $$('.sx-calc-form', root).forEach(form => {
      if (form.dataset.sxOn) return;
      form.dataset.sxOn = '1';
      calc(form);
    });
    $$('.sx-chips', root).forEach(box => {
      if (box.dataset.sxOn) return;
      box.dataset.sxOn = '1';
      box.addEventListener('click', e => {
        const b = e.target.closest('.sx-chip');
        if (!b) return;
        $$('.sx-chip', box).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        box.closest('.sx-products').querySelector('.sx-grid').innerHTML = V.gridHTML(b.dataset.g, b.dataset.cat);
      });
    });
  }

  window.Secciones = { nav, categoria, info, inicio, sucursales, hero, banner, videos, beneficios, productos, guia, pasos, garantia, calculadora, faq, otras, init, icon: k => I[k], catIcon, cats: CATS };
})();
