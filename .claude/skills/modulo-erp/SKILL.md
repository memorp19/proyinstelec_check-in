---
name: modulo-erp
description: Da de alta un módulo completo del ERP de Proyinstelec (tabla, lógica, permisos, API, pantalla y tests) siguiendo el orden y las convenciones del proyecto. Úsala cuando haya que implementar una fase del plan de migración — órdenes de trabajo, control operativo, weekly, KPIs — o cualquier módulo nuevo del ERP.
---

# Alta de un módulo del ERP

Un módulo se construye **de abajo hacia arriba**. Cada capa se termina y se prueba
antes de pasar a la siguiente; así un error aparece en la capa donde nació y no
tres niveles más arriba.

## Paso 0 — Reglas antes que código

Lee el análisis del módulo en `docs/erp-legacy/` y su fase en
`docs/plan-migracion-erp.md` (secciones 4 y 5). Escribe una lista corta de:
formato de folio, estados y transiciones permitidas, quién puede hacer qué,
validaciones obligatorias, correos que dispara.

Si algo no está documentado, **pregunta al usuario**. No deduzcas reglas de negocio.

## Paso 1 — Datos

Agrega las tablas a `apps/web/src/db/schema.ts`, con:

- Índices únicos para lo que no puede repetirse (así no hace falta verificar antes
  de insertar: se atrapa el `23505`).
- Índices para los filtros de la pantalla.
- `createdAt` / `updatedAt` como en las tablas existentes.

`pnpm db:generate`, revisa el SQL, `pnpm db:migrate`.

## Paso 2 — Permisos

Agrega las llaves al catálogo `PERMISOS` de `apps/web/src/lib/permisos.ts` y
métete a `GRUPOS_PERMISOS` para que aparezcan en el panel de admin. Convención:
`modulo.<nombre>` para entrar, `<modulo>.<accion>` para acciones concretas.

## Paso 3 — Lógica de dominio

Un archivo en `apps/web/src/lib/<modulo>.ts` con las operaciones puras contra la
base. Sin HTTP, sin `session`, sin `NextResponse`.

Recuerda: **no hay transacciones**. Atomicidad con `ON CONFLICT`,
`UPDATE … RETURNING` o el contador de `folios.ts`. Si el flujo tiene varios pasos
encadenados, ponlo en `<modulo>-flujos.ts` como hace `cotizaciones-flujos.ts`.

## Paso 4 — Tests de la lógica

`apps/web/src/__tests__/lib/<modulo>.test.ts`, mockeando `@/src/db` con el
helper `dbFalso` (copia el arranque de `src/__tests__/lib/clientes.test.ts`).
Cubre camino feliz, transición de estado inválida, duplicado (`errorDuplicado()`)
y los límites del folio. Deben pasar antes de seguir.

## Paso 5 — API

`apps/web/app/api/erp/<modulo>/route.ts` y sus subrutas. Cada método:
`auth()` → `exigirPermiso()` → parseo con `try/catch` → llamada a `lib` →
`try/catch` con `console.error("[erp/<modulo>]", err)`.

Tests en `apps/web/src/__tests__/api/`: 401 sin sesión, 403 sin permiso, 200 feliz,
422 de validación.

## Paso 6 — Pantalla

`apps/web/app/erp/<modulo>/`. Usa el subagente `ui`. Server Component para cargar,
`"use client"` solo donde hay interacción. Copia la estructura de
`app/erp/cotizaciones/`. La pantalla esconde según permisos, pero la API es la que
protege.

## Paso 7 — Cierre

- Agrega el módulo al menú/navegación con su permiso de entrada.
- `pnpm test:ci`, `pnpm lint`, `pnpm build`.
- Actualiza la fase correspondiente en `docs/plan-migracion-erp.md`.
- Nota en el PR de qué hay que correr en la base de producción.

## Verificación final

Antes de darlo por hecho, comprueba en voz alta: ¿un usuario **sin** el permiso
puede llegar a los datos llamando la API directamente? ¿El folio se puede duplicar
si dos personas guardan al mismo tiempo? ¿Un estado puede saltarse un paso del
flujo? Si alguna respuesta es sí, todavía no está.
