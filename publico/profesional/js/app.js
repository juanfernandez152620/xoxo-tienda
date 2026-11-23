/* XOXO Tecno · diseño C2 "Profesional": clásico, blanco y sobrio (con modo oscuro).
 * 4 vistas, con el menú de arriba: Inicio (/profesional/) y la home de cada categoría (/profesional/audio/…).
 * Inicio: portada, lo que ofrecemos, categorías, productos destacados, quiénes somos, el equipo, las sucursales,
 * garantía, cómo comprar y calculadora de envíos. Las homes de categoría las arma shared/secciones.js.
 * Los textos vienen de /admin (window.SITE); los productos, de la vidriera (shared/vidriera.js).
 */
(() => {
  'use strict';

  const { STORE, SITE, EXTRAS = [] } = window;
  const CATS = SITE.categories || [];
  const STORY = SITE.story || {};
  const V = window.Vidriera;
  const SX = window.Secciones;
  const FL = window.Flash;
  const BASE = '/profesional';
  const CAT = CATS.find(c => c.id === window.CATEGORIA) || null;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const email = (SITE.footer && SITE.footer.email) || 'ventas@xoxotecno.com.ar';
  const line = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41"/></svg>',
    sun: line('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
    moon: line('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
    pin: line('<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  };
  const arrow = SX.icon('arrow');

  /* ---------- Piezas ---------- */
  // Foto de una persona, o un retrato de ejemplo mientras no haya foto (se carga en /admin → Tienda y textos)
  function retrato(p) {
    if (p.photo) return `<img class="pic" src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`;
    return `<div class="pic pic-ph" role="img" aria-label="Foto de ejemplo de ${esc(p.name)}">
      <svg viewBox="0 0 100 120" aria-hidden="true"><circle cx="50" cy="44" r="18"/><path d="M15 120c2-26 16-40 35-40s33 14 35 40z"/></svg>
      <span>Foto de ejemplo</span></div>`;
  }
  const head = (kicker, title, text = '', extra = '') => `
    <header class="sec-head" data-fade>
      ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}
      <h2 class="sec-title">${esc(title)}</h2>
      ${text ? `<p class="sec-text">${esc(text)}</p>` : ''}${extra}
    </header>`;

  /* ---------- Inicio ---------- */
  function portada() {
    const founders = (STORY.founders || []).slice(0, 3);
    const provs = [...new Set((STORE.branches || []).map(b => b.province).filter(Boolean))];
    return `
      <section class="hero wrap">
        <div class="hero-copy" data-fade>
          <p class="kicker">${esc(provs.length ? `Sucursales en ${provs.join(', ').replace(/, ([^,]*)$/, ' y $1')}` : STORY.kicker)}</p>
          <h1 class="hero-title">${esc(STORY.title || STORE.name)}</h1>
          <p class="hero-text">${esc(STORY.text)}</p>
          <div class="ctas">
            <a class="btn" href="#categorias" data-sx-go="categorias">Ver productos ${arrow}</a>
            <a class="btn ghost" href="#nosotros" data-sx-go="nosotros">Conocenos</a>
          </div>
        </div>
        <figure class="hero-fig" data-fade>
          <div class="hero-pics">${founders.map(retrato).join('')}</div>
          <figcaption>${esc(founders.map(f => f.name).join(', ').replace(/, ([^,]*)$/, ' y $1'))}, fundadores de ${esc(STORE.name)}</figcaption>
        </figure>
      </section>`;
  }

  function valores() {
    const d = STORY.warrantyDays || 30;
    const items = [
      [SX.icon('shield'), `${d} días de garantía`, 'En todos los productos'],
      [SX.icon('truck'), 'Envíos a todo el país', 'Andreani y Correo Argentino'],
      [SX.icon('card'), 'Pagá en cuotas', 'Con Mercado Pago'],
      [SX.icon('store'), 'Retiro gratis', 'En nuestras sucursales'],
    ];
    return `<section class="values wrap" aria-label="Lo que ofrecemos">${items.map(([i, t, x]) => `<div class="value" data-fade><span>${i}</span><b>${esc(t)}</b><small>${esc(x)}</small></div>`).join('')}</section>`;
  }

  function categorias() {
    return `
      <section class="cats wrap" id="categorias">
        ${head('Nuestras categorías', 'Todo lo que necesitás, en un solo lugar')}
        <div class="cat-grid">
          ${CATS.map(c => {
            const n = V.byCat(c.id).length;
            return `<a class="cat-card" href="${BASE}/${c.id}/" style="--c:${esc(c.color)}" data-fade>
              <span class="cat-art" aria-hidden="true">${SX.catIcon(c)}</span>
              <span class="cat-body"><b>${esc(c.name)}</b><span>${esc(c.title)}</span><em>${n} producto${n === 1 ? '' : 's'} ${arrow}</em></span>
            </a>`;
          }).join('')}
        </div>
      </section>`;
  }

  function destacados() {
    return CATS.map(c => {
      const list = V.byCat(c.id);
      if (!list.length) return '';
      return `
        <section class="shelf wrap" aria-labelledby="shelf-${c.id}">
          <header class="shelf-head" data-fade>
            <h2 class="sec-title" id="shelf-${c.id}">${esc(c.name)}</h2>
            <a class="more" href="${BASE}/${c.id}/">Ver todo ${arrow}</a>
          </header>
          <div class="xgrid">${list.slice(0, 4).map(V.cardHTML).join('')}</div>
        </section>`;
    }).join('');
  }

  function nosotros() {
    const f = (STORY.founders || []).slice(0, 3);
    return `
      <section class="about wrap" id="nosotros">
        <div class="about-copy" data-fade>
          <p class="kicker">Quiénes somos</p>
          <h2 class="sec-title">${esc(STORY.foundersTitle)}</h2>
          <p class="sec-text">${esc(STORY.foundersText)}</p>
          ${(STORY.stats || []).length ? `<dl class="stats">${STORY.stats.map(x => `<div><dt>${esc(x.l)}</dt><dd>${esc(x.v)}</dd></div>`).join('')}</dl>` : ''}
        </div>
        <div class="people" data-fade>${f.map(p => `<figure class="person">${retrato(p)}<figcaption><b>${esc(p.name)}</b><span>${esc([p.role, p.branch].filter(Boolean).join(' · '))}</span></figcaption></figure>`).join('')}</div>
      </section>`;
  }

  function equipo() {
    const t = STORY.team || [];
    if (!t.length) return '';
    return `
      <section class="team wrap">
        ${head('El equipo', STORY.teamTitle, STORY.teamText)}
        <div class="team-grid">${t.map(p => `<figure class="person" data-fade>${retrato(p)}<figcaption><b>${esc(p.name)}</b><span>${esc([p.role, p.branch].filter(Boolean).join(' · '))}</span></figcaption></figure>`).join('')}</div>
      </section>`;
  }

  function sucursales() {
    const porProv = {};
    for (const b of STORE.branches || []) (porProv[b.province || STORE.city] = porProv[b.province || STORE.city] || []).push(b);
    return `
      <section class="branches wrap" id="sucursales">
        ${head('Sucursales', STORY.branchesTitle, STORY.branchesText)}
        <div class="prov-grid">
          ${Object.entries(porProv).map(([prov, list]) => `
            <div class="prov" data-fade>
              <h3>${esc(prov)}</h3>
              <ul>${list.map(b => `<li>${I.pin}<span><b>${esc(b.name)}</b><small>${esc(b.address)}</small>
                ${b.address && !/a confirmar/i.test(b.address) ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}</span></li>`).join('')}</ul>
            </div>`).join('')}
        </div>
      </section>`;
  }

  /* ---------- Encabezado y pie ---------- */
  function encabezado() {
    $('#nav').innerHTML = SX.nav(BASE, CAT ? CAT.id : '');
  }

  function pie() {
    const f = SITE.footer || {};
    const provs = [...new Set((STORE.branches || []).map(b => b.province).filter(Boolean))];
    $('#foot').innerHTML = `
      <div class="foot-grid wrap">
        <div class="foot-brand"><span class="foot-logo">${$('.logo').innerHTML}</span><p>${esc(f.about || STORY.text || '')}</p></div>
        <nav aria-label="Categorías"><h3>Categorías</h3><a href="${BASE}/">Inicio</a>${CATS.map(c => `<a href="${BASE}/${c.id}/">${esc(c.name)}</a>`).join('')}</nav>
        <div><h3>Sucursales</h3>${provs.map(p => `<p>${esc(p)}</p>`).join('') || `<p>${esc(STORE.city)}</p>`}</div>
        <div><h3>Contacto</h3>
          <a class="js-wa js-wa-general" data-donde="pie" target="_blank" rel="noopener">WhatsApp</a>
          <a href="mailto:${esc(email)}">${esc(email)}</a>
          ${f.instagram ? `<a href="https://instagram.com/${esc(f.instagram.replace(/^@/, ''))}" target="_blank" rel="noopener">${esc(f.instagram)}</a>` : ''}
          ${f.hours ? `<p>${esc(f.hours)}</p>` : ''}
        </div>
      </div>
      <p class="foot-legal wrap">© ${new Date().getFullYear()} ${esc(STORE.name)}${f.legal ? ` · ${esc(f.legal)}` : ''} · ${esc(STORY.warrantyDays || 30)} días de garantía en todos los productos</p>`;
  }

  function armar() {
    $('#contenido').innerHTML = CAT
      ? SX.categoria(CAT, BASE)
      : [portada(), valores(), categorias(), destacados(), nosotros(), equipo(), sucursales(), SX.info()].join('');
    encabezado();
    pie();
    SX.init($('#contenido'));
  }

  /* ---------- Aparecer suave al bajar (nada más que eso) ---------- */
  function aparecer() {
    const els = $$('[data-fade]');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return els.forEach(e => e.classList.add('in'));
    const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
    els.forEach(e => io.observe(e));
  }

  /* ---------- WhatsApp, estadísticas y tema ---------- */
  function whatsapp() {
    $$('.js-wa-general').forEach(a => { a.href = window.TB_WA(STORE.greeting || '¡Hola!'); });
    $$('.fab').forEach(a => { a.innerHTML = I.wa; });
    document.addEventListener('click', e => {
      const a = e.target.closest('.js-wa');
      if (a && window.TB_TRACK) window.TB_TRACK('whatsapp', a.dataset.x || '', { el: a, donde: a.dataset.donde || (a.closest('.ficha') ? 'producto' : 'tarjeta') });
    });
  }
  function vistas() {
    if (!window.TB_TRACK || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = $('[data-x]', e.target);
      if (el) window.TB_TRACK('vista', el.dataset.x);
      io.unobserve(e.target);
    }), { threshold: 0.6 });
    const watch = () => $$('.xcard:not([data-seen])').forEach(el => { el.dataset.seen = '1'; io.observe(el); });
    watch();
    new MutationObserver(watch).observe($('#contenido'), { childList: true, subtree: true });
  }
  function tema() {
    const btn = $('.js-theme');
    const system = matchMedia('(prefers-color-scheme: dark)');
    const dark = () => (document.documentElement.dataset.theme || (system.matches ? 'dark' : 'light')) === 'dark';
    const paint = () => { btn.innerHTML = dark() ? I.sun : I.moon; btn.setAttribute('aria-label', dark() ? 'Pasar a modo claro' : 'Pasar a modo oscuro'); };
    btn.addEventListener('click', () => {
      const next = dark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('xoxo:tema', next); } catch {}
      paint();
    });
    system.addEventListener('change', paint);
    paint();
  }

  armar();
  if (FL) FL.montar();
  tema();
  whatsapp();
  aparecer();
  vistas();
})();
