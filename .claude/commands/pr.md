---
description: Prepara commit y descripción de PR
argument-hint: [resumen en una frase, opcional]
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git branch:*)
---

Prepara el commit y el PR. Contexto que te doy: $ARGUMENTS

1. `git status` y `git diff develop...HEAD` para ver qué hay realmente.
2. Verifica que **no** estoy en `main` ni en `develop`. Si lo estoy, dímelo y
   propón el nombre de rama (`feature/...` o `fix/...`) — no la crees sin mi ok.
3. Confirma que no se cuela ningún archivo con secretos ni basura generada.
4. Agrupa los cambios y propón el mensaje de commit: prefijo (`feat:`, `fix:`,
   `docs:`, `refactor:`, `test:`, `chore:`), en español, imperativo, primera línea
   de menos de 72 caracteres.
5. Redacta la descripción del PR siguiendo `.github/pull_request_template.md`,
   llenando de verdad cada sección con lo que muestra el diff.

**No hagas `git push`.** Enséñame el mensaje y la descripción; yo apruebo, y solo
entonces haces el commit.
