# EstudIA — Sistema de estudio intensivo con quizzes generados por IA

## Contexto
Plataforma para estudiar bibliografía extensa (leyes, libros, resoluciones ministeriales) de exámenes de
ascenso e institucionalización de maestros en Bolivia. Se cargan PDFs, se fragmentan, la IA genera
preguntas con cita a la fuente, y el estudiante rinde quizzes ilimitados con repetición espaciada.
Fase 1: uso local de un solo usuario (admin). Fase 2: multiusuario en la nube con cuentas asignadas.

Documento de diseño completo: `docs/diseno.md` (requerimientos, arquitectura, modelo, lógica, API, hoja de ruta).
Léelo antes de implementar un hito nuevo.

## Stack
- Monorepo con npm workspaces: `apps/web` (React + Vite + TypeScript + Tailwind + TanStack Query),
  `apps/api` (Node + Express + TypeScript), `packages/shared` (tipos y esquemas Zod compartidos).
- Prisma + PostgreSQL 16 con extensión `pgvector` (imagen Docker `pgvector/pgvector:pg16`).
- Cola de trabajos: `pg-boss` (misma base de datos, sin Redis).
- Auth: JWT + bcrypt. Roles: ADMIN, REVISOR, ESTUDIANTE.
- Local: `docker compose up -d db` levanta `db` (en esta PC Docker corre dentro de WSL Ubuntu: ver README);
  `npm run dev` levanta web (5173, con proxy `/api`) y api (3000).
- Prisma 6.19 (fijado; no subir a 7/8 sin migrar a driver adapters). Tests usan la base `estudia_test`
  (`DATABASE_URL_TEST`), con `prisma migrate deploy` en el setup global y `TRUNCATE` por archivo.
- Despliegue futuro: web en Vercel, api en Google Cloud Run (Docker), Postgres/Storage en Supabase.

## Convenciones
- Todo el dominio en español: modelos, campos, rutas, textos de UI (`Pregunta`, `Contenido`, `/api/v1/quizzes`).
  Código técnico genérico (helpers, utils) puede ir en inglés.
- TypeScript estricto. Validar TODA entrada con Zod (body, query, y el JSON que venga de una IA).
- Esquemas Zod viven en `packages/shared` y los usan api y web.
- Rutas API bajo `/api/v1`. Errores con formato `{ error: { codigo, mensaje, detalles? } }`.
- Estructura api por módulo: `src/modulos/<modulo>/{rutas,servicio,esquemas}.ts`.
- Nunca enviar `Opcion.correcta` ni `porQue` al cliente al iniciar un quiz; solo tras responder (Práctica)
  o al finalizar (Examen).
- Solo preguntas con estado `APROBADA` entran a los quizzes.
- Toda pregunta guarda `citaTextual` y `referencia` (ej. "Ley 070, Art. 5, pág. 4").
- Tests con Vitest + Supertest para cada endpoint nuevo. Correr `npm test` antes de dar un hito por terminado.
- Commits pequeños con mensajes en español: `feat(quiz): ...`, `fix(importador): ...`.

## Contrato JSON de preguntas (importación)
```json
{
  "contenido": "Ley 070",
  "tema": "Título I - Capítulo II",
  "fragmentoRef": "ley070-art05",
  "preguntas": [
    {
      "tipo": "OPCION_MULTIPLE",
      "dificultad": "MEDIA",
      "nivelBloom": "COMPRENDER",
      "enunciado": "...",
      "opciones": [
        { "texto": "...", "correcta": true, "porQue": "..." },
        { "texto": "...", "correcta": false, "porQue": "..." }
      ],
      "explicacion": "...",
      "citaTextual": "...",
      "referencia": "Ley 070, Art. 5, pág. 4",
      "etiquetas": ["fines"]
    }
  ]
}
```
Tipos: OPCION_MULTIPLE, VERDADERO_FALSO, SELECCION_MULTIPLE, COMPLETAR, ORDENAR, CASO.
Dificultad: FACIL, MEDIA, DIFICIL. Bloom: RECORDAR, COMPRENDER, APLICAR, ANALIZAR.
Campos opcionales del lote: `coleccion` (si falta, va a "Sin asignar") y `origen`. `tema` con " - " crea jerarquía
("Título I - Capítulo II" → Título I › Capítulo II). Duplicado = mismo enunciado normalizado en el mismo tema.
Reglas: exactamente 1 correcta en OPCION_MULTIPLE (4 opciones), al menos 1 en SELECCION_MULTIPLE (≥3 opciones),
VERDADERO_FALSO 2 opciones con 1 correcta, CASO 1 correcta, COMPLETAR ≥1 respuesta aceptada, ORDENAR en orden correcto;
`citaTextual` debe aparecer literalmente en el fragmento fuente cuando el fragmento exista.

## Fuentes (ingesta de PDF)
- PDFs originales en `fuentes/<carpeta>/...` (ignorados por git) con `manifiesto.json` (título, tipoFuente, clave).
  `npm run ingestar -- fuentes/<carpeta>` registra, extrae (OCR `spa` si la página no tiene texto), fragmenta y exporta.
  Opciones: `--solo <texto>`, `--reprocesar`, `--sin-ocr`. También se puede subir desde la pantalla Documentos.
- Exportación: `fuentes/<clave>/<ref>.md` + `fuentes/<clave>/_indice.md`. Refs: `<clave>-art05`, `-dt01` (disp.
  transitoria), `-df01`, `-pre` (preámbulo/considerandos), `-reg-art01` (reglamento anexo de una RM), `-b001` (bloque de
  libro), `-art05-2` (parte de un artículo largo). Páginas = número de página del PDF.
