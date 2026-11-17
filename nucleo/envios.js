'use strict';
/* Envíos con Andreani y Correo Argentino: cotiza con la tabla de /admin → Envíos (la misma cuenta que hace la
 * página, en publico/shared/envios.js) y le pone precio al envío de cada pedido. El precio del envío lo decide
 * siempre el servidor, nunca el navegador. */

const calc = require('../publico/shared/envios');
const sitio = require('./sitio');

const priceOf = p => p.price || p.cuotas[12] * 12;
const buscar = id => {
  const site = sitio.cargar();
  return [...site.products, ...site.extras].find(p => !p.hidden && p.id === id) || null;
};

// Para la calculadora: /api/envios?provincia=…&cp=…&producto=…
function cotizar({ provincia, cp, productId, cat }) {
  const site = sitio.cargar();
  const prov = calc.provincia(provincia) || calc.provinciaDeCp(cp);
  if (!prov) return { error: 'Elegí tu provincia o escribí tu código postal.', provincias: calc.PROVINCIAS.map(p => p.nombre) };
  const p = productId ? buscar(String(productId)) : null;
  const kg = calc.peso(p, sitio.CATS.includes(cat) ? cat : '');
  return {
    provincia: prov.nombre, zona: prov.zona, kg,
    retiro: site.shipping.pickup,
    opciones: calc.opciones(site.shipping, prov.zona, kg, p ? priceOf(p) : 0),
  };
}

// Envío elegido en el checkout: { tipo: 'retiro' | 'andreani-domicilio' | …, provincia, cp, sucursal }
// Devuelve { ok, envio } con el costo calculado acá, o { error }.
function precio(product, d) {
  const site = sitio.cargar();
  const tipo = String(d.tipo || d.type || 'retiro');
  if (tipo === 'retiro') {
    if (!site.shipping.pickup) return { error: 'El retiro en sucursal no está disponible.' };
    const suc = site.store.branches.find(b => b.id === d.sucursal) || site.store.branches.find(b => b.on) || site.store.branches[0];
    return { ok: true, envio: { tipo, nombre: `Retiro en sucursal ${suc.name}`, sucursal: suc.id, costo: 0 } };
  }
  const prov = calc.provincia(d.provincia) || calc.provinciaDeCp(d.cp);
  if (!prov) return { error: 'Elegí la provincia para el envío.' };
  const op = calc.opciones(site.shipping, prov.zona, calc.peso(product), priceOf(product)).find(o => o.id === tipo);
  if (!op) return { error: 'Esa forma de envío no está disponible. Elegí otra.' };
  return {
    ok: true,
    envio: { tipo, nombre: op.nombre, empresa: op.empresa, servicio: op.servicio, provincia: prov.nombre, zona: prov.zona, costo: op.costo, dias: op.dias },
  };
}

module.exports = { cotizar, precio, calc };
