# Trabajar con IA en este proyecto

El repositorio trae un *harness*: archivos que le dan a un asistente de IA el
contexto y los procedimientos del proyecto, para que no tengas que explicárselos
cada vez. Funciona con **Claude Code**; el contexto principal (`AGENTS.md`) lo
leen también Cursor, Codex y Copilot.

No necesitas configurar nada: basta con abrir el proyecto y empezar.

---

## Qué hay dentro

| Archivo | Para qué sirve |
| --- | --- |
| `AGENTS.md` | Contexto canónico: stack, comandos, arquitectura, reglas que no se rompen. Se carga solo en cada sesión. |
| `CLAUDE.md` | Solo apunta a `AGENTS.md`. No escribas nada aquí. |
| `.claude/agents/` | Subagentes especializados (ver abajo). |
| `.claude/commands/` | Comandos con `/` para tareas repetidas. |
| `.claude/skills/` | Procedimientos largos, como dar de alta un módulo del ERP. |
| `.claude/settings.json` | Permisos compartidos del equipo: qué puede correr la IA sola y qué te pregunta. |

## Los subagentes

Se invocan solos cuando aplican, o los llamas por nombre ("usa el agente
`revisor`"). Cada uno arranca con su propio contexto limpio, así no se contamina
la conversación principal.

- **`revisor`** — revisa tu diff contra las reglas del proyecto y te da hallazgos
  por severidad. Llámalo **siempre** antes de abrir un PR.
- **`datos`** — esquema Drizzle, migraciones, consultas sobre Neon.
- **`erp-legacy`** — busca en `docs/erp-legacy/` cómo funcionaba el sistema viejo.
  Úsalo antes de implementar cualquier regla del ERP.
- **`ui`** — pantallas y componentes con el sistema de diseño de la app.

## Los comandos

Escribes la diagonal y el nombre en el chat:

- **`/contexto cotizaciones`** — te orienta antes de empezar: qué archivos tocan
  eso, qué dice el plan, qué helpers reutilizar. Termina con un plan y espera tu ok.
- **`/ruta-api /api/erp/ot modulo.ot`** — crea una route handler con el patrón del
  proyecto (auth, permiso, validación, lógica en `lib`, tests).
- **`/migracion agregar columna prioridad a ordenes_trabajo`** — cambia el esquema
  y genera la migración, enseñándote el SQL antes de aplicarlo.
- **`/revisar`** — revisión completa: subagente `revisor` + tests + lint + build.
- **`/pr`** — prepara el mensaje de commit y la descripción del PR. No hace push.

## Un día de trabajo típico

```
git checkout develop && git pull
git checkout -b feature/filtro-por-gerencia

/contexto filtrar cotizaciones por gerencia
  → lees el plan que propone, lo ajustas, das el ok
  → trabajas junto con la IA

/revisar
  → arreglas lo que salga

/pr
  → apruebas el mensaje, la IA hace el commit

git push -u origin feature/filtro-por-gerencia
  → abres el PR en GitHub
```

## Reglas de la casa

1. **Tú firmas el código, no la IA.** Lee lo que genera antes de commitear. Si no
   entiendes una línea, pregúntale por qué la escribió; si sigue sin quedar claro,
   no la subas.
2. **Contexto pequeño, resultados mejores.** Una tarea por conversación. Cuando
   cambies de tema, arranca una sesión nueva (`/clear`).
3. **Nunca pegues secretos en el chat.** Ni cadenas de conexión, ni llaves de
   Google, ni el contenido de `.env.local`.
4. **Si algo falla dos veces igual, para.** Pregunta en el equipo en vez de dejar
   que la IA intente una tercera variante del mismo error.
5. **Las reglas de negocio no se inventan.** Si no están en `docs/erp-legacy/`,
   pregunta antes de suponer: hay datos históricos que dependen de ellas.
6. **`main` no se toca.** Todo sale de `develop` y entra por PR.

## Cuando cambies una convención

Si el equipo decide algo nuevo (una forma de nombrar, un patrón, una regla),
actualiza **`AGENTS.md`** en el mismo PR. Un harness desactualizado es peor que no
tenerlo: la IA lo seguirá al pie de la letra.
