# Proyinstelec Field App

PWA offline-first de registro de asistencia para trabajadores de campo de Proyinstelec. Los trabajadores hacen check-in y check-out con foto + geolocalización. Los datos viven en Neon (PostgreSQL) y las fotos en Google Drive. Incorpora además el ERP interno (cotizaciones, órdenes de trabajo y seguimiento semanal), migrado por fases desde Google Apps Script.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14 (App Router) · TypeScript · Tailwind CSS |
| Auth | Auth.js v5 (NextAuth) · Google OAuth · adaptador Drizzle |
| Base de datos | Neon (PostgreSQL serverless) · Drizzle ORM |
| Almacenamiento | Google Drive (service account) |
| Correo | Gmail API (delegación de dominio) |
| Hosting | Vercel |
| Offline | IndexedDB (idb) · Background Sync |
| CI / Testing | Vitest · fake-indexeddb |
| Monorepo | pnpm workspaces |

---

## Estructura del repositorio

```
.
├── apps/
│   └── web/                  # Next.js app (raíz del deploy en Vercel)
│       ├── app/              # App Router: páginas y API routes
│       ├── drizzle/          # Migraciones SQL generadas
│       ├── src/
│       │   ├── db/           # Esquema Drizzle y cliente de Neon
│       │   ├── lib/          # Lógica de negocio (campo y ERP)
│       │   ├── __tests__/    # Tests unitarios (vitest)
│       │   ├── auth.ts       # Auth.js v5 (instancia completa)
│       │   └── auth.config.ts# Configuración sin base (middleware/edge)
│       └── public/           # PWA manifest, iconos
├── scripts/
│   ├── seed.ts               # Datos de desarrollo
│   └── importar-erp.ts       # Importación desde los Sheets del sistema anterior
├── docs/
│   ├── despliegue-vercel-neon.md
│   ├── plan-migracion-erp.md
│   └── erp-legacy/           # Análisis del ERP en Apps Script
└── vercel.json
```

---

## Inicio rápido (desarrollo local)

### Prerrequisitos

