/* Carrito de compras, en los 3 diseños (22/11/2026).
 * Guarda en el navegador qué productos y cuántos (localStorage "xoxo:carrito"). Los precios, el descuento, el envío
 * y las cuotas los vuelve a calcular el servidor al pagar (nucleo/pagos.js): lo de acá es para que la persona vea.
 * El código de descuento: si el descuento flash está vigente, ya viene puesto; si no, la invitación a seguirlos en
 * las redes y pedir uno por WhatsApp. Los códigos propios se consultan en /api/codigo.
 * Uso: Carrito.agregar(id), Carrito.abrir(), Carrito.items(), Carrito.vaciar()
 */
(() => {
  'use strict';

  const { STORE, PRODUCTS = [], EXTRAS = [], SITE = {} } = window;
  const CATALOGO = Object.fromEntries([...PRODUCTS, ...EXTRAS].map(p => [p.id, p]));
  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => '$' + fmt.format(n);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fullName = p => (p.storage ? `${/^(moto|nubia)/i.test(p.name) ? '' : p.brand + ' '}${p.name} ${p.storage} GB` : p.name);
  const priceOf = p => p.price || p.cuotas[12] * 12;
  const sinInteres = STORE.sinInteres ? ' sin interés' : '';
  const V = () => window.Vidriera;
  const Flash = () => window.Flash || null;
  const KEY = 'xoxo:carrito';
  const MAX = 10;

  const ICON = {
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2.2l2.3 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6.1"/><circle cx="10" cy="20.2" r="1.3"/><circle cx="17.5" cy="20.2" r="1.3"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5V4h8.5L21 13.5 13.5 21z"/><circle cx="7.5" cy="8.5" r="1.4"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2.2a9.7 9.7 0 0 0-8.4 14.6L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>',
  };

  /* ---------- Lo guardado ---------- */
  const leer = () => {
    let v = [];
    try { v = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
    return (Array.isArray(v) ? v : []).filter(x => x && CATALOGO[x.id]).map(x => ({ id: x.id, n: Math.min(MAX, Math.max(1, Math.floor(Number(x.n) || 1))) }));
  };
  const guardar = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} pintarBoton(); if (abierto()) pintar(); };
  const items = () => leer();
  const lineas = () => leer().map(x => ({ p: CATALOGO[x.id], n: x.n }));
  const contar = () => leer().reduce((s, x) => s + x.n, 0);

  // Hasta cuántas se pueden llevar: lo que queda en stock (/admin → Stock); 0 = sin stock o reservado
  const tope = id => {
    const s = (window.STOCK || {})[id];
    return !s ? MAX : s.agotado || s.reservado ? 0 : Math.min(MAX, s.quedan);
  };

  function agregar(id, n = 1) {
    if (!CATALOGO[id] || !tope(id)) return;
    const list = leer();
    const it = list.find(x => x.id === id);
    if (it) it.n = Math.min(tope(id), it.n + n); else list.push({ id, n: Math.min(tope(id), n) });
    guardar(list);
    if (window.TB_TRACK) window.TB_TRACK('carrito', id);
  }
  function cambiar(id, n) {
    const list = leer().map(x => (x.id === id ? { ...x, n: Math.max(1, Math.min(MAX, tope(id) || 1, n)) } : x));
    guardar(list);
  }
  const quitar = id => guardar(leer().filter(x => x.id !== id));
  const vaciar = () => { guardar([]); codigo(null); };

  /* ---------- Cuotas del carrito: crédito hasta lo que permitan todos; débito si todos lo aceptan ---------- */
  function cuotas(ls = lineas()) {
    if (!ls.length) return { credito: 12, debito: 0, limita: null, sinDebito: null };
    const de = l => V().cuotasDe(l.p);
    const credito = Math.min(...ls.map(l => de(l).credito));
    const sinDebito = ls.find(l => !de(l).debito) || null;
    return {
      credito,
      debito: sinDebito ? 0 : de(ls[0]).debito,
      limita: credito < 12 ? ls.find(l => de(l).credito === credito) : null,
      sinDebito,
    };
  }

  /* ---------- Código de descuento: el del flash vigente o uno propio (guardado para el pago) ---------- */
  // { code, percent } = propio (baja el precio) · { code, flash: true } = el del flash (el precio ya lo tiene)
  const codigo = v => {
    if (v === undefined) { try { return JSON.parse(sessionStorage.getItem('xoxo:codigo') || 'null'); } catch { return null; } }
    try { if (v) sessionStorage.setItem('xoxo:codigo', JSON.stringify(v)); else sessionStorage.removeItem('xoxo:codigo'); } catch {}
    return v;
  };
  const flashOn = () => Boolean(Flash() && Flash().activo());
  // Lo que vale ahora: el propio si hay; si no, el del flash si está vigente
  function codigoActual() {
    const c = codigo();
    if (c && !c.flash) return c;
    return flashOn() ? { code: Flash().cupon(), flash: true } : null;
  }
  async function consultar(texto) {
    const code = String(texto || '').trim().toLowerCase();
    if (!code) return { error: 'Escribí el código.' };
    if (Flash() && Flash().cuponValido && Flash().cuponValido(code, Flash().cfg)) {
      return flashOn() ? { code, flash: true } : { error: 'El descuento flash ya terminó.' };
    }
    try {
      const res = await fetch('/api/codigo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { code: data.code, percent: data.percent } : { error: data.error || 'Ese código no es válido.' };
    } catch { return { error: 'No pudimos revisar el código. Probá de nuevo.' }; }
  }

  // Totales que ve la persona (el servidor los vuelve a calcular)
  function totales(ls = lineas()) {
    const subtotal = ls.reduce((s, l) => s + priceOf(l.p) * l.n, 0);
    const c = codigoActual();
    const descuento = c && c.percent ? Math.round(subtotal * c.percent / 100) : 0;
    return { subtotal, descuento, total: subtotal - descuento, codigo: c };
  }

  /* ---------- Botón del encabezado ---------- */
  let boton = null;
  function montarBoton() {
    boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'cart-btn';
    boton.setAttribute('aria-label', 'Abrir el carrito');
    boton.innerHTML = `${ICON.cart}<span class="cart-count" hidden>0</span>`;
    boton.addEventListener('click', () => abrir());
    // Red social: antes del botón de WhatsApp · Minimalista e Historia: con los otros botones de arriba
    const antes = document.querySelector('.site-head .head-wa');
    const dentro = document.querySelector('.head-right, .head-actions');
    if (antes) antes.before(boton);
    else if (dentro) dentro.prepend(boton);
    else { boton.classList.add('cart-float'); document.body.append(boton); }
    pintarBoton();
    // Mi cuenta, al lado del carrito: la inicial del nombre si la sesión está iniciada
    const cuenta = document.createElement('a');
    cuenta.className = 'cart-btn cuenta-btn';
    cuenta.href = '/cuenta';
    cuenta.setAttribute('aria-label', 'Mi cuenta: ingresar o ver mis compras');
    cuenta.innerHTML = ICON.user;
    boton.before(cuenta);
    fetch('/api/cuenta').then(r => (r.ok ? r.json() : null)).then(d => {
      if (!d || !d.cliente) return;
      cuenta.innerHTML = `<span class="cuenta-ini">${esc(d.cliente.nombre.trim().charAt(0).toUpperCase())}</span>`;
      cuenta.setAttribute('aria-label', `Mi cuenta (${d.cliente.nombre}): mis compras`);
      window.TB_CLIENTE = d.cliente;
    }).catch(() => {});
  }
  function pintarBoton() {
    if (!boton) return;
    const n = contar();
    const c = boton.querySelector('.cart-count');
    c.hidden = !n;
    c.textContent = n > 9 ? '9+' : String(n);
    boton.setAttribute('aria-label', n ? `Abrir el carrito: ${n} producto${n === 1 ? '' : 's'}` : 'Abrir el carrito');
  }
  // Un saltito del botón al agregar
  const saltar = () => { if (!boton) return; boton.classList.remove('cart-bump'); void boton.offsetWidth; boton.classList.add('cart-bump'); };

  /* ---------- El panel de costado ---------- */
  let root = null;
  let lastFocus = null;
  const abierto = () => Boolean(root && !root.hidden);

  function construir() {
    root = document.createElement('div');
    root.className = 'cart';
    root.hidden = true;
    root.innerHTML = `
      <aside class="cart-panel" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <header class="cart-head"><h2 id="cart-title">Tu carrito</h2>
          <button class="cart-x" type="button" aria-label="Cerrar el carrito">${ICON.close}</button></header>
        <div class="cart-body"></div>
        <footer class="cart-foot"></footer>
      </aside>`;
    document.body.append(root);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); cerrar(); }
      if (e.key === 'Enter' && e.target.name === 'cart-code') { e.preventDefault(); aplicar(); }
    });
  }

  function redesHTML() {
    const F = SITE.footer || {};
    const url = (v, base) => (!v ? '' : /^https?:\/\//i.test(v) ? v : `${base}${String(v).replace(/^@/, '')}`);
    const redes = [
      ['Instagram', url(F.instagram, 'https://instagram.com/')],
      ['Facebook', url(F.facebook, 'https://facebook.com/')],
      ['TikTok', url(F.tiktok, 'https://www.tiktok.com/@')],
    ].filter(([, u]) => u);
    const wa = window.TB_WA ? window.TB_WA('¡Hola! Los sigo en las redes. ¿Me pasan un código de descuento?') : '';
    return `<div class="cart-redes">
      <p><b>Seguinos en las redes y mandanos un mensaje:</b> conseguí un código de descuento.</p>
      <div class="cart-redes-links">
        ${redes.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join('')}
        ${wa ? `<a class="cart-wa js-wa" data-donde="carrito" href="${esc(wa)}" target="_blank" rel="noopener">${ICON.wa}Pedir mi código</a>` : ''}
      </div>
    </div>`;
  }

  function codigoHTML(t) {
    const c = t.codigo;
    const msg = root && root.dataset.msg ? root.dataset.msg : '';
    const malo = root && root.dataset.malo === '1';
    let estado = '';
    if (c && c.flash) {
      estado = `<p class="cart-code-ok">${ICON.tag}<span>Te pusimos el código del descuento flash <b>${esc(c.code)}</b>. Termina en <b class="js-flash-reloj">${esc(Flash().reloj(Flash().restante()))}</b>.</span></p>`;
    } else if (c && c.percent) {
      estado = `<p class="cart-code-ok">${ICON.tag}<span>Código <b>${esc(c.code)}</b> aplicado: ${c.percent}% de descuento.</span>
        <button class="cart-link" type="button" data-act="sacar-codigo">Sacar</button></p>`;
    }
    return `<div class="cart-code">
      ${estado}
      ${!c ? redesHTML() : ''}
      <div class="cart-code-row">
        <input name="cart-code" maxlength="30" placeholder="¿Tenés un código?" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Código de descuento">
        <button class="cart-apply" type="button" data-act="aplicar">Aplicar</button>
      </div>
      ${msg ? `<p class="cart-code-msg${malo ? ' bad' : ''}" aria-live="polite">${esc(msg)}</p>` : ''}
    </div>`;
  }

  function cuotasHTML(total, cu) {
    const filas = [1, 3, 6, 9, 12].filter(n => n <= cu.credito);
    const fila = (n, dest) => `<li${dest ? ' class="fc-dest"' : ''}><span>${n === 1 ? '1 pago' : `${n} cuotas${sinInteres}`}</span><b>${money(n === 1 ? total : Math.ceil(total / n))}</b></li>`;
    return `<div class="ficha-cuotas cart-cuotas">
      <p class="fc-t">El carrito en cuotas</p>
      <div class="fc-grupo"><p class="fc-medio"><b>Con tarjeta de crédito</b><span>por Mercado Pago</span></p>
        <ul class="fc-lista">${filas.map(n => fila(n, n === cu.credito)).join('')}</ul></div>
      ${cu.debito ? `<div class="fc-grupo"><p class="fc-medio"><b>Con tarjeta de débito</b><span>con ${esc(STORE.financing || 'GO cuotas')}</span></p>
        <ul class="fc-lista">${fila(cu.debito, true)}</ul></div>` : ''}
      ${cu.limita ? `<p class="fc-nota">Por ${esc(fullName(cu.limita.p))}, este carrito va hasta ${cu.credito > 1 ? `${cu.credito} cuotas` : '1 pago'} con crédito.</p>` : ''}
      ${cu.sinDebito && STORE.financing ? `<p class="fc-nota">${esc(fullName(cu.sinDebito.p))} no se paga con débito en cuotas: este carrito se paga con Mercado Pago.</p>` : ''}
      <p class="fc-nota">Sin contar el envío: lo elegís al pagar.</p>
    </div>`;
  }

  function pintar() {
    if (!root) return;
    const ls = lineas();
    const n = ls.reduce((s, l) => s + l.n, 0);
    root.querySelector('#cart-title').textContent = n ? `Tu carrito (${n})` : 'Tu carrito';
    const body = root.querySelector('.cart-body');
    const foot = root.querySelector('.cart-foot');
    if (!ls.length) {
      body.innerHTML = `<div class="cart-empty"><span class="cart-empty-ico">${ICON.cart}</span><p><b>Tu carrito está vacío</b></p>
        <p>Agregá productos con el botón Comprar de cada uno.</p></div>`;
      foot.innerHTML = '<button class="cart-pay" type="button" data-act="cerrar">Seguir mirando</button>';
      return;
    }
    const t = totales(ls);
    const cu = cuotas(ls);
    body.innerHTML = `
      <ul class="cart-list">${ls.map(l => {
        const foto = l.p.gallery && l.p.gallery[0];
        return `<li class="cart-item" data-id="${esc(l.p.id)}">
          <span class="cart-thumb">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : (V().icon(l.p.icon) || '')}</span>
          <div class="cart-info">
            <p class="cart-name">${esc(fullName(l.p))}</p>
            <p class="cart-unit">${money(priceOf(l.p))}${l.n > 1 ? ' c/u' : ''}</p>
            ${l.n > tope(l.p.id) ? `<p class="cart-unit" style="color:#b45309;font-weight:700">${tope(l.p.id) ? `Quedan ${tope(l.p.id)}: bajá la cantidad para pagar` : 'Sin stock: sacalo para poder pagar'}</p>` : ''}
            <div class="cart-qty" role="group" aria-label="Cantidad de ${esc(fullName(l.p))}">
              <button type="button" data-act="menos" aria-label="Uno menos"${l.n <= 1 ? ' disabled' : ''}>−</button>
              <span aria-live="polite">${l.n}</span>
              <button type="button" data-act="mas" aria-label="Uno más"${l.n >= Math.min(MAX, tope(l.p.id)) ? ' disabled' : ''}>+</button>
            </div>
          </div>
          <div class="cart-right">
            <b class="cart-line">${money(priceOf(l.p) * l.n)}</b>
            <button class="cart-del" type="button" data-act="quitar" aria-label="Sacar ${esc(fullName(l.p))} del carrito">${ICON.trash}</button>
          </div>
        </li>`;
      }).join('')}</ul>
      ${codigoHTML(t)}
      ${cuotasHTML(t.total, cu)}`;
    foot.innerHTML = `
      <dl class="cart-sum">
        <div><dt>Productos</dt><dd>${money(t.subtotal)}</dd></div>
        ${t.descuento ? `<div class="cart-save"><dt>Código ${esc(t.codigo.code)} (−${t.codigo.percent}%)</dt><dd>−${money(t.descuento)}</dd></div>` : ''}
        <div><dt>Envío</dt><dd>Lo elegís al pagar</dd></div>
        <div class="cart-total"><dt>Total</dt><dd>${money(t.total)}</dd></div>
      </dl>
      <button class="cart-pay" type="button" data-act="pagar"${ls.some(l => l.n > tope(l.p.id)) ? ' disabled title="Hay productos sin stock en el carrito"' : ''}>Pagar</button>
      <button class="cart-more" type="button" data-act="cerrar">Seguir comprando</button>`;
  }

  async function aplicar() {
    const input = root.querySelector('[name="cart-code"]');
    const r = await consultar(input.value);
    if (r.error) { root.dataset.msg = r.error; root.dataset.malo = '1'; }
    else { codigo(r); root.dataset.msg = r.flash ? '¡Listo! Código del descuento flash.' : `¡Listo! ${r.percent}% de descuento.`; root.dataset.malo = ''; }
    pintar();
  }

  function onClick(e) {
    if (e.target === root) return cerrar();
    const b = e.target.closest('[data-act], .cart-x');
    if (!b) return;
    if (b.classList.contains('cart-x')) return cerrar();
    const id = b.closest('[data-id]') && b.closest('[data-id]').dataset.id;
    const it = id && leer().find(x => x.id === id);
    switch (b.dataset.act) {
      case 'mas': return it && cambiar(id, it.n + 1);
      case 'menos': return it && cambiar(id, it.n - 1);
      case 'quitar': return quitar(id);
      case 'aplicar': return aplicar();
      case 'sacar-codigo': root.dataset.msg = ''; codigo(null); return pintar();
      case 'cerrar': return cerrar();
      case 'pagar': cerrar(false); return window.Checkout && window.Checkout.carrito();
      default:
    }
  }

  function abrir() {
    if (!root) construir();
    lastFocus = document.activeElement;
    root.dataset.msg = '';
    pintar();
    root.hidden = false;
    document.documentElement.classList.add('co-lock');
    requestAnimationFrame(() => root.classList.add('on'));
    root.querySelector('.cart-x').focus({ preventScroll: true });
  }
  function cerrar(volver = true) {
    if (!abierto()) return;
    root.classList.remove('on');
    root.hidden = true;
    document.documentElement.classList.remove('co-lock');
    if (volver && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  // Comprar en una tarjeta = sumar al carrito y mostrarlo · Comprar ahora (ficha) = sumar y pagar
  function comprar(id, ahora = false) {
    agregar(id);
    saltar();
    if (ahora && window.Checkout) return window.Checkout.carrito();
    return abrir();
  }

  window.Carrito = { agregar, cambiar, quitar, vaciar, items, lineas, contar, cuotas, totales, codigo, codigoActual, consultar, abrir, cerrar, comprar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarBoton);
  else montarBoton();
  // Si cambia en otra pestaña
  addEventListener('storage', e => { if (e.key === KEY) { pintarBoton(); if (abierto()) pintar(); } });
})();
