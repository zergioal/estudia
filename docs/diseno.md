# EstudIA — Sistema de estudio intensivo con quizzes generados por IA

Oct 30, 2026 · @Sergio Alcocer

## Visión y alcance

EstudIA convierte bibliografía extensa (leyes, libros, resoluciones ministeriales) en un banco de miles de preguntas trazables a su fuente, y entrena al usuario con quizzes ilimitados y repaso inteligente de sus errores. El nombre es provisional.

**Problema.** En exámenes de ascenso de categoría o de institucionalización de cargos, la bibliografía supera fácilmente las 2.000 páginas. Leerla no basta: hace falta practicar recuperación activa sobre todo el temario, saber qué temas aún no se dominan y repasar justo antes de olvidar.

**Usuarios.**

- **Administrador/autor (tú):** carga fuentes, genera y revisa preguntas, publica contenidos, crea cuentas.
- **Estudiante:** elige contenidos, rinde quizzes, revisa su feedback y progreso.
- **Revisor (fase 2, opcional):** colega que valida preguntas antes de publicarlas.

**Fases.**

1. **Fase 1 — Local, un usuario.** Tú cargas PDFs, generas preguntas con IA, estudias. Corre en tu PC con Docker o `npm run dev`.
2. **Fase 2 — Multiusuario en la nube.** Cuentas asignadas por ti, panel por estudiante, ranking.
3. **Fase 3 — Producto.** Planes de pago, instituciones (como EduSync, multi-tenant), app móvil/PWA offline.

**Fuera de alcance en fase 1:** pagos, chat en vivo, preguntas de desarrollo con corrección por IA (se dejan para fase 3).

## Requerimientos

El sistema tiene 6 módulos funcionales; los marcados F1 entran en la primera versión local.

### Funcionales

| ID | Módulo | Requerimiento | Fase |
| --- | --- | --- | --- |
| RF-01 | Contenidos | Organizar el material en Convocatoria/Colección → Contenido (ej. "Ley 070") → Tema/Capítulo → Fragmento | F1 |
| RF-02 | Ingesta | Cargar PDF, DOCX, TXT o texto pegado; extraer texto, detectar artículos/capítulos y dividir en fragmentos con número de página | F1 |
| RF-03 | Ingesta | OCR para PDFs escaneados (resoluciones antiguas) | F1 |
| RF-04 | Generación IA | Generar N preguntas por fragmento o tema, con dificultad (fácil/media/difícil), tipo, respuesta correcta, distractores, explicación y cita textual de la fuente | F1 |
| RF-05 | Generación IA | Importar lotes de preguntas en JSON generados fuera del sistema (Claude Code en VS Code o este chat) | F1 |
| RF-06 | Curación | Bandeja de revisión: aprobar, editar, descartar; detección de duplicados por similitud | F1 |
| RF-07 | Quiz | Elegir uno o varios contenidos/temas, dificultad y cantidad (10, 20, 50, 100); preguntas aleatorias sin repetir dentro del intento | F1 |
| RF-08 | Quiz | Modos: Práctica (feedback inmediato), Examen (cronometrado, feedback al final), Repaso de errores, Simulacro oficial | F1 |
| RF-09 | Feedback | Por cada pregunta fallada: respuesta correcta, explicación, cita del artículo/página y enlace al fragmento original | F1 |
| RF-10 | Puntaje | Puntaje acumulado ilimitado, XP por dificultad, rachas diarias, historial de intentos | F1 |
| RF-11 | Progreso | Dominio (%) por contenido y tema; mapa de calor de temas débiles | F1 |
| RF-12 | Repaso | Repetición espaciada: cola diaria de preguntas a repasar según desempeño | F1 |
| RF-13 | Reportes | El estudiante puede reportar una pregunta errónea o ambigua | F2 |
| RF-14 | Usuarios | Admin crea cuentas (usuario/contraseña), asigna contenidos y fecha de vencimiento | F2 |
| RF-15 | Usuarios | Roles: admin, revisor, estudiante | F2 |
| RF-16 | Social | Ranking por contenido y semanal (opcional, desactivable) | F2 |
| RF-17 | Exportar | Exportar banco a PDF/Word para estudio impreso o a CSV/JSON | F2 |

### No funcionales

