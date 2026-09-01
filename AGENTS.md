# AGENTS.md — contexto para agentes de IA

Este archivo es el **contexto canónico** del repositorio. Lo leen automáticamente
Claude Code, Cursor, Codex y GitHub Copilot al abrir el proyecto; `CLAUDE.md` solo
apunta aquí. Si cambias una convención, cámbiala **en este archivo**.

Para humanos: la guía de instalación paso a paso está en [`README.md`](README.md);
cómo trabajar con la IA en el día a día, en [`docs/trabajar-con-ia.md`](docs/trabajar-con-ia.md).

---

## 1. Qué es este proyecto

App interna de **Proyinstelec**: control de asistencia en campo (check-in/out con
foto y geolocalización) + el **ERP** que se está migrando desde un Google Apps
Script legacy (cotizaciones, órdenes de trabajo, weekly, KPIs).

- Monorepo pnpm. La app vive en `apps/web` (Next.js 14, App Router).
- Producción en **Vercel**; base de datos **Neon** (PostgreSQL serverless).
- Idioma del código: **español** en nombres de dominio, comentarios y textos de
  UI. Los identificadores de framework quedan en inglés (`params`, `session`).

## 2. Comandos

Siempre desde la **raíz** del repo (los scripts hacen `--filter web` por ti):

```bash
pnpm install         # instalar dependencias del workspace
pnpm dev             # servidor de desarrollo → http://localhost:3000
pnpm dev:demo        # sin Google ni base: DEMO_MODE con usuarios falsos
pnpm test            # vitest en watch
pnpm test:ci         # vitest run + cobertura (lo que debe pasar antes del PR)
pnpm lint            # eslint de Next
pnpm build           # build de producción (falla si hay error de tipos)

pnpm db:generate     # genera SQL tras cambiar el esquema
pnpm db:migrate      # aplica migraciones a DATABASE_URL
pnpm db:studio       # explorador visual de la base
pnpm db:seed         # datos de trabajo (idempotente)
```

**Un solo test:** `pnpm --filter web test src/__tests__/lib/folios.test.ts`

Antes de pedir revisión deben pasar los tres: `pnpm test:ci`, `pnpm lint`, `pnpm build`.

## 3. Mapa del repositorio

```
apps/web/
  app/                 rutas (App Router)
    (public)/          landing pública
    app/               área de campo: check-in/out, perfil
    admin/             panel de administración (rol admin)
    erp/               módulos del ERP: clientes, cotizaciones, revisión
    api/               route handlers — TODA la lógica protegida vive aquí
  middleware.ts        guardas por prefijo de ruta (runtime edge)
  src/
    auth.config.ts     config sin base, apta para edge (la usa el middleware)
    auth.ts            instancia completa: adaptador Drizzle + callbacks
    db/schema.ts       esquema Drizzle — 19 tablas, fuente de verdad
    db/index.ts        getDb() perezoso sobre el driver HTTP de Neon
    lib/               lógica de dominio (cotizaciones, folios, permisos, …)
    __tests__/         vitest, refleja la estructura de src/
  drizzle/             migraciones SQL generadas + meta/_journal.json
docs/
  plan-migracion-erp.md          plan por fases y decisiones de arquitectura
  erp-legacy/*.md                análisis del ERP viejo: reglas de negocio
  despliegue-vercel-neon.md      Vercel, Neon, migraciones, baseline
  trabajar-con-ia.md             cómo usar este harness
scripts/               seed.ts, importar-erp.ts (tsx, corren desde la raíz)
```

## 4. Arquitectura: las 6 reglas que no se rompen

1. **La autorización se valida en el servidor, siempre.** La UI solo esconde. Toda
   route handler empieza con:

   ```ts
   const session = await auth();
   const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
   if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });
   ```

   Los permisos válidos son los del catálogo en `src/lib/permisos.ts`; no inventes
   llaves nuevas sin agregarlas al catálogo y a `GRUPOS_PERMISOS`.

2. **Sin transacciones interactivas.** El driver HTTP de Neon no las soporta. La
   atomicidad se resuelve con una sola sentencia: `ON CONFLICT DO UPDATE`,
   `UPDATE … WHERE … RETURNING`, o el contador atómico de `src/lib/folios.ts`.
   Nunca `db.transaction(...)`.

3. **La base se accede con `getDb()`**, nunca con un cliente creado al vuelo. Es
   perezoso a propósito: si `DATABASE_URL` falta, falla con un mensaje claro y no
   al importar el módulo (el build se rompería).

4. **La lógica de dominio vive en `src/lib/`, no en las rutas.** Las rutas parsean
   la petición, validan permisos y llaman a una función de `lib`. Así se puede
   probar sin HTTP.

5. **Cambios de esquema = migración generada.** `db:push` solo para experimentar
   en una rama de Neon personal. En cualquier base compartida:
   `db:generate` → revisar el SQL → `db:migrate`. Nunca editar a mano un archivo
   ya aplicado en `drizzle/`; se genera otra migración encima.

6. **Nada de secretos en el repo.** `apps/web/.env.local` está en `.gitignore` y
   se queda ahí. Si falta una variable, se documenta en `.env.example` con un
   valor de ejemplo, jamás el real.

## 5. Sesión y roles

- **Auth.js v5** con proveedor Google y sesión en **JWT** (el middleware no
  consulta la base en cada petición).
