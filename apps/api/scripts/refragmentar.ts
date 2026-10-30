/**
 * Rehace los cortes de los documentos ya extraídos (sin OCR) y vuelve a exportar fuentes/.
 * Útil después de mejorar el fragmentador. Las preguntas se re-enlazan por fragmentoRef.
 *
 * Uso: npm run refragmentar            (todos)
 *      npm run refragmentar -- ley070  (solo los contenidos con esa clave)
 */
import { prisma } from '../src/db';
import { exportarContenido } from '../src/modulos/ingesta/exportar';
import { fragmentarDocumento } from '../src/modulos/ingesta/servicio';

async function main() {
  const claves = process.argv.slice(2);
  const docs = await prisma.documento.findMany({
    where: { estado: { in: ['EXTRAIDO', 'FRAGMENTADO'] }, ...(claves.length && { contenido: { clave: { in: claves } } }) },
    include: { contenido: { select: { id: true, clave: true } } },
    orderBy: { creadoEn: 'asc' },
  });
  const contenidos = new Set<string>();
  for (const d of docs) {
    const r = await fragmentarDocumento(d.id);
    contenidos.add(d.contenido.id);
    console.log(`✔ ${d.contenido.clave}: ${r.fragmentos} fragmentos (${r.modo})`);
  }
  for (const id of contenidos) await exportarContenido(id);
  console.log(`\n${docs.length} documentos re-fragmentados y exportados.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
