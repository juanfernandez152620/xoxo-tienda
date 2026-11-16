/* Checkout del pago online, en los dos diseños.
 * Muestra el formulario, elige GO cuotas o Mercado Pago y le pide al servidor (nucleo/pagos.js)
 * la dirección de pago. Las claves de las pasarelas nunca están en la página: viven en el .env del servidor.
 * Uso desde la página: Checkout.open('moto-g06-128', 12)
 */
(() => {
  'use strict';

  const { STORE, PRODUCTS, EXTRAS = [] } = window;
  const CATALOG = [...PRODUCTS, ...EXTRAS]; // EXTRAS: productos que no son celulares, con un solo precio
  const byId = Object.fromEntries(CATALOG.map(p => [p.id, p]));
  const VERSION = location.pathname.split('/').filter(Boolean)[0] || '';
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

  const METHODS = {
    gocuotas: {
      name: 'GO cuotas',
      logo: STORE.financingLogo && STORE.financingLogo.color,
      // Celulares: 9 cuotas sin interés. El resto de los productos: las cuotas de STORE.extras
      plan: p => (p.cuotas ? 9 : STORE.extras.cuotas),
      text: p => (p.cuotas
        ? `9 cuotas${sinInteres} de ${money(p.cuotas[9])} con tu tarjeta de débito. La primera se paga hoy.`
        : `${STORE.extras.cuotas} cuotas con tu tarjeta de débito. La primera se paga hoy.`),
    },
    mercadopago: {
      name: 'Mercado Pago',
      logo: '/media/marcas/mercadopago-icono.svg',
      // Celulares: 12 cuotas sin interés con tarjeta de crédito. El resto de los productos, en un pago
      plan: p => (p.cuotas ? 12 : 1),
      text: p => (p.cuotas
        ? `12 cuotas${sinInteres} de ${money(p.cuotas[12])} con tarjeta de crédito. También débito, dinero en cuenta o efectivo.`
        : 'Tarjeta de crédito o débito, dinero en cuenta o efectivo.'),
    },
  };

  let root = null;
  let product = null;
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
              ${Object.entries(METHODS).map(([key, m]) => `
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

            <fieldset class="co-fields">
              <legend>Entrega</legend>
              <div class="co-choice">
                <label><input type="radio" name="delivery" value="retiro" checked><span>Retiro en el local</span></label>
                <label><input type="radio" name="delivery" value="envio"><span>Envío a domicilio</span></label>
              </div>
              <div class="co-address" hidden>
                <label class="co-field"><span>Dirección</span>
                  <input name="address" autocomplete="street-address" maxlength="160" placeholder="Calle, número, piso"></label>
                <label class="co-field"><span>Localidad</span>
                  <input name="city" autocomplete="address-level2" maxlength="80" value="${esc(STORE.city)}"></label>
                <p class="co-note">Te confirmamos el costo y el día del envío por WhatsApp.</p>
              </div>
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
      if (e.target.name === 'delivery') {
        const envio = e.target.value === 'envio';
        $('.co-address').hidden = !envio;
        $$('.co-address input').forEach(i => { i.required = envio; });
      }
    });
    form.addEventListener('submit', submit);
  }

  const $ = sel => root.querySelector(sel);
  const $$ = sel => [...root.querySelectorAll(sel)];
  const selectedMethod = () => ($('input[name="method"]:checked') || {}).value;

  function paintMethod() {
    const key = selectedMethod();
    const m = METHODS[key];
    if (m) plan = m.plan(product);
    const detail = planText();
    $('.co-product small').textContent = [product.cuotas ? product.brand : product.group, detail].filter(Boolean).join(' · ');
    $('.co-cuota').textContent = detail;
    $('.co-pay').textContent = m ? `Pagar con ${m.name}` : 'Elegí cómo pagar';
    $('.co-pay').disabled = !m;
    $('.co-secure span').textContent = m ? `Vas a terminar el pago en el sitio seguro de ${m.name}.` : '';
  }

  // Texto del plan elegido, con su medio de pago
  function planText() {
    if (product.cuotas) return `${plan} cuotas${sinInteres} de ${money(product.cuotas[plan])} con ${STORE.plans[plan]}`;
    return plan > 1 ? `${plan} cuotas con ${STORE.financing}` : '';
  }

  async function open(id, chosenPlan) {
    product = byId[id];
    if (!product) return;
    // Cada cantidad de cuotas va con un medio: 12 con tarjeta de crédito (Mercado Pago), 9 con GO cuotas
    const wanted = product.cuotas && chosenPlan === 12 ? 'mercadopago' : 'gocuotas';
    if (!root) build();
    lastFocus = document.activeElement;

    const photo = product.gallery && product.gallery[0];
    $('.co-product').innerHTML = `
      ${photo ? `<img src="${esc(photo)}" alt="">` : ''}
      <div><b>${esc(fullName(product))}</b><small></small></div>`;
    $('.co-total strong').textContent = money(priceOf(product));
    $$('.co-method').forEach(el => { el.querySelector('.co-mdesc').textContent = METHODS[el.dataset.method].text(product); });
    const pick = $(`.co-method[data-method="${wanted}"] input`);
    pick.checked = true;
    paintMethod();
    showError('');
    fillBuyer();

    root.hidden = false;
    document.documentElement.classList.add('co-lock');
    $('.co-x').focus({ preventScroll: true });

    // Medios activos según el servidor
    const cfg = await loadConfig();
    let first = null;
    $$('.co-method').forEach(el => {
      const state = cfg && cfg.methods[el.dataset.method];
      const on = Boolean(state && state.enabled);
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
  }

  function fillBuyer() {
    const saved = store.get('cc:buyer');
    if (!saved) return;
    const form = $('.co-form');
    for (const key of ['name', 'email', 'phone', 'dni', 'address', 'city']) {
      if (saved[key] && !form.elements[key].value) form.elements[key].value = saved[key];
    }
  }

  const askText = () => (planText()
    ? `¡Hola! Quiero comprar el ${fullName(product)} en ${planText()}.`
    : `¡Hola! Quiero comprar el ${fullName(product)} a ${money(priceOf(product))}.`);

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
    const payload = {
      version: VERSION,
      productId: product.id,
      plan,
      method,
      buyer: { name: f.name.value, email: f.email.value, phone: f.phone.value, dni: f.dni.value },
      delivery: { type: f.delivery.value, address: f.address.value, city: f.city.value },
    };
    store.set('cc:buyer', { name: f.name.value, email: f.email.value, phone: f.phone.value, dni: f.dni.value, address: f.address.value, city: f.city.value });

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
      approved: { title: '¡Pago aprobado!', text: `Tu pedido ${ref} del ${name} ya está pago. Te vamos a escribir por WhatsApp para coordinar la entrega.` },
      pending: { title: 'Estamos confirmando tu pago', text: `Tu pedido ${ref} del ${name} quedó registrado. Apenas se acredite el pago te escribimos por WhatsApp.` },
      review: { title: 'Estamos confirmando tu pago', text: `Tu pedido ${ref} del ${name} quedó registrado. Lo revisamos y te escribimos por WhatsApp.` },
      rejected: { title: 'El pago no se completó', text: 'No se cobró nada. Podés intentar de nuevo con otro medio de pago o escribirnos y te ayudamos.' },
      error: { title: 'El pago no se completó', text: 'No se cobró nada. Podés intentar de nuevo o escribirnos y te ayudamos.' },
    }[status] || { title: 'Estamos confirmando tu pago', text: 'Te escribimos por WhatsApp apenas se acredite.' };

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
        <a class="co-pay" href="${esc(wa)}" target="_blank" rel="noopener">Escribinos por WhatsApp</a>
        ${failed && productId ? `<button class="co-again" type="button" data-id="${productId}" data-plan="${info.plan}">Intentar de nuevo</button>` : ''}
        <button class="co-back" type="button">Seguir mirando</button>
      </div>`;
    panel.querySelectorAll('.co-x, .co-back').forEach(b => b.addEventListener('click', () => { close(); resetPanel(); }));
    const again = panel.querySelector('.co-again');
    if (again) again.addEventListener('click', () => { resetPanel(); open(again.dataset.id, Number(again.dataset.plan)); });
    root.hidden = false;
    document.documentElement.classList.add('co-lock');
  }

  // Después de mostrar un resultado, el formulario se vuelve a armar de cero
  function resetPanel() {
    if (!root) return;
    root.remove();
    root = null;
  }

  window.Checkout = { open, close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showResult);
  else showResult();
})();
