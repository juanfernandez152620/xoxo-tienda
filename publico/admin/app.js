/* Panel /admin de XOXO Tecno: edita el contenido (data/sitio.json, a través del servidor)
   y muestra las estadísticas de los dos diseños. Sin dependencias. */
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('es-AR');
  const n = v => fmt.format(Math.round(v || 0));
  const money = v => '$' + fmt.format(Number(v) || 0);
  const percent = v => `${((v || 0) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
  const clone = o => JSON.parse(JSON.stringify(o));
  const when = iso => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const hour = iso => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const size = b => (b >= 1048576 ? `${(b / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  function ago(iso) {
    if (!iso) return 'nunca';
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'hace instantes';
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return when(iso);
  }

  const VARIANTS = [
    { id: 'red-social', name: 'Red social', cls: 's1', color: '--series-1' },
    { id: 'minimalista', name: 'Minimalista', cls: 's2', color: '--series-2' },
    { id: 'historia', name: 'Historia', cls: 's3', color: '--series-3' },
  ];
  // Profesional salió de la prueba el 22/11/2026: sus números viejos quedan guardados, sin mostrarse
  const vName = id => (VARIANTS.find(v => v.id === id) || {}).name || id;
  const SPEC_ICONS = { pantalla: 'Pantalla', camara: 'Cámara', bateria: 'Batería', memoria: 'Memoria', ram: 'RAM', parlante: 'Parlante', update: 'Actualizaciones', carga: 'Carga rápida' };
  const TYPE_NAMES = { visita: 'Visita', vista: 'Miró un producto', abrir: 'Abrió un producto', like: 'Me gusta', whatsapp: 'WhatsApp', checkout: 'Abrió el checkout' };
  const PLACE_NAMES = {
    tarjeta: 'Tarjeta del producto', producto: 'Página del producto', video: 'Modo video', encabezado: 'Botón de arriba',
    'boton-flotante': 'Botón flotante', pie: 'Pie de página', 'como-comprar': '"Cómo comprar"', aviso: 'Aviso del feed',
    'sin-resultados': 'Búsqueda sin resultados', otro: 'Otro',
  };
  const OPEN_NAMES = { producto: 'página del producto', video: 'modo video', descripcion: 'descripción', ficha: 'ficha del producto' };
  const METRICS = { visitors: 'Visitantes', whatsappVisitors: 'Escribieron por WhatsApp', visits: 'Visitas', whatsapp: 'Clicks en WhatsApp' };

  const S = {
    site: null, draft: null, tab: 'inicio', stats: null, metric: 'visitors', prodSort: 'views', open: null,
    log: null, logQuery: { dia: '', tipo: '', q: '' }, backups: null, upload: null, server: null, exposed: null, reparto: null,
    chat: { list: null, estado: {}, draft: '', files: [], pending: [], uploading: 0, busy: false, rec: null },
  };
  // Preferencias de este navegador (nombre en el chat, último mensaje visto): si no se pueden guardar, no pasa nada
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };

  /* ---------- Servidor ---------- */
  // Carpeta de la tienda en la dirección ('' en la raíz del dominio). Las fotos se guardan como /media/…
  const BASE = window.TB_BASE || '';
  const media = u => (/^\/media\//.test(u || '') ? BASE + u : u || '');
  // Todas las rutas van a /admin/api?r=/ruta
  const apiUrl = path => {
    const [route, qs] = path.split('?');
    return `api?r=${encodeURIComponent(route)}${qs ? '&' + qs : ''}`;
  };
  async function api(path, { method = 'GET', body, file } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-TB': '1' } };
    // Un archivo se manda tal cual (foto o video subido)
    if (file) { opts.body = file; opts.headers['Content-Type'] = file.type || 'application/octet-stream'; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(apiUrl(path), opts);
    // Algunos hostings agregan avisos de PHP antes del JSON: se toma solo el JSON
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { try { data = JSON.parse(text.slice(text.indexOf('{'))); } catch {} }
    if (res.status === 401 && path !== '/login') { showLogin(data && data.error); throw new Error((data && data.error) || 'Sin sesión'); }
    if (!res.ok || !data) throw new Error((data && data.error) || `El servidor respondió con un error (${res.status}). Probá de nuevo.`);
    if (data.error) throw new Error(data.error);
    return data;
  }

  let toastT = 0;
  function toast(msg, error = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), error ? 6000 : 2600);
  }

  /* ---------- Borrador del contenido: se edita acá y se guarda todo junto ---------- */
  const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  function setPath(o, p, v) {
    const keys = p.split('.');
    const last = keys.pop();
    const target = keys.reduce((x, k, i) => {
      if (x[k] == null) x[k] = /^\d+$/.test(keys[i + 1] ?? last) ? [] : {};
      return x[k];
    }, o);
    target[last] = v;
  }
  const isDirty = () => Boolean(S.site && S.draft) && JSON.stringify(S.site) !== JSON.stringify(S.draft);
  const syncSavebar = () => { $('#savebar').hidden = !isDirty() || $('#app').hidden; };

  function readInput(el) {
    const t = el.dataset.type;
    if (el.type === 'checkbox') return el.checked;
    const v = el.value;
    if (t === 'num') return v === '' ? '' : Number(v);
    if (t === 'lines') return v.split('\n').map(s => s.trim()).filter(Boolean);
    if (t === 'csv') return v.split(',').map(s => s.trim()).filter(Boolean);
    if (t === 'csvnum') return v.split(',').map(s => Number(s.replace(/\D/g, ''))).filter(x => x > 0);
    return v;
  }

  // Campos del formulario (data-path = dónde se guarda en el contenido)
  const attrs = (path, { kind = '', live = '', rerender = false } = {}) =>
    `data-path="${esc(path)}"${kind ? ` data-type="${kind}"` : ''}${live ? ` data-live="${live}"` : ''}${rerender ? ' data-rerender' : ''}`;
  function field(label, path, { type = 'text', help = '', ph = '', ro = false, live = '', kind = '' } = {}) {
    let v = getPath(S.draft, path);
    if (kind === 'csv' || kind === 'csvnum') v = (v || []).join(', ');
    return `<label class="field">${esc(label)}
      <input type="${type}" ${attrs(path, { kind: kind || (type === 'number' ? 'num' : ''), live })} value="${esc(v ?? '')}" placeholder="${esc(ph)}"${ro ? ' readonly' : ''}${type === 'number' ? ' inputmode="numeric" min="0"' : ''}>
      ${help ? `<small>${help}</small>` : ''}</label>`;
  }
  function area(label, path, { help = '', kind = '', rows = 3 } = {}) {
    let v = getPath(S.draft, path);
    if (kind === 'lines') v = (v || []).join('\n');
    return `<label class="field">${esc(label)}<textarea rows="${rows}" ${attrs(path, { kind })}>${esc(v ?? '')}</textarea>
      ${help ? `<small>${help}</small>` : ''}</label>`;
  }
  const check = (label, path, rerender = false) =>
    `<label class="check"><input type="checkbox" ${attrs(path, { rerender })}${getPath(S.draft, path) ? ' checked' : ''}>${esc(label)}</label>`;
  const color = (path, title) =>
    `<input type="color" ${attrs(path)} value="${esc(getPath(S.draft, path) || '#000000')}" title="${esc(title)}" aria-label="${esc(title)}">`;
  function mediaField(label, path, help = '') {
    const v = getPath(S.draft, path) || '';
    const preview = !v ? '' : /\.mp4$/i.test(v) ? '<span class="chip">Video</span>' : `<img src="${esc(media(v))}" alt="">`;
    return `<div class="field"><span>${esc(label)}</span>
      <div class="media-field">${preview}
        <input type="text" ${attrs(path, { rerender: true })} value="${esc(v)}" placeholder="/media/… o https://…" aria-label="${esc(label)}">
        <button class="btn small" type="button" data-act="upload" data-path="${esc(path)}">Subir</button>
        ${v ? `<button class="btn small" type="button" data-act="clear" data-path="${esc(path)}">Quitar</button>` : ''}
      </div>${help ? `<small>${help}</small>` : ''}</div>`;
  }

  /* ---------- Vistas ---------- */
  const VIEWS = { inicio: viewInicio, sucursales: viewSucursales, paginas: viewPaginas, clientes: viewClientes, estadisticas: viewStats, ia: viewChat, pedidos: viewOrders, anuncio: viewAb, productos: viewProducts, accesorios: viewExtras, tienda: viewStore, registro: viewLog, copias: viewBackups, cuenta: viewAccount };
  const loading = '<p class="muted">Cargando…</p>';

  function render() {
    $$('#tabs [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
    const cel = $('#tab-celulares');
    if (cel && S.draft) cel.hidden = !S.draft.store.phones;
    const y = scrollY;
    $('#view').innerHTML = (S.exposed ? exposedNote() : '') + VIEWS[S.tab]();
    scrollTo(0, y);
    if (S.tab === 'estadisticas') drawChart();
    syncSavebar();
  }

  async function go(tab) {
    if (!VIEWS[tab]) tab = 'inicio';
    if (S.tab !== tab) { scrollTo(0, 0); S.open = null; }
    if (tab !== 'ia' && S.chat.rec) cancelRec();
    S.tab = tab;
    history.replaceState(null, '', '#' + tab);
    render();
    updateBadge();
    try {
      if (tab === 'ia') { await loadChat(); render(); paintChat(true); markSeen(); }
      if (tab === 'estadisticas') { S.stats = await api('/estadisticas'); render(); }
      if (tab === 'sucursales') { S.reparto = await api('/reparto'); render(); }
      if (tab === 'pedidos' || tab === 'inicio' || tab === 'clientes') { S.orders = await api('/pedidos'); render(); }
      if (tab === 'clientes') { S.clientes = await api('/clientes'); render(); }
      if (tab === 'registro') await loadLog();
      if (tab === 'copias') { S.backups = await api('/backups'); render(); }
      if (tab === 'cuenta') { S.server = await api('/servidor'); render(); }
    } catch (err) { toast(err.message, true); }
  }

  /* ----- Estadísticas ----- */
  function verdict(st) {
    const A = st.variants['red-social'], B = st.variants.minimalista, t = st.test;
    if (!A.visitors && !B.visitors) {
      return { tag: 'Sin datos', title: 'Todavía no hay visitas', text: 'Compartí el link de la sección Anuncio y acá vas a ver cuál de los dos diseños consigue más mensajes por WhatsApp.' };
    }
    const [win, w, lose, l] = A.conversion >= B.conversion ? ['Red social', A, 'Minimalista', B] : ['Minimalista', B, 'Red social', A];
    if (!t.enough) {
      return {
        tag: 'Faltan datos', title: 'Todavía es pronto para elegir',
        text: `Para saber cuál funciona mejor hacen falta al menos 30 visitantes en cada diseño y 10 personas que escriban por WhatsApp. Hoy: ${n(A.visitors)} visitantes en Red social, ${n(B.visitors)} en Minimalista y ${n(A.whatsappVisitors + B.whatsappVisitors)} escribieron.`,
      };
    }
    if (t.significant) {
      return {
        tag: 'Diferencia real', title: `${win} consigue más mensajes por WhatsApp`,
        text: `Escribe el ${percent(w.conversion)} de sus visitantes, contra el ${percent(l.conversion)} en ${lose}. Con esta cantidad de visitas la diferencia no es casualidad (95% de confianza).`,
      };
    }
    return {
      tag: 'Sin ganador todavía', title: 'Por ahora los dos funcionan parecido',
      text: `${win}: ${percent(w.conversion)} · ${lose}: ${percent(l.conversion)} de los visitantes escribe por WhatsApp. La diferencia todavía puede ser casualidad: seguí juntando visitas.`,
    };
  }

  const COMPARE = [
    ['visitors', 'Visitantes (personas distintas)'],
    ['visits', 'Visitas'],
    ['whatsappVisitors', 'Personas que escribieron por WhatsApp'],
    ['conversion', 'Conversión (escribieron / visitantes)', percent],
    ['whatsapp', 'Clicks en WhatsApp'],
    ['checkouts', 'Abrieron el checkout'],
    ['orders', 'Compras iniciadas'],
    ['paid', 'Compras pagadas'],
    ['views', 'Productos mirados (2 s o más)'],
    ['opens', 'Productos abiertos'],
    ['likesNet', 'Me gusta'],
  ];
  const vHead = (extra = '') => VARIANTS.map(v => `<th class="num"><span class="row" style="justify-content:flex-end;gap:6px"><i class="swatch ${v.cls}"></i>${v.name}</span>${extra}</th>`).join('');

  function viewStats() {
    const st = S.stats;
    if (!st) return `<div class="page-head"><h1>Estadísticas</h1></div>${loading}`;
    const vd = verdict(st);
    const tiles = VARIANTS.map(v => {
      const c = st.variants[v.id];
      return `<div class="tile">
        <span class="label"><i class="swatch ${v.cls}"></i>${v.name}</span>
        <span class="value">${percent(c.conversion)}</span>
        <span class="sub">${n(c.whatsappVisitors)} de ${n(c.visitors)} visitantes escribieron por WhatsApp</span>
      </div>`;
    }).join('');
    const compareRows = COMPARE.map(([k, label, f = n]) =>
      `<tr><td>${label}</td>${VARIANTS.map(v => `<td class="num">${f(st.variants[v.id][k])}</td>`).join('')}</tr>`).join('');

    const sortKey = S.prodSort;
    const prods = [...st.products].sort((a, b) =>
      VARIANTS.reduce((s, v) => s + b.per[v.id][sortKey], 0) - VARIANTS.reduce((s, v) => s + a.per[v.id][sortKey], 0));
    const cols = [['views', 'Mirado'], ['opens', 'Abierto'], ['likes', 'Me gusta'], ['whatsapp', 'WhatsApp']];
    const prodRows = prods.map(p => `<tr>
      <td>${esc(p.name)}${p.deleted ? ' <span class="chip off">Ya no existe</span>' : p.hidden ? ' <span class="chip off">Oculto</span>' : ''}<span class="sub">${esc(p.brand)}</span></td>
      ${cols.map(([k]) => VARIANTS.map(v => `<td class="num">${n(p.per[v.id][k])}</td>`).join('')).join('')}
    </tr>`).join('');

    const placeKeys = [...new Set(VARIANTS.flatMap(v => Object.keys(st.places[v.id] || {})))]
      .sort((a, b) => VARIANTS.reduce((s, v) => s + ((st.places[v.id] || {})[b] || 0) - ((st.places[v.id] || {})[a] || 0), 0));
    const sources = [...st.sources].sort((a, b) =>
      VARIANTS.reduce((s, v) => s + ((b.per[v.id] || {}).visits || 0) - ((a.per[v.id] || {}).visits || 0), 0));

    return `
      <div class="page-head"><h1>Estadísticas</h1>
        <button class="btn small" type="button" data-act="reload-stats">Actualizar</button></div>
      <p class="muted">Desde el ${when(st.since)} · último movimiento ${ago(st.lastEventAt)} ·
        reparto actual: ${st.ab.mode === 'split' ? `${st.ab.redSocialPercent}% Red social / ${100 - st.ab.redSocialPercent}% Minimalista` : `solo ${vName(st.ab.mode)}`}</p>

      <section class="card">
        <div class="verdict"><span class="tag">${vd.tag}</span><div><b>${esc(vd.title)}</b>${esc(vd.text)}</div></div>
        <div class="tiles">${tiles}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Comparación</th>${vHead()}</tr></thead>
          <tbody>${compareRows}</tbody>
        </table></div>
      </section>

      ${repartoCard(st.reparto)}

      <section class="card">
        <div class="card-head"><h2>Por día</h2><p>Últimos 30 días</p></div>
        <div class="row">
          <div class="seg" role="group" aria-label="Qué mostrar">${Object.entries(METRICS).map(([k, l]) =>
            `<button type="button" data-act="metric" data-k="${k}" aria-pressed="${S.metric === k}">${l}</button>`).join('')}</div>
          <span class="spacer"></span>
          <div class="legend">${VARIANTS.map(v => `<span><i style="background:var(${v.color})"></i>${v.name}</span>`).join('')}</div>
        </div>
        <div class="chart" id="chart"></div>
        <details class="table-view"><summary>Ver los números por día</summary>
          <div class="table-wrap"><table><thead><tr><th>Día</th>${vHead()}</tr></thead><tbody>
            ${[...st.days].reverse().map(d => `<tr><td>${d.day.slice(8, 10)}/${d.day.slice(5, 7)}/${d.day.slice(0, 4)}</td>${VARIANTS.map(v => `<td class="num">${n(d[v.id][S.metric])}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>
        </details>
      </section>

      <section class="card">
        <div class="card-head"><h2>Qué productos miran más</h2><p>Por diseño. "Mirado" cuenta 2 segundos o más con el video andando.</p></div>
        <div class="seg" role="group" aria-label="Ordenar por">${cols.map(([k, l]) =>
          `<button type="button" data-act="prod-sort" data-k="${k}" aria-pressed="${sortKey === k}">${l}</button>`).join('')}</div>
        <div class="table-wrap"><table>
          <thead>
            <tr><th></th>${cols.map(([, l]) => `<th colspan="2" class="th-group">${l}</th>`).join('')}</tr>
            <tr><th>Producto</th>${cols.map(() => VARIANTS.map(v => `<th class="num"><i class="swatch ${v.cls}" title="${v.name}"></i><span class="muted"> ${{ 'red-social': 'A', minimalista: 'B', historia: 'C' }[v.id] || v.name}</span></th>`).join('')).join('')}</tr>
          </thead>
          <tbody>${prodRows}</tbody>
        </table></div>
      </section>

      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h2>Desde dónde escriben</h2><p>Botón de WhatsApp que tocaron</p></div>
          ${placeKeys.length ? `<div class="table-wrap"><table><thead><tr><th>Botón</th>${vHead()}</tr></thead><tbody>
            ${placeKeys.map(k => `<tr><td>${esc(PLACE_NAMES[k] || k)}</td>${VARIANTS.map(v => `<td class="num">${n((st.places[v.id] || {})[k])}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Todavía nadie tocó WhatsApp.</p>'}
        </section>
        <section class="card">
          <div class="card-head"><h2>Origen de las visitas</h2><p>"anuncio" = link /anuncio · agregá ?src= para separar redes</p></div>
          ${sources.length ? `<div class="table-wrap"><table><thead><tr><th>Origen</th>${vHead()}</tr></thead><tbody>
            ${sources.map(s => `<tr><td>${esc(s.src)}</td>${VARIANTS.map(v => {
              const x = s.per[v.id] || { visits: 0, whatsapp: 0 };
              return `<td class="num">${n(x.visits)} <span class="muted">· ${n(x.whatsapp)} WA</span></td>`;
            }).join('')}</tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Todavía no hay visitas.</p>'}
        </section>
      </div>

      <section class="card">
        <div class="card-head"><h2>Herramientas</h2></div>
        <p class="muted">Los totales se ponen al día cada minuto y se copian cada ${st.backupHours} h (última copia: ${esc(st.lastBackup || 'ninguna')}).
          Cada evento queda además en el registro, así que siempre se pueden recalcular.</p>
        <div class="row">
          <button class="btn" type="button" data-act="recalc">Recalcular desde el registro</button>
          <button class="btn danger" type="button" data-act="reset-stats">Empezar de cero</button>
        </div>
      </section>`;
  }

  // Gráfico de líneas: un eje, dos series, cruz que sigue al puntero y cartel con los dos valores
  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw));
    for (const k of [1, 2, 5, 10]) if (k * p >= raw) return k * p;
    return 10 * p;
  }
  const compact = v => (v >= 1000 ? `${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}K` : n(v));
  function drawChart() {
    const box = $('#chart');
    if (!box || !S.stats) return;
    const days = S.stats.days, m = S.metric;
    const W = Math.max(300, Math.round(box.clientWidth)), H = 250;
    const pad = { l: 36, r: W < 520 ? 16 : 120, t: 12, b: 28 };
    const series = VARIANTS.map(v => ({ ...v, values: days.map(d => (d[v.id] || {})[m] || 0) }));
    const top0 = Math.max(1, ...series.flatMap(s => s.values));
    const step = Math.max(1, niceStep(top0 / 4));
    const top = Math.ceil(top0 / step) * step;
    const ticks = [];
    for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const x = i => pad.l + (i / (days.length - 1)) * iw;
    const y = v => pad.t + (1 - v / top) * ih;
    const last = days.length - 1;
    const label = d => `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}`;
    const ends = series.map(s => y(s.values[last]));
    const showEnds = pad.r > 16 && Math.abs(ends[0] - ends[1]) >= 16;

    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(METRICS[m])} por día en los últimos 30 días, por diseño">
      <g class="grid">${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
      <g class="axis">
        ${ticks.map(t => `<text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`).join('')}
        ${days.map((d, i) => ((last - i) % 7 === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${label(d)}</text>` : '')).join('')}
      </g>
      ${series.map(s => `<path d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}"
        fill="none" stroke="var(${s.color})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
      ${series.map(s => `<circle class="dot" cx="${x(last)}" cy="${y(s.values[last])}" r="4" fill="var(${s.color})"/>`).join('')}
      ${showEnds ? series.map((s, k) => `<text class="end-label" x="${x(last) + 10}" y="${ends[k] + 4}">${s.name} · ${n(s.values[last])}</text>`).join('') : ''}
      <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
      ${series.map(s => `<circle class="dot hover" r="4" fill="var(${s.color})" visibility="hidden"/>`).join('')}
      <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent" tabindex="0"
        aria-label="Recorré los días con las flechas"/>
    </svg><div class="tip" hidden></div>`;

    const svg = $('svg', box), tip = $('.tip', box), cross = $('.cross', box), dots = $$('.dot.hover', box), hit = $('.hit', box);
    let at = last;
    function show(i) {
      at = Math.max(0, Math.min(last, i));
      const cx = x(at);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dots.forEach((d, k) => { d.setAttribute('cx', cx); d.setAttribute('cy', y(series[k].values[at])); d.setAttribute('visibility', 'visible'); });
      const date = new Date(days[at].day + 'T12:00:00');
      tip.innerHTML = `<div class="t">${esc(date.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }))} · ${esc(METRICS[m])}</div>` +
        series.map(s => `<div class="r"><i style="background:var(${s.color})"></i><b>${n(s.values[at])}</b><span>${s.name}</span></div>`).join('');
      tip.hidden = false;
      const scale = svg.getBoundingClientRect().width / W;
      const left = cx * scale + 12;
      tip.style.left = `${left + tip.offsetWidth > box.clientWidth ? cx * scale - tip.offsetWidth - 12 : left}px`;
      tip.style.top = `${pad.t * scale}px`;
    }
    function hide() {
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
      dots.forEach(d => d.setAttribute('visibility', 'hidden'));
    }
    hit.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect();
      show(Math.round(((e.clientX - r.left) * (W / r.width) - pad.l) / iw * last));
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(at));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
    });
  }

  /* ----- Reparto de WhatsApp entre las sucursales ----- */
  function repartoCard(r) {
    if (!r) return '';
    const total = r.sucursales.reduce((s, b) => s + b.total, 0);
    const share = b => (total ? b.total / total : 0);
    return `<section class="card">
      <div class="card-head"><h2>Mensajes por sucursal</h2><p>Personas distintas que tocaron WhatsApp. Cada una queda con su sucursal.</p></div>
      ${r.sucursales.length === 2 && total ? `<div class="split-bar" aria-hidden="true">${r.sucursales.map((b, i) => `<i class="s${i + 1}" style="width:${share(b) * 100}%"></i>`).join('')}</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Sucursal</th><th class="num">Hoy</th><th class="num">Total</th><th class="num">Reparto</th><th class="num">Clicks</th></tr></thead>
        <tbody>${r.sucursales.map(b => `<tr>
          <td>${esc(b.name)}${b.on ? '' : ' <span class="chip off">No recibe mensajes</span>'}</td>
          <td class="num">${n(b.hoy)}</td><td class="num">${n(b.total)}</td><td class="num">${percent(share(b))}</td><td class="num">${n(b.clicks)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted">${r.siguiente ? `La próxima persona nueva va a <b>${esc(r.siguiente)}</b>.`
        : 'Ninguna sucursal tiene WhatsApp cargado: el botón de WhatsApp de las páginas lleva al inicio de la tienda.'}</p>
    </section>`;
  }

  function branchEditor(b, i, len) {
    const p = `store.branches.${i}`;
    const wa = String(b.whatsapp || '').replace(/\D/g, '');
    return `<div class="branch">
      <div class="grid-2">
        ${field('Nombre', `${p}.name`)}
        <label class="field">WhatsApp
          <input type="text" ${attrs(`${p}.whatsapp`)} value="${esc(b.whatsapp)}" inputmode="numeric" placeholder="3813629235">
          <small>Opcional. Característica y número, sin 0 ni 15. Sin número, esta sucursal no recibe mensajes de WhatsApp.
            ${wa ? `<a href="https://wa.me/${esc(wa.length === 10 ? `549${wa}` : wa)}" target="_blank" rel="noopener">Probar este número</a>` : ''}</small></label>
      </div>
      <div class="grid-2">
        ${field('Dirección', `${p}.address`, { help: 'Se muestra en la tienda, con el botón "Cómo llegar".' })}
        ${field('Provincia', `${p}.province`, { help: 'Agrupa las sucursales en la página Historia. Ej. Tucumán, Catamarca, Buenos Aires.' })}
      </div>
      <div class="grid-2">
        ${field('Horarios', `${p}.hours`, { ph: 'Lunes a sábado de 9 a 13 y de 16 a 21', help: 'Se ven en el seguimiento, el comprobante y el mail de "listo para retirar".' })}
        ${field('Teléfono fijo', `${p}.phone`, { ph: '381 4211234' })}
      </div>
      ${mediaField('Foto del local', `${p}.photo`, 'El frente o el interior. Se ve en Historia; sin foto se muestra una de ejemplo.')}
      <div class="row">${check('Recibe mensajes de WhatsApp', `${p}.on`)}${b.on && !wa ? '<span class="muted">(cuando le cargues el WhatsApp)</span>' : ''}<span class="spacer"></span>
        ${len > 1 ? `<button class="btn small" type="button" data-act="del-branch" data-i="${i}">Quitar sucursal</button>` : ''}</div>
    </div>`;
  }

  /* ----- Anuncio (reparto entre los 3 diseños) ----- */
  // Reparto entre los 3 diseños: cada uno tiene una parte (no hace falta que sumen 100)
  const splitPct = w => {
    const total = VARIANTS.reduce((s, v) => s + (Number(w[v.id]) || 0), 0) || 1;
    return VARIANTS.map(v => ({ ...v, pct: Math.round(((Number(w[v.id]) || 0) / total) * 100) }));
  };
  const splitText = w => splitPct(w).map(v => `${v.name} ${v.pct}%`).join(' · ');
  const splitBar = w => splitPct(w).map(v => `<i class="${v.cls}" style="width:${v.pct}%"></i>`).join('');
  function viewAb() {
    const ab = S.draft.ab;
    const link = `${location.origin}${BASE}/anuncio/`;
    const mode = (value, title, text) => `<label class="mode">
      <b><input type="radio" name="ab-mode" value="${value}" ${attrs('ab.mode', { rerender: true })}${ab.mode === value ? ' checked' : ''}>${title}</b>
      <small class="muted">${text}</small></label>`;
    return `
      <div class="page-head"><h1>Anuncio</h1></div>
      <section class="card">
        <div class="card-head"><h2>Link para anuncio digital</h2></div>
        <p>Usalo en Instagram, Facebook, TikTok o donde publiques. Cada persona que entra ve uno de los 3 diseños (Red social, Minimalista e Historia) y queda registrada en las estadísticas.</p>
        <div class="link-box"><code>${esc(link)}</code>
          <button class="btn primary" type="button" data-act="copy" data-text="${esc(link)}">Copiar link</button></div>
        <p class="muted">Para saber de qué red vino cada visita, agregale <code>?src=</code> y un nombre, por ejemplo
          <code>${esc(link)}?src=instagram</code>. Aparece en Estadísticas → Origen de las visitas.</p>
        <p><b>Un link por categoría</b> (la persona entra directo a esa categoría, en su diseño):</p>
        ${(S.draft.categories || []).map(c => {
          const l = `${link}${c.id}/`;
          return `<div class="link-box"><code>${esc(l)}</code><button class="btn small" type="button" data-act="copy" data-text="${esc(l)}">Copiar</button></div>`;
        }).join('')}
      </section>
      <p class="muted">Las sucursales y el reparto de WhatsApp están en la pestaña Sucursales.</p>
      <section class="card">
        <div class="card-head"><h2>Qué diseño se muestra</h2></div>
        <div class="modes">
          ${mode('split', 'Los 3 (prueba A/B/C)', 'Cada visitante ve uno de los 3 diseños, según la parte de cada uno.')}
          ${mode('red-social', 'Solo Red social (A)', 'Todos ven Red social. Los links de los otros diseños también llevan a Red social.')}
          ${mode('minimalista', 'Solo Minimalista (B)', 'Todos ven Minimalista. Los links de los otros diseños también llevan a Minimalista.')}
          ${mode('historia', 'Solo Historia (C)', 'Todos ven Historia, la página animada. Los links de los otros diseños también llevan a Historia.')}
        </div>
        ${ab.mode === 'split' ? `<div class="split">
          <p class="field">Reparto <span id="split-text">${splitText(ab.weights)}</span></p>
          <div class="grid-3">${VARIANTS.map(v => `<label class="field"><span><i class="swatch ${v.cls}"></i> ${v.name}</span>
            <input type="range" min="0" max="100" step="5" value="${Number(ab.weights[v.id]) || 0}" ${attrs(`ab.weights.${v.id}`, { kind: 'num', live: 'split' })}></label>`).join('')}</div>
          <div class="split-bar" id="split-bar" aria-hidden="true">${splitBar(ab.weights)}</div>
        </div>` : ''}
        <p class="note">Cada visitante ve siempre el mismo diseño, porque queda guardado en su navegador. Si cambiás el porcentaje,
          los que ya entraron siguen viendo el suyo. Para volver a repartir a todos, tocá "Repartir de nuevo" (ahora es la ronda ${ab.round}).</p>
        <div class="row">
          <button class="btn" type="button" data-act="reround">Repartir de nuevo a todos</button>
          <a class="btn" href="${esc(BASE)}/red-social/?ver" target="_blank" rel="noopener">Ver Red social</a>
          <a class="btn" href="${esc(BASE)}/minimalista/?ver" target="_blank" rel="noopener">Ver Minimalista</a>
          <a class="btn" href="${esc(BASE)}/historia/?ver" target="_blank" rel="noopener">Ver Historia</a>
        </div>
      </section>`;
  }

  /* ----- Productos ----- */
  const totalsText = p => {
    const c12 = Number(p.cuotas[12]) || 0, c9 = Number(p.cuotas[9]) || 0;
    const same = Math.abs(c12 * 12 - c9 * 9) <= Math.max(12, c12 * 12 * .001);
    return `Total en 12: ${money(c12 * 12)} · Total en 9: ${money(c9 * 9)}${c12 && c9 && same ? ' · mismo precio en 9 o 12' : ''}`;
  };
  const rowTitle = p => (p.cuotas ? `${p.name || 'Sin nombre'} ${p.storage || ''} GB` : p.name || 'Sin nombre');
  const rowMeta = p => `${p.brand || 'Sin marca'} · 12 x ${money(p.cuotas[12])} · 9 x ${money(p.cuotas[9])}`;

  function viewProducts() {
    const list = S.draft.products;
    const visible = list.filter(p => !p.hidden).length;
    return `
      <div class="page-head"><h1>Celulares</h1>
        <button class="btn primary" type="button" data-act="add-product">Agregar producto</button></div>
      <p class="muted">${visible} visibles · ${list.length - visible} ocultos. Ocultar no borra: el producto deja de aparecer en la tienda y conserva sus estadísticas.</p>
      <div class="plist">${list.map((p, i) => productRow(p, i, list.length)).join('')}</div>`;
  }

  function productRow(p, i, len) {
    const open = S.open === i;
    const featured = p.id && S.draft.store.featured === p.id;
    return `<article class="prow${p.hidden ? ' is-hidden' : ''}${open ? ' open' : ''}">
      ${p.gallery && p.gallery[0] ? `<img class="thumb" src="${esc(media(p.gallery[0]))}" alt="">` : '<span class="thumb"></span>'}
      <div>
        <p class="name"><span class="name-text">${esc(rowTitle(p))}</span>
          ${featured ? '<span class="chip">Destacado</span>' : ''} ${p.hidden ? '<span class="chip off">Oculto</span>' : ''}</p>
        <p class="meta">${esc(rowMeta(p))}</p>
      </div>
      <div class="actions">
        <button class="icon-btn" type="button" data-act="move" data-i="${i}" data-d="-1"${i ? '' : ' disabled'} aria-label="Subir">↑</button>
        <button class="icon-btn" type="button" data-act="move" data-i="${i}" data-d="1"${i < len - 1 ? '' : ' disabled'} aria-label="Bajar">↓</button>
        <button class="btn small" type="button" data-act="toggle-hidden" data-i="${i}">${p.hidden ? 'Mostrar' : 'Ocultar'}</button>
        <button class="btn small" type="button" data-act="duplicate" data-i="${i}">Duplicar</button>
        <button class="btn small${open ? ' primary' : ''}" type="button" data-act="edit" data-i="${i}" aria-expanded="${open}">${open ? 'Cerrar' : 'Editar'}</button>
      </div>
      ${open ? productEditor(p, i) : ''}
    </article>`;
  }

  function photosField(p, i, list, help) {
    const at = `data-i="${i}" data-list="${list}"`;
    const photo = (src, k) => `<div class="photo">${k === 0 ? '<span class="badge">Principal</span>' : ''}
      <img src="${esc(media(src))}" alt="Foto ${k + 1}" loading="lazy">
      <div class="row">
        <button class="icon-btn" type="button" data-act="photo-move" ${at} data-k="${k}" data-d="-1"${k ? '' : ' disabled'} aria-label="Mover a la izquierda">←</button>
        <button class="icon-btn" type="button" data-act="photo-del" ${at} data-k="${k}" aria-label="Quitar esta foto">✕</button>
        <button class="icon-btn" type="button" data-act="photo-move" ${at} data-k="${k}" data-d="1"${k < p.gallery.length - 1 ? '' : ' disabled'} aria-label="Mover a la derecha">→</button>
      </div></div>`;
    return `<fieldset><legend>Fotos</legend>
        <p class="muted">${help}</p>
        <div class="photos">${(p.gallery || []).map(photo).join('')}
          <button class="add-photo" type="button" data-act="add-photo" ${at}>+ Subir foto</button></div>
        <div class="row"><input type="text" id="photo-url-${i}" placeholder="O pegá una dirección https://… o /media/…" aria-label="Dirección de una foto" style="flex:1;min-width:220px">
          <button class="btn small" type="button" data-act="add-photo-url" ${at}>Agregar</button></div>
      </fieldset>`;
  }

  function productEditor(p, i) {
    const b = `products.${i}`;
    const saved = S.site.products.some(x => x.id && x.id === p.id);
    const featured = p.id && S.draft.store.featured === p.id;
    const spec = k => {
      const s = (p.specs || [])[k] || {};
      const sb = `${b}.specs.${k}`;
      return `<div class="spec-row">
        <select ${attrs(sb + '.icon')} aria-label="Ícono del dato ${k + 1}">${Object.entries(SPEC_ICONS).map(([v, l]) =>
          `<option value="${v}"${(s.icon || 'pantalla') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input type="text" ${attrs(sb + '.v')} value="${esc(s.v || '')}" placeholder="Valor (ej. 50)" aria-label="Valor del dato ${k + 1}">
        <input type="text" ${attrs(sb + '.u')} value="${esc(s.u || '')}" placeholder="Unidad" aria-label="Unidad del dato ${k + 1}">
        <input type="text" ${attrs(sb + '.l')} value="${esc(s.l || '')}" placeholder="Etiqueta (ej. Cámara)" aria-label="Etiqueta del dato ${k + 1}">
      </div>`;
    };
    return `<div class="editor">
      <fieldset><legend>Datos</legend><div class="grid-2">
        ${field('Marca', b + '.brand', { live: 'title' })}
        ${field('Nombre', b + '.name', { live: 'title', help: 'Sin la memoria, ej. "Moto g06"' })}
        ${field('Memoria (GB)', b + '.storage', { type: 'number', live: 'title' })}
        ${field('RAM en GB (opcional)', b + '.ram', { type: 'number' })}
        ${field('Código', b + '.id', { ro: saved, ph: 'Se genera solo al guardar',
          help: saved ? 'Identifica al producto en las estadísticas: no se cambia.' : 'Letras, números y guiones. Después de guardar no se cambia.' })}
      </div></fieldset>
      <fieldset><legend>Cuotas</legend><div class="grid-2">
        ${field('Valor de cada cuota en 12', `${b}.cuotas.12`, { type: 'number', live: 'totals' })}
        ${field('Valor de cada cuota en 9', `${b}.cuotas.9`, { type: 'number', live: 'totals' })}
      </div><p class="muted" id="totals-${i}">${esc(totalsText(p))}</p></fieldset>
      ${photosField(p, i, 'products', 'La primera es la principal: la de la tarjeta, el video y la portada.')}
      <fieldset><legend>Video (opcional)</legend>
        ${mediaField('Video MP4 vertical', b + '.video', 'De 6 a 10 segundos, sin sonido. Si no hay video, se animan las fotos.')}
        ${mediaField('Portada del video', b + '.poster', 'El primer cuadro del video, como foto.')}
      </fieldset>
      <fieldset><legend>Textos</legend>
        <div class="grid-2">${[0, 1, 2].map(k => field(`Título ${k + 1} del video`, `${b}.highlights.${k}`)).join('')}</div>
        ${field('Frase principal', b + '.pitch')}
        ${area('Descripción (un renglón por línea)', b + '.details', { kind: 'lines', rows: 5 })}
      </fieldset>
      <fieldset><legend>Ficha (los 4 datos de la tarjeta)</legend>
        <div class="specs-grid">${[0, 1, 2, 3].map(spec).join('')}</div></fieldset>
      <fieldset><legend>Colores</legend>
        <div class="row"><span class="muted">Fondo animado</span><span class="colors">${[0, 1, 2].map(k => color(`${b}.palette.${k}`, `Color de fondo ${k + 1}`)).join('')}</span>
          <span class="muted" style="margin-left:12px">Celular dibujado (si no hay foto)</span><span class="colors">${[0, 1].map(k => color(`${b}.color.${k}`, `Color del celular ${k + 1}`)).join('')}</span></div>
      </fieldset>
      <div class="row">${check('Oculto: no aparece en la tienda', b + '.hidden', true)}<span class="spacer"></span>
        <button class="btn small" type="button" data-act="feature" data-i="${i}"${featured ? ' disabled' : ''}>${featured ? 'Es el destacado de la portada' : 'Usar como destacado de la portada'}</button></div>
    </div>`;
  }

  /* ----- Otros productos (la vidriera de la tienda) ----- */
  const EXTRA_ICONS = { 'ventilador-pie': 'Ventilador de pie', 'ventilador-piso': 'Ventilador de piso', 'ventilador-techo': 'Ventilador de techo', ventilador: 'Ventilador', mic: 'Micrófono', tripode: 'Trípode', luz: 'Luz', parlante: 'Parlante', auricular: 'Auriculares' };
  const catName = id => ((S.draft && S.draft.categories) || []).find(c => c.id === id)?.name || '';
  // Cuotas de cada producto (22/11/2026): con crédito hasta 1, 3, 6, 9 o 12; con débito, si se acepta
  const CUOTAS_CREDITO = [1, 3, 6, 9, 12];
  const cuotasMeta = p => `${Number(p.credito || 12) > 1 ? `hasta ${Number(p.credito || 12)} cuotas` : '1 pago'}${p.debito === false ? ', sin débito' : ''}`;
  const extraMeta = p => `${p.example ? 'EJEMPLO · ' : ''}${catName(p.cat) ? `${catName(p.cat)} · ` : ''}${[p.group, p.brand].filter(Boolean).join(' · ') || 'Sin tipo'} · ${money(p.price)}${Number(p.listPrice) > Number(p.price) ? ` · antes ${money(p.listPrice)}` : ''} · ${cuotasMeta(p)}`;

  // Cambiar las cuotas de varios productos a la vez: los de una categoría o un tipo
  function cuotasCard(list) {
    const C = S.cuotasMasivo || (S.cuotasMasivo = { cual: 'todos', credito: '', debito: '' });
    const tipos = [...new Set(list.map(p => p.group).filter(Boolean))];
    const opciones = [['todos', 'Todos los productos'], ...(S.draft.categories || []).map(c => [`cat:${c.id}`, `Categoría: ${c.name}`]), ...tipos.map(t => [`tipo:${t}`, `Tipo: ${t}`])];
    return `<section class="card"><div class="card-head"><h2>Cuotas de varios productos a la vez</h2></div>
      <p class="muted">Elegí a qué productos aplicar, las cuotas, y tocá Aplicar. Después, Guardar arriba. Cada producto se puede cambiar también desde su Editar.</p>
      <div class="grid-3">
        <label class="field">Aplicar a
          <select id="cm-cual">${opciones.map(([v, l]) => `<option value="${esc(v)}"${C.cual === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field">Con crédito
          <select id="cm-credito"><option value="">Sin cambiar</option>${CUOTAS_CREDITO.map(n => `<option value="${n}"${String(C.credito) === String(n) ? ' selected' : ''}>${n === 1 ? 'Solo en 1 pago' : `Hasta ${n} cuotas`}</option>`).join('')}</select></label>
        <label class="field">Con débito
          <select id="cm-debito"><option value="">Sin cambiar</option><option value="si"${C.debito === 'si' ? ' selected' : ''}>Acepta</option><option value="no"${C.debito === 'no' ? ' selected' : ''}>No acepta</option></select></label>
      </div>
      <div class="row"><button class="btn small primary" type="button" data-act="cuotas-masivo">Aplicar</button></div>
    </section>`;
  }

  function viewExtras() {
    const list = S.draft.extras;
    const visible = list.filter(p => !p.hidden).length;
    return `
      <div class="page-head"><h1>Otros productos</h1>
        <button class="btn primary" type="button" data-act="add-extra">Agregar producto</button></div>
      <p class="muted">Ventiladores, creación de contenido, audio y todo lo que no es un celular. ${visible} visibles · ${list.length - visible} ocultos.
        Cada producto va en una de las 3 categorías. Los que dicen EJEMPLO están para ver el diseño: reemplazalos por los reales.</p>
      <section class="card"><div class="card-head"><h2>Sección de la tienda</h2></div>
        <div class="grid-2">
          ${field('Título', 'store.extras.title')}
          ${field('Nombre corto', 'store.extras.short', { help: 'En el menú y en los círculos de Red social.' })}
          ${field('Texto chico arriba del título', 'store.extras.eyebrow')}
        </div>
      </section>
      ${cuotasCard(list)}
      <div class="plist">${list.map((p, i) => extraRow(p, i, list.length)).join('')}</div>`;
  }

  function extraRow(p, i, len) {
    const open = S.open === i;
    const at = `data-i="${i}" data-list="extras"`;
    return `<article class="prow${p.hidden ? ' is-hidden' : ''}${open ? ' open' : ''}">
      ${p.gallery && p.gallery[0] ? `<img class="thumb" src="${esc(media(p.gallery[0]))}" alt="">` : '<span class="thumb"></span>'}
      <div>
        <p class="name"><span class="name-text">${esc(rowTitle(p))}</span> ${p.hidden ? '<span class="chip off">Oculto</span>' : ''}</p>
        <p class="meta">${esc(extraMeta(p))}</p>
      </div>
      <div class="actions">
        <button class="icon-btn" type="button" data-act="move" ${at} data-d="-1"${i ? '' : ' disabled'} aria-label="Subir">↑</button>
        <button class="icon-btn" type="button" data-act="move" ${at} data-d="1"${i < len - 1 ? '' : ' disabled'} aria-label="Bajar">↓</button>
        <button class="btn small" type="button" data-act="toggle-hidden" ${at}>${p.hidden ? 'Mostrar' : 'Ocultar'}</button>
        <button class="btn small" type="button" data-act="duplicate" ${at}>Duplicar</button>
        <button class="btn small${open ? ' primary' : ''}" type="button" data-act="edit" data-i="${i}" aria-expanded="${open}">${open ? 'Cerrar' : 'Editar'}</button>
      </div>
      ${open ? extraEditor(p, i) : ''}
    </article>`;
  }

  function extraEditor(p, i) {
    const b = `extras.${i}`;
    const saved = S.site.extras.some(x => x.id && x.id === p.id);
    return `<div class="editor">
      <fieldset><legend>Datos</legend><div class="grid-2">
        ${field('Nombre', b + '.name', { live: 'title' })}
        ${field('Marca', b + '.brand', { live: 'title' })}
        <label class="field">Categoría
          <select ${attrs(b + '.cat', { live: 'title' })}>${(S.draft.categories || []).map(c => `<option value="${c.id}"${p.cat === c.id ? ' selected' : ''}>${c.num}. ${esc(c.name)}</option>`).join('')}</select></label>
        ${field('Tipo', b + '.group', { live: 'title', help: 'Es el filtro de la tienda, ej. "Micrófonos".' })}
        ${field('Peso con la caja (kg)', b + '.weight', { type: 'number', help: 'Para la calculadora de envíos. Vacío: el de su categoría.' })}
        <label class="field">Ícono si no hay foto
          <select ${attrs(b + '.icon')}>${Object.entries(EXTRA_ICONS).map(([v, l]) => `<option value="${v}"${p.icon === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${field('Código', b + '.id', { ro: saved, ph: 'Se genera solo al guardar',
          help: saved ? 'Identifica al producto en las estadísticas: no se cambia.' : 'Letras, números y guiones. Después de guardar no se cambia.' })}
      </div></fieldset>
      <fieldset><legend>Precio</legend><div class="grid-2">
        ${field('Precio', b + '.price', { type: 'number', live: 'title' })}
        ${field('Precio normal (opcional)', b + '.listPrice', { type: 'number', live: 'title', help: 'Si es mayor al precio, se muestra tachado y con el % de descuento.' })}
      </div></fieldset>
      <fieldset><legend>Cuotas</legend><div class="grid-2">
        <label class="field">Con tarjeta de crédito (Mercado Pago)
          <select ${attrs(b + '.credito', { kind: 'num', live: 'title' })}>${CUOTAS_CREDITO.map(n => `<option value="${n}"${Number(p.credito || 12) === n ? ' selected' : ''}>${n === 1 ? 'Solo en 1 pago' : `Hasta ${n} cuotas`}</option>`).join('')}</select>
          <small>Mercado Pago no le ofrece al cliente más cuotas que estas.</small></label>
        <div class="field">Con débito (${esc(S.draft.store.financing || 'GO cuotas')})
          ${check(`Acepta ${Number(S.draft.store.extras.cuotas) || 6} cuotas con débito`, b + '.debito', true)}
          <small>La cantidad de cuotas con débito la fija el acuerdo con ${esc(S.draft.store.financing || 'GO cuotas')} (Tienda y textos).</small></div>
      </div></fieldset>
      ${photosField(p, i, 'extras', 'La primera es la principal: la de la tarjeta.')}
      <fieldset><legend>Video</legend>${mediaField('Video del producto (.mp4, vertical)', b + '.video', 'Se reproduce solo y sin sonido en la tarjeta, y es lo primero de la ficha. Hasta 30 MB.')}</fieldset>
      <fieldset><legend>Textos</legend>
        ${field('Frase principal', b + '.pitch')}
        ${area('Descripción (un renglón por línea)', b + '.details', { kind: 'lines', rows: 5 })}
      </fieldset>
      <div class="row">${check('Oculto: no aparece en la tienda', b + '.hidden', true)}</div>
    </div>`;
  }
  const newExtra = () => ({ id: '', hidden: true, cat: 'contenido', group: '', brand: '', name: 'Producto nuevo', icon: 'luz', weight: '', price: '', listPrice: '', pitch: '', details: [], gallery: [], credito: 12, debito: true });
  const listOf = el => S.draft[el.dataset.list || 'products'];

  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  function fillIds(site) {
    const used = new Set([...site.products, ...site.extras].map(p => p.id).filter(Boolean));
    const fill = (list, name, taken) => {
      for (const p of list) {
        if (p.id) continue;
        const base = slug(name(p)) || 'item';
        let id = base, k = 2;
        while (taken.has(id)) id = `${base}-${k++}`;
        p.id = id;
        taken.add(id);
      }
    };
    fill(site.products, p => `${p.brand} ${p.name} ${p.storage}`, used);
    fill(site.extras, p => `${p.brand} ${p.name}`, used);
    fill(site.store.branches, b => b.name, new Set(site.store.branches.map(b => b.id).filter(Boolean)));
  }
  const newProduct = () => ({
    id: '', hidden: true, brand: '', name: 'Celular nuevo', storage: 128, cuotas: { 9: '', 12: '' },
    specs: [
      { icon: 'pantalla', v: '', u: '', l: 'Pantalla' }, { icon: 'camara', v: '', u: 'MP', l: 'Cámara' },
      { icon: 'bateria', v: '', u: 'mAh', l: 'Batería' }, { icon: 'memoria', v: '128', u: 'GB', l: 'Memoria' },
    ],
    highlights: ['', '', ''], pitch: '', details: [], gallery: [],
    palette: ['#b49cff', '#ff9fd0', '#8fb8ff'], color: ['#1c2330', '#8b97a8'], video: '', poster: '',
  });

  /* ----- Tienda y textos: descuento flash, envíos, categorías y la página Historia ----- */
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function flashCard() {
    const f = S.draft.flash || {};
    const p = Number(f.percent) || 0;
    const ej = 10000;
    const lista = p > 0 && p < 100 ? Math.round(ej / (1 - p / 100) / 100) * 100 : ej;
    return `<section class="card"><div class="card-head"><h2>Descuento flash</h2></div>
      <p>Cada visitante tiene ${n(Number(f.minutes) || 0)} minutos con el cupón <b>xoxo-${MESES[new Date().getMonth()]}</b> (cambia solo cada mes).
        Arriba de cada precio se ve el precio de lista tachado. <b>Se cobra siempre el precio de la página</b>: el cupón queda anotado en el pedido.</p>
      <p class="muted">Ejemplo: un producto de ${money(ej)} muestra ${money(lista)} tachado (-${p}%).</p>
      <div class="grid-2">
        ${field('Porcentaje', 'flash.percent', { type: 'number' })}
        ${field('Minutos para cada visitante', 'flash.minutes', { type: 'number' })}
      </div>
      <div class="row">${check('Prendido', 'flash.on')}</div>
      <p class="note">Ojo: mostrar como "precio de lista" un precio que nunca se cobró puede considerarse publicidad engañosa (Ley de Lealtad Comercial).
        Si tienen dudas, consúltenlo con su contador o abogado.</p>
    </section>`;
  }

  // Códigos de descuento propios (22/11/2026): los que reparten por redes o WhatsApp. Bajan el precio de verdad.
  function codigosCard() {
    const list = S.draft.codes || (S.draft.codes = []);
    const usos = code => ((S.orders && S.orders.pedidos) || []).filter(o => o.status === 'approved' && o.discount && o.discount.code === code).length;
    return `<section class="card"><div class="card-head"><h2>Códigos de descuento</h2></div>
      <p>Los que dan ustedes, por ejemplo a quien los sigue en las redes y les escribe. A diferencia del flash, <b>bajan el precio</b>: el cliente lo
        pone en el carrito y paga con ese porcentaje menos. Un pedido usa un solo código.</p>
      <p class="muted">Cuando el descuento flash está apagado, el carrito invita a seguirlos en Instagram, Facebook y TikTok (los del pie de página)
        y a pedir un código por WhatsApp.</p>
      ${list.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Código</th><th>% off</th><th>Vale hasta</th><th>Usos máx.</th><th>Usado</th><th>Nota</th><th>Activo</th><th></th></tr></thead>
        <tbody>${list.map((c, i) => `<tr>
          <td><input ${attrs(`codes.${i}.code`)} value="${esc(c.code || '')}" placeholder="sigueme10" maxlength="30" aria-label="Código"></td>
          <td><input class="num-in" type="number" min="1" max="90" inputmode="numeric" ${attrs(`codes.${i}.percent`, { kind: 'num' })} value="${esc(c.percent ?? '')}" aria-label="Porcentaje"></td>
          <td><input type="date" ${attrs(`codes.${i}.until`)} value="${esc(c.until || '')}" aria-label="Vale hasta"></td>
          <td><input class="num-in" type="number" min="0" inputmode="numeric" ${attrs(`codes.${i}.max`, { kind: 'num' })} value="${esc(c.max ?? 0)}" aria-label="Usos máximos (0 = sin límite)"></td>
          <td class="num">${n(usos(c.code))}</td>
          <td><input ${attrs(`codes.${i}.note`)} value="${esc(c.note || '')}" placeholder="Para Instagram" maxlength="80" aria-label="Nota"></td>
          <td>${check('', `codes.${i}.on`)}</td>
          <td><button class="btn small" type="button" data-act="del-code" data-i="${i}">Quitar</button></td>
        </tr>`).join('')}</tbody></table></div>
        <p class="muted">Usos máx.: cuántos pedidos pagados pueden usarlo (0 = sin límite). Vale hasta: vacío = sin fecha.</p>` : '<p class="muted">Todavía no hay códigos.</p>'}
      <div class="row"><button class="btn small" type="button" data-act="add-code">Agregar código</button></div>
    </section>`;
  }

  function enviosCard() {
    const e = S.draft.shipping;
    if (!e) return '';
    const zonas = ['1 · Tucumán', '2 · NOA', '3 · Centro y resto', '4 · Patagonia'];
    const fila = (emp, srv, label) => `<tr><td>${label}</td>${zonas.map((z, i) =>
      `<td><input class="num-in" type="number" min="0" inputmode="numeric" ${attrs(`shipping.rates.${emp}.${srv}.${i}`, { kind: 'num' })} value="${esc(e.rates[emp][srv][i])}" aria-label="${esc(label)}, zona ${esc(z)}"></td>`).join('')}</tr>`;
    return `<section class="card"><div class="card-head"><h2>Envíos (calculadora)</h2></div>
      <p>Precios de la calculadora de envíos y del checkout. Son <b>estimados</b> hasta conectar las cotizaciones reales de Andreani y
        Correo Argentino (hace falta el contrato con cada una). Zona 2: Catamarca, Salta, Jujuy, Santiago del Estero y La Rioja.
        Zona 4: Neuquén, Río Negro, Chubut, Santa Cruz y Tierra del Fuego.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Hasta 1 kg</th>${zonas.map(z => `<th>${z}</th>`).join('')}</tr></thead>
        <tbody>
          ${fila('andreani', 'domicilio', 'Andreani a domicilio')}${fila('andreani', 'sucursal', 'Andreani a sucursal')}
          ${fila('correo', 'domicilio', 'Correo Argentino a domicilio')}${fila('correo', 'sucursal', 'Correo Argentino a sucursal')}
        </tbody></table></div>
      <div class="grid-3">
        ${field('Andreani: cada kg de más (0 = mismo envío para todo)', 'shipping.rates.andreani.extraKg', { type: 'number' })}
        ${field('Correo Argentino: cada kg de más (0 = mismo envío para todo)', 'shipping.rates.correo.extraKg', { type: 'number' })}
        ${field('Envío gratis desde (0 = nunca)', 'shipping.freeFrom', { type: 'number' })}
      </div>
      <div class="row">${check('Andreani', 'shipping.rates.andreani.on')}${check('Correo Argentino', 'shipping.rates.correo.on')}${check('Retiro gratis en sucursal', 'shipping.pickup')}</div>
    </section>`;
  }

  function categoriasCard() {
    const cats = S.draft.categories || [];
    return `<section class="card"><div class="card-head"><h2>Las 3 categorías</h2></div>
      <p class="muted">Cada una tiene su propia home en los 3 diseños, por ejemplo <code>/${esc((cats[0] || {}).id || '')}/</code> (Historia, la página principal). Ahí se ven estos textos: portada, beneficios, guía y preguntas.</p>
      ${cats.map((c, i) => `<fieldset><legend>${c.num}. ${esc(c.name)}</legend><div class="grid-2">
        ${field('Nombre', `categories.${i}.name`)}
        ${field('Nombre corto (menú)', `categories.${i}.short`)}
        ${field('Título', `categories.${i}.title`)}
        <label class="field">Color ${color(`categories.${i}.color`, `Color de ${c.name}`)}</label>
      </div>
        ${mediaField('Foto de fondo del banner', `categories.${i}.banner`, 'Gente usando los productos. Horizontal, con lugar a la izquierda para el texto. Sin foto, la portada muestra el ícono.')}${area('Texto', `categories.${i}.text`)}
        ${area('Beneficios (uno por renglón: Título | texto)', `categories.${i}.benefits`, { kind: 'lines', rows: 4 })}
        ${field('Título de la guía', `categories.${i}.guideTitle`)}
        ${area('Guía para elegir (uno por renglón: Título | texto)', `categories.${i}.guide`, { kind: 'lines', rows: 4, help: 'Si el título nombra un producto (ej. "De torre"), la tarjeta muestra ese producto con su precio.' })}
        ${area('Preguntas frecuentes (una por renglón: Pregunta | respuesta)', `categories.${i}.faq`, { kind: 'lines', rows: 4 })}
      </fieldset>`).join('')}
    </section>`;
  }

  function historiaCard() {
    const h = S.draft.story;
    if (!h) return '';
    const persona = (list, i, label) => `<div class="grid-3">
      ${field(`${label} ${i + 1}: nombre`, `story.${list}.${i}.name`)}
      ${field('Rol', `story.${list}.${i}.role`)}
      ${mediaField('Foto', `story.${list}.${i}.photo`)}
    </div>`;
    return `<section class="card"><div class="card-head"><h2>Página Historia (diseño C)</h2></div>
      <p class="muted">Quiénes son, el equipo, las sucursales y la garantía. Ahora tiene textos de ejemplo (lorem ipsum).</p>
      <div class="grid-2">${field('Texto chico de arriba', 'story.kicker')}${field('Título de la portada', 'story.title')}</div>
      ${area('Texto de la portada', 'story.text')}
      <fieldset><legend>Los 3 socios</legend>
        ${field('Título', 'story.foundersTitle')}${area('Texto', 'story.foundersText')}
        ${mediaField('Foto de los 3 socios juntos', 'story.foundersPhoto', 'Una sola foto horizontal de los tres. Se ve en Historia → Ventilación; sin foto se muestra una de ejemplo.')}
        ${(h.founders || []).map((p, i) => persona('founders', i, 'Socio')).join('')}
      </fieldset>
      <fieldset><legend>El equipo</legend>
        ${field('Título', 'story.teamTitle')}${area('Texto', 'story.teamText')}
        ${(h.team || []).map((p, i) => persona('team', i, 'Persona')).join('')}
      </fieldset>
      <fieldset><legend>Sucursales y garantía</legend>
        ${field('Título de sucursales', 'story.branchesTitle')}${area('Texto de sucursales', 'story.branchesText')}
        <div class="grid-2">${field('Días de garantía', 'story.warrantyDays', { type: 'number' })}${field('Título de garantía', 'story.warrantyTitle')}</div>
        ${area('Texto de garantía', 'story.warrantyText')}
      </fieldset>
      <fieldset><legend>Números</legend><div class="grid-2">${(h.stats || []).map((s, i) => `${field(`Número ${i + 1}`, `story.stats.${i}.v`)}${field('Qué es', `story.stats.${i}.l`)}`).join('')}</div></fieldset>
    </section>`;
  }

  /* ----- Correos de la tienda (en Pedidos) ----- */
  function correoCard(c) {
    const ESTADOS = { enviado: 'Enviado', vista: 'Guardado (sin SMTP)', fallido: 'No salió' };
    const TIPOS = {
      compra: 'Compra al cliente', venta: 'Aviso de venta', prueba: 'Prueba',
      despachado: 'Pedido despachado', listo: 'Listo para retirar', cuenta: 'Confirmá tu email', clave: 'Contraseña nueva',
    };
    const api = q => `${apiUrl(q.split('&')[0])}${q.includes('&') ? `&${q.split('&').slice(1).join('&')}` : ''}`;
    return `<section class="card"><div class="card-head"><h2>Correos</h2>
        <span class="chip${c.modo === 'smtp' ? '' : ' off'}">${c.modo === 'smtp' ? `Manda como ${esc(c.de)}` : 'Sin servidor de correo'}</span></div>
      <p>${c.modo === 'smtp'
        ? `Cuando se aprueba un pago, el cliente recibe el detalle de su compra${c.avisos.length ? ` y se avisa la venta a ${esc(c.avisos.join(', '))}` : ''}.`
        : 'Todavía no hay servidor de correo (SMTP): los mails no salen, se guardan acá para verlos. Se configura con xoxo-claves, opción Correo (ver deploy/CORREO.md).'}</p>
      <div class="row">
        <a class="btn small" href="${esc(api('/correo/ejemplo&tipo=compra'))}" target="_blank" rel="noopener">Ver el mail de compra</a>
        <a class="btn small" href="${esc(api('/correo/ejemplo&tipo=venta'))}" target="_blank" rel="noopener">Ver el aviso de venta</a>
      </div>
      <div class="row"><input id="mail-test" type="email" placeholder="tu@email.com" aria-label="Email para la prueba">
        <button class="btn small" type="button" data-act="mail-test">Mandar una prueba</button><span id="mail-test-msg" class="muted"></span></div>
      ${c.pendientes.length ? `<p class="note">${c.pendientes.length} correo${c.pendientes.length === 1 ? '' : 's'} esperando para reintentar: ${esc(c.pendientes[0].error || '')}</p>` : ''}
      ${c.ultimos.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Cuándo</th><th>Qué</th><th>Para</th><th>Estado</th></tr></thead>
        <tbody>${c.ultimos.slice(0, 15).map(m => `<tr>
          <td>${when(m.t)}</td><td>${esc(TIPOS[m.tipo] || m.tipo)}${m.ref ? ` #${esc(m.ref)}` : ''}</td><td>${esc(m.para)}</td>
          <td>${m.archivo ? `<a href="${esc(api(`/correo/ver&archivo=${m.archivo}`))}" target="_blank" rel="noopener">${esc(ESTADOS[m.estado] || m.estado)}</a>` : esc(ESTADOS[m.estado] || m.estado)}${m.error ? `<span class="sub">${esc(m.error)}</span>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>` : ''}
    </section>`;
  }

  /* ----- Tienda y textos ----- */
  function viewStore() {
    const st = S.draft.store;
    const visible = S.draft.products.filter(p => !p.hidden && p.id);
    const step = (h, k, key = 'howto') => `<div class="step">
      ${field('Ícono', `store.${key}.${k}.icon`, { help: 'Emoji, go o wa' })}
      ${field(`Paso ${k + 1}`, `store.${key}.${k}.title`)}
      ${field('Texto', `store.${key}.${k}.text`)}
      <label class="field">Fondo ${color(`store.${key}.${k}.bg`, `Fondo del paso ${k + 1}`)}</label>
      <label class="field">Letra ${color(`store.${key}.${k}.fg`, `Letra del paso ${k + 1}`)}</label>
    </div>`;
    return `
      <div class="page-head"><h1>Tienda y textos</h1></div>
      <p class="muted">Lo que cambies acá se ve en todos los diseños apenas guardes.</p>
      <section class="card"><div class="card-head"><h2>Celulares</h2></div>
        <div class="row">${check('Vendemos celulares', 'store.phones')}</div>
        <p class="muted">Apagado (así está desde el 17/11/2026): Red social y Minimalista muestran solo ventilación, creación de contenido y audio,
          y los celulares no se pueden comprar. Prendido, vuelve el catálogo de celulares de la pestaña Celulares.</p>
      </section>
      ${flashCard()}
      ${codigosCard()}
      ${enviosCard()}

      <section class="card"><div class="card-head"><h2>Tienda</h2></div>
        <div class="grid-2">
          ${field('Nombre', 'store.name')}
          ${field('Ciudad', 'store.city')}
        </div>
        <p class="muted">Los teléfonos y las direcciones de las sucursales se editan en <a href="#anuncio" data-tab="anuncio">Anuncio</a>.</p>
        ${area('Mensaje de los botones generales de WhatsApp', 'store.greeting', { rows: 2, help: 'Los botones de cada celular arman su propio mensaje con el modelo y las cuotas.' })}
        ${field('Hashtags de las descripciones', 'store.hashtags', { kind: 'csv', help: 'Separados por coma, sin #.' })}
      </section>

      <section class="card"><div class="card-head"><h2>Financiación</h2></div>
        <div class="grid-2">
          ${field('Financiera', 'store.financing', { help: 'Se muestra como "Financiá con …". Vacío para no mostrarla.' })}
          <div class="field" style="align-self:center">${check('Las cuotas son sin interés (12 con crédito por Mercado Pago y las de débito en GO cuotas)', 'store.sinInteres')}</div>
          ${field('Las 12 cuotas se pagan con', 'store.plans.12')}
          ${field('Las 9 cuotas se pagan con', 'store.plans.9', { help: 'Se lee "9 cuotas de $… con …".' })}
          ${field('Cuotas de los otros productos', 'store.extras.cuotas', { type: 'number', help: 'Se muestra "6 cuotas con" y la financiera.' })}
        </div>
        ${mediaField('Logo de la financiera', 'store.financingLogo.color')}
        ${mediaField('Ícono de la financiera', 'store.financingLogo.icon', 'Se usa en "Cómo comprar" (Red social).')}
        <fieldset><legend>Imagen final de todos los videos</legend>
          ${check('Mostrar la imagen final', 'store.closing.show')}
          <div class="grid-2">${field('Título', 'store.closing.title')}${field('Texto', 'store.closing.text')}</div>
        </fieldset>
      </section>

      <section class="card"><div class="card-head"><h2>Portada y avisos</h2><p>Podés usar {financiera}, {ciudad} y {tienda}: se reemplazan solos.</p></div>
        <div class="grid-2">
          ${field('Título, primera parte', 'texts.heroTitle1')}
          ${field('Título, segunda parte', 'texts.heroTitle2')}
        </div>
        ${mediaField('Logo arriba del título', 'texts.heroLogo', 'Ahora es el de Cyber Monday. Quitalo cuando termine la promoción.')}
        ${field('Franja destacada de Red social', 'texts.heroDebito', { help: 'Lo que va entre *asteriscos* se resalta.' })}
        ${field('Subtítulo de Red social', 'texts.heroSub')}
        ${field('Texto de la portada de Minimalista', 'texts.heroText', { help: 'Lo que va entre *asteriscos* se resalta.' })}
        ${area('Avisos de la barra de arriba (uno por línea)', 'texts.notices', { kind: 'lines', rows: 4, help: 'Red social muestra los tres primeros (en celular, los dos primeros). Minimalista los va rotando todos.' })}
        <div class="grid-2">
          ${field('Pregunta de los botones de cuota (Red social)', 'texts.budgetQuestion')}
          ${field('Botones de cuota por mes', 'store.budgets', { kind: 'csvnum', help: 'Montos de la cuota en 12, separados por coma.' })}
          <label class="field">Celular con el que arranca la portada
            <select ${attrs('store.featured')}>${visible.map(p => `<option value="${esc(p.id)}"${st.featured === p.id ? ' selected' : ''}>${esc(rowTitle(p))}</option>`).join('')}</select></label>
        </div>
      </section>

      <p class="muted">El pie de página (email, horarios y redes) está en la pestaña Sucursales; las categorías y la página Historia, en Páginas.</p>

      <section class="card"><div class="card-head"><h2>Al compartir el link y en Google</h2></div>
        ${field('Título', 'texts.seoTitle')}
        ${area('Descripción', 'texts.seoDescription', { rows: 2 })}
        ${mediaField('Imagen al compartir (1200 × 630)', 'texts.ogImage', 'Si queda vacía, se usa la foto del celular destacado.')}
      </section>

      <section class="card"><div class="card-head"><h2>Cómo comprar</h2><p>Los pasos de la historia de Red social y de la ficha de Minimalista.</p></div>
        <div class="steps">${(S.draft.store.howto || []).map((h, k) => step(h, k)).join('')}</div>
      </section>
      <section class="card"><div class="card-head"><h2>Cómo comprar con pago online</h2><p>Los pasos que se ven cuando la tienda cobra online.</p></div>
        <div class="steps">${(S.draft.store.howtoPay || []).map((h, k) => step(h, k, 'howtoPay')).join('')}</div>
      </section>`;
  }

  /* ----- Cambios por IA: chat con Claude ----- */
  // Cada mensaje que se manda aparece al instante como "Enviando…" (S.chat.pending). Cuando el servidor lo guarda
  // pasa a la conversación con "Recibido"; después se ve "Visto por Claude" y "Claude está escribiendo…".
  const SEEN = 'xoxo-chat-visto';
  const chatName = () => store.get('xoxo-chat-nombre') || 'Socio';
  function chatWhen(iso) {
    const d = new Date(iso);
    const t = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${t}`;
  }
  // Texto con los links clickeables (Claude manda links de vista previa)
  function richText(t) {
    const re = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)»]/g;
    let out = '', last = 0, m;
    while ((m = re.exec(t))) {
      out += esc(t.slice(last, m.index)) + `<a href="${esc(m[0])}" target="_blank" rel="noopener">${esc(m[0])}</a>`;
      last = m.index + m[0].length;
    }
    return out + esc(t.slice(last));
  }
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const photosHtml = (list, de) => list.map(u =>
    `<a href="${esc(media(u))}" target="_blank" rel="noopener"><img src="${esc(media(u))}" alt="Foto que mandó ${esc(de)}" loading="lazy"></a>`).join('');
  function chatBubble(m) {
    const mine = m.rol !== 'claude';
    const photos = photosHtml(m.adjuntos || [], m.de);
    const audio = m.audio ? `<div class="msg-audio">
        <audio controls preload="metadata" src="${esc(media(m.audio))}"></audio>
        ${m.transcripcion ? `<p class="msg-tr"><b>Lo que dijo:</b> ${esc(m.transcripcion)}</p>` : ''}
      </div>` : '';
    return `<div class="msg ${mine ? 'mine' : 'ai'}" data-id="${esc(m.id)}">
      <div class="msg-meta">${mine ? esc(m.de) : 'Claude'} · ${chatWhen(m.at)}${m.audio ? ` · audio de ${clock(m.duracion || 0)}` : ''}</div>
      ${audio}
      ${m.texto ? `<div class="msg-text">${richText(m.texto)}</div>` : ''}
      ${photos ? `<div class="msg-photos">${photos}</div>` : ''}
    </div>`;
  }
  // Un mensaje que todavía no llegó al servidor
  function pendingBubble(p) {
    const state = p.error
      ? `<span class="bad">No se envió: ${esc(p.error)}</span>
         <button class="btn small" type="button" data-act="chat-retry" data-k="${p.k}">Reintentar</button>
         <button class="btn small" type="button" data-act="chat-drop" data-k="${p.k}">Borrar</button>`
      : `<span class="spin" aria-hidden="true"></span> ${p.audio && !p.url ? 'Subiendo el audio…' : 'Enviando…'}`;
    return `<div class="msg mine pending${p.error ? ' failed' : ''}">
      <div class="msg-meta">${esc(p.de)}</div>
      ${p.audio ? `<div class="msg-text">Audio de ${clock(p.duracion || 0)}</div>` : ''}
      ${p.texto ? `<div class="msg-text">${richText(p.texto)}</div>` : ''}
      ${p.adjuntos.length ? `<div class="msg-photos">${photosHtml(p.adjuntos, p.de)}</div>` : ''}
      <div class="msg-state" role="status">${state}</div>
    </div>`;
  }
  // Debajo del último mensaje: recibido, visto o escribiendo
  function chatTail() {
    const P = S.chat.pending;
    if (P.length) return P.map(pendingBubble).join('');
    const L = S.chat.list || [], E = S.chat.estado || {};
    if (E.escribiendo) {
      return `<div class="msg ai typing" role="status"><div class="msg-meta">Claude está escribiendo…</div>
        <div class="msg-text"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></div></div>`;
    }
    const last = L[L.length - 1];
    if (!last || last.rol === 'claude') return '';
    const seen = E.visto && L.findIndex(m => m.id === E.visto) >= L.length - 1;
    return `<div class="msg-state mine-state" role="status">${seen
      ? '<b>✓✓</b> Visto por Claude'
      : `<b>✓</b> Recibido.${S.chat.auto ? ' Claude lo está por leer…' : ' Claude todavía no lo vio.'}`}</div>`;
  }
  function chatLog() {
    const L = S.chat.list;
    if (!L) return loading;
    const tail = `<div id="chat-tail">${chatTail()}</div>`;
    if (!L.length && !S.chat.pending.length) {
      return `<div class="chat-empty"><b>Todavía no hay mensajes</b>
        <p>Escribí qué querés cambiar en la tienda. Por ejemplo: "Poné el Samsung A16 a $699.999" o "Agregá el iPhone 15 de 128 GB con esta foto".</p></div>${tail}`;
    }
    return L.map(chatBubble).join('') + tail;
  }
  const chatFiles = () => S.chat.files.map((u, i) =>
    `<span class="chat-file"><img src="${esc(media(u))}" alt="Foto para mandar"><button type="button" data-act="chat-unfile" data-i="${i}" aria-label="Sacar esta foto">×</button></span>`).join('')
    + (S.chat.uploading ? '<span class="muted"><span class="spin" aria-hidden="true"></span> Subiendo foto…</span>' : '');
  function viewChat() {
    return `
      <div class="page-head"><h1>Cambios por IA</h1></div>
      <section class="card chat">
        <p class="muted">Pedile a Claude cambios en la tienda: precios, productos, fotos, textos o algo que no anda. Podés escribir, mandar fotos o grabar un audio. ${S.chat.auto ? 'Claude contesta solo en unos segundos y anota los cambios para que Juan los aplique.' : 'Claude te contesta acá cuando revisa el chat.'}</p>
        <div class="chat-log" id="chat-log" aria-live="polite">${chatLog()}</div>
        <form class="chat-form" id="chat-form" autocomplete="off">
          <div class="chat-files" id="chat-files">${chatFiles()}</div>
          <textarea name="texto" rows="2" maxlength="4000" placeholder="Escribí tu pedido…" aria-label="Mensaje para Claude">${esc(S.chat.draft)}</textarea>
          <div id="chat-controls">${chatControls()}</div>
          <input type="file" id="chat-file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
        </form>
      </section>`;
  }
  const lastChatId = () => (S.chat.list && S.chat.list.length ? S.chat.list[S.chat.list.length - 1].id : '');
  // Trae lo nuevo (o todo la primera vez) y el estado (visto, escribiendo). Devuelve true si cambió algo.
  async function loadChat() {
    const before = `${S.chat.list ? S.chat.list.length : -1}|${lastChatId()}|${JSON.stringify(S.chat.estado)}`;
    const last = lastChatId();
    const r = await api(`/chat${last ? `?despues=${encodeURIComponent(last)}` : ''}`);
    if (r.completo || !S.chat.list) S.chat.list = r.mensajes;
    else {
      // Dos pedidos al mismo tiempo pueden traer el mismo mensaje: no se repite
      const have = new Set(S.chat.list.map(m => m.id));
      S.chat.list.push(...r.mensajes.filter(m => !have.has(m.id)));
    }
    S.chat.estado = r.estado || {};
    S.chat.auto = Boolean(r.auto);
    return before !== `${S.chat.list.length}|${lastChatId()}|${JSON.stringify(S.chat.estado)}`;
  }
  // Repinta sin borrar lo que ya está (así no se corta un audio que alguien está escuchando)
  function paintChat(bottom) {
    const log = $('#chat-log');
    if (!log) return;
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const L = S.chat.list || [];
    const shown = $$('.msg[data-id]', log);
    const tail = $('#chat-tail', log);
    const same = tail && shown.length && shown.length <= L.length && shown[shown.length - 1].dataset.id === L[shown.length - 1].id;
    if (same) {
      tail.insertAdjacentHTML('beforebegin', L.slice(shown.length).map(chatBubble).join(''));
      tail.innerHTML = chatTail();
    } else log.innerHTML = chatLog();
    if (bottom || near) log.scrollTop = log.scrollHeight;
  }
  const paintFiles = () => { const el = $('#chat-files'); if (el) el.innerHTML = chatFiles(); };
  function markSeen() {
    const id = lastChatId();
    if (id) store.set(SEEN, id);
    updateBadge();
  }
  // Cuántas respuestas de Claude hay sin ver (aparece en la pestaña)
  function updateBadge() {
    const b = $('#chat-badge');
    if (!b) return;
    const L = S.chat.list || [];
    const seen = store.get(SEEN);
    const unread = L.slice(L.findIndex(m => m.id === seen) + 1).filter(m => m.rol === 'claude').length;
    b.textContent = unread > 9 ? '9+' : String(unread);
    b.hidden = !unread || S.tab === 'ia';
  }

  /* Mandar: el mensaje se ve enseguida como "Enviando…" y, si falla, queda con Reintentar */
  function newPending(form, extra = {}) {
    const de = (form ? form.de.value.trim() : chatName()) || 'Socio';
    store.set('xoxo-chat-nombre', de);
    const p = {
      k: String(Date.now() + Math.random()), de, texto: form ? form.texto.value.trim() : S.chat.draft.trim(),
      adjuntos: S.chat.files.slice(), error: '', ...extra,
    };
    S.chat.draft = '';
    S.chat.files = [];
    if (form) form.texto.value = '';
    paintFiles();
    S.chat.pending.push(p);
    paintChat(true);
    return p;
  }
  async function deliver(p) {
    p.error = '';
    paintChat(true);
    try {
      if (p.ready) await p.ready; // el audio se termina de cerrar
      if (p.blob && !p.url) {
        p.url = (await api('/chat/audio', { method: 'POST', file: p.blob })).url;
        paintChat(true);
      }
      await api('/chat', {
        method: 'POST',
        body: {
          texto: p.texto, de: p.de, adjuntos: p.adjuntos,
          ...(p.audio ? { audio: p.url, duracion: p.duracion, transcripcion: p.transcripcion } : {}),
        },
      });
      S.chat.pending = S.chat.pending.filter(x => x !== p);
      await loadChat();
      paintChat(true);
      markSeen();
    } catch (err) {
      // Sin internet el navegador dice "Failed to fetch": se muestra en castellano
      p.error = err instanceof TypeError ? 'no hay conexión con la tienda' : err.message || 'no hay conexión con la tienda';
      paintChat(true);
    }
  }
  function sendChat(form) {
    if (S.chat.uploading || S.chat.rec) return;
    if (!form.texto.value.trim() && !S.chat.files.length) return form.texto.focus();
    deliver(newPending(form));
    form.texto.focus();
  }

  /* Audios: se graban con el micrófono del navegador. En la computadora, mientras se graba, el navegador también
     lo pasa a texto (así Claude lo puede leer). En el celular el dictado y la grabación se pelean por el micrófono,
     así que ahí se graba solo el audio. */
  function chatControls() {
    const R = S.chat.rec;
    if (R) {
      return `<div class="chat-rec" role="status">
        <span class="rec-dot" aria-hidden="true"></span>
        <span class="rec-time" id="rec-time">${clock((Date.now() - R.started) / 1000)}</span>
        <span class="rec-text" id="rec-text">${esc(recPreview(R))}</span>
        <button class="btn small" type="button" data-act="rec-cancel">Cancelar</button>
        <button class="btn primary small" type="button" data-act="rec-send">Enviar audio</button>
      </div>`;
    }
    const busy = S.chat.uploading > 0;
    return `<div class="row">
      <label class="chat-as">Escribís como <input type="text" name="de" value="${esc(chatName())}" maxlength="30"></label>
      <span class="spacer"></span>
      <button class="btn small" type="button" data-act="chat-photo">Agregar foto</button>
      <button class="btn small" type="button" data-act="chat-rec">Grabar audio</button>
      <button class="btn primary small" type="submit"${busy ? ' disabled' : ''}>Enviar</button>
    </div>`;
  }
  // El nombre de "Escribís como" vive en el formulario: al repintar los botones se conserva lo que escribió
  function paintControls() {
    const el = $('#chat-controls');
    if (!el) return;
    const name = $('#chat-form [name="de"]');
    if (name) store.set('xoxo-chat-nombre', name.value.trim() || chatName());
    el.innerHTML = chatControls();
    if (!$('#chat-form [name="de"]')) el.insertAdjacentHTML('beforeend', `<input type="hidden" name="de" value="${esc(chatName())}">`);
  }
  const recPreview = R => (`${R.text} ${R.interim}`.trim() || (R.recog ? 'Grabando… hablá tranquilo, se va escribiendo acá.' : 'Grabando…'));
  function recMime() {
    for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }
  async function startRec() {
    if (S.chat.rec) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)) {
      return toast('Este navegador no deja grabar audio. Probá con Chrome o Safari actualizados.', true);
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return toast(err && err.name === 'NotAllowedError'
        ? 'Para grabar, permití el micrófono: tocá el candado al lado de la dirección de la página.'
        : 'No se pudo usar el micrófono.', true);
    }
    const mime = recMime();
    let recorder;
    try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch {
      stream.getTracks().forEach(t => t.stop());
      return toast('Este navegador no deja grabar audio.', true);
    }
    const R = { recorder, stream, chunks: [], started: Date.now(), text: '', interim: '', recog: null, stopping: false };
    S.chat.rec = R;
    recorder.ondataavailable = e => { if (e.data && e.data.size) R.chunks.push(e.data); };
    recorder.start(1000);
    startRecognition(R);
    R.timer = setInterval(() => {
      const s = (Date.now() - R.started) / 1000;
      const el = $('#rec-time');
      if (el) el.textContent = clock(s);
      if (s >= 300) sendRec(); // hasta 5 minutos por audio
    }, 250);
    paintControls();
  }
  function startRecognition(R) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || matchMedia('(pointer: coarse)').matches) return;
    try {
      const sr = new SR();
      sr.lang = 'es-AR';
      sr.continuous = true;
      sr.interimResults = true;
      sr.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) R.text = `${R.text} ${r[0].transcript.trim()}`.trim();
          else interim += r[0].transcript;
        }
        R.interim = interim.trim();
        const el = $('#rec-text');
        if (el) el.textContent = recPreview(R);
      };
      sr.onerror = () => {};
      // Chrome corta el dictado después de un silencio: mientras se graba, se vuelve a prender
      sr.onend = () => {
        if (R.stopping) { if (R.recogDone) R.recogDone(); return; }
        try { sr.start(); } catch {}
      };
      sr.start();
      R.recog = sr;
    } catch {}
  }
  function stopRec(R) {
    R.stopping = true;
    clearInterval(R.timer);
    const audio = new Promise(resolve => {
      R.recorder.onstop = resolve;
      if (R.recorder.state !== 'inactive') R.recorder.stop(); else resolve();
    });
    // El dictado entrega las últimas palabras al cortarse: se espera un poco
    const words = R.recog ? new Promise(resolve => {
      R.recogDone = resolve;
      setTimeout(resolve, 1500);
      try { R.recog.stop(); } catch { resolve(); }
    }) : Promise.resolve();
    return Promise.all([audio, words]).then(() => R.stream.getTracks().forEach(t => t.stop()));
  }
  async function cancelRec() {
    const R = S.chat.rec;
    if (!R || R.stopping) return;
    S.chat.rec = null;
    paintControls();
    await stopRec(R);
  }
  function sendRec() {
    const R = S.chat.rec;
    if (!R || R.stopping) return;
    const secs = Math.round((Date.now() - R.started) / 1000);
    S.chat.rec = null;
    paintControls();
    // El mensaje aparece enseguida; el audio se termina de cerrar y se sube mientras dice "Subiendo el audio…"
    const p = newPending($('#chat-form'), { audio: true, duracion: secs });
    p.ready = stopRec(R).then(() => {
      if (secs < 1 || !R.chunks.length) throw new Error('el audio quedó muy corto');
      p.blob = new Blob(R.chunks, { type: R.recorder.mimeType || R.chunks[0].type || 'audio/webm' });
      p.transcripcion = `${R.text} ${R.interim}`.trim();
    });
    deliver(p).then(() => { p.ready = null; });
  }
  async function addChatFiles(files) {
    for (const file of [...files].slice(0, Math.max(0, 6 - S.chat.files.length))) {
      if (!/^image\//.test(file.type)) { toast('Por el chat solo se pueden mandar fotos.', true); continue; }
      if (file.size > 8 * 1048576) { toast('La foto pesa más de 8 MB. Achicala y probá de nuevo.', true); continue; }
      S.chat.uploading++;
      paintFiles();
      paintControls();
      try {
        const { url } = await api('/subir', { method: 'POST', file });
        S.chat.files.push(url);
      } catch (err) {
        toast(err.message, true);
      } finally {
        S.chat.uploading--;
        paintFiles();
        paintControls();
      }
    }
  }
  document.addEventListener('input', e => {
    if (e.target.name === 'texto' && e.target.closest('#chat-form')) S.chat.draft = e.target.value;
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'chat-file') { addChatFiles(e.target.files); e.target.value = ''; }
    if (e.target.name === 'de' && e.target.closest('#chat-form')) store.set('xoxo-chat-nombre', e.target.value.trim());
  });
  // En la computadora, Enter manda y Shift+Enter baja de línea. En el celular, Enter baja de línea.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.target.name !== 'texto' || !e.target.closest('#chat-form')) return;
    if (matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    e.target.form.requestSubmit();
  });
  // Mensajes nuevos y estado: cada 3 s con el chat abierto; si no, cada minuto para avisar en la pestaña
  let chatPolledAt = 0;
  setInterval(async () => {
    if (document.hidden || $('#app').hidden || S.chat.busy) return;
    const onChat = S.tab === 'ia';
    if (!onChat && Date.now() - chatPolledAt < 60e3) return;
    chatPolledAt = Date.now();
    S.chat.busy = true;
    try {
      if (await loadChat()) {
        if (S.tab === 'ia') { paintChat(false); markSeen(); } else updateBadge();
      }
    } catch {} finally { S.chat.busy = false; }
  }, 3e3);

  /* ----- Pedidos (pago online) ----- */
  const ORDER_STATUS = {
    created: 'Iniciado', pending: 'Esperando el pago', approved: 'Pagado', rejected: 'Rechazado',
    review: 'Revisar en la financiera', error: 'Error al conectar',
  };
  const METHOD_NAMES = { gocuotas: 'GO cuotas', mercadopago: 'Mercado Pago' };
  // modo que informa el servidor → [texto, clase del chip]
  const PAY_MODES = {
    real: ['Real: cobra de verdad', ''], prueba: ['Prueba: no cobra', ''], 'sin-probar': ['Clave cargada', ''],
    demo: ['Pago simulado', ''], apagado: ['Apagado', ' off'],
  };
  function gatewaysCard(G) {
    const T = S.payTest || {};
    const rows = Object.entries(G).map(([key, g]) => {
      const [label, cls] = PAY_MODES[g.modo] || [g.modo, ''];
      const t = T[key];
      const conn = t ? (t.ok ? 'Conecta bien' : `<b style="color:var(--bad)">No conecta: ${esc(t.error)}</b>`)
        : g.modo === 'demo' || g.modo === 'apagado' ? '<span class="muted">Sin clave</span>' : '<span class="muted">Sin probar</span>';
      return `<tr>
        <td><b>${esc(g.name)}</b>${g.cuenta ? `<span class="sub">${esc(g.cuenta)}</span>` : ''}</td>
        <td><span class="chip${cls}">${label}</span></td>
        <td>${conn}</td>
        <td>${g.ultimoAviso ? when(g.ultimoAviso) : '<span class="muted">Ninguno desde que arrancó la tienda</span>'}</td>
      </tr>`;
    }).join('');
    return `<section class="card">
      <div class="card-head"><h2>Pasarelas de pago</h2><p>"Prueba" usa cuentas de prueba de la financiera; "Pago simulado" ni siquiera pasa por ella.</p></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Medio</th><th>Modo</th><th>Conexión</th><th>Último aviso de pago</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="row"><button class="btn small" type="button" data-act="test-pay"${S.payTesting ? ' disabled' : ''}>${S.payTesting ? 'Probando…' : 'Probar conexión'}</button></div>
      <p class="muted">Las claves se cargan en el servidor y nunca pasan por el panel. En una terminal de la computadora: <code>ssh -t xoxo-vps xoxo-claves</code></p>
      ${G.mercadopago && ['real', 'prueba', 'sin-probar'].includes(G.mercadopago.modo) ? `
      <div class="pay-link">
        <h3>Probar Mercado Pago de punta a punta</h3>
        <p class="muted">Crea un pedido de prueba con un link de pago. Al pagarlo se prueba todo: la página de Mercado Pago, el aviso del pago,
          el pedido aprobado y el mail. ${G.mercadopago.modo === 'prueba' ? 'Con la cuenta de prueba no se cobra nada.' : '<b>Con la cuenta real se cobra de verdad</b>: después lo devolvés desde tu Mercado Pago (Actividad → el pago → Devolver).'}</p>
        <div class="row"><label class="field">Monto <input id="pl-monto" type="number" min="10" value="100" inputmode="numeric"></label>
          <label class="field">Tu email <input id="pl-email" type="email" placeholder="tu@email.com"></label>
          <button class="btn small" type="button" data-act="pay-link">Crear link de pago</button></div>
        <p id="pl-out" class="muted"></p>
      </div>` : ''}
    </section>`;
  }
  /* ----- 22/11/2026: Inicio, Sucursales, Páginas y Clientes ----- */
  const diaDe = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const DISENOS = [['historia', 'Historia', '/'], ['red-social', 'Red social', '/red-social/'], ['minimalista', 'Minimalista', '/minimalista/']];
  const linkPaginas = () => `<div class="paginas-grid">${DISENOS.map(([id, nombre, raiz]) => `
    <div class="pagina-col"><b>${nombre}${id === 'historia' ? ' <span class="chip">página principal</span>' : ''}</b>
      <a href="${esc(BASE)}${raiz}${id === 'historia' ? '' : '?ver'}" target="_blank" rel="noopener">Inicio</a>
      ${(S.draft.categories || []).map(c => `<a href="${esc(BASE)}${raiz}${c.id}/${id === 'historia' ? '' : '?ver'}" target="_blank" rel="noopener">${esc(c.name)}</a>`).join('')}
    </div>`).join('')}</div>`;

  // Inicio: lo del día, lo que hay que hacer y accesos directos
  function viewInicio() {
    const head = '<div class="page-head"><h1>Inicio</h1></div>';
    const P = S.orders;
    if (!P) return head + loading;
    const pagos = P.pedidos.filter(o => o.status === 'approved');
    const hoy = diaDe(new Date());
    const semana = Date.now() - 7 * 864e5;
    const deHoy = pagos.filter(o => diaDe(o.paidAt || o.createdAt) === hoy);
    const deSemana = pagos.filter(o => new Date(o.paidAt || o.createdAt).getTime() >= semana);
    const suma = l => l.reduce((s, o) => s + o.amount, 0);
    const cuenta = f => P.pedidos.filter(f).length;
    const tile = (titulo, valor, sub, tab = '') => `<${tab ? `button type="button" data-act="ir-pedidos" data-otab="${tab}"` : 'div'} class="tile">
      <span class="tile-t">${titulo}</span><b class="tile-v">${valor}</b>${sub ? `<span class="tile-s">${sub}</span>` : ''}</${tab ? 'button' : 'div'}>`;
    return `${head}
      <section class="tiles">
        ${tile('Ventas de hoy', money(suma(deHoy)), `${n(deHoy.length)} pedido${deHoy.length === 1 ? '' : 's'}`)}
        ${tile('Últimos 7 días', money(suma(deSemana)), `${n(deSemana.length)} pedido${deSemana.length === 1 ? '' : 's'}`)}
        ${tile('Por preparar', n(cuenta(o => o.status === 'approved' && !estadoDe(o))), 'Pagados sin tildar', 'preparar')}
        ${tile('Preparando', n(cuenta(o => estadoDe(o) === 'preparando')), 'Por despachar o dejar listos', 'preparando')}
        ${tile('Para retirar', n(cuenta(o => estadoDe(o) === 'listo')), 'Esperan en la sucursal', 'retirar')}
        ${tile('Despachados', n(cuenta(o => estadoDe(o) === 'despachado')), 'En camino', 'despachados')}
      </section>
      <section class="card"><div class="card-head"><h2>Últimas compras</h2></div>
        ${pagos.length ? `<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Productos</th><th class="num">Total</th><th>Entrega</th></tr></thead><tbody>
          ${pagos.slice(0, 6).map(o => `<tr><td><b>#${esc(o.ref)}</b><span class="sub">${when(o.paidAt || o.createdAt)}</span></td><td>${esc(o.buyer.name)}</td>
            <td>${esc(itemsDe(o).map(x => `${x.n > 1 ? `${x.n} × ` : ''}${x.name}`).join(', '))}</td><td class="num">${money(o.amount)}</td>
            <td>${esc(PASOS[estadoDe(o)] || 'Por preparar')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Todavía no hay compras pagadas.</p>'}
        <div class="row"><button class="btn small" type="button" data-act="ir-pedidos" data-otab="todos">Ver todos los pedidos</button></div>
      </section>
      <section class="card"><div class="card-head"><h2>Las páginas</h2><p>Abren en otra pestaña. La página principal (xoxotecno.com.ar) es Historia.</p></div>
        ${linkPaginas()}
      </section>`;
  }

  // Sucursales: cada local (horarios, teléfono, WhatsApp, foto), el reparto de WhatsApp y los datos de contacto
  function viewSucursales() {
    const provs = [...new Set(S.draft.store.branches.map(b => b.province).filter(Boolean))];
    return `
      <div class="page-head"><h1>Sucursales</h1><button class="btn small primary" type="button" data-act="add-branch">Agregar sucursal</button></div>
      <p class="muted">${n(S.draft.store.branches.length)} sucursales${provs.length ? ` en ${esc(provs.join(', '))}` : ''}. Se ven en las páginas, en "Retiro en sucursal" al pagar y en el reparto de WhatsApp.</p>
      <section class="card">
        <div class="card-head"><h2>Locales</h2><p>Ningún dato es obligatorio: completá lo que tengas. Los mensajes de WhatsApp se reparten en partes iguales entre las que tienen WhatsApp y reciben mensajes.</p></div>
        <div class="branches">${S.draft.store.branches.map((b, i, all) => branchEditor(b, i, all.length)).join('')}</div>
      </section>
      ${repartoCard(S.reparto)}
      <section class="card"><div class="card-head"><h2>Teléfonos, email y redes</h2><p>Se ven en el pie de las páginas y en el carrito (para pedir un código de descuento). Lo que quede vacío no aparece.</p></div>
        ${area('Sobre la tienda', 'footer.about', { rows: 2 })}
        <div class="grid-2">
          ${field('Horarios generales', 'footer.hours', { ph: 'Lunes a sábado de 9 a 13 y de 16 a 21' })}
          ${field('Email', 'footer.email', { type: 'email' })}
          ${field('Instagram', 'footer.instagram', { ph: '@tutienda o https://…' })}
          ${field('Facebook', 'footer.facebook', { ph: 'tutienda o https://…' })}
          ${field('TikTok', 'footer.tiktok', { ph: '@tutienda o https://…' })}
          ${field('Datos legales', 'footer.legal', { ph: 'Razón social · CUIT 30-00000000-0' })}
        </div>
      </section>`;
  }

  // Páginas: verlas todas y editar los textos de cada categoría y de la página Historia
  function viewPaginas() {
    return `
      <div class="page-head"><h1>Páginas</h1></div>
      <section class="card"><div class="card-head"><h2>Ver las páginas</h2><p>Abren en otra pestaña, con los cambios guardados.</p></div>${linkPaginas()}</section>
      ${categoriasCard()}
      ${historiaCard()}`;
  }

  // Clientes: las cuentas (con email y contraseña o con Google) y lo que compró cada uno
  function viewClientes() {
    const head = '<div class="page-head"><h1>Clientes</h1></div>';
    if (!S.clientes || !S.orders) return head + loading;
    const pagos = S.orders.pedidos.filter(o => o.status === 'approved');
    const de = c => pagos.filter(o => String(o.buyer.email).toLowerCase() === c.email || o.clienteId === c.id);
    const lista = S.clientes.clientes.slice().sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    const sinCuenta = new Set(pagos.map(o => String(o.buyer.email).toLowerCase()).filter(e => !lista.some(c => c.email === e))).size;
    return `${head}
      <p class="muted">${n(lista.length)} cuentas · ${n(sinCuenta)} clientes compraron sin cuenta. Las contraseñas se guardan cifradas: nadie las puede ver.</p>
      <section class="card">
        ${lista.length ? `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Cómo entra</th><th class="num">Compras</th><th class="num">Total</th><th>Desde</th></tr></thead><tbody>
          ${lista.map(c => { const l = de(c); return `<tr><td><b>${esc(c.nombre)}</b><span class="sub">${esc(c.email)}${c.telefono ? ` · ${esc(c.telefono)}` : ''}</span></td>
            <td>${c.google ? 'Google' : 'Email y contraseña'}${c.confirmado ? '' : ' <span class="chip warn">sin confirmar</span>'}</td>
            <td class="num">${n(l.length)}</td><td class="num">${money(l.reduce((s, o) => s + o.amount, 0))}</td>
            <td>${c.creado ? when(c.creado) : ''}${c.ultimo ? `<span class="sub">entró ${when(c.ultimo)}</span>` : ''}</td></tr>`; }).join('')}
          </tbody></table></div>` : '<p class="muted">Todavía nadie creó una cuenta. Se crean en xoxotecno.com.ar/cuenta (y con el botón de la persona, arriba en cada página).</p>'}
      </section>`;
  }

  // Seguimiento de la entrega (22/11/2026): los pasos que tildan después del pago
  const PASOS = { preparando: 'Preparando', despachado: 'Despachado', listo: 'Listo para retirar', entregado: 'Entregado', cancelado: 'Cancelado' };
  const EMPRESAS = { andreani: 'Andreani', correo: 'Correo Argentino', otra: 'Otra' };
  const esRetiro = o => !o.envio || o.envio.tipo === 'retiro';
  const estadoDe = o => (o.seguimiento && o.seguimiento.estado) || '';
  // Las pestañas: qué hay que hacer con cada pedido
  const PESTANAS = [
    ['preparar', 'Por preparar', o => o.status === 'approved' && !estadoDe(o)],
    ['preparando', 'Preparando', o => estadoDe(o) === 'preparando'],
    ['retirar', 'Para retirar', o => estadoDe(o) === 'listo'],
    ['despachados', 'Despachados', o => estadoDe(o) === 'despachado'],
    ['entregados', 'Entregados', o => estadoDe(o) === 'entregado'],
    ['sin-pagar', 'Sin pagar', o => o.status !== 'approved' && estadoDe(o) !== 'cancelado'],
    ['cancelados', 'Cancelados', o => estadoDe(o) === 'cancelado'],
    ['todos', 'Todos', () => true],
  ];
  const plano = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const itemsDe = o => o.items || [{ name: o.product.name, n: 1, price: o.productAmount ?? o.amount }];

  function pedidoCard(o) {
    const phone = String(o.buyer.phone || '');
    const wa = phone.startsWith('54') ? phone : `549${phone}`;
    const d = o.delivery || {};
    const seg = o.seguimiento || { estado: '', historial: [] };
    const est = seg.estado;
    const pagado = o.status === 'approved';
    const entrega = esRetiro(o)
      ? `${esc(o.envio ? o.envio.nombre : 'Retiro en sucursal')}`
      : `${esc(o.envio.nombre)} (${money(o.envio.costo)})<span class="sub">${esc([d.address, d.city, o.envio.provincia, d.cp && `CP ${d.cp}`].filter(Boolean).join(', '))}</span>`;
    const pasos = [
      { paso: 'pagado', at: pagado ? (o.paidAt || o.createdAt) : '' },
      ...(seg.historial || []),
    ].filter(h => h.at);
    const btn = (paso, label, cls = '') => `<button class="btn small${cls}" type="button" data-act="seguir" data-id="${esc(o.id)}" data-paso="${paso}">${label}</button>`;
    const acciones = est === 'cancelado' ? ''
      : !pagado ? btn('cancelado', 'Cancelar')
      : !est ? `${btn('preparando', 'Preparando', ' primary')}${btn('cancelado', 'Cancelar')}`
      : est === 'preparando' ? `${esRetiro(o) ? btn('listo', 'Listo para retirar', ' primary') : btn('despachado', 'Despachado…', ' primary')}${btn('cancelado', 'Cancelar')}`
      : ['listo', 'despachado'].includes(est) ? btn('entregado', 'Entregado', ' primary') : '';
    return `<article class="order${est === 'cancelado' ? ' is-off' : ''}" id="pedido-${esc(o.ref)}">
      <header class="order-head">
        <b class="order-ref">#${esc(o.ref)}</b>
        <span class="muted">${when(o.createdAt)}</span>
        <span class="chip${pagado ? '' : ' off'}">${esc(ORDER_STATUS[o.status] || o.status)}</span>
        ${est ? `<span class="chip ${est === 'cancelado' ? 'off' : 'seg'}">${esc(PASOS[est])}</span>` : pagado ? '<span class="chip warn">Por preparar</span>' : ''}
        ${o.gateway && o.gateway.demo ? '<span class="chip off">DEMO</span>' : ''}
        <b class="order-total">${money(o.amount)}</b>
      </header>
      <div class="order-grid">
        <div>
          <h3>Productos</h3>
          <ul class="order-items">${itemsDe(o).map(x => `<li><span>${x.n > 1 ? `${x.n} × ` : ''}${esc(x.name)}</span><b>${money(x.price * x.n)}</b></li>`).join('')}
            ${o.discount ? `<li class="save"><span>Código ${esc(o.discount.code)} (−${o.discount.percent}%)</span><b>−${money(o.discount.amount)}</b></li>` : ''}
            <li><span>${esc(o.envio ? o.envio.nombre : 'Entrega')}</span><b>${o.envio && o.envio.costo ? money(o.envio.costo) : 'Gratis'}</b></li></ul>
          <p class="sub">${esc(METHOD_NAMES[o.method] || o.method)} · ${o.method === 'gocuotas' ? `${n(o.plan)} cuotas con débito` : o.gateway && o.gateway.installments ? `${n(o.gateway.installments)} ${o.gateway.installments === 1 ? 'pago' : 'cuotas'}` : `hasta ${n(o.credito || 12)} cuotas`}${o.coupon ? ` · cupón ${esc(o.coupon)}` : ''}${o.gateway && o.gateway.paymentId ? ` · operación ${esc(o.gateway.paymentId)}` : ''}</p>
        </div>
        <div>
          <h3>Cliente</h3>
          <p>${esc(o.buyer.name)}<span class="sub">${esc(o.buyer.email)}${o.buyer.dni ? ` · DNI ${esc(o.buyer.dni)}` : ''}</span></p>
          <p><a href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(`¡Hola ${o.buyer.name.split(' ')[0]}! Te escribimos de ${S.site.store.name} por tu pedido #${o.ref}.`)}" target="_blank" rel="noopener">WhatsApp ${esc(phone)}</a> · <a href="mailto:${esc(o.buyer.email)}?subject=${encodeURIComponent(`Tu pedido #${o.ref}`)}">Mail</a></p>
          <h3>Entrega</h3>
          <p>${entrega}</p>
          ${seg.numero ? `<p>${esc(EMPRESAS[seg.empresa] || seg.empresa || '')}: <b>${esc(seg.numero)}</b></p>` : ''}
        </div>
        <div>
          <h3>Historia</h3>
          <ol class="order-steps">${pasos.map(h => `<li><b>${esc(h.paso === 'pagado' ? 'Pagado' : PASOS[h.paso] || h.paso)}</b> <span class="muted">${when(h.at)}</span>${h.numero ? `<span class="sub">${esc(EMPRESAS[h.empresa] || '')} ${esc(h.numero)}</span>` : ''}${h.motivo ? `<span class="sub">Motivo: ${esc(h.motivo)}</span>` : ''}</li>`).join('') || '<li class="muted">Todavía sin pagar</li>'}</ol>
          <label class="field">Nota interna <textarea rows="2" maxlength="500" data-nota="${esc(o.id)}" placeholder="Solo la ven ustedes">${esc(o.nota || '')}</textarea></label>
        </div>
      </div>
      <div class="row order-actions">${acciones}
        ${(seg.historial || []).length ? `<button class="btn small ghost" type="button" data-act="seguir" data-id="${esc(o.id)}" data-paso="deshacer">Deshacer el último paso</button>` : ''}
        <button class="btn small ghost" type="button" data-act="guardar-nota" data-id="${esc(o.id)}">Guardar nota</button>
      </div>
    </article>`;
  }

  function viewOrders() {
    const head = `<div class="page-head"><h1>Pedidos</h1>
      <div class="row"><button class="btn small" type="button" data-act="orders-csv">Descargar (Excel)</button>
      <button class="btn small" type="button" data-act="reload-orders">Actualizar</button></div></div>`;
    const P = S.orders;
    if (!P) return head + loading;
    const list = P.pedidos;
    const tab = S.ordersTab || 'preparar';
    const q = plano(S.ordersQ || '');
    const filtro = (PESTANAS.find(t => t[0] === tab) || PESTANAS[0])[2];
    const busca = o => !q || plano([o.ref, o.buyer.name, o.buyer.email, o.buyer.dni, o.buyer.phone, (o.seguimiento || {}).numero].join(' ')).includes(q);
    const vista = list.filter(o => busca(o) && (q ? true : filtro(o)));
    const paid = list.filter(o => o.status === 'approved');
    return `${head}
      <section class="card">
        <div class="order-tools">
          <div class="otabs" role="tablist">${PESTANAS.map(([id, label, f]) => `<button type="button" role="tab" class="otab${tab === id ? ' on' : ''}" data-act="orders-tab" data-otab="${id}" aria-selected="${tab === id}">${label} <span class="count">${n(list.filter(f).length)}</span></button>`).join('')}</div>
          <input class="order-search" type="search" placeholder="Buscar por código, nombre, email, DNI o n.º de seguimiento" value="${esc(S.ordersQ || '')}" data-orders-q aria-label="Buscar pedidos">
        </div>
        <p class="muted">${n(list.length)} pedidos · ${n(paid.length)} pagados. ${q ? `Resultados de "${esc(S.ordersQ)}" en todos los pedidos.` : ''} Los pagos se confirman consultando a la financiera; los pasos de la entrega los tildan ustedes y el cliente los ve en xoxotecno.com.ar/seguimiento.</p>
        ${vista.length ? vista.map(pedidoCard).join('') : `<p class="muted">${q ? 'No hay pedidos con esa búsqueda.' : 'No hay pedidos en esta pestaña.'}</p>`}
      </section>
      ${P.pasarelas ? gatewaysCard(P.pasarelas) : ''}
      ${P.correo ? correoCard(P.correo) : ''}`;
  }

  /* ----- Registro ----- */
  function device(ua = '') {
    if (!ua) return '';
    if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Mac OS X/.test(ua)) return 'Mac';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Otro';
  }
  function detail(e) {
    if (e.tipo === 'visita') {
      let ref = '';
      try { ref = e.ref ? new URL(e.ref).hostname : ''; } catch {}
      return [ref && `viene de ${ref}`, e.pantalla, device(e.ua)].filter(Boolean).join(' · ');
    }
    if (e.tipo === 'vista') return `${e.s} s`;
    if (e.tipo === 'abrir') return OPEN_NAMES[e.como] || e.como || '';
    if (e.tipo === 'like') return e.on ? 'Le dio me gusta' : 'Lo sacó';
    if (e.tipo === 'whatsapp') {
      const branch = (S.site.store.branches.find(b => b.id === e.suc) || {}).name || e.suc;
      return [PLACE_NAMES[e.donde] || e.donde, branch && `va a ${branch}`].filter(Boolean).join(' · ');
    }
    return '';
  }
  async function loadLog() {
    const q = S.logQuery;
    const params = new URLSearchParams(Object.entries({ dia: q.dia, tipo: q.tipo, q: q.q }).filter(([, v]) => v));
    S.log = await api('/registro?' + params);
    q.dia = S.log.day;
    render();
  }
  function viewLog() {
    const L = S.log;
    if (!L) return `<div class="page-head"><h1>Registro</h1></div>${loading}`;
    const q = S.logQuery;
    const names = Object.fromEntries([...S.site.products, ...S.site.extras].map(p => [p.id, rowTitle(p)]));
    const ips = new Set(L.items.map(e => e.ip)).size;
    const dl = fmt2 => apiUrl(`/registro/descargar?dia=${encodeURIComponent(L.day)}${fmt2 ? '&formato=json' : ''}`);
    return `
      <div class="page-head"><h1>Registro</h1></div>
      <p class="muted">Cada visita y cada acción, con su IP. Un archivo por día en data/registro/.</p>
      <section class="card">
        <form class="row" id="log-form">
          <select name="dia" aria-label="Día">${(L.days.length ? L.days : [L.day]).map(d => `<option${d === L.day ? ' selected' : ''}>${d}</option>`).join('')}</select>
          <select name="tipo" aria-label="Tipo"><option value="">Todo</option>${Object.entries(TYPE_NAMES).map(([k, l]) => `<option value="${k}"${q.tipo === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <input type="text" name="q" value="${esc(q.q)}" placeholder="Buscar IP, producto u origen" aria-label="Buscar" style="flex:1;min-width:180px;width:auto">
          <button class="btn small" type="submit">Buscar</button>
          <span class="spacer"></span>
          <a class="btn small" href="${dl(true)}">Descargar .json</a>
          <a class="btn small" href="${dl(false)}">.jsonl</a>
        </form>
        <p class="muted">${n(L.total)} eventos${L.total > L.items.length ? ` (se muestran los últimos ${n(L.items.length)})` : ''} · ${n(ips)} IP distintas</p>
        ${L.items.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Hora</th><th>Qué</th><th>Diseño</th><th>Producto</th><th>Detalle</th><th>Origen</th><th>IP</th></tr></thead>
          <tbody>${L.items.map(e => `<tr>
            <td class="num">${hour(e.t)}</td>
            <td>${esc(TYPE_NAMES[e.tipo] || e.tipo)}</td>
            <td><span class="chip v-${esc(e.v)}">${esc(vName(e.v))}</span></td>
            <td>${esc(e.id ? names[e.id] || e.id : '')}</td>
            <td>${esc(detail(e))}</td>
            <td>${esc(e.src || '')}</td>
            <td><code>${esc(e.ip)}</code></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted">No hay eventos para ese filtro.</p>'}
      </section>`;
  }

  /* ----- Copias de seguridad ----- */
  function viewBackups() {
    const B = S.backups;
    if (!B) return `<div class="page-head"><h1>Copias</h1></div>${loading}`;
    const table = (rows, restore) => rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Copia</th><th>Fecha</th><th class="num">Tamaño</th>${restore ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows.slice(0, 40).map(r => `<tr><td><code>${esc(r.name)}</code></td><td>${when(r.date)}</td><td class="num">${size(r.size)}</td>
        ${restore ? `<td class="num">${r.name.endsWith(`_rev${S.site.rev}.json`) ? '<span class="chip">Actual</span>'
          : `<button class="btn small" type="button" data-act="restore" data-name="${esc(r.name)}">Restaurar</button>`}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div>${rows.length > 40 ? `<p class="muted">y ${rows.length - 40} más en la carpeta del servidor.</p>` : ''}` : '<p class="muted">Todavía no hay copias.</p>';
    return `
      <div class="page-head"><h1>Copias</h1></div>
      <section class="card">
        <div class="card-head"><h2>Cómo se cuidan los datos</h2></div>
        <ul class="muted" style="margin:0;padding-left:18px;display:grid;gap:4px">
          <li>Cada evento se anota apenas pasa en <code>data/registro/AAAA-MM-DD.jsonl</code>.</li>
          <li>Los totales (<code>data/estadisticas.json</code>) se calculan desde el registro: se ponen al día cada minuto y se copian cada ${B.backupHours} h en <code>data/backups/estadisticas/</code>.</li>
          <li>Si el archivo de estadísticas se daña, se arranca desde la última copia y se le suma lo que quedó en el registro: no se pierde nada.</li>
          <li>Cada versión del contenido queda copiada en <code>data/backups/sitio/</code> (las últimas 100): si <code>sitio.json</code> se daña, se vuelve a la última.</li>
        </ul>
      </section>
      <section class="card">
        <div class="card-head"><h2>Contenido de la tienda</h2><p>Restaurar vuelve a esa versión. La actual queda guardada como copia.</p></div>
        <div class="row"><button class="btn small" type="button" data-act="download-site">Descargar el contenido actual (sitio.json)</button></div>
        ${table(B.sitio, true)}
      </section>
      <section class="card">
        <div class="card-head"><h2>Estadísticas</h2></div>
        <div class="row"><button class="btn small" type="button" data-act="backup-now">Hacer una copia ahora</button></div>
        ${table(B.estadisticas, false)}
      </section>`;
  }

  /* ----- Cuenta y servidor ----- */
  // ¿Se pueden ver los archivos de data/ desde internet? (pasa si el hosting no usa data/.htaccess)
  async function checkExposure() {
    try {
      const res = await fetch(`${BASE}/data/sitio.json`, { cache: 'no-store', credentials: 'omit' });
      S.exposed = res.ok && (await res.text()).trim().startsWith('{');
    } catch { S.exposed = false; }
    render();
  }
  const exposedNote = () => `<p class="note warn" role="alert" style="margin:0 0 16px"><b>Atención: los datos se pueden ver desde internet.</b>
    El hosting no está usando el archivo <code>data/.htaccess</code>, así que cualquiera podría abrir el registro con las IP.
    Revisá que se haya subido (los archivos que empiezan con punto a veces no se suben) o pedile al soporte del hosting que habilite .htaccess.
    Otra opción: mové la carpeta <code>data</code> un nivel más arriba que la tienda, fuera de la parte pública, y renombrala <code>xoxo-datos</code>.</p>`;

  function partnerCard(w) {
    const rows = [
      ['Conexión con Meta', w.configurado ? 'Cargada' : '<b style="color:var(--bad)">Falta cargar las claves</b> (en el servidor: <code>xoxo-claves</code>, opción 4)'],
      ['Dirección del webhook', `<code style="word-break:break-all">${esc(w.webhook)}</code>`],
      ['Números autorizados', w.autorizados.length ? esc(w.autorizados.join(', ')) : '<span class="muted">Ninguno: no le contesta a nadie</span>'],
      ['Último mensaje', w.ultimoMensaje ? `${when(w.ultimoMensaje.at)} · ${esc(w.ultimoMensaje.de)}` : '<span class="muted">Ninguno desde que arrancó la tienda</span>'],
      ...(w.ultimoError ? [['Último problema', `<b style="color:var(--bad)">${esc(w.ultimoError.msg)}</b><span class="sub">${when(w.ultimoError.at)}</span>`]] : []),
    ];
    return `<section class="card">
      <div class="card-head"><h2>WhatsApp del socio</h2><p>Tu socio pide cambios por WhatsApp. Por ahora solo contesta que el mensaje llegó.</p></div>
      <div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
  }

  function viewAccount() {
    const sv = S.server;
    const yes = (ok, good, bad) => (ok ? good : `<b style="color:var(--bad)">${bad}</b>`);
    const rows = sv ? [
      ['Usuario del panel', esc(sv.user)],
      ['Datos protegidos', S.exposed == null ? 'Revisando…' : yes(!S.exposed, sv.dataOutside ? 'Sí (fuera de la parte pública)' : 'Sí (data/.htaccess funciona)', 'No: se ven desde internet')],
      ['Se puede guardar en data/', yes(sv.dataWritable, 'Sí', 'No: dale permiso de escritura a la carpeta data/')],
      ['Se pueden subir fotos', yes(sv.uploadsWritable, sv.uploadLimit ? `Sí, hasta ${size(sv.uploadLimit)} por archivo` : 'Sí', 'No: dale permiso de escritura a media/subidas/')],
      ['Conexión segura (https)', yes(sv.https, 'Sí', 'No: activá el certificado SSL en el hosting')],
      ['Tu IP, como la ve la tienda', `<code>${esc(sv.ip)}</code>${sv.proxy ? ' · se toma del proxy (ip_desde_proxy)' : ''}`],
      ['Copias de las estadísticas', `Cada ${sv.backupHours} h`],
      ['Hora del servidor', `${esc(sv.now)} (${esc(sv.timezone)})`],
      ['Versión de Node', esc(sv.node)],
    ] : [];
    return `
      <div class="page-head"><h1>Cuenta</h1></div>
      <section class="card">
        <div class="card-head"><h2>Cambiar la contraseña</h2><p>Al cambiarla se cierran las sesiones abiertas en otros dispositivos.</p></div>
        <form id="pass-form" autocomplete="on" style="display:grid;gap:12px;max-width:420px">
          <input type="text" name="username" value="${esc(sv ? sv.user : 'admin')}" autocomplete="username" hidden>
          <label class="field">Contraseña actual<input type="password" name="actual" autocomplete="current-password" required></label>
          <label class="field">Contraseña nueva<input type="password" name="nueva" autocomplete="new-password" minlength="12" required>
            <small>12 caracteres o más. Lo más seguro es una frase larga.</small></label>
          <label class="field">Repetí la contraseña nueva<input type="password" name="repetir" autocomplete="new-password" minlength="12" required></label>
          <div class="row"><button class="btn primary" type="submit">Cambiar contraseña</button></div>
        </form>
        <p class="muted">¿Te la olvidaste? En el servidor, abrí <code>datos/config.json</code>, escribí una nueva en <code>"clave"</code> y entrá con esa.</p>
      </section>
      ${sv && sv.socio && sv.socio.configurado ? partnerCard(sv.socio) : ''}
      <section class="card">
        <div class="card-head"><h2>Servidor</h2></div>
        ${sv ? `<div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table></div>` : loading}
      </section>`;
  }

  /* ---------- Acciones ---------- */
  function live(kind, el) {
    const [list, at] = el.dataset.path.split('.');
    const i = Number(at);
    if (kind === 'totals') $(`#totals-${i}`).textContent = totalsText(S.draft.products[i]);
    if (kind === 'title') {
      const row = el.closest('.prow'), p = S.draft[list][i];
      $('.name-text', row).textContent = rowTitle(p);
      $('.meta', row).textContent = list === 'extras' ? extraMeta(p) : rowMeta(p);
    }
    if (kind === 'split') {
      const w = S.draft.ab.weights;
      $('#split-text').textContent = splitText(w);
      $('#split-bar').innerHTML = splitBar(w);
    }
  }

  // Búsqueda de pedidos: filtra mientras se escribe
  let ordersT = 0;
  document.addEventListener('input', e => {
    if (!e.target.matches('[data-orders-q]')) return;
    S.ordersQ = e.target.value;
    clearTimeout(ordersT);
    ordersT = setTimeout(() => {
      const pos = e.target.selectionStart;
      render();
      const nuevo = document.querySelector('[data-orders-q]');
      if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(pos, pos); }
    }, 250);
  });
  document.addEventListener('input', e => {
    const el = e.target.closest('[data-path]');
    if (!el || !S.draft || el.tagName === 'BUTTON' || (el.type === 'radio' && !el.checked)) return;
    setPath(S.draft, el.dataset.path, readInput(el));
    if (el.dataset.live) live(el.dataset.live, el);
    syncSavebar();
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-path]');
    if (el && el.hasAttribute('data-rerender')) render();
  });

  function pickFile(target) {
    S.upload = target;
    const input = $('#file');
    input.value = '';
    input.click();
  }
  $('#file').addEventListener('change', async e => {
    const file = e.target.files[0];
    const target = S.upload;
    if (!file || !target) return;
    try {
      // El hosting tiene un tamaño máximo: mejor avisar antes de subir
      if (!S.server) S.server = await api('/servidor');
      const limit = S.server.uploadLimit;
      if (limit && file.size > limit) {
        return toast(`El archivo pesa ${size(file.size)} y el hosting acepta hasta ${size(limit)}. Achicalo o pedile al hosting que suba el límite.`, true);
      }
      if (!/^video\//.test(file.type) && file.size > 8 * 1048576) return toast('La foto pesa más de 8 MB. Achicala y probá de nuevo.', true);
      toast('Subiendo…');
      const { url } = await api('/subir', { method: 'POST', file });
      if (target.gallery != null) S.draft[target.list][target.gallery].gallery.push(url);
      else setPath(S.draft, target.path, url);
      render();
      toast('Listo. Acordate de guardar los cambios.');
    } catch (err) { toast(err.message, true); }
  });

  const ACTIONS = {
    'reload-stats': () => go('estadisticas'),
    'reload-orders': () => go('pedidos'),
    'ir-pedidos'(el) { S.ordersTab = el.dataset.otab; S.ordersQ = ''; go('pedidos'); },
    'orders-tab'(el) { S.ordersTab = el.dataset.otab; S.ordersQ = ''; render(); },
    async seguir(el) {
      const o = S.orders.pedidos.find(x => x.id === el.dataset.id);
      const paso = el.dataset.paso;
      const body = { id: o.id, paso };
      if (paso === 'despachado') {
        const emp = (o.envio && o.envio.empresa) || '';
        const empresa = prompt('¿Con qué empresa salió? Escribí andreani, correo u otra.', emp || 'andreani');
        if (empresa === null) return;
        body.empresa = ['andreani', 'correo', 'otra'].includes(empresa.trim().toLowerCase()) ? empresa.trim().toLowerCase() : 'otra';
        body.numero = prompt('Número de seguimiento del envío:', '');
        if (body.numero === null) return;
      }
      if (paso === 'cancelado') {
        body.motivo = prompt(`Motivo de la cancelación del pedido #${o.ref}:`, '');
        if (body.motivo === null) return;
      }
      if (paso === 'deshacer' && !confirm(`¿Deshacer el último paso del pedido #${o.ref}?`)) return;
      try {
        await api('/pedidos/seguir', { method: 'POST', body });
        S.orders = await api('/pedidos');
        render();
        toast(paso === 'deshacer' ? 'Listo: se deshizo el último paso.' : `Pedido #${o.ref}: ${PASOS[paso]}.${['despachado', 'listo'].includes(paso) ? ' Le avisamos al cliente por mail.' : ''}`);
      } catch (err) { toast(err.message, true); }
    },
    async 'guardar-nota'(el) {
      const t = document.querySelector(`[data-nota="${CSS.escape(el.dataset.id)}"]`);
      try {
        await api('/pedidos/nota', { method: 'POST', body: { id: el.dataset.id, nota: t.value } });
        const o = S.orders.pedidos.find(x => x.id === el.dataset.id);
        if (o) o.nota = t.value;
        toast('Nota guardada.');
      } catch (err) { toast(err.message, true); }
    },
    'orders-csv'() {
      const col = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const filas = [['Código', 'Fecha', 'Estado del pago', 'Entrega', 'Productos', 'Código de descuento', 'Descuento', 'Envío', 'Total', 'Medio', 'Cuotas', 'Cliente', 'Email', 'Teléfono', 'DNI', 'Dirección', 'Empresa', 'Seguimiento', 'Nota']];
      for (const o of S.orders.pedidos) {
        const d = o.delivery || {}, seg = o.seguimiento || {};
        filas.push([o.ref, o.createdAt.slice(0, 16).replace('T', ' '), ORDER_STATUS[o.status] || o.status, PASOS[seg.estado] || (o.status === 'approved' ? 'Por preparar' : ''),
          itemsDe(o).map(x => `${x.n} x ${x.name}`).join(' + '), o.discount ? o.discount.code : '', o.discount ? o.discount.amount : '', o.envio ? o.envio.costo : 0, o.amount,
          METHOD_NAMES[o.method] || o.method, o.plan, o.buyer.name, o.buyer.email, o.buyer.phone, o.buyer.dni || '',
          [d.address, d.city, d.province, d.cp].filter(Boolean).join(', '), EMPRESAS[seg.empresa] || '', seg.numero || '', o.nota || '']);
      }
      const csv = '\ufeff' + filas.map(f => f.map(col).join(';')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    'chat-photo': () => $('#chat-file').click(),
    'chat-rec': () => startRec(),
    'rec-cancel': () => cancelRec(),
    'rec-send': () => sendRec(),
    'chat-retry': el => { const p = S.chat.pending.find(x => x.k === el.dataset.k); if (p) deliver(p); },
    'chat-drop': el => { S.chat.pending = S.chat.pending.filter(x => x.k !== el.dataset.k); paintChat(false); },
    'chat-unfile': el => { S.chat.files.splice(Number(el.dataset.i), 1); paintFiles(); },
    async 'pay-link'() {
      const out = $('#pl-out');
      out.textContent = 'Creando el link…';
      try {
        const r = await api('/pagos/link-prueba', { method: 'POST', body: { monto: $('#pl-monto').value, email: $('#pl-email').value } });
        if (r.error) { out.textContent = r.error; return; }
        out.innerHTML = `Pedido #${esc(r.pedido)}: <a href="${esc(r.url)}" target="_blank" rel="noopener">abrir el pago en Mercado Pago</a>. Después tocá Actualizar para ver el pedido.`;
      } catch (err) { out.textContent = err.message; }
    },
    async 'test-pay'() {
      S.payTesting = true;
      render();
      try {
        const r = await api('/pagos/probar', { method: 'POST' });
        S.payTest = r.probado;
        if (S.orders) S.orders.pasarelas = r.pasarelas;
        if (!Object.keys(r.probado).length) toast('Todavía no hay claves cargadas: no hay nada para probar.');
      } catch (err) { toast(err.message, true); }
      S.payTesting = false;
      render();
    },
    metric: el => { S.metric = el.dataset.k; render(); },
    'prod-sort': el => { S.prodSort = el.dataset.k; render(); },
    async recalc() {
      try {
        const r = await api('/estadisticas/recalcular', { method: 'POST' });
        toast(`Listo: se recalcularon ${n(r.events)} eventos.`);
        go('estadisticas');
      } catch (err) { toast(err.message, true); }
    },
    async 'reset-stats'() {
      if (!confirm('¿Empezar las estadísticas de cero? Se guarda una copia de las actuales y el registro no se borra.')) return;
      try { await api('/estadisticas/reiniciar', { method: 'POST' }); toast('Estadísticas en cero.'); go('estadisticas'); }
      catch (err) { toast(err.message, true); }
    },
    async copy(el) {
      try { await navigator.clipboard.writeText(el.dataset.text); toast('Link copiado'); }
      catch { prompt('Copiá el link:', el.dataset.text); }
    },
    reround() {
      S.draft.ab.round = (Number(S.draft.ab.round) || 1) + 1;
      render();
      toast('Al guardar, todos los visitantes se reparten de nuevo.');
    },
    'add-product'() {
      S.draft.products.push(newProduct());
      S.open = S.draft.products.length - 1;
      render();
      $$('.prow')[S.open].scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'add-extra'() {
      S.draft.extras.push(newExtra());
      S.open = S.draft.extras.length - 1;
      render();
      $$('.prow')[S.open].scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async 'mail-test'() {
      const para = ($('#mail-test') || {}).value || '';
      const msg = $('#mail-test-msg');
      msg.textContent = 'Mandando…';
      try {
        const r = await api('/correo/probar', { method: 'POST', body: { para } });
        msg.textContent = r.ok ? (r.modo === 'smtp' ? '¡Listo! Fijate en tu bandeja (y en spam).' : 'Guardado: no hay SMTP, mirálo en la lista.') : `No salió: ${r.error}`;
        if (r.ok) setTimeout(() => ACTIONS['reload-orders'](), 900);
      } catch (err) { msg.textContent = err.message; }
    },
    'add-code'() {
      (S.draft.codes || (S.draft.codes = [])).push({ code: '', percent: 10, until: '', max: 0, on: true, note: '' });
      render();
    },
    'del-code'(el) {
      const c = S.draft.codes[+el.dataset.i];
      if (!confirm(`¿Quitar el código ${c.code || 'nuevo'}?`)) return;
      S.draft.codes.splice(+el.dataset.i, 1);
      render();
    },
    'add-branch'() {
      S.draft.store.branches.push({ id: '', name: '', whatsapp: '', address: '', province: '', hours: '', phone: '', on: true });
      render();
    },
    'del-branch'(el) {
      const b = S.draft.store.branches[+el.dataset.i];
      if (!confirm(`¿Quitar la sucursal ${b.name || 'nueva'}?`)) return;
      S.draft.store.branches.splice(+el.dataset.i, 1);
      render();
    },
    edit(el) { const i = +el.dataset.i; S.open = S.open === i ? null : i; render(); },
    move(el) {
      const i = +el.dataset.i, j = i + Number(el.dataset.d);
      const list = listOf(el);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      if (S.open === i) S.open = j; else if (S.open === j) S.open = i;
      render();
    },
    'cuotas-masivo'() {
      const cual = $('#cm-cual').value, credito = $('#cm-credito').value, debito = $('#cm-debito').value;
      S.cuotasMasivo = { cual, credito, debito };
      if (!credito && !debito) return toast('Elegí las cuotas con crédito o con débito.', true);
      const [tipo, valor] = cual === 'todos' ? ['todos', ''] : [cual.slice(0, cual.indexOf(':')), cual.slice(cual.indexOf(':') + 1)];
      const lista = S.draft.extras.filter(p => tipo === 'todos' || (tipo === 'cat' ? p.cat === valor : p.group === valor));
      for (const p of lista) {
        if (credito) p.credito = Number(credito);
        if (debito) p.debito = debito === 'si';
      }
      render();
      toast(`Cuotas cambiadas en ${lista.length} producto${lista.length === 1 ? '' : 's'}. Tocá Guardar para que se vean en la tienda.`);
    },
    'toggle-hidden'(el) {
      const list = listOf(el), p = list[+el.dataset.i];
      if (list === S.draft.products && !p.hidden && list.filter(x => !x.hidden).length === 1) return toast('Tiene que quedar al menos un celular visible.', true);
      p.hidden = !p.hidden;
      render();
    },
    duplicate(el) {
      const i = +el.dataset.i;
      const list = listOf(el);
      const copy = { ...clone(list[i]), id: '', hidden: true };
      copy.name += ' (copia)';
      list.splice(i + 1, 0, copy);
      S.open = i + 1;
      render();
    },
    feature(el) {
      const p = S.draft.products[+el.dataset.i];
      if (!p.id) return toast('Guardá el producto primero.', true);
      S.draft.store.featured = p.id;
      render();
    },
    'add-photo': el => pickFile({ gallery: +el.dataset.i, list: el.dataset.list }),
    'add-photo-url'(el) {
      const i = +el.dataset.i;
      const url = $(`#photo-url-${i}`).value.trim();
      if (!/^(\/media\/|https:\/\/)/.test(url)) return toast('La dirección tiene que empezar con https:// o /media/', true);
      listOf(el)[i].gallery.push(url);
      render();
    },
    'photo-move'(el) {
      const g = listOf(el)[+el.dataset.i].gallery, k = +el.dataset.k, j = k + Number(el.dataset.d);
      [g[k], g[j]] = [g[j], g[k]];
      render();
    },
    'photo-del'(el) { listOf(el)[+el.dataset.i].gallery.splice(+el.dataset.k, 1); render(); },
    upload: el => pickFile({ path: el.dataset.path }),
    clear(el) { setPath(S.draft, el.dataset.path, ''); render(); },
    async restore(el) {
      const name = el.dataset.name;
      if (!confirm(`¿Volver al contenido de la copia ${name}?${isDirty() ? '\n\nSe pierden los cambios sin guardar.' : ''}`)) return;
      try {
        S.site = await api('/backups/restaurar', { method: 'POST', body: { name } });
        S.draft = clone(S.site);
        S.backups = await api('/backups');
        render();
        toast('Contenido restaurado. Ya se ve en la tienda.');
      } catch (err) { toast(err.message, true); }
    },
    async 'backup-now'() {
      try { const r = await api('/backups/ahora', { method: 'POST' }); toast(`Copia guardada: ${r.name}`); go('copias'); }
      catch (err) { toast(err.message, true); }
    },
    'download-site'() {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S.site, null, 2)], { type: 'application/json' }));
      a.download = `sitio-rev${S.site.rev}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };

  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) return go(tab.dataset.tab);
    const el = e.target.closest('[data-act]');
    if (el && ACTIONS[el.dataset.act]) { e.preventDefault(); ACTIONS[el.dataset.act](el, e); }
  });

  async function changePassword(e) {
    e.preventDefault();
    const form = e.target, f = new FormData(form);
    if (f.get('nueva') !== f.get('repetir')) return toast('Las dos contraseñas nuevas no coinciden.', true);
    try {
      await api('/clave', { method: 'POST', body: { actual: f.get('actual'), nueva: f.get('nueva') } });
      form.reset();
      toast('Listo: la contraseña nueva ya funciona.');
    } catch (err) { toast(err.message, true); }
  }

  document.addEventListener('submit', e => {
    if (e.target.id === 'pass-form') return changePassword(e);
    if (e.target.id === 'chat-form') { e.preventDefault(); return sendChat(e.target); }
    if (e.target.id !== 'log-form') return;
    e.preventDefault();
    const f = new FormData(e.target);
    S.logQuery = { dia: f.get('dia'), tipo: f.get('tipo'), q: String(f.get('q') || '').trim() };
    loadLog().catch(err => toast(err.message, true));
  });
  document.addEventListener('change', e => {
    if (e.target.closest('#log-form') && e.target.tagName === 'SELECT') e.target.form.requestSubmit();
  });

  async function save() {
    // Los códigos se generan sobre una copia: si no se puede guardar, salen del nombre definitivo la próxima vez
    const site = clone(S.draft);
    fillIds(site);
    const btn = $('#save');
    btn.disabled = true;
    try {
      const saved = await api('/sitio', { method: 'POST', body: { rev: S.site.rev, site } });
      S.site = saved;
      S.draft = clone(saved);
      render();
      toast('Guardado. Los cambios ya están en la tienda.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }
  $('#save').addEventListener('click', save);
  $('#discard').addEventListener('click', () => {
    if (!confirm('¿Descartar los cambios sin guardar?')) return;
    S.draft = clone(S.site);
    render();
  });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !$('#app').hidden) { e.preventDefault(); if (isDirty()) save(); }
  });
  addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  let resizeT = 0;
  addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(drawChart, 150); });
  // Las estadísticas se actualizan solas cada minuto mientras están a la vista
  setInterval(() => {
    if (S.tab === 'estadisticas' && !document.hidden && !$('#app').hidden) {
      api('/estadisticas').then(st => { S.stats = st; render(); }).catch(() => {});
    }
  }, 60e3);

  /* ---------- Ingreso ---------- */
  function showLogin(msg = '') {
    $('#app').hidden = true;
    $('#savebar').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = msg;
    const user = $('#login-form [name="user"]');
    (user.value ? $('#login-form [name="password"]') : user).focus();
  }

  async function start() {
    // Si la sesión venció con cambios sin guardar, se conservan
    if (!isDirty()) {
      S.site = await api('/sitio');
      S.draft = clone(S.site);
    }
    $('#login').hidden = true;
    $('#app').hidden = false;
    go(location.hash.slice(1) || S.tab);
    if (S.tab !== 'ia') loadChat().then(updateBadge).catch(() => {});
    checkExposure();
  }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#login-error').textContent = '';
    try {
      await api('/login', { method: 'POST', body: { user: f.get('user'), password: f.get('password') } });
      e.target.password.value = '';
      await start();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  $('#logout').addEventListener('click', async () => {
    if (isDirty() && !confirm('Tenés cambios sin guardar. ¿Salir igual?')) return;
    await api('/logout', { method: 'POST' }).catch(() => {});
    S.site = S.draft = null;
    showLogin('');
  });

  fetch(apiUrl('/sesion'), { credentials: 'same-origin' })
    .then(r => (r.ok ? start() : showLogin()))
    .catch(() => showLogin('No se pudo conectar con el servidor.'));
})();