| ID | Atributo | Requerimiento |
| --- | --- | --- |
| RNF-01 | Escalabilidad | Soportar al menos 50.000 preguntas y 200 usuarios concurrentes sin rediseño |
| RNF-02 | Rendimiento | Armar un quiz de 100 preguntas en menos de 1 s |
| RNF-03 | Trazabilidad | Toda pregunta guarda fuente, página/artículo, modelo y versión del prompt que la generó |
| RNF-04 | Calidad | Ninguna pregunta llega a estudiantes sin estado "aprobada" (o validación automática superada) |
| RNF-05 | Seguridad | Contraseñas con bcrypt/argon2, JWT o sesión, rate limiting; las respuestas correctas nunca viajan al cliente antes de responder en modo Examen |
| RNF-06 | Costo | Generación por lotes con caché de prompts; meta de costo por cada 1.000 preguntas medible en el panel |
| RNF-07 | Usabilidad | Mobile-first: la mayoría estudiará desde el celular |
| RNF-08 | Portabilidad | Fase 1 corre en local con Docker; fase 2 se despliega sin reescribir |
| RNF-09 | Legal | Leyes y resoluciones son públicas; libros con derechos de autor solo para uso del titular de la cuenta, nunca se muestran íntegros a terceros |

## Arquitectura

Recomiendo un monolito modular con el mismo stack de EduSync (React + Express + Prisma + PostgreSQL), más una cola de trabajos para la generación con IA y `pgvector` para detectar duplicados y buscar en las fuentes. Así reutilizas lo que ya dominas y despliegas igual (Vercel + Cloud Run + Supabase).

&#91;embedded content: arquitectura de EstudIA · 3 clientes, 1 API, cola de IA\]

Los clientes solo hablan con la API; extraer, fragmentar, generar y validar corren en la cola, que es la única pieza que llama a la Claude API.

### Stack

| Capa | Tecnología | Por qué |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript, Tailwind, TanStack Query, PWA | Mobile-first y uso offline del repaso |
| Backend | Node.js + Express + TypeScript, Zod para validar | Igual que EduSync; Zod valida también el JSON que devuelve la IA |
| ORM / BD | Prisma + PostgreSQL (Supabase) con extensión `pgvector` | Relacional para el banco, vectorial para similitud |
| Cola de trabajos | `pg-boss` (usa la misma Postgres) | Sin Redis extra; reintentos y lotes largos |
| Archivos | Supabase Storage (local: carpeta `storage/`) | PDFs originales y páginas |
| Extracción | `pdfjs-dist` / `pdf-parse`; Tesseract (`spa`) para escaneados | Texto con número de página |
| IA | Claude API (generación y validación) + modelo de embeddings | Ver rutas de generación abajo |
| Auth | JWT + bcrypt (fase 1 simple), Supabase Auth opcional en fase 2 | Cuentas creadas por el admin |
| Local | Docker Compose: `web`, `api`, `db` | Mismo entorno en tu PC y en la nube |

### Pipeline de contenido

1. **Carga:** subes el PDF y lo asignas a un Contenido (ej. "Ley 070 Avelino Siñani – Elizardo Pérez").
2. **Extracción:** texto por página; OCR si la página no tiene texto.
3. **Fragmentación:** cortes por estructura (Título, Capítulo, Artículo) con respaldo de \~800–1.200 palabras; cada fragmento guarda páginas y etiqueta ("Art. 5").
4. **Embeddings:** cada fragmento se vectoriza para búsqueda y deduplicación.
5. **Generación:** por cada fragmento, la IA produce preguntas en JSON estricto con cita textual.
6. **Validación automática:** Zod (forma), comprobación de que la cita existe en el fragmento, y un segundo pase de IA que resuelve la pregunta "a ciegas" y marca ambigüedad o más de una respuesta correcta.
7. **Deduplicación:** similitud de coseno > 0,92 con preguntas existentes → se marca como duplicada.
8. **Revisión humana:** bandeja con aprobar / editar / descartar (puedes aprobar en bloque las que pasaron validación).
9. **Publicación:** solo preguntas `APROBADA` entran a los quizzes.

### Rutas para generar preguntas con IA

Las cuatro rutas terminan en el mismo formato JSON y el mismo endpoint de importación, así puedes combinarlas.

