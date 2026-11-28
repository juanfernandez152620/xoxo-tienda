'use strict';
/* Comprobante de compra en PDF (22/11/2026): lo descarga el cliente después de pagar, desde el mail, desde la
 * página /seguimiento y desde "Mis compras". Tiene el código de compra para mostrar en la sucursal.
 * No es una factura (la factura electrónica de AFIP es otro trámite). */

const { BASE_URL } = require('./entorno');
const sitio = require('./sitio');
const pdf = require('./pdf');

const AZUL = '#2b4966';
const CREMA = '#f6efe1';
const GRIS = '#5b6676';
const money = n => `$${new Intl.NumberFormat('es-AR').format(Math.round(n))}`;
const fechaHora = iso => {
  const d = new Date(iso);
  const dos = n => String(n).padStart(2, '0');
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
};
const MEDIOS = { mercadopago: 'Mercado Pago', gocuotas: 'GO cuotas' };
const PASOS = { preparando: 'Preparando', despachado: 'Despachado', listo: 'Listo para retirar', entregado: 'Entregado', cancelado: 'Cancelado' };
const EMPRESAS = { andreani: 'Andreani', correo: 'Correo Argentino', otra: '' };

function comprobante(o) {
  const site = sitio.cargar();
  const tienda = site.store.name;
  const host = BASE_URL.replace(/^https?:\/\//, '');
  const items = o.items || [{ name: o.product.name, n: 1, price: o.productAmount ?? o.amount }];
  const seg = o.seguimiento || {};
  const retiro = !o.envio || o.envio.tipo === 'retiro';
  const suc = site.store.branches.find(b => b.id === (o.envio && o.envio.sucursal)) || null;
  const dias = site.story && site.story.warrantyDays;

  return pdf.hoja({ titulo: `Comprobante de compra #${o.ref} · ${tienda}`, autor: tienda }, d => {
    const M = 48;
    const R = d.ancho - M;
    let y;

    // Encabezado: la marca y el código de la compra
    d.rect(0, d.alto - 104, d.ancho, 104, AZUL);
    d.texto(M, d.alto - 52, 'XOXO TECNO', { size: 24, bold: true, color: '#ffffff' });
    d.texto(M, d.alto - 74, 'Comprobante de compra', { size: 12, color: CREMA });
    d.texto(R, d.alto - 50, `Pedido #${o.ref}`, { size: 20, bold: true, color: '#ffffff', align: 'right' });
    d.texto(R, d.alto - 72, fechaHora(o.paidAt || o.createdAt), { size: 11, color: CREMA, align: 'right' });
    y = d.alto - 136;

    if (o.gateway && o.gateway.demo) {
      d.rect(M, y - 8, R - M, 24, '#fff3c4');
      d.texto(M + 10, y, 'PRUEBA: pago simulado, no se cobró nada.', { size: 10, bold: true, color: '#7a5b00' });
      y -= 34;
    }

    // Comprador y pago, en dos columnas
    const col = M + (R - M) / 2 + 10;
    const titulo = (x, yy, t) => d.texto(x, yy, t.toUpperCase(), { size: 9, bold: true, color: GRIS });
    titulo(M, y, 'Comprador');
    titulo(col, y, 'Pago');
    const b = o.buyer;
    const izq = [b.name, b.email, `Tel. ${b.phone}`, b.dni ? `DNI ${b.dni}` : ''].filter(Boolean);
    const cuotas = o.method === 'gocuotas' ? `${o.plan} cuotas con tarjeta de débito`
      : o.gateway && o.gateway.installments ? `${o.gateway.installments} ${o.gateway.installments === 1 ? 'pago' : 'cuotas'} con Mercado Pago`
      : '';
    const der = [
      MEDIOS[o.method] || o.method,
      cuotas,
      o.gateway && (o.gateway.paymentId || o.gateway.gcOrderId) ? `Operación ${o.gateway.paymentId || o.gateway.gcOrderId}` : '',
      o.status === 'approved' ? `Pagado el ${fechaHora(o.paidAt || o.createdAt)}` : 'Pago pendiente',
    ].filter(Boolean);
    izq.forEach((t, i) => d.texto(M, y - 18 - i * 15, t, { size: 11, bold: i === 0, color: '#242424' }));
    der.forEach((t, i) => d.texto(col, y - 18 - i * 15, t, { size: 11, bold: i === 0, color: '#242424' }));
    y -= 18 + Math.max(izq.length, der.length) * 15 + 20;

    // Productos
    d.linea(M, y + 8, R, y + 8, AZUL, 1.2);
    titulo(M, y - 6, 'Cant.');
    titulo(M + 44, y - 6, 'Producto');
    titulo(R, y - 6, '');
    d.texto(R, y - 6, 'IMPORTE', { size: 9, bold: true, color: GRIS, align: 'right' });
    y -= 26;
    for (const it of items) {
      const renglones = d.cortar(it.name, R - M - 44 - 110, 11);
      d.texto(M, y, String(it.n), { size: 11, color: '#242424' });
      renglones.forEach((t, i) => d.texto(M + 44, y - i * 14, t, { size: 11, color: '#242424' }));
      if (it.n > 1) d.texto(M + 44, y - renglones.length * 14, `${it.n} × ${money(it.price)}`, { size: 9, color: GRIS });
      d.texto(R, y, money(it.price * it.n), { size: 11, color: '#242424', align: 'right' });
      y -= renglones.length * 14 + (it.n > 1 ? 12 : 0) + 8;
    }
    d.linea(M, y + 6, R, y + 6);
    y -= 10;
    const fila = (a, b2, { bold = false, size = 11, color = '#242424' } = {}) => {
      d.texto(M + 44, y, a, { size, bold, color });
      d.texto(R, y, b2, { size, bold, color, align: 'right' });
      y -= size + 8;
    };
    const subtotal = items.reduce((s, it) => s + it.price * it.n, 0);
    fila('Subtotal', money(subtotal));
    if (o.discount) fila(o.discount.bienvenida ? 'Regalo de bienvenida (primera compra)' : `Código ${o.discount.code} (${o.discount.percent}% de descuento)`, `-${money(o.discount.amount)}`, { color: '#15803d' });
    if (o.coupon && !(o.discount && !o.discount.bienvenida)) fila(`Descuento flash (código ${o.coupon})`, 'incluido', { color: '#15803d' });
    fila(o.envio ? o.envio.nombre : 'Entrega', o.envio && o.envio.costo ? money(o.envio.costo) : o.envio && o.envio.tipo === 'coordinar' ? 'A coordinar' : 'Gratis');
    y -= 14;
    d.rect(M, y - 10, R - M, 30, CREMA);
    d.texto(M + 12, y, 'TOTAL PAGADO', { size: 12, bold: true, color: AZUL });
    d.texto(R - 12, y, money(o.amount), { size: 16, bold: true, color: AZUL, align: 'right' });
    y -= 50;

    // Entrega y estado
    titulo(M, y, 'Entrega');
    y -= 18;
    if (retiro) {
      d.texto(M, y, `Retiro en la sucursal ${suc ? suc.name : ''}`, { size: 11, bold: true, color: '#242424' });
      if (suc && suc.address) { y -= 15; d.texto(M, y, suc.address, { size: 11, color: '#242424' }); }
      if (suc && suc.hours) { y -= 15; d.texto(M, y, suc.hours, { size: 11, color: GRIS }); }
      y -= 15;
      d.texto(M, y, `Llevá este comprobante (o el código #${o.ref}) y tu DNI.`, { size: 11, color: GRIS });
    } else {
      const dir = o.delivery || {};
      d.texto(M, y, o.envio.nombre, { size: 11, bold: true, color: '#242424' });
      y -= 15;
      d.texto(M, y, [dir.address, dir.city, o.envio.provincia || dir.province, dir.cp && `CP ${dir.cp}`].filter(Boolean).join(', '), { size: 11, color: '#242424' });
      if (o.envio.tipo === 'coordinar' && !seg.numero) { y -= 15; d.texto(M, y, 'Te escribimos por WhatsApp para coordinar el envío.', { size: 11, color: GRIS }); }
      if (seg.numero) { y -= 15; d.texto(M, y, `Número de seguimiento ${EMPRESAS[seg.empresa] || ''}: ${seg.numero}`.replace('  ', ' '), { size: 11, bold: true, color: '#242424' }); }
    }
    if (seg.estado) { y -= 15; d.texto(M, y, `Estado: ${PASOS[seg.estado] || seg.estado}`, { size: 11, color: GRIS }); }
    y -= 34;

    // Cómo seguirlo
    d.rect(M, y - 34, R - M, 52, '#eef3f8');
    d.texto(M + 12, y, `Seguí tu pedido en ${host}/seguimiento`, { size: 11, bold: true, color: AZUL });
    d.texto(M + 12, y - 16, `con el código #${o.ref} y el email de la compra.`, { size: 11, color: AZUL });
    y -= 64;
    if (dias) { d.texto(M, y, `Tu compra tiene ${dias} días de garantía. Si algo no anda, escribinos.`, { size: 10, color: GRIS }); y -= 15; }

    // Pie
    d.linea(M, 70, R, 70);
    d.texto(M, 54, `${tienda} · ${host}`, { size: 9, bold: true, color: GRIS });
    d.texto(M, 40, 'Comprobante de compra. No válido como factura.', { size: 9, color: GRIS });
  });
}

module.exports = { comprobante };
