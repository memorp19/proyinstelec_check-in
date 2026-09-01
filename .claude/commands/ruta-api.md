---
description: Crea una route handler nueva siguiendo el patrón del proyecto
argument-hint: <ruta> <permiso> — p. ej. /api/erp/ot modulo.ot
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

Crea la route handler: **$ARGUMENTS** (primer argumento = ruta, segundo = permiso
del catálogo que exige).

Sigue exactamente el patrón del proyecto:

1. Lee una ruta hermana como referencia
   (`apps/web/app/api/erp/cotizaciones/route.ts`) y cópiale la estructura.
2. Verifica que el permiso exista en `apps/web/src/lib/permisos.ts`. Si no existe,
   **detente y pregúntame** antes de agregarlo al catálogo.
3. Cada método (`GET`, `POST`, `PATCH`, …) empieza igual:

   ```ts
   const session = await auth();
   const rechazo = exigirPermiso(session?.user, "<permiso>");
   if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });
   ```

4. Parsea el body con `try/catch` → `400 Body inválido`. Valida los campos contra
   los tipos del dominio y devuelve `422` con un mensaje en español cuando algo no
   cuadre.
5. La lógica va en una función de `apps/web/src/lib/`, no en la ruta. Si no existe,
   créala ahí y expórtala.
6. `try/catch` alrededor de la parte que toca la base:
   `console.error("[ruta]", err)` y `500` con el mensaje.
7. Escribe el test en `apps/web/src/__tests__/api/`, mockeando `@/src/db` con
   `dbFalso`. Cubre: sin sesión (401), sin permiso (403), caso feliz, y un error
   de validación.
8. Corre el test del archivo y `pnpm lint`.

Al terminar dime qué ruta quedó, qué permiso exige y qué casos cubre el test.