| Ruta | Cómo funciona | Costo | Mejor para |
| --- | --- | --- | --- |
| A. Claude Code en VS Code | El repo tiene `fuentes/` con los fragmentos en .md y una skill/comando `/generar-preguntas` que lee un tema, escribe `importar/*.json` y ejecuta `npm run import` | Tu suscripción de Claude | Fase 1: miles de preguntas sin programar la integración |
| B. Servidor MCP propio | EstudIA expone herramientas MCP (`listar_fragmentos`, `guardar_preguntas`, `ver_estadisticas`); desde este chat o Claude Code me pides "genera 50 preguntas difíciles del Capítulo III" y las guardo directo en tu banco | Tu suscripción | Fase 1–2: generar conversando, sin copiar y pegar |
| C. API integrada | Botón "Generar" en el panel admin; la cola envía lotes a la Claude API usando procesamiento por lotes y caché de prompts | Pago por uso | Fase 2–3: otros autores generan solos |
| D. Chat manual | Pegas un fragmento aquí, pides el JSON y lo importas | Suscripción | Pruebas rápidas |

Recomendación: empezar con A + importador, sumar B en cuanto el banco pase de unas cientos de preguntas, y C solo cuando otros usuarios necesiten generar.

### Formato de pregunta (contrato JSON)

```json
{
  "fragmentoId": "ley070-art05",
  "tipo": "OPCION_MULTIPLE",
  "dificultad": "MEDIA",
  "nivelBloom": "COMPRENDER",
  "enunciado": "Según la Ley 070, ¿cuál es uno de los objetivos de la educación?",
  "opciones": [
    {"texto": "...", "correcta": true,  "porQue": "..."},
    {"texto": "...", "correcta": false, "porQue": "Confunde con el Art. 4"}
  ],
  "explicacion": "...",
  "citaTextual": "...",
  "referencia": "Ley 070, Art. 5, pág. 4",
  "etiquetas": ["fines", "objetivos"]
}
```

El campo `porQue` de cada distractor permite un feedback que explica el error concreto que cometiste, no solo la respuesta correcta.

## Modelado de datos

El modelo separa tres mundos: el **contenido** (de dónde salen las preguntas), el **banco** (las preguntas y su calidad) y el **aprendizaje** (cómo le va a cada usuario con cada pregunta).

| Entidad | Qué guarda | Relaciones clave |
| --- | --- | --- |
| `Usuario` | Credenciales, rol, XP total, racha | Tiene Asignaciones, Intentos, EstadosDeEstudio |
| `Coleccion` | Agrupa por convocatoria: "Ascenso de categoría 2027" | Tiene Contenidos |
| `Contenido` | Una obra o norma: "Ley 070", "RM 001/2026" | Tiene Temas y Documentos |
| `Tema` | Capítulo/título, jerárquico (padreId) | Tiene Fragmentos y Preguntas |
| `Documento` | Archivo subido, estado de procesamiento | Tiene Fragmentos |
| `Fragmento` | Texto, páginas, etiqueta ("Art. 5"), embedding | Origen de Preguntas |
| `Pregunta` | Enunciado, tipo, dificultad, Bloom, explicación, cita, estado, métricas | Tiene Opciones; pertenece a Tema y Fragmento |
| `Opcion` | Texto, correcta, porQue | Pertenece a Pregunta |
| `Intento` | Un quiz: modo, filtros, cantidad, puntaje, tiempos | Tiene Respuestas |
| `Respuesta` | Opción elegida, correcta, segundos, confianza | Une Intento y Pregunta |
| `EstadoEstudio` | Por usuario y pregunta: facilidad, intervalo, próxima revisión, aciertos/fallos | Motor de repetición espaciada |
| `Asignacion` | Qué contenidos puede ver un usuario y hasta cuándo | Usuario ↔ Coleccion/Contenido |
| `Reporte` | Pregunta reportada por un estudiante y su resolución | Usuario ↔ Pregunta |
| `TrabajoGeneracion` | Lote de IA: modelo, versión de prompt, tokens, costo, resultado | Produce Preguntas |

### Esquema Prisma (núcleo)

