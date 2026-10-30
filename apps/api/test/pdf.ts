/** Genera un PDF mínimo con una línea de texto por elemento (Helvetica, WinAnsi). Solo para tests. */
export function pdfDeTexto(paginas: string[][]): Buffer {
  const escapar = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objetos: string[] = [];
  const nPaginas = paginas.length;
  // 1 catálogo, 2 árbol de páginas, 3 fuente, luego (página, contenido) por cada página.
  objetos.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = paginas.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objetos.push(`<< /Type /Pages /Kids [${kids}] /Count ${nPaginas} >>`);
  objetos.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  for (const [i, lineas] of paginas.entries()) {
    const flujo = ['BT', '/F1 10 Tf', '14 TL', '40 800 Td', ...lineas.map((l) => `(${escapar(l)}) Tj T*`), 'ET'].join('\n');
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objetos.push(`<< /Length ${Buffer.byteLength(flujo, 'latin1')} >>\nstream\n${flujo}\nendstream`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
