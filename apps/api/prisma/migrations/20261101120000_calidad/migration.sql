-- Embeddings locales de 384 dimensiones (multilingual-e5-small). Las columnas estaban vacías.
ALTER TABLE "Fragmento" DROP COLUMN "embedding";
ALTER TABLE "Fragmento" ADD COLUMN "embedding" vector(384);
ALTER TABLE "Pregunta" DROP COLUMN "embedding";
ALTER TABLE "Pregunta" ADD COLUMN "embedding" vector(384);

-- Validador y deduplicación
ALTER TABLE "Pregunta" ADD COLUMN "alertas" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Pregunta" ADD COLUMN "validadoEn" TIMESTAMP(3);
ALTER TABLE "Pregunta" ADD COLUMN "ciega" JSONB;
ALTER TABLE "Pregunta" ADD COLUMN "duplicadaDeId" TEXT;
ALTER TABLE "Pregunta" ADD COLUMN "similitud" DOUBLE PRECISION;
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_duplicadaDeId_fkey" FOREIGN KEY ("duplicadaDeId") REFERENCES "Pregunta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Pregunta_embedding_idx" ON "Pregunta" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "Fragmento_embedding_idx" ON "Fragmento" USING hnsw ("embedding" vector_cosine_ops);

-- Reportes de estudiantes
CREATE TABLE "Reporte" (
    "id" TEXT NOT NULL,
    "preguntaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "comentario" TEXT,
    "resuelto" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoEn" TIMESTAMP(3),
    CONSTRAINT "Reporte_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Reporte_resuelto_creadoEn_idx" ON "Reporte"("resuelto", "creadoEn");
CREATE INDEX "Reporte_preguntaId_idx" ON "Reporte"("preguntaId");
ALTER TABLE "Reporte" ADD CONSTRAINT "Reporte_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reporte" ADD CONSTRAINT "Reporte_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
