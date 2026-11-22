/* Mi cuenta (xoxotecno.com.ar/cuenta): ingresar o crear la cuenta (email y contraseña, o Google), Mis compras
 * (con el seguimiento y el comprobante de cada una) y Mis datos (se completan solos al pagar).
 * Los links de los mails traen ?confirmar=… (confirmar el email) o ?clave=… (contraseña nueva). */
(() => {
  'use strict';

  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => '$' + fmt.format(Math.round(n));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = document.querySelector('.cu');
  const PROVINCIAS = (window.Envios && window.Envios.PROVINCIAS || []).map(p => p.nombre);
  const ESTADOS = { '': 'Pagado', preparando: 'Preparando', listo: 'Listo para retirar', despachado: 'Despachado', entregado: 'Entregado', cancelado: 'Cancelado' };
  const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.2 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.2 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"/></svg>';

  let estado = { cliente: null, google: false };
  let aviso = { texto: '', malo: false };

  async function api(path, body) {
    const res = await fetch(`/api/cuenta${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Algo salió mal. Probá de nuevo.');
    return data;
  }
  const avisoHTML = () => (aviso.texto ? `<p class="${aviso.malo ? 'sp-error' : 'cu-ok'}" role="alert">${esc(aviso.texto)}</p>` : '');
  const decir = (texto, malo = false) => { aviso = { texto, malo }; };

  /* ---------- Sin sesión: ingresar, crear cuenta, me olvidé ---------- */
  function vistaIngreso(modo = 'ingresar') {
    const tab = (id, label) => `<button type="button" class="cu-tab${modo === id ? ' on' : ''}" data-modo="${id}">${label}</button>`;
    const google = estado.google ? `<a class="sp-btn cu-google" href="/api/cuenta/google">${GOOGLE}Continuar con Google</a><p class="cu-o"><span>o con tu email</span></p>` : '';
    const forms = {
      ingresar: `<form class="cu-form" data-form="ingresar">
          <label><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
          <label><span>Contraseña</span><input name="clave" type="password" autocomplete="current-password" required minlength="8"></label>
          <button class="sp-btn" type="submit">Ingresar</button>
          <button class="cu-link" type="button" data-modo="olvido">Me olvidé la contraseña</button></form>`,
      registro: `<form class="cu-form" data-form="registro">
          <label><span>Nombre y apellido</span><input name="nombre" autocomplete="name" required minlength="3"></label>
          <label><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
          <label><span>Contraseña (8 caracteres o más)</span><input name="clave" type="password" autocomplete="new-password" required minlength="8"></label>
          <button class="sp-btn" type="submit">Crear mi cuenta</button></form>`,
      olvido: `<form class="cu-form" data-form="olvido">
          <p class="sp-muted">Escribí el email de tu cuenta y te mandamos un link para crear una contraseña nueva.</p>
          <label><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
          <button class="sp-btn" type="submit">Mandarme el link</button>
          <button class="cu-link" type="button" data-modo="ingresar">Volver</button></form>`,
    };
    main.innerHTML = `
      <h1>Mi cuenta</h1>
      <p class="cu-intro">Con tu cuenta ves todas tus compras, bajás los comprobantes y pagás más rápido. Para comprar no hace falta.</p>
      ${avisoHTML()}
      <div class="sp-box cu-caja">
        ${modo !== 'olvido' ? `<div class="cu-tabs">${tab('ingresar', 'Ingresar')}${tab('registro', 'Crear cuenta')}</div>${google}` : ''}
        ${forms[modo]}
      </div>`;
  }

  function vistaClaveNueva(token) {
    main.innerHTML = `<h1>Contraseña nueva</h1>${avisoHTML()}
      <div class="sp-box cu-caja"><form class="cu-form" data-form="clave" data-token="${esc(token)}">
        <label><span>Contraseña nueva (8 caracteres o más)</span><input name="clave" type="password" autocomplete="new-password" required minlength="8"></label>
        <button class="sp-btn" type="submit">Guardar y entrar</button></form></div>`;
  }

  /* ---------- Con sesión: Mis compras y Mis datos ---------- */
  async function vistaCuenta(seccion = 'compras') {
    const c = estado.cliente;
    const tab = (id, label) => `<button type="button" class="cu-tab${seccion === id ? ' on' : ''}" data-seccion="${id}">${label}</button>`;
    main.innerHTML = `
      <div class="cu-top"><h1>Hola, ${esc(c.nombre.split(' ')[0])}</h1><button class="cu-link" type="button" data-salir>Salir</button></div>
      <p class="cu-intro">${esc(c.email)}${c.google ? ' · con Google' : ''}</p>
      ${avisoHTML()}
      <div class="cu-tabs">${tab('compras', 'Mis compras')}${tab('datos', 'Mis datos')}</div>
      <div class="cu-seccion"><p class="sp-muted">Cargando…</p></div>`;
    decir('');
    const box = main.querySelector('.cu-seccion');
    if (seccion === 'datos') {
      const d = c.direccion || {};
      box.innerHTML = `<form class="sp-box cu-form" data-form="datos">
        <p class="sp-muted">Se completan solos cuando pagás.</p>
        <label><span>Nombre y apellido</span><input name="nombre" value="${esc(c.nombre)}" autocomplete="name"></label>
        <div class="cu-fila"><label><span>Celular (WhatsApp)</span><input name="telefono" type="tel" value="${esc(c.telefono)}" autocomplete="tel"></label>
          <label><span>DNI</span><input name="dni" inputmode="numeric" value="${esc(c.dni)}"></label></div>
        <label><span>Dirección</span><input name="address" value="${esc(d.address || '')}" autocomplete="street-address" placeholder="Calle, número, piso"></label>
        <div class="cu-fila"><label><span>Localidad</span><input name="city" value="${esc(d.city || '')}" autocomplete="address-level2"></label>
          <label><span>Provincia</span><select name="province"><option value="">Elegí…</option>${PROVINCIAS.map(p => `<option${p === d.province ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
          <label><span>Código postal</span><input name="cp" value="${esc(d.cp || '')}" autocomplete="postal-code"></label></div>
        <button class="sp-btn" type="submit">Guardar mis datos</button></form>`;
      return;
    }
    try {
      const { compras, confirmado } = await api('/compras');
      const confirmar = confirmado ? '' : `<div class="sp-box cu-aviso"><p><b>Confirmá tu email</b> para ver también las compras que hiciste antes sin cuenta. Te mandamos un link a ${esc(c.email)}.</p>
        <button class="cu-link" type="button" data-reenviar>Mandarme el link de nuevo</button></div>`;
      box.innerHTML = confirmar + (compras.length ? compras.map(p => {
        const est = p.seguimiento.estado === 'cancelado' ? 'Cancelado' : p.pago !== 'approved' ? 'Esperando el pago' : ESTADOS[p.seguimiento.estado] || 'Pagado';
        return `<article class="sp-box cu-compra">
          <div class="cu-compra-head"><b>Pedido #${esc(p.ref)}</b><span class="sp-chip${p.seguimiento.estado === 'cancelado' ? ' mal' : ''}">${esc(est)}</span>
            <span class="sp-muted">${esc(new Date(p.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }))}</span><b class="cu-total">${money(p.total)}</b></div>
          <p>${p.items.map(x => `${x.n > 1 ? `${x.n} × ` : ''}${esc(x.name)}`).join(', ')}</p>
          <div class="sp-acciones">
            <a class="sp-btn sp-btn-2" href="/seguimiento?${new URLSearchParams({ pedido: p.ref, email: c.email })}">Ver el seguimiento</a>
            ${p.pago === 'approved' ? `<a class="sp-btn" href="/api/pedidos/${encodeURIComponent(p.id)}/comprobante.pdf" target="_blank" rel="noopener">Comprobante (PDF)</a>` : ''}
          </div></article>`;
      }).join('') : '<div class="sp-box"><p>Todavía no hay compras en tu cuenta.</p><a class="sp-btn" href="/">Ir a la tienda</a></div>');
    } catch (e) { box.innerHTML = `<p class="sp-error">${esc(e.message)}</p>`; }
  }

  /* ---------- Eventos ---------- */
  main.addEventListener('click', async e => {
    const b = e.target.closest('[data-modo], [data-seccion], [data-salir], [data-reenviar]');
    if (!b) return;
    if (b.dataset.modo) { decir(''); return vistaIngreso(b.dataset.modo); }
    if (b.dataset.seccion) return vistaCuenta(b.dataset.seccion);
    if (b.hasAttribute('data-salir')) { await api('/salir', {}); estado.cliente = null; decir('Saliste de tu cuenta.'); return vistaIngreso(); }
    if (b.hasAttribute('data-reenviar')) {
      try { await api('/reenviar', {}); decir('Te mandamos el link de nuevo. Revisá también la carpeta de spam.'); } catch (err) { decir(err.message, true); }
      return vistaCuenta('compras');
    }
  });
  main.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (!f.reportValidity()) return;
    const v = Object.fromEntries(new FormData(f));
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (f.dataset.form === 'ingresar') { estado.cliente = (await api('/ingresar', v)).cliente; return vistaCuenta(); }
      if (f.dataset.form === 'registro') {
        estado.cliente = (await api('/registro', v)).cliente;
        decir(`¡Listo! Te mandamos un mail a ${estado.cliente.email} para confirmar tu email.`);
        return vistaCuenta();
      }
      if (f.dataset.form === 'olvido') { await api('/olvido', v); decir('Si hay una cuenta con ese email, te mandamos el link. Revisá también la carpeta de spam.'); return vistaIngreso('ingresar'); }
      if (f.dataset.form === 'clave') {
        estado.cliente = (await api('/clave', { token: f.dataset.token, clave: v.clave })).cliente;
        history.replaceState(null, '', '/cuenta');
        decir('Listo: tu contraseña nueva quedó guardada.');
        return vistaCuenta();
      }
      if (f.dataset.form === 'datos') {
        estado.cliente = (await api('/datos', { nombre: v.nombre, telefono: v.telefono, dni: v.dni, direccion: { address: v.address, city: v.city, province: v.province, cp: v.cp } })).cliente;
        decir('Tus datos quedaron guardados.');
        return vistaCuenta('datos');
      }
    } catch (err) {
      decir(err.message, true);
      if (f.dataset.form === 'datos') return vistaCuenta('datos');
      if (f.dataset.form === 'clave') return vistaClaveNueva(f.dataset.token);
      return vistaIngreso(f.dataset.form === 'registro' ? 'registro' : f.dataset.form === 'olvido' ? 'olvido' : 'ingresar');
    } finally { btn.disabled = false; }
  });

  /* ---------- Al entrar ---------- */
  (async () => {
    const q = new URLSearchParams(location.search);
    if (q.get('error')) decir(q.get('error'), true);
    try { estado = await api(''); } catch {}
    if (q.get('clave')) return vistaClaveNueva(q.get('clave'));
    if (q.get('confirmar')) {
      try { estado.cliente = (await api('/confirmar', { token: q.get('confirmar') })).cliente; decir('¡Listo! Tu email quedó confirmado.'); } catch (err) { decir(err.message, true); }
      history.replaceState(null, '', '/cuenta');
    }
    if (q.get('error')) history.replaceState(null, '', '/cuenta');
    return estado.cliente ? vistaCuenta() : vistaIngreso(q.get('modo') === 'registro' ? 'registro' : 'ingresar');
  })();
})();
