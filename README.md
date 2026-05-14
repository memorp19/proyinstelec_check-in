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

Cobertura actual: **132 tests** en 14 archivos (libs, API routes, auth callbacks, middleware, IDB/sync-queue).

---

## Variables de entorno — referencia completa

Ver [`apps/web/.env.example`](apps/web/.env.example) para la lista completa con comentarios.
