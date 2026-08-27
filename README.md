# Proyinstelec Field App

PWA offline-first de registro de asistencia para trabajadores de campo de Proyinstelec. Los trabajadores hacen check-in y check-out con foto + geolocalización. Los datos se almacenan en DynamoDB y las fotos en Google Drive.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14 (App Router) · TypeScript · Tailwind CSS |
| Auth | NextAuth v4 · Google OAuth |
| Base de datos | AWS DynamoDB (single-table + tablas auxiliares) |
| Almacenamiento | Google Drive (service account) |
| Infraestructura | AWS CDK v2 (TypeScript) |
| Offline | IndexedDB (idb) · Background Sync |
| CI / Testing | Vitest · fake-indexeddb |
| Monorepo | pnpm workspaces |

---

## Estructura del repositorio

```
.
├── apps/
│   └── web/                  # Next.js app
│       ├── app/              # App Router (páginas y API routes)
│       ├── src/
│       │   ├── lib/          # Lógica de negocio (DynamoDB, Drive, IDB, Odoo)
│       │   ├── __tests__/    # Tests unitarios (vitest)
│       │   ├── auth.ts       # authOptions de NextAuth
│       │   ├── auth-callbacks.ts
│       │   ├── middleware.ts
│       │   └── types/
│       └── public/           # PWA manifest, iconos
├── infra/
│   └── cdk/                  # Stack CDK: DynamoDB, SSM, Lambda, CloudFront
├── scripts/
│   ├── create-tables.ts      # Crea tablas DynamoDB Local
│   └── seed.ts               # Datos de prueba locales
├── docs/
│   └── setup-google-drive.md
└── docker-compose.yml        # DynamoDB Local + Admin UI
```

---

## Inicio rápido (desarrollo local)

### Prerrequisitos

- Node.js ≥ 20
- pnpm 9+
- Docker Desktop

### 1. Clonar e instalar

```bash
git clone <repo-url>
cd "Proyinstelec checkin:out"
pnpm install
```

### 2. Variables de entorno

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edita `apps/web/.env.local` con tus credenciales de Google OAuth y NextAuth secret:

```bash
# Generar NEXTAUTH_SECRET:
openssl rand -base64 32
```

