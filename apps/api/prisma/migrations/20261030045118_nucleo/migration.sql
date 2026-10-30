-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMIN', 'REVISOR', 'ESTUDIANTE');

-- CreateEnum
CREATE TYPE "Dificultad" AS ENUM ('FACIL', 'MEDIA', 'DIFICIL');

-- CreateEnum
CREATE TYPE "TipoPregunta" AS ENUM ('OPCION_MULTIPLE', 'VERDADERO_FALSO', 'SELECCION_MULTIPLE', 'COMPLETAR', 'ORDENAR', 'CASO');

-- CreateEnum
CREATE TYPE "EstadoPregunta" AS ENUM ('BORRADOR', 'VALIDADA', 'APROBADA', 'DESCARTADA', 'DUPLICADA', 'EN_REVISION');

-- CreateEnum
CREATE TYPE "ModoQuiz" AS ENUM ('PRACTICA', 'EXAMEN', 'REPASO_ERRORES', 'SIMULACRO', 'REPASO_DIARIO');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'ESTUDIANTE',
    "xpTotal" INTEGER NOT NULL DEFAULT 0,
    "rachaDias" INTEGER NOT NULL DEFAULT 0,
    "ultimoEstudio" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coleccion" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coleccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contenido" (
    "id" TEXT NOT NULL,
    "coleccionId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipoFuente" TEXT NOT NULL,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contenido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tema" (
    "id" TEXT NOT NULL,
    "contenidoId" TEXT NOT NULL,
    "padreId" TEXT,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Tema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "id" TEXT NOT NULL,
    "contenidoId" TEXT NOT NULL,
    "archivoUrl" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "paginas" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fragmento" (
    "id" TEXT NOT NULL,
    "ref" TEXT,
    "documentoId" TEXT NOT NULL,
    "temaId" TEXT,
    "etiqueta" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "paginaDesde" INTEGER NOT NULL,
    "paginaHasta" INTEGER NOT NULL,
    "embedding" vector(1024),

    CONSTRAINT "Fragmento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pregunta" (
    "id" TEXT NOT NULL,
    "temaId" TEXT NOT NULL,
    "fragmentoId" TEXT,
    "fragmentoRef" TEXT,
    "tipo" "TipoPregunta" NOT NULL,
    "dificultad" "Dificultad" NOT NULL,
    "nivelBloom" TEXT NOT NULL,
    "enunciado" TEXT NOT NULL,
    "explicacion" TEXT NOT NULL,
    "citaTextual" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "etiquetas" TEXT[],
    "estado" "EstadoPregunta" NOT NULL DEFAULT 'BORRADOR',
    "origen" TEXT NOT NULL,
    "trabajoId" TEXT,
    "vecesRespondida" INTEGER NOT NULL DEFAULT 0,
    "vecesAcertada" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(1024),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pregunta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opcion" (
    "id" TEXT NOT NULL,
    "preguntaId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "correcta" BOOLEAN NOT NULL,
    "porQue" TEXT,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "Opcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intento" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "modo" "ModoQuiz" NOT NULL,
    "filtros" JSONB NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "puntaje" INTEGER NOT NULL DEFAULT 0,
    "aciertos" INTEGER NOT NULL DEFAULT 0,
    "iniciadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEn" TIMESTAMP(3),

    CONSTRAINT "Intento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Respuesta" (
    "id" TEXT NOT NULL,
    "intentoId" TEXT NOT NULL,
    "preguntaId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "opcionesElegidas" TEXT[],
    "correcta" BOOLEAN,
    "segundos" INTEGER,
    "confianza" INTEGER,

    CONSTRAINT "Respuesta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstadoEstudio" (
    "usuarioId" TEXT NOT NULL,
    "preguntaId" TEXT NOT NULL,
    "aciertos" INTEGER NOT NULL DEFAULT 0,
    "fallos" INTEGER NOT NULL DEFAULT 0,
    "facilidad" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervaloDias" INTEGER NOT NULL DEFAULT 0,
    "proximaRevision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaRespuesta" TIMESTAMP(3),

    CONSTRAINT "EstadoEstudio_pkey" PRIMARY KEY ("usuarioId","preguntaId")
);

-- CreateTable
CREATE TABLE "Asignacion" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "coleccionId" TEXT NOT NULL,
    "venceEn" TIMESTAMP(3),

    CONSTRAINT "Asignacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_usuario_key" ON "Usuario"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "Coleccion_nombre_key" ON "Coleccion"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Contenido_titulo_key" ON "Contenido"("titulo");

-- CreateIndex
CREATE INDEX "Contenido_coleccionId_idx" ON "Contenido"("coleccionId");

-- CreateIndex
CREATE INDEX "Tema_contenidoId_padreId_idx" ON "Tema"("contenidoId", "padreId");

-- CreateIndex
CREATE UNIQUE INDEX "Documento_hash_key" ON "Documento"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "Fragmento_ref_key" ON "Fragmento"("ref");

-- CreateIndex
CREATE INDEX "Pregunta_temaId_estado_dificultad_idx" ON "Pregunta"("temaId", "estado", "dificultad");

-- CreateIndex
CREATE INDEX "Pregunta_estado_idx" ON "Pregunta"("estado");

-- CreateIndex
CREATE INDEX "Opcion_preguntaId_idx" ON "Opcion"("preguntaId");

-- CreateIndex
CREATE UNIQUE INDEX "Respuesta_intentoId_preguntaId_key" ON "Respuesta"("intentoId", "preguntaId");

-- CreateIndex
CREATE INDEX "EstadoEstudio_usuarioId_proximaRevision_idx" ON "EstadoEstudio"("usuarioId", "proximaRevision");

-- AddForeignKey
ALTER TABLE "Contenido" ADD CONSTRAINT "Contenido_coleccionId_fkey" FOREIGN KEY ("coleccionId") REFERENCES "Coleccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tema" ADD CONSTRAINT "Tema_contenidoId_fkey" FOREIGN KEY ("contenidoId") REFERENCES "Contenido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tema" ADD CONSTRAINT "Tema_padreId_fkey" FOREIGN KEY ("padreId") REFERENCES "Tema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_contenidoId_fkey" FOREIGN KEY ("contenidoId") REFERENCES "Contenido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fragmento" ADD CONSTRAINT "Fragmento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fragmento" ADD CONSTRAINT "Fragmento_temaId_fkey" FOREIGN KEY ("temaId") REFERENCES "Tema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_temaId_fkey" FOREIGN KEY ("temaId") REFERENCES "Tema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_fragmentoId_fkey" FOREIGN KEY ("fragmentoId") REFERENCES "Fragmento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opcion" ADD CONSTRAINT "Opcion_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intento" ADD CONSTRAINT "Intento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Respuesta" ADD CONSTRAINT "Respuesta_intentoId_fkey" FOREIGN KEY ("intentoId") REFERENCES "Intento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Respuesta" ADD CONSTRAINT "Respuesta_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstadoEstudio" ADD CONSTRAINT "EstadoEstudio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstadoEstudio" ADD CONSTRAINT "EstadoEstudio_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asignacion" ADD CONSTRAINT "Asignacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asignacion" ADD CONSTRAINT "Asignacion_coleccionId_fkey" FOREIGN KEY ("coleccionId") REFERENCES "Coleccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