```prisma
enum Rol { ADMIN REVISOR ESTUDIANTE }
enum Dificultad { FACIL MEDIA DIFICIL }
enum TipoPregunta { OPCION_MULTIPLE VERDADERO_FALSO SELECCION_MULTIPLE COMPLETAR ORDENAR CASO }
enum EstadoPregunta { BORRADOR VALIDADA APROBADA DESCARTADA DUPLICADA EN_REVISION }
enum ModoQuiz { PRACTICA EXAMEN REPASO_ERRORES SIMULACRO REPASO_DIARIO }

model Usuario {
  id           String   @id @default(cuid())
  usuario      String   @unique
  nombre       String
  passwordHash String
  rol          Rol      @default(ESTUDIANTE)
  xpTotal      Int      @default(0)
  rachaDias    Int      @default(0)
  ultimoEstudio DateTime?
  activo       Boolean  @default(true)
  intentos     Intento[]
  estados      EstadoEstudio[]
  asignaciones Asignacion[]
  creadoEn     DateTime @default(now())
}

model Coleccion {
  id          String      @id @default(cuid())
  nombre      String
  descripcion String?
  contenidos  Contenido[]
  asignaciones Asignacion[]
}

model Contenido {
  id          String      @id @default(cuid())
  coleccionId String
  coleccion   Coleccion   @relation(fields: [coleccionId], references: [id])
  titulo      String
  tipoFuente  String      // LEY, DECRETO, RM, LIBRO, GUIA
  publicado   Boolean     @default(false)
  temas       Tema[]
  documentos  Documento[]
}

model Tema {
  id          String     @id @default(cuid())
  contenidoId String
  contenido   Contenido  @relation(fields: [contenidoId], references: [id])
  padreId     String?
  padre       Tema?      @relation("Jerarquia", fields: [padreId], references: [id])
  hijos       Tema[]     @relation("Jerarquia")
  nombre      String
  orden       Int
  fragmentos  Fragmento[]
  preguntas   Pregunta[]
}

model Documento {
  id          String    @id @default(cuid())
  contenidoId String
  contenido   Contenido @relation(fields: [contenidoId], references: [id])
  archivoUrl  String
  hash        String    @unique   // evita subir el mismo PDF dos veces
  estado      String    // SUBIDO, EXTRAIDO, FRAGMENTADO, ERROR
  paginas     Int?
  fragmentos  Fragmento[]
}

model Fragmento {
  id          String    @id @default(cuid())
  documentoId String
  documento   Documento @relation(fields: [documentoId], references: [id])
  temaId      String?
  tema        Tema?     @relation(fields: [temaId], references: [id])
  etiqueta    String    // "Art. 5", "Cap. III"
  texto       String
  paginaDesde Int
  paginaHasta Int
  embedding   Unsupported("vector(1024)")?
  preguntas   Pregunta[]
}

model Pregunta {
  id            String         @id @default(cuid())
  temaId        String
  tema          Tema           @relation(fields: [temaId], references: [id])
  fragmentoId   String?
  fragmento     Fragmento?     @relation(fields: [fragmentoId], references: [id])
  tipo          TipoPregunta
  dificultad    Dificultad
  nivelBloom    String
  enunciado     String
  explicacion   String
  citaTextual   String
  referencia    String
  etiquetas     String[]
  estado        EstadoPregunta @default(BORRADOR)
  origen        String         // CLAUDE_CODE, MCP, API, MANUAL
  trabajoId     String?
  vecesRespondida Int          @default(0)
  vecesAcertada   Int          @default(0)
  embedding     Unsupported("vector(1024)")?
  opciones      Opcion[]
  respuestas    Respuesta[]
  estados       EstadoEstudio[]
  creadoEn      DateTime       @default(now())
  @@index([temaId, estado, dificultad])
}

model Opcion {
  id         String   @id @default(cuid())
  preguntaId String
  pregunta   Pregunta @relation(fields: [preguntaId], references: [id], onDelete: Cascade)
  texto      String
  correcta   Boolean
  porQue     String?
  orden      Int
}

model Intento {
  id          String    @id @default(cuid())
  usuarioId   String
  usuario     Usuario   @relation(fields: [usuarioId], references: [id])
  modo        ModoQuiz
  filtros     Json      // contenidos, temas, dificultad
  cantidad    Int
  puntaje     Int       @default(0)
  aciertos    Int       @default(0)
  iniciadoEn  DateTime  @default(now())
  finalizadoEn DateTime?
  respuestas  Respuesta[]
}

model Respuesta {
  id          String   @id @default(cuid())
  intentoId   String
  intento     Intento  @relation(fields: [intentoId], references: [id])
  preguntaId  String
  pregunta    Pregunta @relation(fields: [preguntaId], references: [id])
  orden       Int
  opcionesElegidas String[]
  correcta    Boolean?
  segundos    Int?
  confianza   Int?     // 1 = adiviné, 2 = dudé, 3 = seguro
  @@unique([intentoId, preguntaId])
}

model EstadoEstudio {
  usuarioId       String
  preguntaId      String
  usuario         Usuario  @relation(fields: [usuarioId], references: [id])
  pregunta        Pregunta @relation(fields: [preguntaId], references: [id])
  aciertos        Int      @default(0)
  fallos          Int      @default(0)
  facilidad       Float    @default(2.5)
  intervaloDias   Int      @default(0)
  proximaRevision DateTime @default(now())
  ultimaRespuesta DateTime?
  @@id([usuarioId, preguntaId])
  @@index([usuarioId, proximaRevision])
}

model Asignacion {
  id          String    @id @default(cuid())
  usuarioId   String
  usuario     Usuario   @relation(fields: [usuarioId], references: [id])
  coleccionId String
  coleccion   Coleccion @relation(fields: [coleccionId], references: [id])
  venceEn     DateTime?
}
```

