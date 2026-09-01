---
description: Cambia el esquema y genera la migración correspondiente
argument-hint: [qué cambia — p. ej. "agregar columna prioridad a ordenes_trabajo"]
allowed-tools: Read, Grep, Glob, Edit, Bash
---

Cambio de esquema: **$ARGUMENTS**

Usa el subagente `datos` y sigue este orden sin saltarte pasos:

1. Lee `apps/web/src/db/schema.ts` y ubica la tabla.
2. Aplica el cambio. Nombre en `snake_case` en la base, `camelCase` en TypeScript.
   Si la columna es `NOT NULL` en una tabla con datos, necesita `DEFAULT`.
3. `pnpm db:generate`.
4. **Muéstrame el SQL generado** antes de aplicar nada. Si contiene `DROP COLUMN`,
   `DROP TABLE` o un cambio de tipo que pierde datos, detente y espera mi
   confirmación explícita.
5. `pnpm db:migrate`.
6. Actualiza lo que dependa: tipos de `src/lib/`, el mapeo a snake_case si aplica
   (`aPerfil()` en `users.ts` es el ejemplo), `scripts/seed.ts`, y los tests.
7. `pnpm test:ci` y `pnpm build`.

Cierra diciéndome: qué archivo de migración se creó, y qué hay que correr en la
rama de Neon de producción cuando esto se publique.