- Normativa → un fragmento por artículo con temas Parte/Reglamento › Título › Capítulo › Sección › Subsección.
  Libros/guías → bloques de ~900 palabras con temas por rango de 20 páginas.

## Guías de estudio
- Una por documento en `guias/<clave>.json` (versionadas): `{ clave, resumen, ideasClave[], obligatorio[], opcional[],
  consejos[] }`, cada parte `{ parte: "Arts. 3-5", titulo, porQue }` (esquema `guiaArchivoSchema` en shared).
- Cargar o actualizar: `npm run guias -- guias/` (o un archivo). Se ven en la pestaña Guías (`#/guias`, `#/guias/<id>`),
  con atajo a un quiz solo de ese documento; `#/estudiar/<contenidoId>` abre Estudiar con el documento marcado.
- API: `GET /api/v1/guias`, `GET /api/v1/guias/:contenidoId`, `PUT /api/v1/admin/guias/:contenidoId` (ADMIN).
- Al redactar una guía: basarse en `fuentes/<clave>/_indice.md` (estructura) y en los fragmentos; obligatorio = lo que
  más se pregunta y lo propio del director/a de CEA; opcional = lo de menor peso. Nada inventado.

## Examen objetivo: institucionalización de cargos directivos (Convocatoria Pública 0001/2026)
Según el Reglamento de la Convocatoria 0001/2026 (Arts. 6, 11, 12, 14): examen de competencia escrito de
**100 preguntas en 150 minutos** (~90 s por pregunta), contenido **35% Normativa General y Específica y 65%
Contenidos Técnico-Pedagógicos**, nota mínima **51/100** (Regular, Alternativa y Especial; 61 en Superior); el examen
pondera 65% y los méritos 35%. La bibliografía del usuario (`fuentes/examenDireccion/`) apunta a director/a de
**Educación Alternativa (CEA)**: la normativa específica son RM del VEAE.

## Generar preguntas (cuando el usuario lo pida en esta sesión)
1. Leer `fuentes/<clave>/_indice.md` para ubicar los fragmentos y luego `fuentes/<clave>/<ref>.md`.
2. Política de preguntas (pedido del usuario):
   - Solo `OPCION_MULTIPLE`, **4 opciones, 1 correcta**, `dificultad: "DIFICIL"`; Bloom de preferencia APLICAR/ANALIZAR
     (casos de un director/a de CEA o UE: "¿qué debe hacer?", "¿quién es competente?"), también RECORDAR de datos finos.
   - Rebuscadas pero inequívocas: distractores de confusiones reales — instancia vecina (Distrital vs Departamental vs
     Núcleo), quién designa vs de quién depende, cifras/plazos/fechas/edades de la misma norma, listas con un solo
     elemento cambiado, conceptos de otro autor/meta/artículo, "NO corresponde/EXCEPTO". Sin "todas/ninguna las
     anteriores"; opciones de largo similar. Cada `porQue` explica el error citando artículo/autor.
   - Cantidad proporcional al documento: meta = máx(30, palabras/600) (palabras = suma de la columna del `_indice.md`),
     repartidas entre todos los títulos/bloques, no solo los primeros.
   - Mezcla de estilos por lote: ~30% memorísticas (cifras, plazos, edades, porcentajes, quién/qué instancia, listas
     literales), ~40% situaciones prácticas ("Usted es director/a de un CEA/UE y ocurre X, ¿qué debe hacer?"), ~30%
     rebuscadas y capciosas (EXCEPTO/NO corresponde, opción casi correcta con una palabra cambiada: "solo", "siempre",
     "podrá" vs "deberá", plazo en días hábiles vs calendario, actor intercambiado). La correcta debe seguir siendo inequívoca.
   - Nada inventado fuera del fragmento. `citaTextual` copiada literal del texto; `referencia` con artículo/sección
     y página del encabezado.
3. Lote mínimo: basta `{ "fragmentoRef": "...", "preguntas": [...] }` (contenido y tema salen del fragmento). Un archivo
   puede ser un arreglo de lotes. Guardar en `importar/<clave>-<tema o ref>-<fecha>.json`.
4. Ejecutar `npm run importar -- <archivo>` (desde la raíz) y reportar cuántas se importaron, rechazaron o quedaron
   como duplicadas. Quedan en BORRADOR: el usuario las aprueba en la bandeja (solo APROBADAS entran a los quizzes,
   y solo de tipo OPCION_MULTIPLE).

## Hoja de ruta (marcar al completar)
- [x] Hito 0 — Base: monorepo, Docker (pgvector), Prisma con esquema núcleo, seed de admin, login
- [x] Hito 1 — Banco e importador: CRUD Colección/Contenido/Tema, importador JSON con Zod, bandeja de revisión
- [x] Hito 2 — Quiz mínimo: crear quiz por filtros y cantidad (10/20/50/100), modo Práctica, resumen, XP
- [x] Hito 3 — Ingesta PDF: extracción por página, OCR, fragmentación por artículos, exportar a `fuentes/`
- [ ] Hito 4 — Repetición espaciada con confianza, repaso del día, cuaderno de errores, dominio por tema
- [ ] Hito 5 — Embeddings, deduplicación, validador automático, estadísticas de preguntas
- [ ] Hito 6 — Servidor MCP (listar_fragmentos, guardar_preguntas, ver_estadisticas)
- [ ] Hito 7 — Multiusuario, asignaciones, reportes, despliegue
- [ ] Hito 8 — Modos Examen y Simulacro, PWA offline, generación por API desde el panel
