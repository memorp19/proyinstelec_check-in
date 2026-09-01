## Qué cambia

<!-- Una o dos frases. Qué hace el usuario ahora que antes no podía. -->

## Por qué

<!-- Problema o requerimiento que resuelve. Enlaza la tarea si existe. -->

## Cómo probarlo

1.
2.
3.

## Checklist

- [ ] `pnpm test:ci` pasa
- [ ] `pnpm lint` pasa
- [ ] `pnpm build` pasa
- [ ] Lógica nueva en `src/lib/` tiene test (camino feliz **y** error)
- [ ] Las rutas de API nuevas validan `auth()` + `exigirPermiso()`
- [ ] Si cambió `src/db/schema.ts`, la migración está generada y aplicada
- [ ] No hay secretos, `.env*` ni archivos generados en el diff
- [ ] Reutilicé el sistema de diseño (tokens de Tailwind), no inventé estilos

## Base de datos

<!-- ¿Hay que correr algo en la rama de producción de Neon? Si no, escribe "nada". -->

## Se usó IA en este cambio

- [ ] Sí — revisé línea por línea el código generado y corrí `/revisar`
- [ ] No
