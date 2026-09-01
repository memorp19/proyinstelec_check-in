---
description: Revisión completa antes de pedir un PR
allowed-tools: Read, Grep, Glob, Bash
---

Revisa mi trabajo antes de que abra el PR.

1. Lanza el subagente `revisor` sobre el diff contra `develop`.
2. En paralelo corre `pnpm test:ci`, `pnpm lint` y `pnpm build`.
3. Comprueba a mano lo que las herramientas no ven:
   - ¿Hay archivos que no deberían estar en el diff (`.env*`, `pnpm-lock.yaml`
     sin razón, `coverage/`, capturas, archivos temporales)?
   - ¿Cambió `src/db/schema.ts` sin su migración en `drizzle/`?
   - ¿Los mensajes de commit siguen el formato (`feat:`, `fix:`, `docs:`, …)?

Dame un veredicto en una línea — **listo** o **no listo** — y debajo la lista de
lo que falta, ordenada por importancia. Si algo falla, arréglalo solo si es
mecánico (formato, import sin usar, test que quedó desalineado); para cualquier
cambio de comportamiento, propón y espera.
