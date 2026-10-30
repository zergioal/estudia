# EstudIA

Quizzes generados por IA, con cita a la fuente, para estudiar la bibliografía de los exámenes de ascenso.
Diseño completo: [docs/diseno.md](docs/diseno.md).

## Puesta en marcha

Requisitos: Node 22+, Docker (Docker Desktop, o Docker dentro de WSL).

```bash
cp .env.example .env          # cambia JWT_SECRET y ADMIN_PASSWORD
npm install
docker compose up -d db       # Postgres 16 + pgvector en :5432 (crea también estudia_test)
npm run db:migrate            # aplica migraciones
npm run db:seed               # crea el ADMIN de .env
npm run dev                   # api :3000 y web :5173
```

Abre http://localhost:5173 e ingresa con `ADMIN_USUARIO` / `ADMIN_PASSWORD`.

### Docker dentro de WSL (sin Docker Desktop)

WSL apaga su VM cuando no tiene procesos activos, y con ella el contenedor. Deja una terminal de Ubuntu
abierta o arranca la base así y no cierres esa ventana:

```bash
wsl -d Ubuntu -- bash -lc "cd '/mnt/d/PROYECTOS WEB/estudIA/estudia' && docker compose up -d db && exec sleep infinity"
```

Para que no se apague sola, agrega en `%UserProfile%\.wslconfig`:

```ini
[wsl2]
vmIdleTimeout=-1
```

y ejecuta `wsl --shutdown` una vez.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | API (tsx watch) y web (Vite) en paralelo |
| `npm test` | Tests de la API (Vitest + Supertest) sobre la base `estudia_test` |
| `npm run typecheck` | TypeScript en todos los paquetes |
| `npm run db:migrate` | `prisma migrate dev` (crea/aplica migraciones) |
| `npm run db:seed` | Crea o actualiza el usuario ADMIN de `.env` |
| `npm run importar -- <archivo.json>` | Importa un lote de preguntas en estado BORRADOR |
| `npm run ingestar -- <carpeta\|archivo.pdf>` | Extrae (con OCR), fragmenta y exporta PDFs a `fuentes/<clave>/` |

## Estructura

```
apps/api        Express + Prisma (src/modulos/<modulo>/{rutas,servicio,esquemas}.ts)
apps/web        React + Vite + Tailwind + TanStack Query
packages/shared Enums y esquemas Zod compartidos (contrato JSON de preguntas)
importar/       Lotes JSON para importar (ejemplo.json)
fuentes/        PDFs originales (no versionados) + manifiesto.json, y fragmentos exportados en fuentes/<clave>/*.md
storage/        PDFs subidos y caché del OCR (no versionado)
```

## API

Todas bajo `/api/v1`. Errores: `{ error: { codigo, mensaje, detalles? } }`.

| Método | Ruta | Rol |
| --- | --- | --- |
| POST | `/auth/login` | — |
| GET | `/auth/yo` | autenticado |
| GET | `/admin/arbol` | ADMIN |
| POST · PATCH · DELETE | `/admin/colecciones[/:id]`, `/admin/contenidos[/:id]`, `/admin/temas[/:id]` | ADMIN |
| POST | `/admin/preguntas/importar` | ADMIN |
| GET | `/admin/revision?estado=&contenidoId=&temaId=&pagina=&porPagina=` | ADMIN, REVISOR |
| GET · PATCH | `/admin/preguntas/:id` | ADMIN, REVISOR |
| POST | `/admin/preguntas/aprobar-lote` | ADMIN |
| POST | `/admin/documentos` (multipart: `archivo`, `contenidoId`, `ocr`) | ADMIN |
| GET | `/admin/documentos[?contenidoId=]`, `/admin/documentos/:id` | ADMIN |
| POST | `/admin/documentos/:id/procesar` (re-extraer), `/admin/documentos/:id/fragmentar` (rehacer cortes) | ADMIN |
| DELETE | `/admin/documentos/:id` | ADMIN |
| POST | `/admin/contenidos/:id/exportar` | ADMIN |

## Ingesta de PDF

El procesamiento corre en una cola `pg-boss` dentro de la API. El OCR (tesseract.js, español) descarga sus
datos de idioma la primera vez a `storage/tessdata/` (requiere internet). Variables opcionales en `.env`:
`STORAGE_DIR`, `FUENTES_DIR`, `MAX_MB_PDF` (100 por defecto), `COLA_MODO=inline` (procesa sin cola).
