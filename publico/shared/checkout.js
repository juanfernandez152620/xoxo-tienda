/* Checkout del pago online, en los tres diseños.
 * Muestra el formulario, elige Mercado Pago (el medio principal) o GO cuotas, calcula el envío con Andreani o
 * Correo Argentino (shared/envios.js) y le pide al servidor (nucleo/pagos.js) la dirección de pago. El servidor
 * vuelve a calcular el precio y el envío: lo que muestra la página es solo para que la persona sepa el total.
 * Las claves de las pasarelas nunca están en la página: viven en el .env del servidor.
 * Uso desde la página: Checkout.carrito() paga el carrito (shared/carrito.js); Checkout.open('id') paga un solo producto
 */
(() => {
  'use strict';

  const { STORE, PRODUCTS, EXTRAS = [], SITE = {} } = window;
  const SHIP = SITE.shipping || null;
  const Envios = window.Envios || null;
  const Flash = window.Flash || null;
  const CATALOG = [...PRODUCTS, ...EXTRAS]; // EXTRAS: productos que no son celulares, con un solo precio
  const byId = Object.fromEntries(CATALOG.map(p => [p.id, p]));
  // El diseño de la página (lo pone el servidor): en la página principal la dirección no lo dice
  const VERSION = window.TB_DISENO || location.pathname.split('/').filter(Boolean)[0] || '';
  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => '$' + fmt.format(n);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fullName = p => (p.storage ? `${/^(moto|nubia)/i.test(p.name) ? '' : p.brand + ' '}${p.name} ${p.storage} GB` : p.name);
  const priceOf = p => p.price || p.cuotas[12] * 12; // mismo cálculo que el servidor
  const sinInteres = STORE.sinInteres ? ' sin interés' : '';
  // WhatsApp pasa por el reparto entre sucursales (shared/seguimiento.js)
  const waHref = text => window.TB_WA(text);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // Las cuotas de cada producto (las define shared/vidriera.js, que carga antes de pagar) y las del pedido entero:
  // crédito hasta lo que permitan todos sus productos; débito solo si todos lo aceptan
  const cuotasDe = p => window.Vidriera.cuotasDe(p);
  const cuotasPedido = () => (window.Carrito ? window.Carrito.cuotas(lines) : { credito: cuotasDe(product).credito, debito: cuotasDe(product).debito });
  // Mercado Pago va primero: es el medio principal
  const METHODS = {
    mercadopago: {
      name: 'Mercado Pago',
      logo: '/media/marcas/mercadopago-icono.svg',
      // Celulares: 12 cuotas sin interés con tarjeta de crédito. El resto: las cuotas se eligen en Mercado Pago
      plan: p => (p.cuotas ? 12 : 1),
      text: p => (p.cuotas
        ? `12 cuotas${sinInteres} de ${money(p.cuotas[12])} con tarjeta de crédito. También débito, dinero en cuenta o efectivo.`
        : `${cuotasPedido().credito > 1 ? `Hasta ${cuotasPedido().credito} cuotas` : 'En 1 pago'} con tarjeta de crédito. También débito, dinero en cuenta o efectivo.`),
    },
    gocuotas: {
      name: 'GO cuotas',
      logo: STORE.financingLogo && STORE.financingLogo.color,
      // Celulares: 9 cuotas sin interés. El resto de los productos: las cuotas de STORE.extras
      plan: p => (p.cuotas ? 9 : cuotasPedido().debito),
      text: p => (p.cuotas
        ? `9 cuotas${sinInteres} de ${money(p.cuotas[9])} con tu tarjeta de débito. La primera se paga hoy.`
        : cuotasPedido().debito ? `${cuotasPedido().debito} cuotas con tu tarjeta de débito. La primera se paga hoy.`
          : lines.length > 1 ? 'Algún producto del carrito no se puede pagar con débito en cuotas.' : 'Este producto no se puede pagar con débito en cuotas.'),
    },
  };
  // 27/11/2026: solo los medios prendidos (Mercado Pago está apagado en /admin hasta tener su webhook)
  const ACTIVOS = Object.keys(METHODS).filter(k => !(window.TB_PAGOS && window.TB_PAGOS[k] === false));
  // Sin la calculadora: el envío se coordina por WhatsApp después de la compra (se pide solo provincia y localidad)
  const COORD = Boolean(SHIP && SHIP.modo === 'coordinar');
  const branches = (STORE.branches || []).map((b, i) => ({ ...b, i }));

  let root = null;
  let lines = [];      // [{ p, n }]: el carrito, o un solo producto
  let product = null;  // el primero (para los textos de un solo producto)
  const subtotal = () => lines.reduce((s, l) => s + priceOf(l.p) * l.n, 0);
  const peso = () => lines.reduce((s, l) => s + (Envios ? Envios.peso(l.p) : 0) * l.n, 0);
  let plan = 12;
  let lastFocus = null;
  let config = null;

  // Qué pasarelas están activas en el servidor (se pregunta una vez)
  function loadConfig() {
    if (!config) {
      config = fetch('/api/checkout/config')
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .catch(() => null);
    }
    return config;
  }

  const icon = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
    good: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    wait: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    bad: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 7v6M12 16.8v.2"/></svg>',
  };

  function build() {
    root = document.createElement('div');
    root.className = 'co';
    root.hidden = true;
    root.innerHTML = `
      <div class="co-panel" role="dialog" aria-modal="true" aria-labelledby="co-title">
        <header class="co-head">
          <h2 id="co-title">Finalizá tu compra</h2>
          <button class="co-x" type="button" aria-label="Cerrar">${icon.close}</button>
        </header>
        <form class="co-form" novalidate>
          <div class="co-body">
            <div class="co-product"></div>

            <fieldset class="co-methods">
              <legend>¿Cómo querés pagar?</legend>
              ${Object.entries(METHODS).filter(([key]) => ACTIVOS.includes(key)).map(([key, m]) => `
                <label class="co-method" data-method="${key}">
                  <input type="radio" name="method" value="${key}">
                  <span class="co-logo">${m.logo ? `<img src="${esc(m.logo)}" alt="">` : ''}</span>
                  <span class="co-mtext"><b>${esc(m.name)}</b><small class="co-mdesc"></small></span>
                  <span class="co-demo" hidden>Demo</span>
                </label>`).join('')}
            </fieldset>

            <fieldset class="co-fields">
              <legend>Tus datos</legend>
              <label class="co-field"><span>Nombre y apellido</span>
                <input name="name" autocomplete="name" required minlength="3" maxlength="80"></label>
              <label class="co-field"><span>Email</span>
                <input name="email" type="email" autocomplete="email" inputmode="email" required maxlength="120"></label>
              <div class="co-row">
                <label class="co-field"><span>Celular (WhatsApp)</span>
                  <input name="phone" type="tel" autocomplete="tel" inputmode="tel" required placeholder="381 5123456" pattern="[0-9 +\\(\\)\\-]{8,20}"></label>
                <label class="co-field"><span>DNI <i>(opcional)</i></span>
                  <input name="dni" inputmode="numeric" pattern="[0-9.]{7,10}" maxlength="10"></label>
              </div>
            </fieldset>

            ${COORD ? `
            <fieldset class="co-fields co-ship">
              <legend>Entrega</legend>
              <div class="co-options" role="radiogroup" aria-label="Forma de entrega"></div>
              <label class="co-field co-branch" hidden><span>Sucursal</span>
                <select name="branch">${branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}${b.province ? ` (${esc(b.province)})` : ''}</option>`).join('')}</select></label>
              <div class="co-address" hidden>
                <div class="co-row">
                  <label class="co-field"><span>Provincia</span>
                    <select name="province" autocomplete="address-level1">
                      <option value="">Elegí…</option>
                      ${Envios ? Envios.PROVINCIAS.map(p => `<option>${esc(p.nombre)}</option>`).join('') : ''}
                    </select></label>
                  <label class="co-field"><span>Localidad</span>
                    <input name="city" autocomplete="address-level2" maxlength="80"></label>
                </div>
                <input type="hidden" name="cp"><input type="hidden" name="address">
                <p class="co-note">Después de la compra te escribimos por WhatsApp para coordinar el envío: la empresa, el costo y la dirección. El envío se paga aparte.</p>
              </div>
            </fieldset>` : `
            <fieldset class="co-fields co-ship">
              <legend>Entrega</legend>
              <div class="co-row">
                <label class="co-field"><span>Provincia</span>
                  <select name="province" autocomplete="address-level1">
                    <option value="">Elegí…</option>
                    ${Envios ? Envios.PROVINCIAS.map(p => `<option>${esc(p.nombre)}</option>`).join('') : ''}
                  </select></label>
                <label class="co-field"><span>Código postal</span>
                  <input name="cp" autocomplete="postal-code" maxlength="8" placeholder="4000" inputmode="text"></label>
              </div>
              <div class="co-options" role="radiogroup" aria-label="Forma de entrega"></div>
              <label class="co-field co-branch" hidden><span>Sucursal</span>
                <select name="branch">${branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}${b.province ? ` (${esc(b.province)})` : ''}</option>`).join('')}</select></label>
              <div class="co-address" hidden>
                <label class="co-field co-street"><span>Dirección</span>
                  <input name="address" autocomplete="street-address" maxlength="160" placeholder="Calle, número, piso"></label>
                <label class="co-field"><span>Localidad</span>
                  <input name="city" autocomplete="address-level2" maxlength="80"></label>
                <p class="co-note"></p>
              </div>
            </fieldset>`}

            <div class="co-regalo" hidden></div>

            <fieldset class="co-fields co-coupon">
              <legend>Código de descuento</legend>
              <div class="co-coupon-row">
                <input name="coupon" maxlength="30" placeholder="¿Tenés un código?" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Código de descuento">
                <button class="co-apply" type="button">Aplicar</button>
              </div>
              <p class="co-coupon-msg" aria-live="polite"></p>
            </fieldset>

            <fieldset class="co-fields">
              <legend>Resumen</legend>
              <dl class="co-sum"></dl>
            </fieldset>

            <div class="co-error" role="alert" hidden></div>
          </div>

          <footer class="co-foot">
            <div class="co-total"><span>Total</span><strong></strong></div>
            <p class="co-cuota"></p>
            <button class="co-pay" type="submit"></button>
            <p class="co-secure">${icon.lock}<span></span></p>
          </footer>
        </form>
      </div>`;
    document.body.append(root);

    const form = $('.co-form');
    $('.co-x').addEventListener('click', close);
    root.addEventListener('click', e => { if (e.target === root) close(); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    form.addEventListener('change', e => {
      if (e.target.name === 'method') paintMethod();
      if (e.target.name === 'delivery') paintDelivery();
      if (e.target.name === 'province') paintShipping();
    });
    // El código postal completa la provincia (se puede corregir)
    form.elements.cp.addEventListener('input', () => {
      const p = Envios && Envios.provinciaDeCp(form.elements.cp.value);
      if (p && form.elements.province.value !== p.nombre) {
        form.elements.province.value = p.nombre;
        paintShipping();
      }
    });
    $('.co-apply').addEventListener('click', applyCoupon);
    form.elements.coupon.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });
    form.addEventListener('submit', submit);
  }

  const $ = sel => root.querySelector(sel);
  const $$ = sel => [...root.querySelectorAll(sel)];
  const selectedMethod = () => ($('input[name="method"]:checked') || {}).value;

  /* ---------- Envío: retiro gratis o Andreani / Correo Argentino según la provincia ---------- */
  let shipOptions = [];
  const selectedShip = () => {
    const v = ($('input[name="delivery"]:checked') || {}).value || 'retiro';
    return v === 'retiro' ? { id: 'retiro', nombre: 'Retiro en sucursal', costo: 0 } : shipOptions.find(o => o.id === v) || null;
  };

  function paintShipping() {
    const form = $('.co-form');
    const prov = Envios && Envios.provincia(form.elements.province.value);
    const before = ($('input[name="delivery"]:checked') || {}).value || 'retiro';
    // Sin la calculadora (COORD): una sola opción de envío, que se coordina por WhatsApp y se paga aparte
    shipOptions = COORD ? [{ id: 'coordinar', nombre: 'Envío a todo el país', costo: 0, coordinar: true }]
      : prov && SHIP ? Envios.opciones(SHIP, prov.zona, peso(), subtotal()) : [];
    const pickup = !SHIP || SHIP.pickup;
    const opt = (value, title, price, note) => `
      <label class="co-opt">
        <input type="radio" name="delivery" value="${esc(value)}">
        <span class="co-opt-main"><b>${esc(title)}</b><small>${esc(note)}</small></span>
        <span class="co-opt-price">${price}</span>
      </label>`;
    $('.co-options').innerHTML = [
      pickup ? opt('retiro', 'Retiro en sucursal', 'Gratis', branches.length > 1 ? `${branches.length} sucursales` : (branches[0] && branches[0].name) || '') : '',
      ...shipOptions.map(o => (o.coordinar ? opt(o.id, o.nombre, 'A coordinar', 'Lo coordinamos por WhatsApp después de la compra')
        : opt(o.id, o.nombre, o.costo ? money(o.costo) : 'Gratis', `Llega en ${Envios.diasTexto(o.dias)}`))),
      !prov && !COORD ? '<p class="co-ship-hint">Elegí tu provincia o escribí tu código postal para ver el envío con Andreani y Correo Argentino.</p>' : '',
    ].join('');
    const keep = $(`input[name="delivery"][value="${CSS.escape(before)}"]`) || $('input[name="delivery"]');
    if (keep) keep.checked = true;
    paintDelivery();
  }

  function paintDelivery() {
    const ship = selectedShip();
    const envio = Boolean(ship && ship.id !== 'retiro');
    const domicilio = envio && ship.id.endsWith('domicilio');
    $('.co-branch').hidden = Boolean(envio) || branches.length < 2;
    $('.co-address').hidden = !envio;
    const form = $('.co-form');
    form.elements.city.required = envio;
    if (!COORD) {
      $('.co-street').hidden = !domicilio;
      form.elements.address.required = domicilio;
      form.elements.cp.required = envio;
      $('.co-note').textContent = envio
        ? (domicilio ? 'Te mandamos el número de seguimiento por email y WhatsApp.' : `Retirás en la sucursal de ${ship.nombre.split(' a ')[0]} más cercana a esa dirección.`)
        : '';
    }
    paintTotals();
  }

  /* ---------- Código de descuento: el del flash o uno propio ---------- */
  let couponOk = false; // el del flash vigente (el precio de la página ya lo tiene)
  let own = null;       // uno propio: { code, percent } (baja el precio; el servidor lo vuelve a revisar)
  async function applyCoupon() {
    const input = $('.co-form').elements.coupon;
    const msg = $('.co-coupon-msg');
    const value = input.value.trim();
    couponOk = Boolean(Flash && value && Flash.cuponValido(value, Flash.cfg) && Flash.activo());
    own = null;
    let bad = '';
    if (value && !couponOk && !(Flash && Flash.cuponValido(value, Flash.cfg)) && window.Carrito) {
      const r = await window.Carrito.consultar(value);
      if (r.percent) { own = r; window.Carrito.codigo(r); } else bad = r.error;
    }
    msg.className = `co-coupon-msg${value ? (couponOk || own ? ' ok' : ' bad') : ''}`;
    if (!value) msg.textContent = '';
    else if (own) msg.textContent = `¡Listo! Código ${own.code}: ${own.percent}% de descuento.`;
    else if (couponOk) msg.textContent = `¡Listo! Descuento flash del ${Flash.cfg.percent}% aplicado.`;
    else if (Flash && Flash.cuponValido(value, Flash.cfg)) msg.textContent = 'Tu hora del descuento flash ya terminó.';
    else msg.textContent = bad || 'Ese código no es válido.';
    paintTotals();
  }

  // Resumen: productos, descuento (flash o código propio), envío y total
  function paintTotals() {
    if (!lines.length) return;
    const ship = selectedShip();
    const price = subtotal();
    const shipCost = ship ? ship.costo : 0;
    const flashOn = Flash && Flash.activo() && Flash.cfg.percent > 0;
    const list = flashOn ? lines.reduce((s, l) => s + Flash.lista(priceOf(l.p), Flash.cfg.percent) * l.n, 0) : 0;
    // Código propio o regalo de bienvenida (cuenta nueva, primera compra): el que más descuenta, igual que el servidor
    const R = window.Carrito && window.Carrito.regalo;
    const deCodigo = own ? Math.round(price * own.percent / 100) : 0;
    const deRegalo = R ? R.monto(R.mio(), price) : 0;
    const regalo = deRegalo > deCodigo;
    const desc = regalo ? deRegalo : deCodigo;
    const n = lines.reduce((s, l) => s + l.n, 0);
    const row = (a, b, cls = '') => `<div class="${cls}"><dt>${a}</dt><dd>${b}</dd></div>`;
    $('.co-sum').innerHTML = [
      flashOn && couponOk && !own ? row('Precio de lista', `<s>${money(list)}</s>`) : '',
      flashOn && couponOk && !own ? row(`Descuento flash (${esc(Flash.cupon())})`, `−${money(list - price)}`, 'co-save') : '',
      row(n > 1 ? `Productos (${n})` : 'Producto', money(price)),
      regalo ? row('Regalo de bienvenida', `−${money(desc)}`, 'co-save') : own ? row(`Código ${esc(own.code)} (−${own.percent}%)`, `−${money(desc)}`, 'co-save') : '',
      row(ship ? esc(ship.coordinar ? 'Envío' : ship.nombre) : 'Envío', ship ? (shipCost ? money(shipCost) : ship.coordinar ? 'A coordinar' : 'Gratis') : 'Elegí la entrega'),
    ].join('');
    $('.co-total strong').textContent = money(price - desc + shipCost);
    // La invitación a crear la cuenta (sin sesión) o el aviso de que el regalo ya está aplicado
    const box = $('.co-regalo');
    const html = R ? R.html({ regalo, subtotal: price }) : '';
    box.innerHTML = html;
    box.hidden = !html;
  }

  function paintMethod() {
    const key = selectedMethod();
    const m = METHODS[key];
    if (m) plan = m.plan(product);
    const detail = planText();
    $('.co-cuota').textContent = detail;
    $('.co-pay').textContent = m ? `Pagar con ${m.name}` : 'Elegí cómo pagar';
    $('.co-pay').disabled = !m;
    $('.co-secure span').textContent = m ? `Vas a terminar el pago en el sitio seguro de ${m.name}.` : '';
  }

  // Texto del plan elegido, con su medio de pago
  function planText() {
    if (product.cuotas && lines.length === 1) return `${plan} cuotas${sinInteres} de ${money(product.cuotas[plan])} con ${STORE.plans[plan]}`;
    if (selectedMethod() === 'gocuotas') return plan > 1 ? `${plan} cuotas con ${STORE.financing}` : '';
    const c = cuotasPedido().credito;
    return c > 1 ? `Hasta ${c} cuotas${sinInteres} con tarjeta de crédito en Mercado Pago` : 'En 1 pago con Mercado Pago';
  }

  // Un solo producto (los celulares de antes, o "Intentar de nuevo"): como antes
  function open(id, chosenPlan) {
    if (!byId[id]) return;
    lines = [{ p: byId[id], n: 1 }];
    return abrirPedido(byId[id].cuotas && chosenPlan === 9 ? 'gocuotas' : 'mercadopago');
  }
  // El carrito entero (shared/carrito.js)
  function carrito() {
    const ls = window.Carrito ? window.Carrito.lineas() : [];
    if (!ls.length) return window.Carrito && window.Carrito.abrir();
    lines = ls;
    return abrirPedido('mercadopago');
  }

  async function abrirPedido(wanted) {
    product = lines[0].p;
    // Si quedó armado el cartel de un pago anterior (sin formulario), se arma de cero
    if (root && !root.querySelector('.co-form')) resetPanel();
    if (!root) build();
    lastFocus = document.activeElement;

    $('.co-product').innerHTML = lines.map(l => {
      const photo = l.p.gallery && l.p.gallery[0];
      return `<div class="co-line">${photo ? `<img src="${esc(photo)}" alt="">` : `<span class="co-line-ico">${(window.Vidriera && window.Vidriera.icon(l.p.icon)) || ''}</span>`}
        <div><b>${esc(fullName(l.p))}</b><small>${l.n > 1 ? `${l.n} × ${money(priceOf(l.p))}` : money(priceOf(l.p))}</small></div></div>`;
    }).join('');
    $$('.co-method').forEach(el => { el.querySelector('.co-mdesc').textContent = METHODS[el.dataset.method].text(product); });
    // El medio pedido, o el primero que esté prendido (sin Mercado Pago: GO cuotas)
    const pick = $(`.co-method[data-method="${wanted}"] input`) || $('.co-method input');
    if (pick) pick.checked = true;
    paintMethod();
    showError('');
    fillBuyer();
    // Código: el que se puso en el carrito; si no, el del descuento flash vigente (va puesto solo)
    const form = $('.co-form');
    const actual = window.Carrito && window.Carrito.codigoActual();
    if (!form.elements.coupon.value) form.elements.coupon.value = (actual && actual.code) || (Flash && Flash.elegido()) || '';
    if (form.elements.coupon.value) applyCoupon();
    else { own = null; couponOk = false; }
    paintShipping();

    root.hidden = false;
    document.documentElement.classList.add('co-lock');
    $('.co-x').focus({ preventScroll: true });

    // Medios activos según el servidor
    const cfg = await loadConfig();
    let first = null;
    $$('.co-method').forEach(el => {
      const state = cfg && cfg.methods[el.dataset.method];
      // GO cuotas, solo si todos los productos aceptan débito en cuotas (/admin → Otros productos → Cuotas)
      const on = Boolean(state && state.enabled) && !(el.dataset.method === 'gocuotas' && !product.cuotas && !cuotasPedido().debito);
      el.classList.toggle('off', !on);
      el.querySelector('input').disabled = !on;
      el.querySelector('.co-demo').hidden = !(state && state.demo);
      if (on && !first) first = el;
    });
    if (!cfg) {
      showError(`El pago online no está disponible en este momento. <a href="${esc(waHref(askText()))}" target="_blank" rel="noopener">Compralo por WhatsApp</a>.`, true);
    } else if (!first) {
      showError(`Todavía no hay medios de pago configurados. <a href="${esc(waHref(askText()))}" target="_blank" rel="noopener">Compralo por WhatsApp</a>.`, true);
    }
    const current = $('input[name="method"]:checked');
    if ((!current || current.disabled) && first) first.querySelector('input').checked = true;
    paintMethod();
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.documentElement.classList.remove('co-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    // Al cerrar el cartel del resultado de un pago (tocando afuera o con Esc) se descarta: si no, el próximo
    // "Pagar" no encontraba el formulario y no abría nada
    if (root.querySelector('.co-panel[data-result]')) resetPanel();
  }

  function fillBuyer() {
    const form = $('.co-form');
    // Con la sesión iniciada: los datos de la cuenta (Mi cuenta → Mis datos)
    const c = window.TB_CLIENTE;
    if (c) {
      const d = c.direccion || {};
      const desdeCuenta = { name: c.nombre, email: c.email, phone: c.telefono, dni: c.dni, address: d.address, city: d.city, province: d.province, cp: d.cp };
      for (const [key, v] of Object.entries(desdeCuenta)) if (v && form.elements[key] && !form.elements[key].value) form.elements[key].value = v;
    }
    const saved = store.get('cc:buyer');
    if (!saved) return;
    for (const key of ['name', 'email', 'phone', 'dni', 'address', 'city', 'province', 'cp', 'branch']) {
      if (saved[key] && form.elements[key] && !form.elements[key].value) form.elements[key].value = saved[key];
    }
  }

  const askText = () => `¡Hola! Quiero comprar ${lines.map(l => `${l.n > 1 ? `${l.n} × ` : 'el '}${fullName(l.p)}`).join(', ')}${planText() ? ` en ${planText()}` : ` (${money(subtotal())})`}.`;

  function showError(message, isHtml = false) {
    const box = $('.co-error');
    box.hidden = !message;
    if (isHtml) box.innerHTML = message;
    else box.textContent = message;
  }

  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    showError('');
    if (!form.reportValidity()) return;
    const method = selectedMethod();
    if (!method) return showError('Elegí cómo querés pagar.');
    const f = form.elements;
    const ship = selectedShip();
    if (!ship) return showError('Elegí cómo querés recibir tu compra.');
    const payload = {
      version: VERSION,
      productId: product.id,
      items: lines.map(l => ({ id: l.p.id, n: l.n })),
      plan,
      method,
      buyer: { name: f.name.value, email: f.email.value, phone: f.phone.value, dni: f.dni.value },
      delivery: { type: ship.id, address: f.address.value, city: f.city.value, province: f.province.value, cp: f.cp.value, branch: f.branch.value },
      coupon: own ? own.code : couponOk ? f.coupon.value.trim() : '',
    };
    store.set('cc:buyer', {
      name: f.name.value, email: f.email.value, phone: f.phone.value, dni: f.dni.value,
      address: f.address.value, city: f.city.value, province: f.province.value, cp: f.cp.value, branch: f.branch.value,
    });

    const btn = $('.co-pay');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = `Conectando con ${METHODS[method].name}…`;
    try {
      const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'No pudimos iniciar el pago.');
      location.href = data.url; // a la pasarela (GO cuotas o Mercado Pago)
    } catch (err) {
      const msg = err instanceof TypeError ? 'No hay conexión con el servidor de pagos.' : err.message;
      showError(`${esc(msg)} <a href="${esc(waHref(askText()))}" target="_blank" rel="noopener">Comprar por WhatsApp</a>`, true);
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      paintMethod();
    }
  }

  /* ---------- Al volver de la pasarela: ?pago=ok|pendiente|error&pedido=… ---------- */
  async function showResult() {
    const params = new URLSearchParams(location.search);
    const id = params.get('pedido');
    const result = params.get('pago');
    if (!id || !result) return;
    const paymentId = params.get('payment_id') || params.get('collection_id');
    history.replaceState(history.state, '', location.pathname + location.hash); // limpia la dirección

    let info = null;
    try {
      const res = await fetch(`/api/pedidos/${encodeURIComponent(id)}${paymentId ? `?payment_id=${encodeURIComponent(paymentId)}` : ''}`);
      if (res.ok) info = await res.json();
    } catch {}

    const status = info && info.status !== 'created' ? info.status : result === 'ok' ? 'pending' : result === 'pendiente' ? 'pending' : 'rejected';
    const ref = info ? `#${info.ref}` : '';
    const name = info ? info.product : 'tu compra';
    const view = {
      approved: { title: '¡Pago aprobado!', text: `Tu código de compra es ${ref}: guardalo, con él seguís el pedido y lo retirás. Te mandamos el detalle y el comprobante a tu email.` },
      pending: { title: 'Estamos confirmando tu pago', text: `Tu pedido ${ref} del ${name} quedó registrado. Apenas se acredite el pago te escribimos por WhatsApp.` },
      review: { title: 'Estamos confirmando tu pago', text: `Tu pedido ${ref} del ${name} quedó registrado. Lo revisamos y te escribimos por WhatsApp.` },
      rejected: { title: 'El pago no se completó', text: 'No se cobró nada. Podés intentar de nuevo con otro medio de pago o escribirnos y te ayudamos.' },
      error: { title: 'El pago no se completó', text: 'No se cobró nada. Podés intentar de nuevo o escribirnos y te ayudamos.' },
    }[status] || { title: 'Estamos confirmando tu pago', text: 'Te escribimos por WhatsApp apenas se acredite.' };

    if (status === 'approved' && window.Carrito) window.Carrito.vaciar();
    if (!root) build();
    const panel = $('.co-panel');
    const failed = status === 'rejected' || status === 'error';
    const tone = failed ? 'bad' : status === 'approved' ? 'good' : 'wait';
    const wa = waHref(`¡Hola! ${ref ? `Hice el pedido ${ref} ` : 'Hice un pedido '}del ${name} en la web.`);
    const productId = info && CATALOG.find(p => fullName(p) === info.product)?.id;
    panel.dataset.result = status;
    panel.innerHTML = `
      <div class="co-result ${tone}">
        <button class="co-x" type="button" aria-label="Cerrar">${icon.close}</button>
        <span class="co-badge" aria-hidden="true">${icon[tone]}</span>
        <h2 id="co-title">${esc(view.title)}</h2>
        <p>${esc(view.text)}</p>
        ${info && info.demo ? '<p class="co-demo-note">Pago simulado (modo demo): no se cobró nada.</p>' : ''}
        ${status === 'approved' ? `<a class="co-pay" href="/api/pedidos/${encodeURIComponent(id)}/comprobante.pdf" target="_blank" rel="noopener">Descargar el comprobante (PDF)</a>` : ''}
        ${info ? `<a class="co-again co-track" href="/seguimiento?${esc(new URLSearchParams({ pedido: info.ref, email: (store.get('cc:buyer') || {}).email || '' }))}">Seguí tu pedido</a>` : ''}
        <a class="${status === 'approved' ? 'co-again' : 'co-pay'}" href="${esc(wa)}" target="_blank" rel="noopener">Escribinos por WhatsApp</a>
        ${failed && (productId || (window.Carrito && window.Carrito.contar())) ? `<button class="co-again" type="button" data-id="${productId || ''}" data-plan="${info ? info.plan : 1}">Intentar de nuevo</button>` : ''}
        <button class="co-back" type="button">Seguir mirando</button>
      </div>`;
    panel.querySelectorAll('.co-x, .co-back').forEach(b => b.addEventListener('click', () => { close(); resetPanel(); }));
    const again = panel.querySelector('.co-again');
    if (again) again.addEventListener('click', () => { resetPanel(); if (window.Carrito && window.Carrito.contar()) carrito(); else open(again.dataset.id, Number(again.dataset.plan)); });
    root.hidden = false;
    document.documentElement.classList.add('co-lock');
  }

  // Después de mostrar un resultado, el formulario se vuelve a armar de cero
  function resetPanel() {
    if (!root) return;
    root.remove();
    root = null;
  }

  window.Checkout = { open, carrito, close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showResult);
  else showResult();
})();
