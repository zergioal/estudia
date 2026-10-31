-- AlterTable
ALTER TABLE "Respuesta" ADD COLUMN     "ordenOpciones" TEXT[],
ADD COLUMN     "respondidaEn" TIMESTAMP(3),
ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Intento_usuarioId_iniciadoEn_idx" ON "Intento"("usuarioId", "iniciadoEn");

