/* Descuento flash, en los tres diseños.
 * El cupón del mes (xoxo-noviembre, xoxo-diciembre…) se ve siempre: arriba de cada precio va el "precio de lista"
 * tachado (el precio de la página más el porcentaje, redondeado), la barra queda fija arriba de la pantalla y
 * tiene una cuenta regresiva (los minutos de /admin → Descuento flash) que vuelve a empezar cuando llega a cero.
 * El precio que se cobra es siempre el de la página: el cupón queda anotado en el pedido.
 * La cuenta del cupón es la misma en el servidor (require) y en la página (window.Flash).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Flash = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const cupon = (d = new Date()) => `xoxo-${MESES[d.getMonth()]}`;
  const plano = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Acepta XOXO-NOVIEMBRE, xoxo noviembre, xoxonoviembre…
  const cuponValido = (texto, cfg) => Boolean(cfg && cfg.on && plano(texto) && plano(texto) === plano(cupon()));
  // Precio de lista: el de la página más el porcentaje del descuento, redondeado a $100
  const lista = (precio, percent) => Math.round(precio / (1 - percent / 100) / 100) * 100;

  const api = { MESES, cupon, cuponValido, lista, plano };
  if (typeof document === 'undefined') return api; // en el servidor alcanza con la cuenta

  /* ---------- En la página ---------- */
  const cfg = (window.SITE && window.SITE.flash) || { on: false, percent: 0, minutes: 0 };
  const KEY = 'xoxo:flash';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  // La cuenta de cada visitante arranca en su primera visita y, cuando llega a cero, vuelve a empezar
  let inicio = (store.get(KEY) || {}).inicio || 0;
  const durar = () => Math.max(1, cfg.minutes) * 60e3;
  function renovar() {
    if (inicio && Date.now() < inicio + durar()) return;
    // Se mantiene el ritmo: la nueva vuelta empieza donde terminó la anterior
    inicio = inicio ? inicio + Math.floor((Date.now() - inicio) / durar()) * durar() : Date.now();
    store.set(KEY, { inicio });
  }
  renovar();
  const restante = () => { renovar(); return Math.max(0, inicio + durar() - Date.now()); };
  const activo = () => Boolean(cfg.on && cfg.percent > 0);
  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => '$' + fmt.format(n);
  const reloj = ms => {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`;
  };

  // Precio tachado para poner arriba de un precio (vacío si no hay descuento flash)
  const tachado = (precio, cls = '') => (cfg.on && cfg.percent > 0
    ? `<s class="fl-was ${cls}" aria-label="Precio de lista ${money(lista(precio, cfg.percent))}">${money(lista(precio, cfg.percent))}</s>` : '');
  const etiqueta = (cls = '') => (cfg.on && cfg.percent > 0 ? `<span class="fl-tag ${cls}">-${cfg.percent}%</span>` : '');

  // El cupón que el visitante tocó "Usar": el checkout lo completa solo
  const elegido = () => (activo() ? (store.get('xoxo:cupon') || '') : '');

  let pill = null, bar = null, timer = 0;
  const icono = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.2 2 4.5 13.4h6.1L9.8 22l8.7-11.4h-6.1z"/></svg>';

  function pintar() {
    const on = activo();
    document.documentElement.classList.toggle('flash-on', on);
    document.documentElement.classList.toggle('flash-off', !on);
    const r = reloj(restante());
    document.querySelectorAll('.js-flash-reloj').forEach(el => { el.textContent = r; });
    if (pill) pill.hidden = !on;
    if (bar) bar.hidden = !on;
  }

  // Alto de la barra fija: los encabezados de cada diseño se pegan justo debajo (var(--fl-h))
  function medir() {
    const h = bar && !bar.hidden ? bar.offsetHeight : 0;
    document.documentElement.style.setProperty('--fl-h', `${h}px`);
  }

  async function copiar() {
    const code = cupon();
    store.set('xoxo:cupon', code);
    let ok = false;
    try { await navigator.clipboard.writeText(code); ok = true; } catch {}
    avisar(ok ? `Cupón ${code} copiado: lo ponés al pagar` : `Tu cupón es ${code}: lo ponés al pagar`);
  }

  function avisar(msg) {
    let t = document.querySelector('.fl-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'fl-toast';
      t.setAttribute('role', 'status');
      document.body.append(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => t.classList.remove('on'), 3200);
  }

  // Barra de arriba y contador flotante. opts.barra = false para no poner la barra (si el diseño la arma solo)
  function montar(opts = {}) {
    if (!cfg.on || cfg.percent <= 0) {
      document.documentElement.classList.add('flash-off');
      medir();
      return;
    }
    const code = cupon();
    if (opts.barra !== false) {
      bar = document.createElement('div');
      bar.className = 'fl-bar';
      bar.innerHTML = `
        <span class="fl-bar-ico">${icono}</span>
        <span class="fl-bar-txt"><b><span class="fl-long">Descuento flash </span>${cfg.percent}% OFF</b> con el cupón <button type="button" class="fl-code js-flash-copy" aria-label="Copiar el cupón ${code}">${code}</button></span>
        <span class="fl-bar-time"><span class="fl-long">Termina en </span><b class="js-flash-reloj"></b></span>`;
      (opts.dentro || document.body).prepend(bar);
    }
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'fl-pill js-flash-copy';
    pill.setAttribute('aria-label', `Descuento flash: copiar el cupón ${code}`);
    pill.innerHTML = `${icono}<span><b>-${cfg.percent}%</b> <span class="js-flash-reloj"></span></span>`;
    document.body.append(pill);
    document.addEventListener('click', e => { if (e.target.closest('.js-flash-copy')) copiar(); });
    pintar();
    medir();
    if (bar && 'ResizeObserver' in window) new ResizeObserver(medir).observe(bar);
    timer = setInterval(pintar, 1000);
  }

  return Object.assign(api, { cfg, activo, restante, reloj, tachado, etiqueta, elegido, montar, copiar, pintar });
});
