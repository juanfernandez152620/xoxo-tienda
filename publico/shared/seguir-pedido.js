/* Seguí tu compra (xoxotecno.com.ar/seguimiento): con el código de la compra y el email muestra en qué anda el
 * pedido (los pasos que tildan en /admin → Pedidos), la entrega, lo que compró y el comprobante en PDF.
 * Los links del mail y del comprobante traen ?pedido=…&email=… y la consulta sale sola. */
(() => {
  'use strict';

  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => '$' + fmt.format(Math.round(n));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cuando = iso => (iso ? new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const $ = s => document.querySelector(s);
  const EMPRESAS = { andreani: ['Andreani', 'https://www.andreani.com/'], correo: ['Correo Argentino', 'https://www.correoargentino.com.ar/'] };
  const ICON = {
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9.5 14.5L12 17l2.5-2.5"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2.2a9.7 9.7 0 0 0-8.4 14.6L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  };

  function pasos(p) {
    const seg = p.seguimiento;
    const at = paso => (seg.historial.filter(h => h.paso === paso).pop() || {}).at;
    const retiro = !p.envio || p.envio.tipo === 'retiro';
    const orden = ['pagado', 'preparando', retiro ? 'listo' : 'despachado', 'entregado'];
    const nombres = { pagado: 'Pagado', preparando: 'Preparando', listo: 'Listo para retirar', despachado: 'Despachado', entregado: 'Entregado' };
    const actual = p.pago !== 'approved' ? -1 : seg.estado ? orden.indexOf(seg.estado) : 0;
    return `<ol class="sp-pasos">${orden.map((k, i) => {
      const hecho = i <= actual;
      const fecha = k === 'pagado' ? p.pagadoEl : hecho ? at(k) : '';
      return `<li class="${hecho ? 'hecho' : ''}${i === actual ? ' actual' : ''}">
        <span class="sp-dot">${hecho ? ICON.ok : i + 1}</span>
        <b>${nombres[k]}</b>${fecha ? `<small>${esc(cuando(fecha))}</small>` : ''}
      </li>`;
    }).join('')}</ol>`;
  }

  function entrega(p) {
    const seg = p.seguimiento;
    if (p.sucursal) {
      const s = p.sucursal;
      const mapa = s.address && !/a confirmar/i.test(s.address) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}` : '';
      return `<div class="sp-box"><h2>Retirás en la sucursal ${esc(s.name)}</h2>
        <p>${esc(s.address || '')}${s.hours ? `<br>${esc(s.hours)}` : ''}</p>
        ${seg.estado === 'listo' ? `<p class="sp-ok">Tu pedido ya está listo. Llevá el código <b>#${esc(p.ref)}</b> (o el comprobante) y tu DNI.</p>` : '<p class="sp-muted">Te avisamos por mail y WhatsApp cuando esté listo para retirar.</p>'}
        ${mapa ? `<a class="sp-link" href="${esc(mapa)}" target="_blank" rel="noopener">${ICON.pin}Cómo llegar</a>` : ''}</div>`;
    }
    const [empresa, web] = EMPRESAS[seg.empresa] || ['', ''];
    return `<div class="sp-box"><h2>${esc(p.envio ? p.envio.nombre : 'Envío')}</h2>
      <p>${esc(p.direccion)}</p>
      ${seg.numero ? `<p class="sp-ok">Número de seguimiento${empresa ? ` de ${esc(empresa)}` : ''}: <b>${esc(seg.numero)}</b></p>
        ${web ? `<a class="sp-link" href="${esc(web)}" target="_blank" rel="noopener">Buscalo en ${esc(web.replace(/^https:\/\/(www\.)?|\/$/g, ''))}</a>` : ''}`
        : p.envio && p.envio.tipo === 'coordinar' ? '<p class="sp-muted">Te escribimos por WhatsApp para coordinar el envío. Cuando lo despachemos vas a ver acá el número de seguimiento.</p>'
        : '<p class="sp-muted">Cuando lo despachemos vas a ver acá el número de seguimiento (y te lo mandamos por mail).</p>'}</div>`;
  }

  // Sin pagar todavía: si se puede, el botón para pagarlo ahora (el servidor arma un link nuevo de la pasarela)
  function sinPagar(p) {
    const tienda = esc(document.querySelector('.sp-volver')?.getAttribute('href') || '/');
    if (p.pagar === 'en-curso') return `<div class="sp-box"><h2>Estamos esperando tu pago</h2><p>Ya empezaste a pagar con ${esc(p.medio)} (por ejemplo, en efectivo). Apenas se acredite, tu pedido pasa a Pagado y te avisamos por mail.</p></div>`;
    if (p.pagar === 'vencido') return `<div class="sp-box"><h2>Este pedido no se pagó</h2><p>Pasaron más de 3 días y los precios pueden haber cambiado. Si todavía lo querés, armalo de nuevo desde la tienda.</p><a class="sp-btn" href="${tienda}">Ir a la tienda</a></div>`;
    if (p.pagar !== 'si') return '<div class="sp-box"><h2>Todavía no recibimos el pago</h2><p>Apenas se acredite, tu pedido pasa a Pagado y te avisamos por mail.</p></div>';
    const fallo = p.pago === 'rejected' || p.pago === 'error';
    return `<div class="sp-box sp-pagar"><h2>${fallo ? 'El pago no se completó' : 'Todavía no recibimos el pago'}</h2>
      <p>${fallo ? `No se cobró nada. Podés intentarlo de nuevo con ${esc(p.medio)}.` : `Si no llegaste a terminar el pago, podés hacerlo ahora con ${esc(p.medio)}.`} Apenas se acredite, tu pedido pasa a Pagado y te avisamos por mail.</p>
      <button class="sp-btn" type="button" data-pagar>Pagar ${money(p.total)}</button>
      <p class="sp-error" role="alert" hidden></p></div>`;
  }

  async function pagar(btn, p, email) {
    const err = btn.nextElementSibling;
    const antes = btn.textContent;
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = `Conectando con ${p.medio}…`;
    try {
      const res = await fetch('/api/seguimiento/pagar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedido: p.ref, email }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'No pudimos iniciar el pago. Probá de nuevo.');
      location.href = data.url; // a Mercado Pago (o GO cuotas)
    } catch (e) {
      err.textContent = e instanceof TypeError ? 'No hay conexión. Probá de nuevo.' : e.message;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = antes;
    }
  }

  function mostrar(p, email) {
    const seg = p.seguimiento;
    const cancelado = seg.estado === 'cancelado';
    const motivo = cancelado ? (seg.historial.filter(h => h.paso === 'cancelado').pop() || {}).motivo : '';
    const subtotal = p.items.reduce((s, x) => s + x.price * x.n, 0);
    const wa = `/api/whatsapp?${new URLSearchParams({ m: `¡Hola! Quiero consultar por mi pedido #${p.ref}.`, v: 'historia', donde: 'otro' })}`;
    const estado = cancelado ? 'Cancelado' : p.pago !== 'approved' ? 'Esperando el pago'
      : { '': 'Pagado', preparando: 'Preparando', listo: 'Listo para retirar', despachado: 'Despachado', entregado: 'Entregado' }[seg.estado] || 'Pagado';
    const res = $('.sp-res');
    res.innerHTML = `
      <div class="sp-titulo"><h1>Pedido #${esc(p.ref)}</h1><span class="sp-chip${cancelado ? ' mal' : ''}">${esc(estado)}</span></div>
      <p class="sp-hola">Hola${p.nombre ? `, ${esc(p.nombre)}` : ''}. Compraste el ${esc(new Date(p.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }))}.</p>
      ${p.demo ? '<p class="sp-demo">PRUEBA: pago simulado, no se cobró nada.</p>' : ''}
      ${cancelado ? `<div class="sp-box mal"><h2>El pedido se canceló</h2>${motivo ? `<p>${esc(motivo)}</p>` : ''}<p>Si tenés dudas, escribinos por WhatsApp.</p></div>`
        : p.pago !== 'approved' ? sinPagar(p)
        : pasos(p)}
      ${!cancelado ? entrega(p) : ''}
      <div class="sp-box"><h2>Tu compra</h2>
        <ul class="sp-items">${p.items.map(x => `<li><span>${x.n > 1 ? `${x.n} × ` : ''}${esc(x.name)}</span><b>${money(x.price * x.n)}</b></li>`).join('')}
          ${p.descuento ? `<li class="sp-save"><span>${p.descuento.texto ? esc(p.descuento.texto) : `Código ${esc(p.descuento.code)} (−${p.descuento.percent}%)`}</span><b>−${money(p.descuento.amount)}</b></li>` : ''}
          <li><span>${esc(p.envio ? p.envio.nombre : 'Entrega')}</span><b>${p.envio && p.envio.costo ? money(p.envio.costo) : p.envio && p.envio.tipo === 'coordinar' ? 'A coordinar' : 'Gratis'}</b></li>
          <li class="sp-total"><span>Total</span><b>${money(p.total)}</b></li></ul>
        <p class="sp-muted">${esc(p.medio)}${p.cuotas ? ` · ${p.cuotas} ${p.cuotas === 1 ? 'pago' : 'cuotas'}` : ''}${p.items.length > 1 || p.descuento ? ` · productos ${money(subtotal)}` : ''}</p>
      </div>
      <div class="sp-acciones">
        ${p.pago === 'approved' ? `<a class="sp-btn" href="/api/comprobante?${new URLSearchParams({ pedido: p.ref, email })}" target="_blank" rel="noopener">${ICON.pdf}Descargar el comprobante (PDF)</a>` : ''}
        <a class="sp-btn sp-btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">${ICON.wa}Consultar por WhatsApp</a>
        <button class="sp-btn sp-btn-2" type="button" data-otro>Buscar otro pedido</button>
      </div>`;
    const btnPagar = res.querySelector('[data-pagar]');
    if (btnPagar) btnPagar.addEventListener('click', () => pagar(btnPagar, p, email));
    res.hidden = false;
    $('.sp-buscar').hidden = true;
    res.querySelector('[data-otro]').addEventListener('click', () => {
      res.hidden = true;
      $('.sp-buscar').hidden = false;
      history.replaceState(null, '', location.pathname);
      $('.sp-form').elements.pedido.focus();
    });
    scrollTo(0, 0);
  }

  async function consultar(pedido, email) {
    const err = $('.sp-error');
    err.hidden = true;
    const btn = $('.sp-form button');
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    try {
      const res = await fetch(`/api/seguimiento?${new URLSearchParams({ pedido, email })}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No pudimos buscar tu pedido. Probá de nuevo.');
      history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({ pedido: data.ref, email })}`);
      mostrar(data, email);
    } catch (e) {
      err.textContent = e instanceof TypeError ? 'No hay conexión. Probá de nuevo.' : e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ver mi pedido';
    }
  }

  const form = $('.sp-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const pedido = form.elements.pedido.value.trim().replace(/^#/, '').toUpperCase();
    const email = form.elements.email.value.trim().toLowerCase();
    if (pedido.length !== 6) { $('.sp-error').textContent = 'El código tiene 6 letras y números, por ejemplo K7Q2MA.'; $('.sp-error').hidden = false; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('.sp-error').textContent = 'Revisá el email.'; $('.sp-error').hidden = false; return; }
    consultar(pedido, email);
  });
  // Desde el mail o el comprobante: ?pedido=K7Q2MA&email=…
  const q = new URLSearchParams(location.search);
  if (q.get('pedido')) form.elements.pedido.value = `#${q.get('pedido').replace(/^#/, '').toUpperCase()}`;
  if (q.get('email')) form.elements.email.value = q.get('email');
  if (q.get('pedido') && q.get('email')) consultar(q.get('pedido').replace(/^#/, '').toUpperCase(), q.get('email').toLowerCase());
})();