- `session.user` trae: `id`, `rol` (`campo` | `admin` | `cliente`), `tipo`
  (`planta` | `temporal` | `admin` | `cliente`), `es_super_admin`,
  `perfil_completo`, `permisos[]`, `iniciales`, `gerencia`.
- **Super admin**: columna `users.es_super_admin` en la base. **No hay lista de
  correos en el código** — si necesitas nombrar a alguien, se hace desde el panel
  de admin o con SQL (ver README). Un super admin no puede ser degradado desde la
  API por nadie más.
- El personal de planta se detecta por dominio del correo
  (`GOOGLE_WORKSPACE_DOMAIN`); los temporales entran por invitación y completan su
  alta antes de usar la app.

## 6. Reglas de negocio heredadas del ERP (no las cambies sin preguntar)

Vienen del sistema en Apps Script y hay datos históricos que dependen de ellas.
El detalle está en `docs/erp-legacy/`; el resumen operativo:

- **Folios.** Cotización `PCOTOP-NNN-AAAA[-v]`, orden de trabajo `OTnnnAAv`,
  actividad `ACT-####`. Se generan con el contador atómico de `src/lib/folios.ts`,
  nunca con `count(*) + 1`.
- **Flujo de cotización:** `PROCESO → REVISION → ENVIADA → ASIGNADA`. La aprobación
  se guarda **por versión exacta** y se invalida si la cotización vuelve a
  `REVISION`.
- **PDF obligatorio** para poder enviar una cotización al cliente.
- El **responsable** de una OT debe tener `iniciales` capturadas (2-5 mayúsculas);
  son la llave con la que el ERP identifica personas.
- "Vigente" = la versión más alta de un `(numero, anio)`:
  `DISTINCT ON (numero, anio) … ORDER BY version DESC`.

## 7. Diseño (sistema de la app base)

Tailwind con los tokens de `apps/web/tailwind.config.ts`. **Reutiliza lo que ya
existe** antes de inventar estilos:

- Fondo `navy` (`#0A1628`), superficies `bg-white/5` y `bg-white/10`, bordes
  `border-white/10`.
- Tipografía: `font-head` (Barlow Condensed) para títulos, `font-body` para texto,
  `font-mono` (Space Mono) para folios, claves y datos técnicos.
- Estado en *pills* con alfas: `bg-green/15 text-green`, `bg-amber/15 text-amber`,
  `bg-danger/15 text-danger`.
- Área táctil mínima 44×44 (`min-h-tap`, `min-w-tap`) — la app se usa en campo,
  con guantes y a pleno sol.
- Sin librerías de componentes nuevas. Sin `localStorage` para estado de dominio.

## 8. Tests

Vitest. Cada archivo de `src/lib/` con lógica no trivial tiene su test en
`src/__tests__/lib/`. Para las funciones que tocan la base se mockea `@/src/db`
con el helper encadenado:

```ts
vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso, errorDuplicado } from "../helpers/db-falso";

function usarDb(resultados: unknown[] = []) {
  const falso = dbFalso(resultados);
  vi.mocked(getDb).mockImplementation(falso.getDb as never);
  return falso;
}
```

Cada `await` de la lib consume el siguiente elemento de la cola, en orden;
`{ error: errorDuplicado() }` simula el 23505 de una llave duplicada. Copia
`src/__tests__/lib/clientes.test.ts` como referencia.

Cubre el camino feliz **y** el error esperado (permiso faltante, folio duplicado,
estatus inválido). Un PR que agrega lógica sin test no pasa revisión.

## 9. Git

- Se trabaja **a partir de `develop`**: `feature/lo-que-sea`, `fix/lo-que-sea`.
- `main` es producción; no se le hace push directo.
- Commits en español, en imperativo y con prefijo:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Un PR = un cambio entendible. Usa la plantilla que aparece sola al abrirlo.

## 10. Para el agente: cómo trabajar aquí

- **Lee antes de escribir.** Antes de crear un helper, busca en `src/lib/` — casi
  siempre ya existe (`folios`, `permisos`, `bitacora`, `correo`, `drive`).
- **Sigue el patrón del vecino.** Copia la estructura de una ruta o pantalla
  hermana en vez de introducir un estilo nuevo.
- **Cambios pequeños y verificables.** Después de tocar código corre el test del
  archivo afectado; al terminar, `pnpm test:ci` y `pnpm build`.
- **No toques** sin que te lo pidan explícitamente: `drizzle/` ya aplicado,
  `.env*`, `pnpm-lock.yaml`, configuración de Vercel.
- **Ante una regla de negocio dudosa**, busca en `docs/erp-legacy/` antes de
  suponer. Si no está documentada, pregúntale al usuario en vez de inventarla.
- **Si un comando falla dos veces igual**, para y explica qué intentaste. No
  repitas el mismo intento.
- Comentarios: explican **por qué**, no qué hace la línea. En español.

## 11. Herramientas del repo (Claude Code)

- Subagentes en `.claude/agents/`: `revisor`, `datos`, `erp-legacy`, `ui`.
- Comandos: `/contexto`, `/ruta-api`, `/migracion`, `/revisar`, `/pr`.
- Skill `modulo-erp` para dar de alta un módulo completo del ERP.

Detalle de cada uno en [`docs/trabajar-con-ia.md`](docs/trabajar-con-ia.md).
