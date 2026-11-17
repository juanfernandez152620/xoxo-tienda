/* XOXO Tecno · diseño C "Historia": una página que se cuenta con el scroll.
 * Inicio (/historia/): quiénes somos (los 3 socios), el equipo, las sucursales, la garantía, cómo comprar
 * (Mercado Pago → envío → mail de confirmación), la calculadora de envíos y las 3 categorías con sus productos.
 * Categoría (/historia/ventilacion/, /contenido/, /audio/): la categoría primero y después lo mismo, más corto.
 * Los textos vienen de /admin (window.SITE.story); los productos, de la vidriera (shared/vidriera.js).
 * Las animaciones siguen al scroll con dos piezas: [data-reveal] aparece al entrar en pantalla y [data-scroll]
 * recibe --p (de 0 a 1) mientras cruza la pantalla. Con "reducir movimiento" todo queda quieto.
 */
(() => {
  'use strict';

  const { STORE, SITE, EXTRAS = [] } = window;
  const CATS = SITE.categories || [];
  const STORY = SITE.story || {};
  const SHIP = SITE.shipping || null;
  const V = window.Vidriera;
  const FL = window.Flash;
  const EN = window.Envios;
  const PAY = window.TB_MODE === 'pago' && Boolean(window.Checkout);
  const CAT = CATS.find(c => c.id === window.CATEGORIA) || null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => '$' + fmt.format(n);
  const catUrl = c => `/historia/${c.id}/`;
  const emailTienda = (SITE.footer && SITE.footer.email) || 'ventas@xoxotecno.com.ar';

  const line = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41"/></svg>',
    sun: line('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
    moon: line('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
    arrow: line('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    down: line('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    shield: line('<path d="M12 2.8 4.5 5.6v6.1c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V5.6z"/><path d="m8.6 12.2 2.3 2.3 4.6-4.8"/>'),
    truck: line('<path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
    card: line('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 15h4"/>'),
    mail: line('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>'),
    pin: line('<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
    store: line('<path d="M3.5 9.5h17l-1.2-4.8a1.5 1.5 0 0 0-1.5-1.2H6.2a1.5 1.5 0 0 0-1.5 1.2zM4.5 9.5v10h15v-10M9.5 19.5v-5h5v5"/>'),
    check: line('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    sonido: line('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    mudo: line('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  };

  /* ---------- Piezas ---------- */
  // Foto de una persona, o un retrato de ejemplo mientras no haya foto (se carga en /admin → Historia)
  const TONOS = ['#63a3d1', '#ec4899', '#8b5cf6', '#38bdf8', '#c1f4a4', '#294562'];
  function retrato(p, i, extraCls = '') {
    if (p.photo) return `<img class="ph-img ${extraCls}" src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`;
    return `<div class="ph ${extraCls}" style="--h:${TONOS[i % TONOS.length]}" role="img" aria-label="Foto de ejemplo de ${esc(p.name)}">
      <svg viewBox="0 0 100 120" aria-hidden="true"><circle cx="50" cy="44" r="19"/><path d="M13 120c2-27 17-41 37-41s35 14 37 41z"/></svg>
      <span class="ph-tag">Foto de ejemplo</span></div>`;
  }

  const sectionHead = (kicker, title, text = '', cls = '') => `
    <header class="sec-head ${cls}" data-reveal>
      ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}
      <h2 class="sec-title">${esc(title)}</h2>
      ${text ? `<p class="sec-text">${esc(text)}</p>` : ''}
    </header>`;

  // Tarjetas de producto (las de la vidriera) con aparición escalonada
  const cards = list => `<div class="xgrid h-grid">${list.map((p, i) => `<div class="h-card" data-reveal style="--i:${i % 8}">${V.cardHTML(p)}</div>`).join('')}</div>`;

  /* ---------- Secciones del inicio ---------- */
  function heroHome() {
    return `
      <section class="hero" data-scroll>
        <div class="hero-bg" aria-hidden="true"><span class="orb o1"></span><span class="orb o2"></span><span class="orb o3"></span></div>
        <div class="hero-inner">
          <p class="kicker hero-kicker">${esc(STORY.kicker || STORE.name)}</p>
          <div class="hero-logo" aria-hidden="true">${$('.logo-svg').outerHTML}</div>
          <h1 class="hero-title">${esc(STORY.title || STORE.name)}</h1>
          <p class="hero-text">${esc(STORY.text)}</p>
          <div class="hero-ctas">
            <a class="btn" href="#categorias">Ver productos ${I.arrow}</a>
            <a class="btn ghost" href="#envios">Calculá tu envío</a>
          </div>
        </div>
        <a class="scroll-cue" href="#socios" aria-label="Seguir bajando">${I.down}</a>
      </section>`;
  }

  // Los 3 socios: las fotos llegan apiladas y se abren mientras bajás
  function socios() {
    const f = (STORY.founders || []).slice(0, 3);
    return `
      <section class="founders" id="socios" data-scroll>
        <div class="founders-sticky">
          <div class="founders-copy">
            <p class="kicker" data-reveal>Quiénes somos</p>
            <h2 class="sec-title" data-reveal>${esc(STORY.foundersTitle)}</h2>
            <p class="sec-text" data-reveal>${esc(STORY.foundersText)}</p>
          </div>
          <div class="founders-cards">
            ${f.map((p, i) => `
              <figure class="founder" style="--k:${i - 1}">
                ${retrato(p, i)}
                <figcaption><b>${esc(p.name)}</b><span>${esc(p.role)}</span></figcaption>
              </figure>`).join('')}
          </div>
        </div>
      </section>`;
  }

  function numeros() {
    const st = STORY.stats || [];
    if (!st.length) return '';
    return `
      <section class="stats" aria-label="XOXO Tecno en números">
        ${st.map((x, i) => `
          <div class="stat" data-reveal style="--i:${i}">
            <b class="js-count" data-to="${esc(x.v)}">${esc(x.v)}</b><span>${esc(x.l)}</span>
          </div>`).join('')}
      </section>`;
  }

  function equipo() {
    const t = STORY.team || [];
    if (!t.length) return '';
    return `
      <section class="team wrap">
        ${sectionHead('El equipo', STORY.teamTitle, STORY.teamText)}
        <div class="team-grid">
          ${t.map((p, i) => `
            <figure class="member" data-reveal style="--i:${i}">
              ${retrato(p, i + 1)}
              <figcaption><b>${esc(p.name)}</b><span>${esc(p.role)}</span></figcaption>
            </figure>`).join('')}
        </div>
      </section>`;
  }

  // Sucursales agrupadas por provincia, sobre una línea que se dibuja con el scroll
  function sucursales() {
    const porProv = {};
    for (const b of STORE.branches || []) (porProv[b.province || STORE.city] = porProv[b.province || STORE.city] || []).push(b);
    const provs = Object.entries(porProv);
    if (!provs.length) return '';
    return `
      <section class="branches wrap" id="sucursales" data-scroll>
        ${sectionHead('Sucursales', STORY.branchesTitle, STORY.branchesText)}
        <div class="route">
          <span class="route-line" aria-hidden="true"><i></i></span>
          ${provs.map(([prov, list], i) => `
            <article class="prov" data-reveal style="--i:${i}">
              <span class="prov-pin" aria-hidden="true">${I.pin}</span>
              <h3>${esc(prov)}</h3>
              <ul>${list.map(b => `
                <li><b>${esc(b.name)}</b><span>${esc(b.address)}</span>
                  ${b.address && !/a confirmar/i.test(b.address) ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}</li>`).join('')}
              </ul>
            </article>`).join('')}
        </div>
      </section>`;
  }

  function garantia() {
    const d = STORY.warrantyDays;
    if (!d) return '';
    return `
      <section class="warranty" data-scroll>
        <div class="warranty-num" aria-hidden="true"><b>${esc(d)}</b><span>días</span></div>
        <div class="warranty-copy" data-reveal>
          <span class="badge-ico">${I.shield}</span>
          <h2 class="sec-title">${esc(STORY.warrantyTitle)}</h2>
          <p class="sec-text"><b>${esc(d)} días de garantía</b> en todos los productos. ${esc(STORY.warrantyText)}</p>
        </div>
      </section>`;
  }

  // Cómo comprar: tres pasos sobre una línea que se llena con el scroll
  function comoComprar() {
    const pasos = [
      [I.card, 'Comprás online', 'Elegí tu producto y pagá con Mercado Pago: tarjeta en cuotas, débito, dinero en cuenta o efectivo.'],
      [I.truck, 'Elegís el envío', 'Andreani o Correo Argentino a tu casa o a la sucursal, o retirás gratis en una de nuestras sucursales.'],
      [I.mail, 'Te llega el mail', `Apenas se acredita el pago te escribimos desde ${emailTienda} con el detalle y el seguimiento.`],
    ];
    return `
      <section class="steps wrap" id="como-comprar" data-scroll>
        ${sectionHead('Cómo comprar', 'Simple, en tres pasos', '')}
        <ol class="steps-list">
          <span class="steps-line" aria-hidden="true"><i></i></span>
          ${pasos.map(([ico, t, x], i) => `
            <li class="step" data-reveal style="--i:${i}">
              <span class="step-ico">${ico}<em>${i + 1}</em></span>
              <h3>${esc(t)}</h3><p>${esc(x)}</p>
            </li>`).join('')}
        </ol>
        <div class="mail-demo" data-reveal aria-label="Así se ve el mail de confirmación">
          <div class="mail-top"><span></span><span></span><span></span></div>
          <p class="mail-from"><b>${esc(STORE.name)}</b> &lt;${esc(emailTienda)}&gt;</p>
          <p class="mail-subject">Recibimos tu pago · pedido #A1B2C3</p>
          <div class="mail-body">
            <i style="width:82%"></i><i style="width:64%"></i>
            <div class="mail-row"><span>Producto</span><span>${money(39999)}</span></div>
            <div class="mail-row"><span>Envío Andreani</span><span>${money(9500)}</span></div>
            <div class="mail-row total"><span>Total pagado</span><span>${money(49499)}</span></div>
          </div>
        </div>
      </section>`;
  }

  // Calculadora de envíos: la misma cuenta que el checkout y el servidor (shared/envios.js).
  // El envío cuesta lo mismo para cualquier producto (17/11/2026): alcanza con la provincia o el código postal.
  function calculadora() {
    if (!SHIP || !EN) return '';
    return `
      <section class="calc wrap" id="envios">
        <div class="calc-copy" data-reveal>
          <p class="kicker">Envíos a todo el país</p>
          <h2 class="sec-title">Calculá tu envío</h2>
          <p class="sec-text">Enviamos con <b>Andreani</b> y <b>Correo Argentino</b>, a domicilio o a sucursal. Si estás cerca, retirás gratis en cualquiera de nuestras sucursales.</p>
          <ul class="carriers"><li class="c-and">Andreani</li><li class="c-ca">Correo Argentino</li><li class="c-ret">Retiro gratis</li></ul>
        </div>
        <form class="calc-form" data-reveal novalidate>
          <div class="fld-row">
            <label class="fld"><span>Provincia</span>
              <select name="provincia"><option value="">Elegí…</option>${EN.PROVINCIAS.map(p => `<option>${esc(p.nombre)}</option>`).join('')}</select></label>
            <label class="fld"><span>Código postal</span>
              <input name="cp" maxlength="8" placeholder="4000" autocomplete="postal-code"></label>
          </div>
          <div class="calc-out" aria-live="polite"></div>
        </form>
      </section>`;
  }

  function categorias(sinEsta) {
    const list = CATS.filter(c => !sinEsta || c.id !== sinEsta.id);
    return `
      <section class="cats wrap" id="categorias">
        ${sectionHead(sinEsta ? 'Seguí mirando' : 'Nuestras categorías', sinEsta ? 'Otras categorías' : 'Tres mundos, una tienda', '')}
        <div class="cat-tiles">
          ${list.map((c, i) => {
            const n = V.byCat(c.id).length;
            const ico = { ventilacion: 'ventilador', contenido: 'mic', audio: 'auricular' }[c.id];
            return `
              <a class="cat-tile" href="${catUrl(c)}" data-reveal style="--i:${i};--c:${esc(c.color)}">
                <span class="cat-ico">${V.icon(ico) || ''}</span>
                <span class="cat-name">${esc(c.name)}</span>
                <span class="cat-title">${esc(c.title)}</span>
                <span class="cat-go">${n} producto${n === 1 ? '' : 's'} ${I.arrow}</span>
              </a>`;
          }).join('')}
        </div>
      </section>`;
  }

  // En el inicio: una fila de productos por categoría
  function productosHome() {
    return CATS.map(c => {
      const list = V.byCat(c.id);
      if (!list.length) return '';
      return `
        <section class="shelf wrap" style="--c:${esc(c.color)}" aria-labelledby="shelf-${c.id}">
          <header class="shelf-head" data-reveal>
            <h2 class="sec-title" id="shelf-${c.id}">${esc(c.name)}</h2>
            <a class="more" href="${catUrl(c)}">Ver todo ${I.arrow}</a>
          </header>
          ${cards(list.slice(0, 4))}
        </section>`;
    }).join('');
  }

  /* ---------- Página de categoría ---------- */
  function heroCategoria(c) {
    const ico = { ventilacion: 'ventilador', contenido: 'mic', audio: 'auricular' }[c.id];
    return `
      <section class="hero hero-cat" style="--c:${esc(c.color)}" data-scroll>
        <div class="hero-bg" aria-hidden="true"><span class="orb o1"></span><span class="orb o2"></span></div>
        <div class="hero-inner">
          <p class="kicker hero-kicker"><a href="/historia/">${esc(STORE.name)}</a></p>
          <div class="cat-hero-art" aria-hidden="true"><span class="cat-hero-ico">${V.icon(ico) || ''}</span></div>
          <h1 class="hero-title">${esc(c.name)}</h1>
          <p class="hero-sub">${esc(c.title)}</p>
          <p class="hero-text">${esc(c.text)}</p>
          <div class="hero-ctas"><a class="btn" href="#productos">Ver los productos ${I.arrow}</a><a class="btn ghost" href="#envios">Calculá tu envío</a></div>
        </div>
      </section>`;
  }

  function franja() {
    const d = STORY.warrantyDays;
    const items = [
      [I.shield, d ? `${d} días de garantía` : 'Garantía en todo'],
      [I.truck, 'Envíos con Andreani y Correo Argentino'],
      [I.card, 'Pagá con Mercado Pago'],
      [I.store, 'Retiro gratis en sucursal'],
    ];
    const fila = items.map(([i, t]) => `<span>${i}${esc(t)}</span>`).join('');
    return `<div class="ribbon" aria-label="Por qué comprar en XOXO"><div class="ribbon-track">${fila}${fila}</div></div>`;
  }

  function productosCategoria(c) {
    const list = V.byCat(c.id);
    const grupos = [...new Set(list.map(p => p.group))];
    return `
      <section class="shelf wrap" id="productos" style="--c:${esc(c.color)}">
        <header class="shelf-head" data-reveal>
          <h2 class="sec-title">${list.length} producto${list.length === 1 ? '' : 's'}</h2>
          ${grupos.length > 1 ? `<div class="chips" role="group" aria-label="Filtrar">${['Todos', ...grupos].map((g, i) => `<button type="button" class="chip" data-g="${i ? esc(g) : ''}" aria-pressed="${i === 0}">${esc(g)}</button>`).join('')}</div>` : ''}
        </header>
        <div class="js-cat-grid">${list.length ? cards(list) : '<p class="empty">Muy pronto vas a ver los productos de esta categoría acá.</p>'}</div>
      </section>`;
  }

  /* ---------- Ventilación: la versión de la confianza (17/11/2026) ----------
     La prueba ABC compara qué pesa más para el cliente: el precio (Red social), el producto (Minimalista) o la
     confianza (Historia). Acá, en los primeros 5 segundos: quiénes somos y la oferta flash; enseguida, cada
     ventilador como un capítulo con su historia, su video y la compra a un toque. Nada de relleno: lo que en
     /admin → Historia sigue siendo de ejemplo (lorem ipsum, "Socio 1", sin foto) no se muestra. */
  const CAPITULOS = {
    ventilacion: [
      { id: 'ventilador-piso-exahome-turbo-20', ocasion: 'Para las fiestas', color: '#ec4899', titulo: 'Para la mesa larga de las fiestas',
        historia: 'Nochebuena en el patio, el quincho lleno, la mesa larga. El Turbo de 20 pulgadas mueve mucho aire en ambientes grandes: lo inclinás hacia la mesa y el brindis sale fresco.' },
      { id: 'ventilador-pie-delhi-18', ocasion: 'Para tu casa', color: '#63a3d1', titulo: 'Para el día a día en tu casa',
        historia: 'Del living a la cocina y de la cocina al comedor: gira de lado a lado y refresca hasta 30 m². Lo subís para la mesa o lo bajás para el sillón.' },
      { id: 'ventilador-techo-kanji', ocasion: 'Para tu pieza', color: '#8b5cf6', titulo: 'Para dormir fresco en tu pieza',
        historia: 'Lo manejás con el control desde la cama y el timer lo apaga cuando ya te dormiste. Al apagarlo, las aspas se esconden. Y en invierno, función reversa.' },
    ],
  };
  const sinRelleno = t => String(t || '').replace(/\s*Lorem ipsum[\s\S]*$/i, '').trim();
  const esReal = p => Boolean(p && p.photo && p.name && !/^Socio \d+$/i.test(p.name));
  const listaY = arr => arr.join(', ').replace(/, ([^,]*)$/, ' y $1');
  const conDireccion = b => b.address && !/a confirmar/i.test(b.address);
  const flashOn = () => Boolean(FL && FL.cfg && FL.cfg.on && FL.cfg.percent > 0);
  const sinInteres = STORE.sinInteres ? ' sin interés' : '';
  const cuotaDe = (precio, n) => money(Math.ceil(precio / n));
  const goImg = () => (STORE.financingLogo && STORE.financingLogo.color
    ? `<img class="hv-go" src="${esc(STORE.financingLogo.color)}" alt="${esc(STORE.financing)}">` : esc(STORE.financing || ''));
  const capitulosDe = c => (CAPITULOS[c.id] || []).map(k => ({ ...k, p: EXTRAS.find(p => p.id === k.id) })).filter(k => k.p);

  // 1. Portada: una sola pantalla, lo que el cliente ve en los primeros segundos
  function hvPortada(c) {
    const provs = [...new Set((STORE.branches || []).map(b => b.province).filter(Boolean))];
    const socios = (STORY.founders || []).filter(esReal).slice(0, 3);
    const d = STORY.warrantyDays || 30;
    return `
      <section class="hv-hero" data-scroll>
        <div class="hv-hero-in wrap">
          <div class="hv-hero-copy">
            <p class="kicker hv-anim" style="--i:0">Somos ${esc(STORE.name)}</p>
            <h1 class="hv-title hv-anim" style="--i:1">Los ventiladores que elegimos para estas fiestas</h1>
            <ul class="hv-trust hv-anim" style="--i:2">
              <li>${I.store}<span>${esc((STORY.founders || []).length || 3)} socios y sucursales en ${esc(listaY(provs))}</span></li>
              <li>${I.shield}<span>${esc(d)} días de garantía en todo</span></li>
              <li>${I.wa}<span>Por WhatsApp te contesta una persona</span></li>
            </ul>
            ${socios.length ? `<div class="hv-socios hv-anim" style="--i:3">${socios.map((p, i) => `
              <figure class="hv-socio" style="--k:${i}">${retrato(p, i)}<figcaption>${esc(p.name)}</figcaption></figure>`).join('')}</div>` : ''}
            ${flashOn() ? `<p class="hv-flash hv-anim fl-only" style="--i:3"><b>-${FL.cfg.percent}% flash</b> con el cupón <b>${esc(FL.cupon())}</b> · termina en <b class="js-flash-reloj">${FL.reloj(FL.restante())}</b></p>` : ''}
            <div class="hv-ctas hv-anim" style="--i:4">
              <a class="btn" href="#cap-1" data-sx-go="cap-1">Ver los ventiladores ${I.down}</a>
              <a class="btn ghost js-wa js-wa-general" data-donde="portada" target="_blank" rel="noopener">${I.wa}Hablar con nosotros</a>
            </div>
          </div>
          ${c.banner ? `<figure class="hv-hero-foto" aria-hidden="true"><img src="${esc(c.banner)}" alt="" fetchpriority="high" decoding="async"></figure>` : ''}
        </div>
      </section>`;
  }

  /* 2. La historia, después del banner: los socios, el equipo y las sucursales, armados igual que los capítulos
        de los ventiladores (mismo marco vertical, mismo encabezado, misma historia y el recuadro al final).
        Cada parte cuenta el porqué y termina en su promesa: la garantía, las cuotas y los envíos.
        Los textos de /admin → Historia se usan cuando ya son reales; los porqués son de acá. */
  const textoReal = (t, porDefecto) => sinRelleno(t) || porDefecto;
  const nombreReal = n => Boolean(n && !/^(socio \d+|lorem|ipsum|dolor|sit|amet|elit|consectetur)$/i.test(String(n).trim()));

  // Fotos de ejemplo (marcadas así) hasta que se carguen las reales en /admin → Historia y → Sucursales
  const SILUETA = {
    persona: '<svg viewBox="0 0 100 120" aria-hidden="true"><circle cx="50" cy="44" r="19"/><path d="M13 120c2-27 17-41 37-41s35 14 37 41z"/></svg>',
    grupo: '<svg viewBox="0 0 160 100" aria-hidden="true"><circle cx="40" cy="42" r="13"/><path d="M14 100c2-19 12-29 26-29s24 10 26 29z"/><circle cx="120" cy="42" r="13"/><path d="M94 100c2-19 12-29 26-29s24 10 26 29z"/><circle cx="80" cy="34" r="15"/><path d="M50 100c2-23 14-34 30-34s28 11 30 34z"/></svg>',
    local: '<svg viewBox="0 0 120 100" aria-hidden="true"><path d="M10 38h100l-8-24H18z"/><rect x="18" y="42" width="84" height="54" rx="2"/><rect x="30" y="56" width="22" height="40" fill-opacity=".5"/><rect x="62" y="56" width="30" height="20" fill-opacity=".5"/></svg>',
  };
  const fotoOEjemplo = (src, que, forma, tono) => (src
    ? `<img class="ph-img" src="${esc(src)}" alt="${esc(que)}" loading="lazy" decoding="async">`
    : `<div class="ph hv-ph hv-ph-${forma}" style="--h:${tono}" role="img" aria-label="Foto de ejemplo: ${esc(que)}">${SILUETA[forma]}<span class="ph-tag">Foto de ejemplo</span></div>`);

  // Pila de fotos: la de adelante entera y las otras asomando detrás, a los costados. Llega como un abanico de
  // cartas y se acomoda al aparecer; se pasa deslizando con el dedo (o arrastrando con el mouse), tocando una
  // de atrás, con las flechas o con el teclado (hvCarruseles)
  const carrusel = (fotos, que) => {
    const varias = fotos.length > 1;
    return `
      <div class="hv-carrusel-box">
        <div class="hv-pila${varias ? '' : ' abierto'}" tabindex="0" role="group" aria-roledescription="carrusel" aria-label="Fotos de ${esc(que)}${varias ? '. Deslizá para ver más' : ''}">${fotos.map((f, i) => `
          <figure class="hv-pila-c" style="--d:${i};--a:${i}">${f.foto}${f.nombre ? `<figcaption>${esc(f.nombre)}</figcaption>` : ''}</figure>`).join('')}
        </div>
        ${varias ? `
        <div class="hv-pila-nav">
          <button type="button" class="hv-car-btn hv-car-prev" data-d="-1" aria-label="Foto anterior">${I.arrow}</button>
          <div class="hv-dots" aria-hidden="true">${fotos.map((f, i) => `<span${i ? '' : ' class="on"'}></span>`).join('')}</div>
          <button type="button" class="hv-car-btn hv-car-next" data-d="1" aria-label="Foto siguiente">${I.arrow}</button>
        </div>` : ''}
      </div>`;
  };

  // Cada parte, igual que un capítulo: las fotos de un lado; el encabezado, la historia y la promesa del otro
  const hvParte = ({ id, alt, color, etiqueta, titulo, parrafos, promesa, visual }) => `
    <section class="hv-cap hv-parte${alt ? ' hv-cap-alt' : ''}" id="${id}" data-scroll style="--c:${color}">
      <div class="hv-cap-in wrap">
        <div class="hv-cap-media">${visual}</div>
        <div class="hv-cap-copy">
          <p class="kicker hv-ocasion" data-reveal style="--i:0">Somos ${esc(STORE.name)}<span>${esc(etiqueta)}</span></p>
          <h2 class="hv-cap-title" data-reveal style="--i:1">${titulo}</h2>
          ${parrafos.filter(Boolean).map((t, i) => `<p class="hv-cap-story" data-reveal style="--i:${i + 2}">${t}</p>`).join('')}
          <div class="hv-compra hv-promesa-fin" data-reveal style="--i:4">
            <span class="hv-pf-ico">${promesa.ico}</span>
            <div><b class="hv-pf-t">${promesa.titulo}</b><p>${promesa.texto}</p>${promesa.extra || ''}</div>
          </div>
        </div>
      </div>
    </section>`;

  // Los 3 socios, en una sola foto: por qué damos garantía
  function hvSocios() {
    const n = (STORY.founders || []).length || 3;
    const d = STORY.warrantyDays || 30;
    return hvParte({
      id: 'socios', color: '#63a3d1', etiqueta: 'Los socios',
      titulo: `${esc(n)} socios detrás de cada venta`,
      parrafos: [
        esc(textoReal(STORY.foundersText, `Arrancamos ${STORE.name} entre tres y elegimos cada producto que vendemos: lo que no pondríamos en nuestra casa, no lo vendemos.`)),
        'Sabemos lo que es comprar algo y quedarse con la duda de qué pasa si falla. Preferimos que esa duda sea nuestra y no tuya.',
      ],
      promesa: {
        ico: I.shield, titulo: `Por eso te damos ${esc(d)} días de garantía`,
        texto: esc(textoReal(STORY.warrantyText, `Si algo no anda en los primeros ${d} días, lo resolvemos en la sucursal o por WhatsApp, sin vueltas.`)),
      },
      visual: carrusel([{ foto: fotoOEjemplo(STORY.foundersPhoto, `los ${n} socios de ${STORE.name}`, 'grupo', '#63a3d1') }], 'los socios'),
    });
  }

  // El equipo: por qué te damos cuotas y por qué el pago es seguro
  function hvEquipo() {
    const t = (STORY.team || []).slice(0, 8);
    const n = Number(STORE.extras.cuotas) || 6;
    const debito = STORE.financing ? `, o <b>${esc(n)} cuotas${sinInteres} con tu tarjeta de débito</b> en ${goImg()}` : '';
    const fotos = (t.length ? t : [{}, {}, {}]).map((p, i) => {
      const nombre = nombreReal(p.name) ? p.name : '';
      return { foto: fotoOEjemplo(p.photo, nombre || 'alguien del equipo', 'persona', TONOS[(i + 1) % TONOS.length]), nombre };
    });
    return hvParte({
      id: 'equipo', alt: true, color: '#ec4899', etiqueta: 'El equipo',
      titulo: esc(textoReal(STORY.teamTitle, 'Un equipo que te atiende de verdad')),
      parrafos: [
        esc(textoReal(STORY.teamText, 'Te asesoramos en el local y por WhatsApp, y armamos cada pedido.')),
        'Un ventilador lo necesitás cuando aprieta el calor, no cuando cobrás. Y no todos tienen tarjeta de crédito: por eso también aceptamos el débito en cuotas.',
      ],
      promesa: {
        ico: I.card, titulo: 'Por eso te damos cuotas, y con pago seguro',
        texto: `Hasta <b>12 cuotas${sinInteres} con tarjeta de crédito</b> por Mercado Pago${debito}. Pagás en sus plataformas: los datos de tu tarjeta nunca pasan por nosotros.`,
      },
      visual: carrusel(fotos, 'el equipo'),
    });
  }

  // Las sucursales: por qué enviamos a todo el país y el retiro es gratis
  function hvSucursales() {
    const branches = STORE.branches || [];
    const conDir = branches.filter(conDireccion);
    const otras = [...new Set(branches.filter(b => !conDireccion(b)).map(b => b.province).filter(Boolean))];
    const provs = [...new Set(branches.map(b => b.province).filter(Boolean))];
    const fotos = [...conDir, ...branches.filter(b => !conDireccion(b))]
      .map((b, i) => ({ foto: fotoOEjemplo(b.photo, `el local de ${b.name}`, 'local', TONOS[(i + 3) % TONOS.length]), nombre: b.province && b.province !== b.name ? `${b.name} · ${b.province}` : b.name }));
    const dirs = conDir.length ? `
      <ul class="hv-dirs">${conDir.map(b => `
        <li>${I.pin}<span><b>${esc(b.name)}</b>${esc(b.address)}</span><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}" target="_blank" rel="noopener">Cómo llegar</a></li>`).join('')}
        ${otras.length ? `<li class="hv-dirs-mas">${I.pin}<span>También estamos en ${esc(listaY(otras))}</span></li>` : ''}
      </ul>` : '';
    return hvParte({
      id: 'sucursales', color: '#8b5cf6', etiqueta: 'Las sucursales',
      titulo: esc(textoReal(STORY.branchesTitle, `Sucursales en ${listaY(provs)}`)),
      parrafos: [
        esc(textoReal(STORY.branchesText, 'Vení a ver los ventiladores funcionando antes de llevarte el tuyo.')),
        'El calor no es de una sola provincia, y no todos tienen una sucursal a la vuelta. Queremos que cualquiera pueda tener su ventilador, viva donde viva.',
      ],
      promesa: {
        ico: I.truck, titulo: 'Por eso enviamos a todo el país, y retirar es gratis',
        texto: 'Con <b>Andreani</b> o <b>Correo Argentino</b>, a tu casa o a la sucursal del correo, con seguimiento. Y si estás cerca, lo retirás <b>sin cargo en cualquiera de nuestras sucursales</b>.',
        extra: dirs,
      },
      visual: fotos.length ? carrusel(fotos, 'las sucursales') : '',
    });
  }

  // Pilas de fotos: el abanico se acomoda al aparecer; después se pasan de a una, en ronda (de la última a la primera)
  function hvCarruseles() {
    const pilas = $$('.hv-pila');
    if (!pilas.length) return;
    const abrir = p => p.classList.add('abierto');
    if (reduce.matches || !('IntersectionObserver' in window)) pilas.forEach(abrir);
    else {
      const io = new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting) { abrir(e.target); io.unobserve(e.target); }
      }, { threshold: 0.4 });
      pilas.forEach(p => io.observe(p));
    }

    pilas.forEach(pila => {
      const cartas = $$('.hv-pila-c', pila);
      const n = cartas.length;
      const dots = $$('.hv-dots span', pila.parentElement);
      let cur = 0;
      // Distancia de cada foto a la de adelante: 0 adelante, -1/+1 asomando a cada lado, y así
      const distancia = i => { let d = (((i - cur) % n) + n) % n; if (d > n / 2) d -= n; return d; };
      const pintar = () => {
        cartas.forEach((c, i) => {
          const d = distancia(i);
          c.style.setProperty('--d', d);
          c.style.setProperty('--a', Math.abs(d));
          c.setAttribute('aria-hidden', String(d !== 0));
        });
        dots.forEach((d, k) => d.classList.toggle('on', k === cur));
      };
      const ir = k => { cur = ((k % n) + n) % n; abrir(pila); pintar(); };
      pila.pasar = d => ir(cur + d);
      pintar();
      if (n < 2) return;

      // Arrastrar: la foto de adelante sigue al dedo; al soltar pasa si se movió lo suficiente o rápido
      let x0 = 0;
      let dx = 0;
      let t0 = 0;
      let quien = null;
      let movio = false;
      pila.addEventListener('pointerdown', e => {
        if (e.button) return;
        quien = e.pointerId;
        x0 = e.clientX;
        dx = 0;
        t0 = performance.now();
        movio = false;
      });
      pila.addEventListener('pointermove', e => {
        if (e.pointerId !== quien) return;
        dx = e.clientX - x0;
        if (!movio && Math.abs(dx) > 6) {
          movio = true;
          pila.classList.add('arrastrando');
          try { pila.setPointerCapture(quien); } catch {}
        }
        if (!movio) return;
        cartas[cur].style.setProperty('--drag', `${dx}px`);
        cartas[cur].style.setProperty('--rot', `${dx / 28}deg`);
      });
      const soltar = e => {
        if (e.pointerId !== quien) return;
        quien = null;
        pila.classList.remove('arrastrando');
        cartas[cur].style.removeProperty('--drag');
        cartas[cur].style.removeProperty('--rot');
        if (!movio) return;
        const v = dx / Math.max(1, performance.now() - t0);
        if (dx < -45 || v < -0.45) ir(cur + 1);
        else if (dx > 45 || v > 0.45) ir(cur - 1);
      };
      pila.addEventListener('pointerup', soltar);
      pila.addEventListener('pointercancel', soltar);
      // Tocar una de las de atrás la trae adelante (un arrastre no cuenta como toque)
      pila.addEventListener('click', e => {
        if (movio) { movio = false; return; }
        const c = e.target.closest('.hv-pila-c');
        const i = cartas.indexOf(c);
        if (i >= 0 && i !== cur) ir(i);
      });
      pila.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); ir(cur + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); ir(cur - 1); }
      });
    });

    document.addEventListener('click', e => {
      const b = e.target.closest('.hv-car-btn');
      if (!b) return;
      const pila = $('.hv-pila', b.closest('.hv-carrusel-box'));
      if (pila && pila.pasar) pila.pasar(Number(b.dataset.d));
    });
  }

  // 3. Un capítulo por ventilador: la ocasión, la historia, lo que la respalda, el video y la compra
  function hvCapitulo(k, i, total) {
    const p = k.p;
    const n = Number(STORE.extras.cuotas) || 6;
    const ver = `href="#x=${esc(p.id)}" data-x="${esc(p.id)}"`;
    return `
      <section class="hv-cap${i % 2 ? ' hv-cap-alt' : ''}" id="cap-${i + 1}" data-cap="${esc(p.id)}" data-scroll style="--c:${esc(k.color)}">
        <span class="hv-cap-n" aria-hidden="true">${i + 1}</span>
        <div class="hv-cap-in wrap">
          <div class="hv-cap-media">
            <div class="hv-video">
              <a class="hv-media js-ficha" ${ver} aria-label="Ver ${esc(p.name)}">
                ${p.video ? V.videoHTML(p, false, true) : V.coverHTML(p, false)}
              </a>
              ${p.video ? `<button type="button" class="hv-sonido" aria-pressed="false" aria-label="Activar el sonido del video">${I.mudo}</button>` : ''}
            </div>
          </div>
          <div class="hv-cap-copy">
            <p class="kicker hv-ocasion" data-reveal style="--i:0">${esc(k.ocasion)}<span>${i + 1} de ${total}</span></p>
            <h2 class="hv-cap-title" data-reveal style="--i:1">${esc(k.titulo)}</h2>
            <p class="hv-cap-story" data-reveal style="--i:2">${esc(k.historia)}</p>
            <ul class="hv-datos" data-reveal style="--i:3">${(p.details || []).slice(0, 4).map(d => `<li>${I.check}<span>${esc(d)}</span></li>`).join('')}</ul>
            <div class="hv-compra" data-reveal style="--i:4">
              <p class="hv-name"><a class="js-ficha" ${ver}>${esc(p.name)}</a></p>
              ${V.priceHTML(p)}
              ${STORE.financing ? `<p class="hv-cuotas"><b>${n} cuotas${sinInteres}</b> de <b>${cuotaDe(p.price, n)}</b> con débito ${goImg()}</p>` : ''}
              <p class="hv-cuotas"><b>12 cuotas${sinInteres}</b> de <b>${cuotaDe(p.price, 12)}</b> con crédito</p>
              <div class="hv-btns">${PAY ? V.buyButton(p, 'Comprar') : V.waLink(p, 'Pedilo por WhatsApp')}</div>
            </div>
          </div>
        </div>
      </section>`;
  }

  function hvCapitulos(c) {
    const caps = capitulosDe(c);
    // Los productos de la categoría que todavía no tienen capítulo se ven igual, para no esconder ninguno
    const resto = V.byCat(c.id).filter(p => !caps.some(k => k.p === p));
    return caps.map((k, i) => hvCapitulo(k, i, caps.length)).join('') + (resto.length ? `
      <section class="shelf wrap" id="productos" style="--c:${esc(c.color)}">
        <header class="shelf-head" data-reveal><h2 class="sec-title">También tenemos</h2></header>
        ${cards(resto)}
      </section>` : '');
  }

  // 4. Cierre: una persona del otro lado
  function hvCierre() {
    return `
      <section class="hv-cierre wrap" data-reveal>
        <h2 class="sec-title">¿Dudas? Te contesta una persona</h2>
        <p class="sec-text">Escribinos por WhatsApp y alguien del equipo te ayuda a elegir el tuyo.</p>
        <div class="hv-ctas">
          <a class="btn js-wa js-wa-general" data-donde="cierre" target="_blank" rel="noopener">${I.wa}Escribinos</a>
          <a class="btn ghost" href="#cap-1" data-sx-go="cap-1">Volver a los ventiladores</a>
        </div>
      </section>`;
  }

  // Sonido de los videos de los capítulos: se prende de a uno (los demás quedan en silencio)
  function hvSonido() {
    const pintar = (b, on) => {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Silenciar el video' : 'Activar el sonido del video');
      b.innerHTML = on ? I.sonido : I.mudo;
    };
    document.addEventListener('click', e => {
      const b = e.target.closest('.hv-sonido');
      if (!b) return;
      const v = $('video', b.parentElement);
      if (!v) return;
      const prender = v.muted;
      $$('.hv-sonido').forEach(x => { const o = $('video', x.parentElement); if (o) o.muted = true; pintar(x, false); });
      if (!prender) return;
      v.muted = false;
      v.dataset.played = '1';
      const r = v.play();
      if (r && r.catch) r.catch(() => {});
      pintar(b, true);
    });
  }

  // Celular: abajo, siempre a mano, comprar el ventilador que se está viendo
  function hvBarra() {
    const caps = $$('.hv-cap');
    if (!caps.length) return;
    document.body.insertAdjacentHTML('beforeend', '<div class="hv-bar" hidden><span class="hv-bar-txt"><small></small><b></b></span><span class="hv-bar-btn"></span></div>');
    const bar = $('.hv-bar');
    let actual = '';
    let ticking = false;
    const pintar = () => {
      ticking = false;
      const mitad = innerHeight / 2;
      const cap = caps.find(c => { const r = c.getBoundingClientRect(); return r.top < mitad && r.bottom > mitad; });
      const id = cap ? cap.dataset.cap : '';
      bar.hidden = !id;
      if (!id || id === actual) return;
      actual = id;
      const p = EXTRAS.find(x => x.id === id);
      $('small', bar).textContent = p.name;
      $('b', bar).textContent = money(p.price);
      $('.hv-bar-btn', bar).innerHTML = PAY ? V.buyButton(p, 'Comprar') : V.waLink(p, 'Pedilo');
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(pintar); } }, { passive: true });
    pintar();
  }

  /* ---------- Encabezado, pie y armado ---------- */
  // Menú de las 4 vistas: Inicio y la home de cada categoría (shared/secciones.js), más el atajo a Envíos
  function nav() {
    $('#nav').innerHTML = window.Secciones.nav('/historia', CAT ? CAT.id : '') + '<a href="#envios" class="nav-ship" data-sx-go="envios">Envíos</a>';
  }


  function pie() {
    const f = SITE.footer || {};
    const provs = [...new Set((STORE.branches || []).map(b => b.province).filter(Boolean))];
    $('#foot').innerHTML = `
      <div class="foot-grid wrap">
        <div class="foot-brand">
          <span class="foot-logo">${$('.logo-svg').outerHTML}</span>
          <p>${esc(sinRelleno(f.about || STORY.text) || 'Ventilación, creación de contenido y audio en cuotas.')}</p>
        </div>
        <nav aria-label="Categorías"><h3>Categorías</h3>${CATS.map(c => `<a href="${catUrl(c)}">${esc(c.name)}</a>`).join('')}</nav>
        <div><h3>Sucursales</h3>${provs.map(p => `<p>${esc(p)}</p>`).join('') || `<p>${esc(STORE.city)}</p>`}</div>
        <div><h3>Contacto</h3>
          <a class="js-wa js-wa-general" data-donde="pie" target="_blank" rel="noopener">WhatsApp</a>
          <a href="mailto:${esc(emailTienda)}">${esc(emailTienda)}</a>
          ${f.instagram ? `<a href="https://instagram.com/${esc(f.instagram.replace(/^@/, ''))}" target="_blank" rel="noopener">${esc(f.instagram)}</a>` : ''}
          ${f.hours ? `<p>${esc(f.hours)}</p>` : ''}
        </div>
      </div>
      <p class="foot-legal wrap">© ${new Date().getFullYear()} ${esc(STORE.name)}${f.legal ? ` · ${esc(f.legal)}` : ''} · Garantía de ${esc(STORY.warrantyDays || 0)} días en todos los productos</p>`;
  }

  function armar() {
    const main = $('#contenido');
    const sx = html => `<div class="sx-page h-sx" style="--sx-accent:${esc(CAT.color)}">${html}</div>`;
    if (CAT && capitulosDe(CAT).length) document.body.classList.add('hv-page');
    main.innerHTML = CAT && capitulosDe(CAT).length
      ? [hvPortada(CAT), hvSocios(), hvEquipo(), hvSucursales(), franja(), hvCapitulos(CAT), calculadora(), sx(window.Secciones.faq(CAT)), hvCierre(), categorias(CAT)].join('')
      : CAT
      ? [CAT.banner ? `<div class="sx-page h-sx" style="--sx-accent:${esc(CAT.color)}">${window.Secciones.hero(CAT)}${window.Secciones.videos(CAT)}</div>` : heroCategoria(CAT), franja(), `<div class="sx-page h-sx" style="--sx-accent:${esc(CAT.color)}">${window.Secciones.beneficios(CAT)}</div>`,
        productosCategoria(CAT), `<div class="sx-page h-sx" style="--sx-accent:${esc(CAT.color)}">${window.Secciones.guia(CAT)}</div>`,
        comoComprar(), calculadora(), garantia(), `<div class="sx-page h-sx" style="--sx-accent:${esc(CAT.color)}">${window.Secciones.faq(CAT)}</div>`, categorias(CAT)].join('')
      : [heroHome(), socios(), numeros(), equipo(), sucursales(), garantia(), franja(), categorias(), productosHome(), comoComprar(), calculadora()].join('');
    nav();
    pie();
  }

  /* ---------- Animaciones con el scroll ---------- */
  // Aparecer al entrar en pantalla
  function reveal() {
    const els = $$('[data-reveal]');
    if (reduce.matches || !('IntersectionObserver' in window)) return els.forEach(el => el.classList.add('in'));
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    els.forEach(el => io.observe(el));
  }

  // --p: cuánto avanzó cada sección [data-scroll] (0 cuando asoma abajo, 1 cuando terminó de pasar)
  function progreso() {
    const els = $$('[data-scroll]');
    const bar = $('.progress span');
    let ticking = false;
    const pasos = $$('.step');
    function update() {
      ticking = false;
      const vh = innerHeight;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) continue;
        // Las secciones altas (con contenido fijo) cuentan mientras el contenido está pegado arriba
        // La portada cuenta desde arriba de todo (0) hasta que salió de pantalla (1)
        const tall = el.classList.contains('founders');
        const top = el.classList.contains('hero') || el.classList.contains('hv-hero');
        const p = tall ? -r.top / Math.max(1, r.height - vh) : top ? -r.top / Math.max(1, r.height) : (vh - r.top) / (vh + r.height);
        el.style.setProperty('--p', Math.min(1, Math.max(0, p)).toFixed(4));
      }
      const doc = document.documentElement;
      const total = doc.scrollHeight - vh;
      if (bar) bar.style.transform = `scaleX(${total > 0 ? Math.min(1, scrollY / total) : 0})`;
      $('#head').classList.toggle('solid', scrollY > 24);
      // Los pasos de "Cómo comprar" se prenden a medida que avanza la línea
      const steps = $('.steps');
      if (steps) {
        const p = Number(getComputedStyle(steps).getPropertyValue('--p')) || 0;
        pasos.forEach((s, i) => s.classList.toggle('on', p > 0.28 + i * 0.1));
      }
    }
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    update();
  }

  // Números que cuentan hasta su valor ("+5.000", "3"…)
  function contadores() {
    const els = $$('.js-count');
    const run = el => {
      const m = String(el.dataset.to).match(/^(\D*)([\d.]+)(.*)$/);
      if (!m || reduce.matches) return;
      const fin = Number(m[2].replace(/\./g, ''));
      const t0 = performance.now();
      const dur = 1400;
      const tick = now => {
        const k = Math.min(1, (now - t0) / dur);
        const v = Math.round(fin * (1 - Math.pow(1 - k, 3)));
        el.textContent = `${m[1]}${fmt.format(v)}${m[3]}`;
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
    }, { threshold: 0.6 });
    els.forEach(el => io.observe(el));
  }

  /* ---------- Calculadora de envíos ---------- */
  function calc() {
    const form = $('.calc-form');
    if (!form) return;
    const out = $('.calc-out', form);
    const saved = (() => { try { return JSON.parse(localStorage.getItem('cc:buyer') || 'null') || {}; } catch { return {}; } })();
    if (saved.province) form.elements.provincia.value = saved.province;
    if (saved.cp) form.elements.cp.value = saved.cp;
    // Si en /admin → Envíos se vuelve a poner un recargo por kg, los precios se muestran "desde" (1 kg)
    const porKg = Object.values(SHIP.rates || {}).some(r => r && r.on && r.extraKg > 0);

    function pintar() {
      const prov = EN.provincia(form.elements.provincia.value);
      if (!prov) {
        out.innerHTML = '<p class="calc-hint">Elegí tu provincia o escribí tu código postal.</p>';
        return;
      }
      const ops = EN.opciones(SHIP, prov.zona, 1, 0);
      const cerca = (STORE.branches || []).filter(b => b.province && EN.provincia(b.province) && EN.provincia(b.province).nombre === prov.nombre);
      out.innerHTML = `
        <ul class="quotes">
          ${SHIP.pickup ? `<li class="q q-ret"><span class="q-mark">${I.store}</span><span class="q-name"><b>Retiro en sucursal</b><small>${cerca.length ? `${cerca.length} sucursal${cerca.length === 1 ? '' : 'es'} en ${esc(prov.nombre)}` : 'En nuestras sucursales'}</small></span><span class="q-price">Gratis</span></li>` : ''}
          ${ops.map((o, i) => `
            <li class="q q-${o.empresa}" style="--i:${i}">
              <span class="q-mark">${o.empresa === 'andreani' ? 'A' : 'CA'}</span>
              <span class="q-name"><b>${esc(o.nombre)}</b><small>Llega en ${esc(EN.diasTexto(o.dias))}</small></span>
              <span class="q-price">${o.costo ? `${porKg ? 'Desde ' : ''}${money(o.costo)}` : 'Gratis'}</span>
            </li>`).join('')}
        </ul>
        <p class="calc-note">${porKg ? 'Precio para productos de hasta 1 kg; los más pesados suman un poco más.' : 'El mismo precio para cualquier producto.'} El total exacto lo ves antes de pagar.</p>`;
    }
    // Lo que elige acá queda cargado en el checkout (shared/checkout.js lee cc:buyer)
    const recordar = () => {
      try {
        const b = JSON.parse(localStorage.getItem('cc:buyer') || 'null') || {};
        localStorage.setItem('cc:buyer', JSON.stringify({ ...b, province: form.elements.provincia.value, cp: form.elements.cp.value }));
      } catch {}
    };
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

  /* ---------- Filtros de la página de categoría ---------- */
  function chips() {
    $$('.chip').forEach(b => b.addEventListener('click', () => {
      $$('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const list = V.byCat(CAT.id).filter(p => !b.dataset.g || p.group === b.dataset.g);
      $('.js-cat-grid').innerHTML = cards(list);
      reveal();
      vistas();
    }));
  }

  /* ---------- WhatsApp y estadísticas ---------- */
  function whatsapp() {
    $$('.js-wa-general').forEach(a => { a.href = window.TB_WA(STORE.greeting || '¡Hola!'); });
    $$('.fab').forEach(a => { a.innerHTML = I.wa; a.dataset.donde = 'boton-flotante'; });
    $$('.wa-btn').forEach(a => { a.insertAdjacentHTML('afterbegin', I.wa); a.dataset.donde = 'encabezado'; });
    document.addEventListener('click', e => {
      const a = e.target.closest('.js-wa');
      if (a && window.TB_TRACK) window.TB_TRACK('whatsapp', a.dataset.x || '', { el: a, donde: a.dataset.donde || (a.closest('.ficha') ? 'producto' : 'tarjeta') });
    });
  }

  // Cada producto que se ve en pantalla cuenta una "vista" (una vez por visita)
  function vistas() {
    if (!window.TB_TRACK || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = (e.target.matches('[data-x]') ? e.target : $('[data-x]', e.target) || {}).dataset;
        if (id && id.x) window.TB_TRACK('vista', id.x);
        io.unobserve(e.target);
      }
    }, { threshold: 0.6 });
    // También la foto o el video de cada capítulo de ventilación (.hv-media)
    $$('.xcard, .hv-media').forEach(el => io.observe(el));
  }

  /* ---------- Modo claro / oscuro (el mismo botón que en Minimalista) ---------- */
  function tema() {
    const btn = $('.js-theme');
    const system = matchMedia('(prefers-color-scheme: dark)');
    const dark = () => (document.documentElement.dataset.theme || (system.matches ? 'dark' : 'light')) === 'dark';
    const paint = () => {
      btn.innerHTML = dark() ? I.sun : I.moon;
      btn.setAttribute('aria-label', dark() ? 'Pasar a modo claro' : 'Pasar a modo oscuro');
    };
    btn.addEventListener('click', () => {
      const next = dark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('xoxo:tema', next); } catch {}
      paint();
    });
    system.addEventListener('change', paint);
    paint();
  }

  /* ---------- Inicio ---------- */
  armar();
  if (FL) FL.montar();
  tema();
  whatsapp();
  reveal();
  progreso();
  contadores();
  calc();
  if (CAT) chips();
  vistas();
  hvBarra();
  hvSonido();
  hvCarruseles();
  // Producto compartido (#x=…) lo abre la vidriera; el ancla (#envios) baja después de armar la página
  if (/^#[a-z-]+$/.test(location.hash)) {
    const el = document.getElementById(location.hash.slice(1));
    if (el) requestAnimationFrame(() => el.scrollIntoView());
  }
  document.documentElement.classList.add('ready');
})();
