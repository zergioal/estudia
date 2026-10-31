-- CreateTable
CREATE TABLE "GuiaEstudio" (
    "id" TEXT NOT NULL,
    "contenidoId" TEXT NOT NULL,
    "resumen" TEXT NOT NULL,
    "ideasClave" TEXT[],
    "obligatorio" JSONB NOT NULL,
    "opcional" JSONB NOT NULL,
    "consejos" TEXT[],
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuiaEstudio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuiaEstudio_contenidoId_key" ON "GuiaEstudio"("contenidoId");

-- AddForeignKey
ALTER TABLE "GuiaEstudio" ADD CONSTRAINT "GuiaEstudio_contenidoId_fkey" FOREIGN KEY ("contenidoId") REFERENCES "Contenido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
