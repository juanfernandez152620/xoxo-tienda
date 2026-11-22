'use strict';
/* Un PDF simple sin dependencias: una hoja A4 con textos (Helvetica y Helvetica-Bold), líneas y rectángulos.
 * Lo usa el comprobante de compra (nucleo/comprobante.js). Los textos van en WinAnsi, que tiene las letras del
 * castellano (á, é, ñ, ü, ¿, ¡); lo que no entra (emojis, por ejemplo) se cambia por "?".
 *
 *   const buf = pdf.hoja({ titulo: 'Comprobante' }, d => { d.texto(48, 800, 'Hola', { size: 14, bold: true }); });
 */

const A4 = { ancho: 595.28, alto: 841.89 };
// Letras de WinAnsi que no están en el mismo lugar que en Unicode
const WIN = { '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153, '−': 45 };
function codificar(t) {
  let out = '';
  for (const ch of String(t ?? '')) {
    let c = WIN[ch] || ch.codePointAt(0);
    if (!WIN[ch] && (c > 255 || (c >= 128 && c < 160))) c = 63;
    if (c < 32) c = 32;
    const s = String.fromCharCode(c);
    out += s === '(' || s === ')' || s === '\\' ? `\\${s}` : s;
  }
  return out;
}

// Anchos de Helvetica (en milésimas del tamaño): para alinear a la derecha y cortar renglones
const ANCHOS = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278,
  '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, '×': 584, '·': 278, '−': 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667,
  Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556,
  q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};
const ancho = (t, size, bold = false) => [...String(t ?? '')].reduce((s, ch) => {
  const base = ch.normalize('NFD')[0];
  const w = /\d/.test(base) ? 556 : ANCHOS[base] ?? ANCHOS[ch] ?? 556;
  return s + w * (bold && /[a-z]/i.test(base) ? 1.06 : 1);
}, 0) * size / 1000;

// Un color '#2b4966' → '0.169 0.286 0.400'
const rgb = hex => {
  const h = String(hex || '#000000').replace('#', '');
  return [0, 2, 4].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
};

function hoja({ titulo = '', autor = '' } = {}, dibujar) {
  const ops = [];
  const d = {
    ancho: A4.ancho,
    alto: A4.alto,
    medir: (t, size = 10, bold = false) => ancho(t, size, bold),
    texto(x, y, t, { size = 10, bold = false, color = '#000000', align = 'left' } = {}) {
      const w = align === 'left' ? 0 : ancho(t, size, bold);
      const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${x0.toFixed(2)} ${y.toFixed(2)} Td (${codificar(t)}) Tj ET`);
    },
    // Corta un texto en renglones que entran en "max" puntos; devuelve los renglones
    cortar(t, max, size = 10, bold = false) {
      const renglones = [];
      let linea = '';
      for (const palabra of String(t ?? '').split(/\s+/).filter(Boolean)) {
        const prueba = linea ? `${linea} ${palabra}` : palabra;
        if (ancho(prueba, size, bold) <= max || !linea) linea = prueba;
        else { renglones.push(linea); linea = palabra; }
      }
      if (linea) renglones.push(linea);
      return renglones.length ? renglones : [''];
    },
    rect(x, y, w, h, color) { ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); },
    linea(x1, y1, x2, y2, color = '#d9d4c7', grosor = 0.8) {
      ops.push(`${rgb(color)} RG ${grosor} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    },
  };
  dibujar(d);

  const contenido = ops.join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.ancho} ${A4.alto}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${codificar(titulo)}) /Author (${codificar(autor)}) /Producer (${codificar(autor)}) >>`,
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { hoja };
