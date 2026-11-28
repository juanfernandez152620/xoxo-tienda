/* Cartel flotante de una promo pasajera (27/11/2026: Black Week con la mascota de XOXO), en los diseños de la tienda.
 * No cambia nada de la página: es una burbuja en la esquina de abajo a la izquierda (el botón de WhatsApp está a la
 * derecha). Al tocarla se abre una tarjetita con la promo, el link a los productos y, si está prendido, el regalo
 * de bienvenida. Se cierra con la ×: en esa visita queda chiquita, sin el cartel.
 * Lo pone el servidor (nucleo/paginas.js) solo mientras la promo está vigente: /admin → Tienda y textos → Cartel de
 * promo (prendido, hasta qué día, título, texto e imagen). Usa window.SITE.promo. */
(() => {
  'use strict';

  const SITE = window.SITE || {};
  const P = SITE.promo;
  if (!P || !P.imagen || document.querySelector('.xo-promo')) return;
  const R = SITE.bienvenida || null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + new Intl.NumberFormat('es-AR').format(n);
  const KEY = 'xoxo:promo-chica';
  const chica = () => { try { return sessionStorage.getItem(KEY) === P.titulo; } catch { return false; } };
  const achicar = () => { try { sessionStorage.setItem(KEY, P.titulo); } catch {} };

  const css = `
.xo-promo { --xp-azul: #004c90; --xp-azul-2: #2b4966; position: fixed; z-index: 55; left: max(14px, env(safe-area-inset-left)); bottom: max(16px, env(safe-area-inset-bottom)); font-family: inherit; transition: bottom .25s ease; }
.xo-promo-btn { position: relative; display: block; width: 84px; height: 84px; padding: 0; border: 3px solid #fff; border-radius: 50%; background: var(--xp-azul); box-shadow: 0 14px 34px -10px rgba(0, 40, 90, .6); cursor: pointer; animation: xo-flotar 3.2s ease-in-out infinite; }
.xo-promo-btn img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.xo-promo-tag { position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%); padding: 3px 9px; border-radius: 999px; background: #111; color: #fff; font: 800 10.5px/1.2 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; box-shadow: 0 0 0 2px #fff; }
.xo-promo-burbuja { position: absolute; left: 92px; bottom: 30px; width: max-content; max-width: min(220px, calc(100vw - 130px)); padding: 9px 12px; border-radius: 16px 16px 16px 4px; background: #fff; color: #10233a; font: 700 13.5px/1.3 system-ui, sans-serif; box-shadow: 0 12px 30px -12px rgba(0, 30, 70, .45); animation: xo-aparecer .45s .6s ease-out both; cursor: pointer; }
.xo-promo-burbuja b { display: block; color: var(--xp-azul); font-size: 15px; }
.xo-promo.chica .xo-promo-btn { width: 60px; height: 60px; animation: none; }
.xo-promo.chica .xo-promo-burbuja, .xo-promo.chica .xo-promo-cerrar { display: none; }
.xo-promo-cerrar { position: absolute; top: -6px; left: 64px; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: #fff; color: #10233a; font: 700 17px/1 system-ui, sans-serif; box-shadow: 0 4px 12px rgba(0, 0, 0, .25); cursor: pointer; }
.xo-promo-card { position: absolute; left: 0; bottom: calc(100% + 14px); width: min(320px, calc(100vw - 28px)); overflow: hidden; border-radius: 22px; background: #fff; color: #10233a; box-shadow: 0 24px 60px -18px rgba(0, 30, 70, .55); animation: xo-aparecer .3s ease-out both; }
.xo-promo-card[hidden] { display: none; }
.xo-promo-foto { display: block; width: 100%; aspect-ratio: 496 / 388; max-height: 28vh; object-fit: cover; background: var(--xp-azul); }
.xo-promo-in { display: grid; gap: 10px; padding: 16px 18px 18px; }
.xo-promo-in h2 { margin: 0; color: var(--xp-azul); font: 900 26px/1 system-ui, sans-serif; letter-spacing: -.01em; text-transform: uppercase; }
.xo-promo-in p { margin: 0; font-size: 15px; line-height: 1.4; }
.xo-promo-regalo { padding: 10px 12px; border-radius: 12px; background: #eef4fb; font-size: 14px !important; }
.xo-promo-regalo a { color: var(--xp-azul); font-weight: 800; }
.xo-promo-ctas { display: grid; gap: 8px; }
.xo-promo-ctas a, .xo-promo-ctas button { display: flex; align-items: center; justify-content: center; min-height: 46px; padding: 0 18px; border: 0; border-radius: 999px; background: var(--xp-azul-2); color: #fff; font: 800 15px/1 system-ui, sans-serif; text-decoration: none; cursor: pointer; }
.xo-promo-ctas .xo-wa { background: #25d366; }
.xo-promo-x { position: absolute; top: 10px; right: 10px; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%; background: rgba(255, 255, 255, .92); color: #10233a; font: 700 20px/1 system-ui, sans-serif; cursor: pointer; }
@keyframes xo-flotar { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes xo-aparecer { from { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .xo-promo-btn, .xo-promo-burbuja, .xo-promo-card { animation: none; } }
@media (max-width: 560px) {
  .xo-promo-btn { width: 70px; height: 70px; }
  .xo-promo-burbuja { left: 78px; bottom: 24px; font-size: 12.5px; }
  .xo-promo-cerrar { left: 52px; }
}`;

  // Dónde están los productos en cada diseño (para "Ver las promos")
  const productos = () => document.querySelector('#pr-ofertas, #categorias, #sx-categorias, #catalogo, #contenido, .xgrid, #feed');

  function montar() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const wa = window.TB_WA ? window.TB_WA(`¡Hola! Vi las promociones de ${P.titulo} en la web y quiero consultar.`) : '';
    const regalo = R ? (R.tipo === 'porcentaje' ? `${R.valor}% off` : `${money(R.valor)} off`) : '';
    const el = document.createElement('div');
    el.className = `xo-promo${chica() ? ' chica' : ''}`;
    el.innerHTML = `
      <div class="xo-promo-card" role="dialog" aria-label="${esc(P.titulo)}" hidden>
        <img class="xo-promo-foto" src="/media/marca/mascota-regalo.webp" alt="" decoding="async">
        <button class="xo-promo-x" type="button" aria-label="Cerrar">×</button>
        <div class="xo-promo-in">
          <h2>${esc(P.titulo)}</h2>
          <p>${esc(P.texto)}</p>
          ${regalo ? `<p class="xo-promo-regalo">🎁 Y si creás tu cuenta, <a href="/cuenta?registro=1">${esc(regalo)} en tu primera compra</a>.</p>` : ''}
          <div class="xo-promo-ctas">
            <button type="button" class="xo-ver">Ver las promos</button>
            ${wa ? `<a class="xo-wa js-wa" data-donde="promo" href="${esc(wa)}" target="_blank" rel="noopener">Consultar por WhatsApp</a>` : ''}
          </div>
        </div>
      </div>
      <button class="xo-promo-btn" type="button" aria-haspopup="dialog" aria-label="${esc(P.titulo)}: ${esc(P.texto)}">
        <img src="${esc(P.imagen)}" alt="" decoding="async"><span class="xo-promo-tag">${esc(P.titulo)}</span>
      </button>
      <span class="xo-promo-burbuja" aria-hidden="true"><b>${esc(P.titulo)}</b>${esc(P.texto)}</span>
      <button class="xo-promo-cerrar" type="button" aria-label="Achicar el cartel de ${esc(P.titulo)}">×</button>`;
    document.body.append(el);

    const card = el.querySelector('.xo-promo-card');
    const abrir = v => {
      card.hidden = !v;
      el.querySelector('.xo-promo-btn').setAttribute('aria-expanded', String(v));
      if (v) { el.classList.add('chica'); achicar(); }
    };
    el.addEventListener('click', e => {
      if (e.target.closest('.xo-promo-btn, .xo-promo-burbuja')) return abrir(card.hidden);
      if (e.target.closest('.xo-promo-x')) return abrir(false);
      if (e.target.closest('.xo-promo-cerrar')) { el.classList.add('chica'); achicar(); return; }
      if (e.target.closest('.xo-ver')) {
        abrir(false);
        const destino = productos();
        if (destino) destino.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !card.hidden) abrir(false); });
    document.addEventListener('click', e => { if (!card.hidden && !el.contains(e.target)) abrir(false); });

    // Abajo a la izquierda también pueden estar la pastilla del descuento flash y, en Historia (celular), la barra
    // de "Comprar": si se ven, la mascota se acomoda arriba de ellas
    const visible = sel => { const x = document.querySelector(sel); return x && !x.hidden && x.getClientRects().length ? x : null; };
    let pendiente = false;
    const acomodar = () => {
      pendiente = false;
      // (dónde termina cada una cuando está quieta: su "bottom" más su alto, sin contar la animación de entrada)
      const tapan = [visible('.fl-pill'), visible('.hv-bar')].filter(Boolean).map(x => innerHeight - (parseFloat(getComputedStyle(x).bottom) || 0) - x.offsetHeight);
      el.style.bottom = tapan.length ? `${Math.max(16, Math.round(innerHeight - Math.min(...tapan) + 10))}px` : '';
    };
    const pedir = () => { if (!pendiente) { pendiente = true; setTimeout(acomodar, 80); } };
    addEventListener('scroll', pedir, { passive: true });
    addEventListener('resize', pedir);
    setInterval(pedir, 1500);
    setTimeout(acomodar, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
