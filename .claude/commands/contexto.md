---
description: Orienta al agente antes de empezar a trabajar en algo
argument-hint: [módulo o tarea, p. ej. "cotizaciones" o "arreglar el filtro de clientes"]
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git log:*), Bash(git branch:*)
---

Voy a trabajar en: **$ARGUMENTS**

Antes de escribir código, oriéntate y dime en qué terreno estoy pisando:

1. Estado del repo: rama actual, si hay cambios sin commitear, últimos 3 commits.
2. Qué archivos de `apps/web/src/lib/`, `apps/web/app/` y `apps/web/src/__tests__/`
   tocan lo que voy a hacer.
3. Qué dice `docs/plan-migracion-erp.md` sobre esta parte: ¿de qué fase es, está
   implementada, se simplificó a propósito?
4. Si es una regla de negocio del ERP, qué encontró `docs/erp-legacy/` al respecto.
5. Qué helpers ya existentes debería reutilizar en vez de escribir de nuevo.
6. Los riesgos concretos de este cambio (migración necesaria, permisos nuevos,
   datos históricos que dependen de esto).

Responde en una nota breve. **No modifiques ningún archivo todavía**: termina
proponiendo un plan de 3 a 6 pasos y espera mi visto bueno.
