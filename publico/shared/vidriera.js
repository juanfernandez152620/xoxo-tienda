/* Vidriera: los productos que no son celulares (ventiladores, contenido y audio).
 * No tienen video ni cuotas: se ven en tarjetas con foto y precio, y al tocarlas se abre una ficha con la galería.
 * La usan los tres diseños y toma los colores del diseño donde se usa (vidriera.css).
 * Con el descuento flash (shared/flash.js), arriba del precio va el precio de lista tachado.
 * Los productos se editan en /admin → Otros productos (window.EXTRAS).
 * Links compartidos: #x=tripode-soul-j500 abre directo esa ficha.
 */
(() => {
  'use strict';

  const { STORE, EXTRAS } = window;
  const byId = Object.fromEntries(EXTRAS.map(p => [p.id, p]));
  const groups = [...new Set(EXTRAS.map(p => p.group))];
  const CATS = (window.SITE && window.SITE.categories) || [];
  const FL = window.Flash && window.Flash.cfg && window.Flash.cfg.on && window.Flash.cfg.percent > 0 ? window.Flash : null;
  // Pago online: el botón principal abre el checkout (shared/checkout.js) en vez de WhatsApp
  const PAY = window.TB_MODE === 'pago' && Boolean(window.Checkout);
  const isWeb = /^https?:$/.test(location.protocol);

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => '$' + fmt.format(n);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const baseUrl = () => location.href.split('#')[0];
  const productUrl = p => `${baseUrl()}#x=${p.id}`;
  const percentOff = p => (FL ? FL.cfg.percent : p.listPrice > p.price ? Math.round((1 - p.price / p.listPrice) * 100) : 0);
  const kicker = p => [p.group, p.brand].filter(Boolean).join(' · ');
  const filter = (group, cat) => EXTRAS.filter(p => (!group || p.group === group) && (!cat || p.cat === cat));

  const line = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
    mic: line('<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7"/>'),
    tripode: line('<rect x="7.5" y="2.5" width="9" height="6" rx="1.5"/><path d="M12 8.5v5M12 13.5l-6.5 8M12 13.5l6.5 8M12 13.5v8"/>'),
    luz: line('<path d="M9.5 18.5h5M10.5 21.5h3"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.8.6 1.3 1.4 1.3 2.2v2h5v-2c0-.8.5-1.6 1.3-2.2A6.5 6.5 0 0 0 12 2.5z"/>'),
    'ventilador-pie': "<svg viewBox=\"0 0 48 48\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"24\" cy=\"15\" r=\"11\"/><circle cx=\"24\" cy=\"15\" r=\"7.5\" stroke-dasharray=\"1.5 2.2\" stroke-width=\"1.2\"/><path transform=\"rotate(0 24 15)\" d=\"M24 13.4c.4-4.4 2.8-7.2 5.6-6.4.2-.1 2.0.4 1.6 4.4-.1 2.4-2.4 3.6-5.6 2.4\"/><path transform=\"rotate(120 24 15)\" d=\"M24 13.4c.4-4.4 2.8-7.2 5.6-6.4.2-.1 2.0.4 1.6 4.4-.1 2.4-2.4 3.6-5.6 2.4\"/><path transform=\"rotate(240 24 15)\" d=\"M24 13.4c.4-4.4 2.8-7.2 5.6-6.4.2-.1 2.0.4 1.6 4.4-.1 2.4-2.4 3.6-5.6 2.4\"/><circle cx=\"24\" cy=\"15\" r=\"1.8\"/><path d=\"M24 26v14M21.5 30h5\"/><ellipse cx=\"24\" cy=\"42\" rx=\"9\" ry=\"2.4\"/></svg>",
    ventilador: "<svg viewBox=\"0 0 48 48\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"24\" cy=\"15\" r=\"11\"/><circle cx=\"24\" cy=\"15\" r=\"7.5\" stroke-dasharray=\"1.5 2.2\" stroke-width=\"1.2\"/><path transform=\"rotate(0 24 15)\" d=\"M24 13.4c.4-4.4 2.8-7.2 5.6-6.4.2-.1 2.0.4 1.6 4.4-.1 2.4-2.4 3.6-5.6 2.4\"/><path transform=\"rotate(120 24 15)\" d=\"M24 13.4c.4-4.4 2.8-7.2 5.6-6.4.2-.1 2.0.4 1.6 4.4-.1 2.4-2.4 3.6-5.6 2.4\"/><path transform=\"rotate(240 24 15)\" d=\"M24 13.4c.4-4.4 2.8-7.2 5.6-6.4.2-.1 2.0.4 1.6 4.4-.1 2.4-2.4 3.6-5.6 2.4\"/><circle cx=\"24\" cy=\"15\" r=\"1.8\"/><path d=\"M24 26v14M21.5 30h5\"/><ellipse cx=\"24\" cy=\"42\" rx=\"9\" ry=\"2.4\"/></svg>",
    'ventilador-piso': "<svg viewBox=\"0 0 48 48\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"24\" cy=\"20\" r=\"14\"/><circle cx=\"24\" cy=\"20\" r=\"10\" stroke-dasharray=\"1.5 2.2\" stroke-width=\"1.2\"/><path transform=\"rotate(0 24 20)\" d=\"M24 18.4c.4-5.5 3.5-9.0 7.0-8.0.2-.1 2.5.4 2.0 5.5-.1 3.0-3.0 4.5-7.0 3.0\"/><path transform=\"rotate(120 24 20)\" d=\"M24 18.4c.4-5.5 3.5-9.0 7.0-8.0.2-.1 2.5.4 2.0 5.5-.1 3.0-3.0 4.5-7.0 3.0\"/><path transform=\"rotate(240 24 20)\" d=\"M24 18.4c.4-5.5 3.5-9.0 7.0-8.0.2-.1 2.5.4 2.0 5.5-.1 3.0-3.0 4.5-7.0 3.0\"/><circle cx=\"24\" cy=\"20\" r=\"2.2\"/><path d=\"M10.5 22 7.5 39M37.5 22l3 17M4 39h7.5M36.5 39H44\"/></svg>",
    'ventilador-techo': "<svg viewBox=\"0 0 48 48\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M17 5h14\"/><path d=\"M20.5 5v2.5h7V5\"/><path d=\"M24 7.5v7\"/><path d=\"M16.5 14.5h15l-2 5h-11z\"/><path d=\"M16.8 16.2C10.5 15.6 4.6 16.4 3 17.6c1.7 1 8.3 1.2 14.4.3M31.2 16.2c6.3-.6 12.2.2 13.8 1.4-1.7 1-8.3 1.2-14.4.3\"/><path d=\"M19.5 19.5a4.5 3.2 0 0 0 9 0\"/><path d=\"M21.5 27.5l-1 2M24 28v2.3M26.5 27.5l1 2\" stroke-width=\"1.4\"/></svg>",
    ventiladorViejo: line('<circle cx="12" cy="10" r="1.6"/><path d="M12 8.4c-.4-2.6.6-5 3-5.4 2.2-.3 2.9 2.2 1 3.6-1.3 1-2.6 1.4-4 1.8M13.4 11c2.3 1.2 3.7 3.4 2.7 5.6-.9 2-3.3 1.3-3.4-1-.1-1.6.3-3 .7-4.6M10.6 10.8c-2.1 1.6-4.7 1.9-6.1 0-1.3-1.8.5-3.6 2.6-2.6 1.4.7 2.4 1.7 3.5 2.6M12 11.6V19M8 21.5h8"/>'),
    parlante: line('<rect x="5.5" y="2.5" width="13" height="19" rx="3"/><circle cx="12" cy="14.5" r="3.5"/><circle cx="12" cy="6.8" r="1.4"/>'),
    auricular: line('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13.5" width="4.5" height="7" rx="1.8"/><rect x="16.5" y="13.5" width="4.5" height="7" rx="1.8"/>'),
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l10.5-6.5z"/></svg>',
    cart: line('<path d="M3 4h2.2l2.3 11h10.3l2.1-8H6.3"/><circle cx="9.5" cy="19.5" r="1.5"/><circle cx="16.5" cy="19.5" r="1.5"/>'),
    share: line('<path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M12 15V3M7 8l5-5 5 5"/>'),
    close: line('<path d="M6 6l12 12M18 6L6 18"/>'),
    left: line('<path d="M15 6l-6 6 6 6"/>'),
    right: line('<path d="M9 6l6 6-6 6"/>'),
  };

  /* ---------- Foto, o dibujo de la marca mientras no haya foto ---------- */
  const rhombus = (x, y, r, color) => `<polygon points="${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}" style="fill:var(--${color})"/>`;
  const DIAMONDS = [
    [[80, 16, 34, 'azul-xoxo'], [104, 52, 24, 'acero'], [12, 92, 18, 'profundo']],
    [[18, 14, 30, 'azul-xoxo'], [96, 84, 34, 'profundo'], [62, 108, 18, 'acero']],
    [[100, 20, 30, 'profundo'], [6, 62, 24, 'acero'], [84, 104, 26, 'azul-xoxo']],
  ];
  function artHTML(p) {
    const shapes = DIAMONDS[EXTRAS.indexOf(p) % DIAMONDS.length].map(d => rhombus(...d)).join('');
    return `<span class="x-art" aria-hidden="true"><svg class="x-shapes" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${shapes}</svg>${ICON[p.icon] || ICON.luz}</span>`;
  }
  const photoHTML = (p, src, alt) => `<img class="x-photo" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  // Video del producto: arranca solo y sin sonido cuando aparece en pantalla (ver "Videos" más abajo)
  const videoHTML = (p, controls = false, auto = true) => `<video class="x-video" src="${esc(p.video)}" poster="${esc((p.gallery || [])[0] || '')}"
    ${auto ? 'muted loop data-auto' : ''} playsinline preload="none"${controls ? ' controls' : ''} aria-label="Video de ${esc(p.name)}"></video>`;
  // En la tarjeta va siempre la foto (con fondo blanco); si el producto tiene video, un aviso y se ve en la ficha
  const coverHTML = p => `${(p.gallery || [])[0] ? photoHTML(p, p.gallery[0], p.name) : artHTML(p)}${p.video ? `<span class="x-vtag">${ICON.play}Video</span>` : ''}`;
  // Red social (<script ... data-preview>): la tarjeta trae el video escondido y arranca al pasar el mouse
  // o cuando queda en el medio de la pantalla del celular (ver "Videos de las tarjetas" más abajo)
  const PREVIEW = Boolean(document.currentScript && document.currentScript.hasAttribute('data-preview'));
  const previewHTML = p => (PREVIEW && p.video
    ? `<video class="x-video x-preview" src="${esc(p.video)}" muted loop playsinline preload="none" tabindex="-1" aria-hidden="true"></video>` : '');

  /* ---------- Precio y botones ---------- */
  function priceHTML(p) {
    // Descuento flash: el precio de lista tachado va arriba y el precio de la página, grande
    if (FL) return `<p class="x-price x-price-flash">${FL.tachado(p.price, 'x-was')}<b>${money(p.price)}</b></p>`;
    const off = percentOff(p);
    return `<p class="x-price"><b>${money(p.price)}</b>${off ? `<s aria-label="Precio normal ${money(p.listPrice)}">${money(p.listPrice)}</s>` : ''}</p>`;
  }

  // Mercado Pago es el medio principal; abajo, siempre, que también se puede pagar con débito en GO cuotas
  const cuotasText = () => `Hasta 12 cuotas con Mercado Pago${STORE.financing ? ` o ${STORE.extras.cuotas} con tu débito en ${STORE.financing}` : ''}`;
  const goLogo = () => (STORE.financingLogo && STORE.financingLogo.color
    ? `<img class="x-go" src="${esc(STORE.financingLogo.color)}" alt="${esc(STORE.financing)}">` : esc(STORE.financing));
  const cuotasHTML = () => `<p class="x-cuotas">Hasta 12 cuotas con Mercado Pago</p>${STORE.financing
    ? `<p class="x-cuotas x-debito">o <b>${esc(STORE.extras.cuotas)} cuotas</b> con tu <b>débito</b> en ${goLogo()}</p>` : ''}`;

  function buyMessage(p) {
    const lines = ['¡Hola! Vi este producto en la web y me interesa:', `🛒 ${p.name}`, `💵 ${money(p.price)}`, `💳 ${cuotasText()}`, '¿Sigue disponible?'];
    if (isWeb) lines.push(productUrl(p));
    return lines.join('\n');
  }

  const waLink = (p, text, cls = '') => `<a class="x-btn ${cls} js-wa" target="_blank" rel="noopener" data-x="${esc(p.id)}" href="${esc(window.TB_WA(buyMessage(p)))}">${ICON.wa}${text}</a>`;
  const buyButton = (p, text) => `<button class="x-btn js-x-buy" type="button" data-x="${esc(p.id)}">${ICON.cart}${text}</button>`;

  /* ---------- Tarjetas ---------- */
  function cardHTML(p) {
    const off = percentOff(p);
    return `
      <article class="xcard">
        <a class="xcard-media js-ficha" href="#x=${esc(p.id)}" data-x="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
          ${coverHTML(p)}${previewHTML(p)}
          ${off ? (FL ? `<span class="x-off fl-only">-${off}%</span>` : `<span class="x-off">${off}% OFF</span>`) : ''}
        </a>
        <div class="xcard-info">
          <p class="x-kicker">${esc(kicker(p))}</p>
          <h3 class="x-name"><a class="js-ficha" href="#x=${esc(p.id)}" data-x="${esc(p.id)}">${esc(p.name)}</a></h3>
          ${priceHTML(p)}
          ${cuotasHTML()}
          ${PAY ? buyButton(p, 'Comprar') : waLink(p, 'Pedilo')}
        </div>
      </article>`;
  }

  const gridHTML = (group, cat) => `<div class="xgrid">${filter(group, cat).map(cardHTML).join('')}</div>`;

  // Estante para mezclar con otros productos: fila que se desliza y botón para ver todo
  // Con las 3 categorías, el estante mezcla ventilación, contenido y audio
  const shelfTitle = () => (CATS.length ? CATS.map(c => c.short || c.name).join(', ').replace(/, ([^,]*)$/, ' y $1') : STORE.extras.title);
  const shelfHTML = () => `
    <section class="xshelf" aria-label="${esc(shelfTitle())}">
      <div class="xshelf-head">
        <div><p class="x-eyebrow">${esc(STORE.extras.eyebrow)}</p><h2>${esc(shelfTitle())}</h2></div>
        <button class="x-more js-x-all" type="button">Ver todo</button>
      </div>
      <div class="xrow">${EXTRAS.map(cardHTML).join('')}</div>
    </section>`;

  /* ---------- Ficha del producto: galería de fotos, precio y descripción ---------- */
  let root = null, current = null, lastFocus = null;

  function build() {
    root = document.createElement('div');
    root.className = 'ficha';
    root.hidden = true;
    root.innerHTML = `
      <div class="ficha-panel" role="dialog" aria-modal="true" aria-labelledby="ficha-title">
        <button class="ficha-x" type="button" aria-label="Cerrar">${ICON.close}</button>
        <div class="ficha-content"></div>
      </div>`;
    document.body.append(root);
  }

  function galleryHTML(p) {
    const photos = p.gallery || [];
    // Lo primero que se ve es el producto: la foto principal. El video va segundo (con controles, para el sonido).
    const items = photos.map((src, i) => ({ src, i }));
    if (!items.length && !p.video) items.push({ arte: true });
    if (p.video) items.splice(Math.min(1, items.length), 0, { video: true });
    const slides = items.map(it => (it.video ? `<div class="ficha-slide ficha-video">${videoHTML(p, true)}</div>`
      : it.arte ? `<div class="ficha-slide">${artHTML(p)}</div>`
      : `<div class="ficha-slide">${photoHTML(p, it.src, `${p.name}, foto ${it.i + 1}`)}</div>`)).join('');
    const many = items.length > 1;
    return `
      <div class="ficha-gal">
        <div class="ficha-slides" tabindex="0" aria-label="Fotos de ${esc(p.name)}">${slides}</div>
        ${many ? `
        <button class="ficha-arrow prev" type="button" data-d="-1" aria-label="Foto anterior">${ICON.left}</button>
        <button class="ficha-arrow next" type="button" data-d="1" aria-label="Foto siguiente">${ICON.right}</button>
        <div class="ficha-thumbs" role="group" aria-label="Elegir foto">${items.map((it, k) => (it.video ? `
          <button class="ficha-thumb ficha-thumb-video" type="button" data-i="${k}" aria-pressed="${k === 0}" aria-label="Video">${ICON.play}<span>Video</span></button>` : `
          <button class="ficha-thumb" type="button" data-i="${k}" aria-pressed="${k === 0}" aria-label="Foto ${it.i + 1}"><img src="${esc(it.src)}" alt="" loading="lazy"></button>`)).join('')}</div>` : ''}
      </div>`;
  }

  function relatedHTML(p) {
    const others = EXTRAS.filter(x => x !== p)
      .sort((a, b) => (b.group === p.group) - (a.group === p.group) || (b.cat === p.cat) - (a.cat === p.cat)).slice(0, 3);
    if (!others.length) return '';
    return `
      <div class="ficha-rel">
        <h3>También te puede servir</h3>
        ${others.map(x => `
          <a class="ficha-rel-item js-ficha" href="#x=${esc(x.id)}" data-x="${esc(x.id)}">
            <span class="ficha-rel-art">${coverHTML(x)}</span>
            <span><b>${esc(x.name)}</b><small>${money(x.price)}</small></span>
          </a>`).join('')}
      </div>`;
  }

  function paint(p) {
    const off = percentOff(p);
    $('.ficha-content', root).innerHTML = `
      ${galleryHTML(p)}
      <div class="ficha-body">
        <p class="x-kicker">${esc(kicker(p))}</p>
        <h2 class="ficha-name" id="ficha-title">${esc(p.name)}</h2>
        ${priceHTML(p)}
        ${FL ? `<div class="ficha-off ficha-flash fl-only"><span class="x-off">-${off}% flash</span>
            <span class="ficha-off-txt">Termina en <b class="js-flash-reloj">${FL.reloj(FL.restante())}</b></span>
            <span class="ficha-off-cupon">Con el cupón <b>${esc(FL.cupon())}</b></span></div>`
          : off ? `<div class="ficha-off"><span class="x-off">${off}% OFF</span><span class="ficha-off-txt">Ahorrás ${money(p.listPrice - p.price)}</span></div>` : ''}
        ${cuotasHTML()}
        ${p.pitch ? `<p class="ficha-pitch">${esc(p.pitch)}</p>` : ''}
        ${(p.details || []).length ? `<ul class="ficha-details">${p.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        <div class="ficha-ctas">
          ${PAY ? `${buyButton(p, 'Comprar ahora')}${waLink(p, 'Consultar por WhatsApp', 'ghost')}` : waLink(p, 'Pedilo por WhatsApp')}
          <button class="x-btn ghost js-x-share" type="button">${ICON.share}Compartir</button>
        </div>
        <p class="ficha-note">¿Tenés dudas de medidas o compatibilidad? Preguntanos por WhatsApp.</p>
        ${relatedHTML(p)}
      </div>`;
    $('.ficha-panel', root).scrollTop = 0;
    $('.ficha-slides', root).addEventListener('scroll', syncThumbs, { passive: true });
  }

  const slideWidth = () => $('.ficha-slides', root).clientWidth || 1;
  const slideIndex = () => Math.round($('.ficha-slides', root).scrollLeft / slideWidth());
  function goSlide(i) {
    const box = $('.ficha-slides', root);
    const last = box.children.length - 1;
    box.scrollTo({ left: Math.max(0, Math.min(last, i)) * slideWidth(), behavior: 'smooth' });
  }
  function syncThumbs() {
    const at = slideIndex();
    $$('.ficha-thumb', root).forEach((b, i) => b.setAttribute('aria-pressed', String(i === at)));
  }

  function show(p) {
    if (!root) build();
    current = p;
    pararPrevia();
    paint(p);
    if (root.hidden) lastFocus = document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add('x-lock');
    $('.ficha-x', root).focus({ preventScroll: true });
  }

  function hide() {
    if (!root || root.hidden) return;
    $$('video', root).forEach(v => v.pause());
    root.hidden = true;
    current = null;
    document.documentElement.classList.remove('x-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  // El "atrás" del celular cierra la ficha
  function open(id) {
    const p = byId[id];
    if (!p) return;
    const url = `#x=${id}`;
    if (window.TB_TRACK) window.TB_TRACK('abrir', id, { como: 'ficha' });
    try {
      if (current) history.replaceState({ ficha: id }, '', url);
      else history.pushState({ ficha: id }, '', url);
    } catch {}
    show(p);
  }
  function close() {
    if (history.state && history.state.ficha) return history.back();
    try { history.replaceState(null, '', baseUrl()); } catch {}
    hide();
  }

  addEventListener('popstate', () => {
    const m = /^#x=([\w-]+)$/.exec(location.hash);
    if (m && byId[m[1]]) show(byId[m[1]]);
    else hide();
  });

  async function share(p) {
    const text = `Mirá este ${p.name}: ${money(p.price)}`;
    if (navigator.share) {
      try { await navigator.share({ title: p.name, text, url: productUrl(p) }); } catch {}
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${productUrl(p)}`)}`, '_blank', 'noopener');
  }

  /* ---------- Eventos ---------- */
  const plainClick = e => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button);

  document.addEventListener('click', e => {
    const t = e.target;
    let el;
    if ((el = t.closest('.js-ficha')) && plainClick(e)) {
      e.preventDefault();
      return open(el.dataset.x);
    }
    if ((el = t.closest('.js-x-buy'))) {
      if (window.TB_TRACK) window.TB_TRACK('checkout', el.dataset.x);
      return window.Checkout.open(el.dataset.x);
    }
    if (t.closest('.js-x-share')) return share(current);
    if ((el = t.closest('.ficha-arrow'))) return goSlide(slideIndex() + Number(el.dataset.d));
    if ((el = t.closest('.ficha-thumb'))) return goSlide(Number(el.dataset.i));
    if (t.closest('.ficha-x') || (root && t === root)) return close();
  });

  document.addEventListener('keydown', e => {
    if (!current || !root || root.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') goSlide(slideIndex() - 1);
    else if (e.key === 'ArrowRight') goSlide(slideIndex() + 1);
  });

  // Link compartido: "atrás" vuelve a la tienda en vez de salir
  addEventListener('load', () => {
    const m = /^#x=([\w-]+)$/.exec(location.hash);
    if (!m || !byId[m[1]]) return;
    try { history.replaceState(null, '', baseUrl()); } catch {}
    open(m[1]);
  });

  /* ---------- Videos: se reproducen solos (sin sonido) mientras se ven, y se pausan al salir ---------- */
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(navigator.connection && navigator.connection.saveData);
  const vio = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        if (!quieto || v.dataset.played) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
      } else if (!v.paused) v.pause();
    }
  }, { threshold: [0, 0.5] }) : null;
  const mirarVideos = (el = document) => $$('video[data-auto]:not([data-io])', el).forEach(v => { v.dataset.io = '1'; if (vio) vio.observe(v); });
  if (vio) {
    new MutationObserver(() => mirarVideos()).observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('DOMContentLoaded', () => mirarVideos());
  }

  /* ---------- Videos de las tarjetas (Red social): la foto es lo principal; el video arranca sin sonido al pasar
     el mouse (compu) o cuando la tarjeta queda en el medio de la pantalla (celular). De a uno. ---------- */
  let previa = null;
  function pararPrevia() {
    if (!previa) return;
    previa.pause();
    previa.parentElement.classList.remove('vprev');
    previa = null;
  }
  function empezarPrevia(media) {
    const v = media && media.querySelector('.x-preview');
    if (!v || (v === previa && !v.paused)) return;
    if (root && !root.hidden) return;
    // No le corta el sonido a un video que alguien puso a propósito
    if ($$('video').some(x => !x.paused && !x.muted && !x.classList.contains('x-preview'))) return;
    pararPrevia();
    previa = v;
    const r = v.play();
    if (r && r.catch) r.catch(() => {});
  }
  if (PREVIEW && !quieto) {
    // El video aparece recién cuando arranca, así no se ve un cuadro negro mientras carga
    document.addEventListener('playing', e => { if (e.target === previa) previa.parentElement.classList.add('vprev'); }, true);
    document.addEventListener('pause', e => {
      if (e.target.classList && e.target.classList.contains('x-preview')) e.target.parentElement.classList.remove('vprev');
    }, true);
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      document.addEventListener('mouseover', e => { const m = e.target.closest && e.target.closest('.xcard-media'); if (m) empezarPrevia(m); });
      document.addEventListener('mouseout', e => {
        const m = e.target.closest && e.target.closest('.xcard-media');
        if (m && !m.contains(e.relatedTarget)) pararPrevia();
      });
    } else if ('IntersectionObserver' in window) {
      // Celular: la franja del medio de la pantalla; si entran dos tarjetas (grilla de 2), la más centrada
      const enMedio = new Set();
      const elegir = () => {
        const mitad = innerHeight / 2;
        let mejor = null;
        let dist = Infinity;
        for (const m of enMedio) {
          const r = m.getBoundingClientRect();
          const d = Math.abs(r.top + r.height / 2 - mitad) + r.left / 1000;
          if (d < dist) { dist = d; mejor = m; }
        }
        if (mejor) empezarPrevia(mejor);
        else pararPrevia();
      };
      const io = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (e.isIntersecting) enMedio.add(e.target);
          else enMedio.delete(e.target);
        }
        elegir();
      }, { rootMargin: '-38% 0px -38% 0px' });
      const mirar = () => $$('.xcard-media:not([data-prev])').forEach(m => {
        if (!m.querySelector('.x-preview')) return;
        m.dataset.prev = '1';
        io.observe(m);
      });
      new MutationObserver(mirar).observe(document.documentElement, { childList: true, subtree: true });
      addEventListener('DOMContentLoaded', mirar);
    }
  }

  document.addEventListener('play', e => {
    if (e.target.tagName !== 'VIDEO') return;
    $$('video').forEach(v => { if (v !== e.target && !v.paused) v.pause(); });
  }, true);

  const byCat = cat => filter('', cat);
  window.Vidriera = {
    title: STORE.extras.title, short: STORE.extras.short, groups, cats: CATS, filter, byCat, gridHTML, shelfHTML,
    cardHTML, priceHTML, coverHTML, videoHTML, buyButton, waLink, icon: key => ICON[key], open, close,
  };
})();
