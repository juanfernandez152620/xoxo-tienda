/* Calculadora de envíos: la misma cuenta en la página (window.Envios) y en el servidor (require).
 * El costo sale de la tabla de /admin → Envíos: precio por zona para cada empresa (Andreani, Correo Argentino)
 * y servicio (a domicilio o a sucursal), más un recargo por cada kg arriba de 1 kg.
 * Zonas desde Tucumán: 1 Tucumán · 2 NOA (Catamarca, Salta, Jujuy, Santiago del Estero, La Rioja)
 *                      3 centro, Cuyo, NEA y Buenos Aires · 4 Patagonia.
 * Cuando haya contrato con Andreani o Correo Argentino, el servidor puede pedir la cotización real a su API
 * y usar esta tabla solo como respaldo (ver deploy/ENVIOS.md).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Envios = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // Letra del código postal (CPA) de cada provincia y su zona
  const PROVINCIAS = [
    ['T', 'Tucumán', 1], ['K', 'Catamarca', 2], ['A', 'Salta', 2], ['Y', 'Jujuy', 2], ['G', 'Santiago del Estero', 2],
    ['F', 'La Rioja', 2], ['C', 'Ciudad de Buenos Aires', 3], ['B', 'Buenos Aires', 3], ['X', 'Córdoba', 3],
    ['S', 'Santa Fe', 3], ['E', 'Entre Ríos', 3], ['W', 'Corrientes', 3], ['N', 'Misiones', 3], ['H', 'Chaco', 3],
    ['P', 'Formosa', 3], ['M', 'Mendoza', 3], ['J', 'San Juan', 3], ['D', 'San Luis', 3], ['L', 'La Pampa', 3],
    ['Q', 'Neuquén', 4], ['R', 'Río Negro', 4], ['U', 'Chubut', 4], ['Z', 'Santa Cruz', 4], ['V', 'Tierra del Fuego', 4],
  ].map(([letra, nombre, zona]) => ({ letra, nombre, zona }));

  // Códigos postales de 4 números: rango aproximado de cada provincia (la persona puede corregirla)
  const RANGOS = [
    [1000, 1499, 'C'], [1500, 1999, 'B'], [2000, 2699, 'S'], [2700, 2999, 'B'], [3000, 3099, 'S'], [3100, 3299, 'E'],
    [3300, 3399, 'N'], [3400, 3499, 'W'], [3500, 3599, 'H'], [3600, 3699, 'P'], [3700, 3799, 'H'], [4000, 4199, 'T'],
    [4200, 4399, 'G'], [4400, 4599, 'A'], [4600, 4699, 'Y'], [4700, 4799, 'K'], [5000, 5299, 'X'], [5300, 5399, 'F'],
    [5400, 5499, 'J'], [5500, 5699, 'M'], [5700, 5799, 'D'], [5800, 5999, 'X'], [6000, 6299, 'B'], [6300, 6399, 'L'],
    [6400, 7999, 'B'], [8000, 8199, 'B'], [8200, 8299, 'L'], [8300, 8399, 'Q'], [8400, 8599, 'R'], [9000, 9299, 'U'],
    [9300, 9409, 'Z'], [9410, 9429, 'V'], [9430, 9499, 'Z'],
  ];

  const EMPRESAS = { andreani: 'Andreani', correo: 'Correo Argentino' };
  const SERVICIOS = { domicilio: 'a domicilio', sucursal: 'a sucursal' };
  // Peso con caja cuando el producto no tiene uno cargado
  const PESO_CAT = { ventilacion: 4, contenido: 0.5, audio: 0.6 };

  const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function provincia(nombreOLetra) {
    const q = sinTildes(nombreOLetra);
    if (!q) return null;
    return PROVINCIAS.find(p => sinTildes(p.nombre) === q || p.letra.toLowerCase() === q) || null;
  }

  function provinciaDeCp(cp) {
    const s = String(cp || '').trim().toUpperCase();
    const cpa = s.match(/^([A-HJ-NP-Z])\s*\d{4}/);
    if (cpa) return provincia(cpa[1]);
    const n = Number((s.match(/^\d{4}$/) || [])[0]);
    if (!n) return null;
    const r = RANGOS.find(([a, b]) => n >= a && n <= b);
    return r ? provincia(r[2]) : null;
  }

  const peso = (p, cat) => (p && p.weight) || PESO_CAT[(p && p.cat) || cat] || 0.5;

  // Opciones de envío para una zona y un peso (kg). subtotal: para el envío gratis desde cierto monto.
  function opciones(cfg, zona, kg, subtotal = 0) {
    const out = [];
    if (!cfg || zona < 1 || zona > 4) return out;
    const gratis = cfg.freeFrom > 0 && subtotal >= cfg.freeFrom;
    const dias = cfg.days[zona - 1] || [3, 7];
    const extra = Math.max(0, Math.ceil(kg - 1));
    for (const [empresa, nombre] of Object.entries(EMPRESAS)) {
      const r = cfg.rates[empresa];
      if (!r || !r.on) continue;
      for (const [servicio, texto] of Object.entries(SERVICIOS)) {
        const base = r[servicio][zona - 1];
        const costo = gratis ? 0 : Math.round(base + r.extraKg * extra);
        out.push({ id: `${empresa}-${servicio}`, empresa, servicio, nombre: `${nombre} ${texto}`, costo, dias: [dias[0], dias[1] + (servicio === 'sucursal' ? 1 : 0)] });
      }
    }
    return out.sort((a, b) => a.costo - b.costo);
  }

  const diasTexto = d => (d[0] === d[1] ? `${d[0]} día${d[0] === 1 ? '' : 's'} hábil${d[0] === 1 ? '' : 'es'}` : `${d[0]} a ${d[1]} días hábiles`);

  return { PROVINCIAS, EMPRESAS, SERVICIOS, PESO_CAT, provincia, provinciaDeCp, peso, opciones, diasTexto };
});