- Node.js ≥ 20
- pnpm 9+
- Una base en [Neon](https://console.neon.tech) (plan gratuito basta para desarrollo)

### 1. Instalar

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
```

### 2. Variables de entorno

Llenar `apps/web/.env.local` con la cadena de conexión de Neon, el secreto de
Auth.js (`openssl rand -base64 32`) y las credenciales de Google.
Ver [`docs/despliegue-vercel-neon.md`](docs/despliegue-vercel-neon.md) para el detalle.

### 3. Preparar la base y arrancar

```bash
pnpm db:migrate   # aplica el esquema
pnpm db:seed      # usuarios y datos de prueba
pnpm dev          # http://localhost:3000
```

Sin Google ni base de datos: `pnpm dev:demo`.


---

## Scripts disponibles

```bash
# Desarrollo
pnpm dev              # servidor de desarrollo
pnpm dev:demo         # sin Google ni base de datos
pnpm build            # build de producción
pnpm lint             # ESLint

# Tests
pnpm test             # watch
pnpm test:ci          # una pasada, con cobertura

# Base de datos (Neon)
pnpm db:generate      # generar migración tras cambiar el esquema
pnpm db:migrate       # aplicar migraciones
pnpm db:push          # aplicar el esquema sin migración (solo desarrollo)
pnpm db:studio        # explorador visual
pnpm db:seed          # datos de desarrollo

# Importación desde el sistema anterior
pnpm import:erp                 # Sheets -> Neon
DRY_RUN=true pnpm import:erp    # solo reporta, no escribe
```

---

## Arquitectura

### Flujo de check-in / check-out

```
Trabajador abre /app
       |
       v
[Foto obligatoria]  --online-->  POST /api/upload  ->  Google Drive
       |                                                    | driveFileId
       v                                                    v
[Geolocalización]           POST /api/jornada  ->  Neon (jornada abierta)
       |                         |
       |                    syncToOdooAsync (fire-and-forget, sólo planta)
       v
[Check-out]  --online-->  PATCH /api/jornada/:id  ->  Neon (jornada cerrada)
       |
  offline  ->  IndexedDB (sync-queue)  ->  se envía al recuperar conexión
```

### Modelo de datos

Esquema relacional en `apps/web/src/db/schema.ts` (19 tablas):

| Grupo | Tablas |
|---|---|
| Auth.js | `users`, `accounts`, `sessions`, `verification_tokens` |
| Campo | `empresas`, `proyectos`, `proyecto_usuarios`, `invitaciones`, `jornadas`, `odoo_queue` |
| ERP | `clientes`, `contactos`, `cotizaciones`, `aprobaciones`, `ordenes_trabajo`, `ot_responsables` |
| Comunes | `bitacora`, `contadores`, `config_erp` |

La versión vigente de una cotización es la de mayor `version` por `(numero, anio)`
— un `DISTINCT ON` en SQL, sin las filas ocultas ni los índices espejo que
necesitaba el sistema anterior.

### Roles y permisos

| `tipo` | `rol` | Descripción |
|---|---|---|
| `admin` | `admin` | Gestión completa; tiene todos los permisos del ERP |
| `planta` | `campo` | Trabajador @proyinstelec.mx — sync con Odoo activo |
| `temporal` | `campo` | Trabajador externo — entra por token de invitación |
| `cliente` | `cliente` | Portal de consulta de solo lectura |

Sobre el rol, cada usuario puede tener permisos finos del ERP
(`permisos` en su perfil, catálogo en `src/lib/permisos.ts`). Se editan en
Admin → Usuarios → ERP y se validan en el servidor con `exigirPermiso()`.

### Identidad

Auth.js administra la identidad: el `sub` de Google vive en `accounts` y el
identificador de dominio es `users.id`. Un usuario dado de alta por adelantado
(siembra, importación) queda enlazado por correo la primera vez que entra con
Google, conservando su rol y permisos.

---

## Despliegue

Vercel (hosting) + Neon (base de datos). Guía completa en
[`docs/despliegue-vercel-neon.md`](docs/despliegue-vercel-neon.md).

---

## Tests

```bash
pnpm test        # modo watch
pnpm test:ci     # una pasada, con cobertura
```

Cobertura actual: **187 tests** en 20 archivos (libs, API routes, middleware, IDB/sync-queue, ERP Fases 0-1).

---

## Variables de entorno — referencia completa

Ver [`apps/web/.env.example`](apps/web/.env.example) para la lista completa con comentarios.

---

## ERP (migración por fases)

La app incorpora el ERP interno (Cotizaciones, Órdenes de Trabajo, Weekly/KPIs), migrado por fases
desde el sistema anterior en Google Apps Script. Plan y decisiones: [`docs/plan-migracion-erp.md`](docs/plan-migracion-erp.md);
análisis del sistema anterior: [`docs/erp-legacy/`](docs/erp-legacy/).

**Fase 0 (lista):**

- Permisos ERP en el perfil (`permisos`, `iniciales`, `gerencia`) — se editan en `/admin` → Usuarios → botón «ERP».
  El rol `admin` tiene todos los permisos implícitamente; catálogo y guard en `apps/web/src/lib/permisos.ts` (`exigirPermiso`).
- Sección `/erp` con menú por permisos (módulos se activan en las fases 1-4).
- Folios atómicos (`src/lib/folios.ts`), bitácora (`src/lib/bitacora.ts`) y correo transaccional con
  Gmail API + delegación de dominio (`src/lib/correo.ts`; en dev usar `CORREO_DESHABILITADO=true`).
- GSIs nuevos en `proyinstelec-main`: `gsi4-coleccion` (colecciones por año/semana/estado) y `gsi5-fecha` (servicios por fecha).
  En local: `pnpm db:reset` para recrear tablas con los índices nuevos.

**Migración de arquitectura (rama `feat/vercel-neon`):** de AWS (DynamoDB + CDK + Amplify) a
Vercel + Neon, con Drizzle ORM y Auth.js v5. Las reglas de negocio del ERP se conservaron intactas.

**Fase 1 (lista) — Clientes y Cotizaciones:**

- `/erp/clientes`: empresas y contactos con verificación anti-duplicados por razón social normalizada.
- `/erp/cotizaciones`: buscador con los 8 filtros del ERP anterior, alta con carpeta de Drive `NNN - AAAA`
  y copia de plantillas, versiones (la vigente es la única que cuenta en búsquedas y dashboards),
  edición, flujo completo de revisión → aprobación → envío al cliente (PDF obligatorio, CC al equipo)
  → ingreso de OC → generación de OT (`OTnnnAAv`) con carpeta de Drive, responsable y aviso a áreas.
- `/erp/revision`: bandeja para aprobar o solicitar corrección (permiso `cotizaciones.aprobar`) —
  reemplaza los links sin autenticación del sistema anterior.
- Libs: `clientes.ts`, `cotizaciones.ts` (estados y transiciones), `cotizaciones-flujos.ts` (correos y reglas),
  `ot.ts`, `drive-erp.ts`, `config-erp.ts` (catálogo de áreas para avisos de OT — editar el ítem `CONFIG#erp`).
- Importador idempotente desde los Sheets legacy: `pnpm import:erp` (variables `IMPORT_*` en `.env.example`;
  `DRY_RUN=true` para solo reportar). Al terminar reporta los elaboradores cuyas iniciales hay que cruzar con los perfiles.

**Configuración Drive del ERP:** definir las variables `ERP_COTIZACIONES_FOLDER_ID`,
`ERP_OT_FOLDER_ID`, `ERP_PLANTILLA_DOC_ID` y `ERP_PLANTILLA_SHEET_ID` con la carpeta raíz de
cotizaciones, la de OT y las dos plantillas.

**Configuración del correo (producción):** definir `CORREO_REMITENTE` (cuenta del dominio desde la
que salen los correos) y, si se usa una llave distinta a la de Drive, `GMAIL_SERVICE_ACCOUNT_KEY`.
Además hay que habilitar la delegación de dominio del service account en la consola de administrador
de Google Workspace con el scope `https://www.googleapis.com/auth/gmail.send`.