`Reporte` y `TrabajoGeneracion` siguen el mismo patrón y se agregan en fase 2. Las respuestas correctas viven en `Opcion.correcta` y la API nunca las envía al iniciar un quiz en modo Examen.

## Lógica de estudio

Un quiz "aleatorio" puro desperdicia tiempo en lo que ya sabes; propongo una mezcla ponderada que prioriza lo pendiente de repaso y lo débil, sin dejar de cubrir todo el temario.

### Selección de preguntas para un quiz de N

| Bloque | Proporción | Criterio |
| --- | --- | --- |
| Repaso vencido | 40 % | `proximaRevision <= hoy`, ordenadas por más atrasadas |
| Temas débiles | 30 % | Preguntas de temas con dominio < 60 % |
| Nuevas | 30 % | Nunca vistas, repartidas proporcionalmente entre los temas elegidos |

Si un bloque no alcanza, el resto se completa con aleatorias del filtro. En modo **Simulacro** se ignora la ponderación y se imita la distribución oficial del examen (ej. 30 % Ley 070, 20 % currículo, etc.), configurable por colección. Las opciones se barajan en cada intento.

### Puntaje y progreso

- **XP por acierto:** fácil 10, media 20, difícil 35. Bonus ×1,5 si aciertas una pregunta que antes fallaste.
- **Sin penalización por error en Práctica**; en Simulacro se puede activar la regla del examen real si la tiene.
- **Puntaje acumulado** = suma de XP de todos los intentos (nunca baja). Es motivación, no medida de dominio.
- **Dominio por tema** (lo que realmente importa): porcentaje de preguntas del tema cuyo `EstadoEstudio` tiene intervalo ≥ 7 días. Llegar al 100 % significa que respondiste todo bien varias veces espaciadas.
- **Rachas** de días consecutivos y meta diaria (ej. 50 preguntas).

### Repetición espaciada (SM-2 simplificado)

Cada respuesta actualiza el `EstadoEstudio` de esa pregunta:

- **Fallo** → intervalo 1 día, facilidad −0,2 (mínimo 1,3).
- **Acierto con confianza "adiviné"** → se trata como fallo blando: intervalo 1 día, sin cambiar facilidad.
- **Acierto con duda** → intervalo × 1,2.
- **Acierto seguro** → intervalo × facilidad (1 → 3 → 7 → 18 → 45 días aprox.).

El botón de confianza (3 toques: adiviné / dudé / seguro) es clave: evita que un acierto por suerte se dé por aprendido. Más adelante puedes cambiar a FSRS, que es más preciso, sin tocar el modelo de datos.

### Feedback

- **Inmediato (Práctica):** al responder se muestra correcta/incorrecta, el `porQue` de la opción que elegiste, la explicación y la cita con referencia ("Ley 070, Art. 5, pág. 4").
- **"Ver en la fuente":** abre el fragmento original con la cita resaltada.
- **Resumen del intento:** aciertos por tema, tiempo promedio, lista de falladas con un botón "Repasar estas ahora".
- **Cuaderno de errores:** todas tus preguntas falladas que aún no dominas, filtrables por contenido.
- **Pregúntale a la IA (fase 2):** "no entiendo por qué" abre una explicación ampliada basada solo en el fragmento fuente.

