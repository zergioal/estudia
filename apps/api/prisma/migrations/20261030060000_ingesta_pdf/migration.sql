-- AlterTable
ALTER TABLE "Contenido" ADD COLUMN     "clave" TEXT;

-- AlterTable
ALTER TABLE "Documento" ADD COLUMN     "error" TEXT,
ADD COLUMN     "modo" TEXT,
ADD COLUMN     "nombreArchivo" TEXT NOT NULL,
ADD COLUMN     "paginasOcr" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "procesadoEn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Fragmento" ADD COLUMN     "orden" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "palabras" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Pagina" (
    "id" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "ocr" BOOLEAN NOT NULL DEFAULT false,
    "confianza" DOUBLE PRECISION,

    CONSTRAINT "Pagina_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pagina_documentoId_numero_key" ON "Pagina"("documentoId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Contenido_clave_key" ON "Contenido"("clave");

-- CreateIndex
CREATE INDEX "Documento_contenidoId_idx" ON "Documento"("contenidoId");

-- CreateIndex
CREATE INDEX "Fragmento_documentoId_orden_idx" ON "Fragmento"("documentoId", "orden");

-- CreateIndex
CREATE INDEX "Fragmento_temaId_idx" ON "Fragmento"("temaId");

-- AddForeignKey
ALTER TABLE "Pagina" ADD CONSTRAINT "Pagina_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

