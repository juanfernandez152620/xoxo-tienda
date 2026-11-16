/* Estadísticas para comparar los dos diseños: visitas, productos vistos, me gusta y clicks a WhatsApp.
   Manda cada evento a /api/evento; el servidor guarda la IP y lo suma en las estadísticas de /admin.
   Los botones de WhatsApp pasan por /api/whatsapp, que reparte los mensajes entre las sucursales.
   Uso desde las apps: TB_TRACK('like', idProducto, { on: true }) */
(() => {
  'use strict';

  const VARIANT = document.currentScript.dataset.variante;
  const ENDPOINT = '/api/evento';
  const store = {
    get(area, key) { try { return window[area].getItem(key); } catch { return null; } },
    set(area, key, value) { try { window[area].setItem(key, value); } catch {} },
  };
  const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 16);

  // Un id por navegador (visitante) y otro por pestaña (visita)
  let vid = store.get('localStorage', 'tb:vid');
  if (!vid) { vid = randomId(); store.set('localStorage', 'tb:vid', vid); }
  let sid = store.get('sessionStorage', 'tb:sid');
  if (!sid) { sid = randomId(); store.set('sessionStorage', 'tb:sid', sid); }

  // Cómo llegó: lo deja el link de entrada (/ o /anuncio) justo antes de redirigir
  let entry = null;
  try { entry = JSON.parse(store.get('sessionStorage', 'tb:entrada') || 'null'); } catch {}
  try { sessionStorage.removeItem('tb:entrada'); } catch {}
  const src = (entry && entry.src) || store.get('sessionStorage', 'tb:src') ||
    (/^#[pvx]=/.test(location.hash) ? 'link-producto' : 'directo');
  store.set('sessionStorage', 'tb:src', src);

  // Dirección de un botón de WhatsApp: el servidor elige la sucursal y anota el click
  window.TB_WA = text => `/api/whatsapp?${new URLSearchParams({ m: text, v: VARIANT, vid, sid, src })}`;

  function send(type, id, data) {
    const body = JSON.stringify({ tipo: type, v: VARIANT, id: id || '', vid, sid, src, ...data });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return;
    } catch {}
    fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  }

  // Cada producto cuenta una sola "vista" y una sola "apertura" por visita
  const once = new Set();
  window.TB_TRACK = (type, id, data = {}) => {
    if (type === 'whatsapp') {
      // Al tocar el botón se le suma al link desde dónde escribió y por qué producto
      const url = new URL(data.el.href, location.href);
      url.searchParams.set('id', id || '');
      url.searchParams.set('donde', data.donde);
      data.el.href = url.href;
      return;
    }
    if (type === 'vista' || type === 'abrir') {
      const key = type + ':' + id;
      if (once.has(key)) return;
      once.add(key);
    }
    send(type, id, data);
  };

  send('visita', '', {
    ref: (entry ? entry.ref : document.referrer) || '',
    ruta: location.pathname + location.hash,
    pantalla: `${screen.width}x${screen.height}`,
  });
})();