Para Google OAuth: crea un proyecto en [console.cloud.google.com](https://console.cloud.google.com), habilita la Google OAuth API y agrega `http://localhost:3000/api/auth/callback/google` como URI de redirección autorizada.

Para Google Drive (fotos): ver [docs/setup-google-drive.md](docs/setup-google-drive.md).

### 3. Base de datos local

```bash
pnpm db:up        # Levanta DynamoDB Local en :8000 y Admin UI en :8001
pnpm db:create    # Crea las 4 tablas con sus GSIs
pnpm db:seed      # Siembra usuarios, proyectos y token de invitación de prueba
```

Admin UI disponible en [http://localhost:8001](http://localhost:8001).

### 4. Correr la app

```bash
pnpm dev          # http://localhost:3000
```

### Cuentas de prueba (login con Google)

| Rol | Email | Notas |
|---|---|---|
| **Super Admin** | `memorp19@gmail.com` | google_sub migrado automáticamente al primer login |
| Admin | `admin@proyinstelec.mx` | Cuenta corporativa de prueba |
| Planta (campo) | `carlos@proyinstelec.mx` | Cuenta corporativa de prueba |
| Temporal | cualquier Gmail | Usar con token `dev-token-valido-12345` en `/unirse?token=dev-token-valido-12345` |

---

## Scripts disponibles

```bash
# Desarrollo
pnpm dev              # Next.js dev server
pnpm build            # Build de producción
pnpm lint             # ESLint

# Tests
pnpm test             # Vitest watch
pnpm test:ci          # Vitest con coverage (CI)

# Base de datos local
pnpm db:up            # docker compose up -d
pnpm db:down          # docker compose down
pnpm db:create        # Crear tablas DynamoDB Local
pnpm db:seed          # Sembrar datos de prueba
pnpm db:reset         # Borrar volumen + recrear todo

# CDK
pnpm cdk synth        # Sintetizar CloudFormation
pnpm cdk diff         # Diferencia con el stack desplegado
pnpm cdk deploy       # Desplegar (requiere credenciales AWS)
```

---

## Arquitectura

### Flujo de check-in / check-out

```
Trabajador abre /app
       │
       ▼
[Foto obligatoria]  ──online──►  POST /api/upload  →  Google Drive
       │                                                     │ driveFileId
       ▼                                                     ▼
[Geolocalización]           POST /api/jornada  →  DynamoDB (estado: abierta)
       │                         │
       │                    syncToOdooAsync (fire-and-forget, solo planta)
       ▼
[Check-out]  ──online──►  PATCH /api/jornada/:id  →  DynamoDB (estado: cerrada)
       │
  offline  →  IndexedDB (sync-queue)  →  flush cuando vuelve conexión
```

### Tablas DynamoDB

| Tabla | PK | Propósito |
|---|---|---|
| `proyinstelec-users` | `google_sub` | Perfiles de usuario (GSI por email y tipo) |
| `proyinstelec-invitaciones` | `token` | Tokens de invitación para temporales (TTL automático) |
| `proyinstelec-main` | `pk / sk` | Single-table: Proyectos, Jornadas, Evidencias |
| `proyinstelec-odoo-queue` | `id` | Cola de reintentos Odoo (TTL 7 días) |

### Roles

| `tipo` | `rol` | Descripción |
|---|---|---|
| `admin` | `admin` | Gestión de proyectos e invitaciones |
| `planta` | `campo` | Trabajador @proyinstelec.mx — sync Odoo activo |
| `temporal` | `campo` | Trabajador externo — requiere token de invitación |
| `cliente` | `cliente` | Portal de consulta solo-lectura |

### Migración de super admin pre-seeded

Al hacer login por primera vez con Google, si el email coincide con un registro en DynamoDB (creado por seed o por un admin), el sistema migra automáticamente el `google_sub` placeholder al ID real de Google. El rol y tipo se preservan.

---

## Despliegue en producción

### 1. CDK Bootstrap (primera vez)

```bash
aws configure  # credenciales con permisos CDK
cd infra/cdk
pnpm cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

### 2. Parámetros SSM

Los secretos **no** son gestionados por CDK — deben cargarse manualmente antes del primer deploy:

```bash
# Google Drive
aws ssm put-parameter --name /proyinstelec/drive/service-account-email \
  --value "campo@tu-proyecto.iam.gserviceaccount.com" --type String

aws ssm put-parameter --name /proyinstelec/drive/service-account-key \
  --value "$(cat service-account-key.json)" --type SecureString

aws ssm put-parameter --name /proyinstelec/drive/root-folder-id \
  --value "1BxiMYour_Folder_ID_Here" --type String

# Odoo (opcional — dejar vacío si ODOO_SYNC_ENABLED=false)
aws ssm put-parameter --name /proyinstelec/odoo/url --value "https://odoo.tuempresa.com" --type String
aws ssm put-parameter --name /proyinstelec/odoo/db  --value "proyinstelec" --type String
aws ssm put-parameter --name /proyinstelec/odoo/api-key --value "TU_API_KEY" --type SecureString
```

### 3. Deploy

```bash
# Variables requeridas por el stack de producción
export ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:ACCOUNT:certificate/...
export DOMAIN_APEX=proyinstelec.mx
export NEXTJS_ORIGIN_DOMAIN=tu-amplify-domain.amplifyapp.com

pnpm cdk deploy ProyinstelecProd
```

### Hosting del frontend

El frontend Next.js se aloja en **AWS Amplify Gen 2**. CloudFront actúa como CDN y proxy hacia Amplify y API Gateway.

---

## Tests

```bash
cd apps/web
node_modules/.bin/vitest run          # todos los tests
node_modules/.bin/vitest run --coverage  # con reporte de cobertura
```

Cobertura actual: **208 tests** en 21 archivos (libs, API routes, auth callbacks, middleware, IDB/sync-queue, ERP Fases 0-1).

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

**Configuración Drive del ERP:** crear los parámetros SSM `/proyinstelec/erp/*` (o las variables `ERP_*`
en local) con la carpeta raíz de cotizaciones, la de OT y las dos plantillas.

**Configuración del correo (producción):** crear el parámetro SSM `/proyinstelec/correo/service-account-key`
(llave JSON del service account) y `/proyinstelec/correo/remitente` (cuenta del dominio), y habilitar la
delegación de dominio del service account en la consola de administrador de Google Workspace con el scope
`https://www.googleapis.com/auth/gmail.send`.