## API y pantallas

Unos 25 endpoints REST cubren la fase 1 y 2; todos bajo `/api/v1` con JWT.

### Endpoints principales

| Método | Ruta | Rol | Uso |
| --- | --- | --- | --- |
| POST | `/auth/login` | Todos | Iniciar sesión |
| GET | `/me/panel` | Estudiante | XP, racha, dominio por contenido, repaso pendiente de hoy |
| GET | `/colecciones` | Todos | Colecciones asignadas con contenidos y temas |
| POST | `/quizzes` | Estudiante | Crear intento `{modo, contenidoIds, temaIds, dificultad, cantidad}` → devuelve preguntas sin respuestas |
| POST | `/quizzes/:id/respuestas` | Estudiante | Responder una pregunta → feedback (en Práctica) |
| POST | `/quizzes/:id/finalizar` | Estudiante | Cierra, calcula puntaje, devuelve resumen y feedback (en Examen) |
| GET | `/me/errores` | Estudiante | Cuaderno de errores |
| GET | `/me/repaso-hoy` | Estudiante | Cola de repetición espaciada |
| POST | `/preguntas/:id/reportes` | Estudiante | Reportar pregunta |
| POST | `/admin/documentos` | Admin | Subir PDF → encola extracción |
| GET | `/admin/documentos/:id` | Admin | Estado de procesamiento y fragmentos |
| POST | `/admin/generaciones` | Admin | Encolar generación `{fragmentoIds, porFragmento, dificultades}` (ruta C) |
| POST | `/admin/preguntas/importar` | Admin | Importar JSON (rutas A, B, D) |
| GET | `/admin/revision` | Admin/Revisor | Bandeja de preguntas por aprobar |
| PATCH | `/admin/preguntas/:id` | Admin/Revisor | Editar, aprobar, descartar |
| POST | `/admin/preguntas/aprobar-lote` | Admin | Aprobar en bloque las validadas |
| GET | `/admin/estadisticas/preguntas` | Admin | Preguntas "rotas": % de acierto < 15 % o > 98 % |
| POST | `/admin/usuarios` | Admin | Crear cuenta y asignar colecciones |

### Pantallas

**Estudiante**

1. **Inicio:** racha, XP, botón grande "Repaso de hoy (37)", dominio por contenido en barras.
2. **Nuevo quiz:** elegir contenidos/temas (árbol con casillas), dificultad, cantidad (10/20/50/100), modo.
3. **Quiz:** una pregunta por pantalla, barra de progreso, botones de confianza, temporizador en Examen.
4. **Resultado:** puntaje, aciertos por tema, falladas con explicación y "Repasar estas".
5. **Mi progreso:** mapa de calor de temas, historial, cuaderno de errores.

**Administrador**

1. **Contenidos:** árbol Colección → Contenido → Tema; subir documentos.
2. **Documento:** fragmentos detectados, editar cortes, botón "Generar preguntas".
3. **Bandeja de revisión:** tarjeta por pregunta con la cita de la fuente al lado; atajos de teclado (A aprobar, D descartar, E editar).
4. **Calidad:** preguntas reportadas y con estadísticas anómalas.
5. **Usuarios:** crear, asignar, desactivar, ver progreso.

## Mejoras sugeridas

Las tres mejoras de mayor impacto son: trazabilidad a la fuente, repetición espaciada con confianza, y control de calidad automático; ya están integradas arriba. Estas son las demás, ordenadas por valor para un examen de ascenso.

**Para aprender más rápido**

- **Variedad de tipos, no solo opción múltiple.** Verdadero/falso con corrección ("si es falso, ¿qué artículo lo contradice?"), completar el número del artículo, ordenar etapas de un procedimiento, y **casos prácticos** ("Un maestro con 5 años de servicio solicita… ¿qué norma aplica?"), que son los que más se parecen a los exámenes reales.
- **Niveles de Bloom en lugar de solo dificultad.** Recordar (dato literal), comprender, aplicar (caso), analizar (comparar dos normas). Así el estudiante sube de memorizar a razonar.
- **Preguntas "trampa" frecuentes.** Generar distractores a partir de confusiones reales: números de artículos vecinos, leyes parecidas, plazos cambiados.
- **Fichas resumen por tema** generadas por la IA desde los fragmentos: un repaso de 2 minutos antes de cada quiz.
- **Modo "normativa cruzada".** Preguntas que relacionan dos documentos (ej. Ley 070 con una RM que la reglamenta).
- **Línea de tiempo normativa:** qué norma derogó o modificó a cuál, para evitar estudiar artículos vigentes que ya no lo están.

**Para el banco de preguntas**

- **Cobertura visible:** % de artículos/fragmentos que tienen al menos 3 preguntas; la IA genera primero donde hay huecos.
- **Retroalimentación estadística:** una pregunta que casi nadie acierta suele estar mal redactada; una que todos aciertan es demasiado obvia. Se marcan para revisión automáticamente.
- **Versionado:** editar una pregunta crea versión nueva; el historial de respuestas sigue siendo válido.
- **Importar exámenes de gestiones pasadas** (si los consigues) etiquetados como "oficial": son oro para calibrar dificultad.

**Para el producto**

- **PWA con modo offline** para el repaso diario en el micro o sin datos.
- **Recordatorio diario** por WhatsApp/Telegram o notificación push con el número de preguntas pendientes.
- **Grupos de estudio:** un docente o director crea un grupo, asigna una colección y ve el avance de su equipo.
- **Multi-tenant como EduSync** para vender a sindicatos de maestros, institutos o direcciones distritales.
- **Integración con EduSync o PlataformaCEA:** el mismo motor de quizzes sirve para tus estudiantes del CEA.

**Riesgos a vigilar**

- **Alucinaciones de la IA:** mitigadas con cita textual obligatoria, validación automática y revisión humana. Nunca publicar sin estos filtros.
- **Normas desactualizadas:** cada Contenido debe guardar fecha de vigencia y fuente oficial (Gaceta Oficial, Ministerio de Educación).
- **Derechos de autor de libros:** los fragmentos de libros no se muestran completos a otros usuarios; solo la cita corta que respalda la pregunta.
- **Costo de IA en fase 3:** registrar tokens por lote desde el inicio para poder fijar precios.

## Hoja de ruta

El primer objetivo es estudiar tú mismo con un banco real lo antes posible; cada hito deja algo usable.

1. **Hito 0 — Base del proyecto.** Repo, Docker Compose (web, api, db con pgvector), Prisma con el esquema núcleo, login de admin.
2. **Hito 1 — Banco e importador.** CRUD de Colección/Contenido/Tema, endpoint `/admin/preguntas/importar` con validación Zod, bandeja de revisión. Aquí ya puedes cargar preguntas generadas con Claude Code.
3. **Hito 2 — Quiz mínimo.** Crear quiz por filtros y cantidad, modo Práctica con feedback inmediato, resumen del intento, XP acumulado.
4. **Hito 3 — Ingesta de PDF.** Subida, extracción por página, OCR, fragmentación por artículos, exportación de fragmentos a `fuentes/*.md` para Claude Code.
5. **Hito 4 — Aprender de verdad.** Repetición espaciada con confianza, repaso del día, cuaderno de errores, dominio por tema.
6. **Hito 5 — Calidad automática.** Embeddings, deduplicación, validador "a ciegas", estadísticas de preguntas rotas.
7. **Hito 6 — Servidor MCP.** Herramientas para generar y guardar preguntas conversando desde este chat o Claude Code.
8. **Hito 7 — Multiusuario.** Roles, creación de cuentas, asignaciones con vencimiento, reportes, despliegue en Vercel + Cloud Run + Supabase.
9. **Hito 8 — Producto.** Modos Examen y Simulacro, PWA offline, recordatorios, generación por API desde el panel.

### Próximos pasos concretos

- [ ] Elegir la primera colección piloto (ej. bibliografía del próximo examen de ascenso) y reunir los PDFs
- [ ] Definir el nombre del sistema
- [ ] Crear el repo y el esquema Prisma (Hito 0)
- [ ] Escribir el prompt de generación y la skill `/generar-preguntas` para Claude Code
- [ ] Generar un primer lote de 200 preguntas de una ley y revisarlas para calibrar el prompt
