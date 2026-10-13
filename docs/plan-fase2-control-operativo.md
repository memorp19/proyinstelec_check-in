# Plan de la Fase 2 — OT y Control Operativo

Plan de implementación acordado para la Fase 2 del
[plan de migración](plan-migracion-erp.md). El inventario funcional del sistema
viejo está en [`erp-legacy/analisis-ot-control-operativo.md`](erp-legacy/analisis-ot-control-operativo.md);
este documento decide **cómo** se construye en la app nueva y **en qué orden**.

Las reglas de arquitectura (autorización en servidor, sin transacciones
interactivas, lógica en `src/lib/`) son las de [`AGENTS.md`](../AGENTS.md) §4.

---

## 1. Bloqueo previo: integrar la rama de OT

La rama `feat/control-operativo` se creó desde `4dd3310`, que **no contiene** el
trabajo de OT. Estos dos commits siguen sin integrar, en `fix/validar-ot-folder-id`:

```
4b3443e  feat(erp): listado de OT y validación de la raíz de Drive
efc2a9d  feat(erp): monto por moneda y reglas de generación de OT
```

Lo que aportan y que la Fase 2 usa como cimiento:

| Aporta | Por qué se necesita antes |
|---|---|
| `app/api/erp/ot/route.ts` y `ot/[folio]/route.ts` | son las lecturas sobre las que cuelga la ficha |
| `app/erp/ot/` (page + `OTClient.tsx`) | el nivel 1 del listado; la ficha es su nivel 2 |
| `.../cotizaciones/[key]/ot/route.ts` | la vía de generación de OT sin orden de compra |
| migración `0002_montos_y_ot_sin_oc.sql` | sin ella `orden_compra` sigue `NOT NULL` y la OT sin OC no funciona |
| `src/__tests__/lib/ot.test.ts` | red de seguridad de `src/lib/ot.ts` |

**No se empieza ningún PR de Fase 2 hasta que esto esté integrado.** Si se
generara una migración antes, tomaría el número `0002` y colisionaría con la de
esa rama en `drizzle/meta/_journal.json`.

Nota de ramas: `develop` está 18 commits detrás de `main` y no tiene commits
propios. AGENTS.md §9 manda ramar de `develop`; conviene adelantarla
(fast-forward) para que la regla siga siendo cierta.

---

## 2. Corrección del modelo de OT

Dos cosas del modelo actual están mal y hay que arreglarlas **antes** de
construir el control operativo encima.

### 2.1 Una OT tiene hasta TRES responsables simultáneos

El modelo actual asume uno solo. El error no es solo conceptual: hoy se pierden
datos en silencio.

`responsablesActivosPorFolio` devuelve `Record<string, ResponsableOT>` y arma el
índice con `Object.fromEntries`, que **conserva únicamente la última fila de cada
folio**. Con tres responsables activos, dos desaparecen y cuál sobrevive depende
del orden en que Postgres devuelva las filas. Además `registrarResponsable`
desactiva a *todos* los activos antes de insertar, lo que impide tener más de uno.

Cambios necesarios, en orden de dependencia:

1. **Esquema.** Columna `slot` (`smallint`, 1-3) en `ot_responsables` con
   `CHECK (slot BETWEEN 1 AND 3)` y un índice único parcial
   `UNIQUE (folio_ot, slot) WHERE activo`.

   El tope de 3 se impone **en la base, no en la lib**: la regla 2 prohíbe
   leer-y-luego-escribir, y un `INSERT … SELECT … WHERE (SELECT count(*) …) < 3`
   no es seguro bajo `READ COMMITTED` (dos altas concurrentes pueden ver 2 y
   dejar 4). Con el índice parcial, la segunda alta al mismo slot revienta con
   `23505` y se reintenta en el siguiente slot libre — el mismo idioma que ya
   usa `createOT` para el folio duplicado.

2. **`src/lib/ot.ts`:**
   - `responsablesActivosPorFolio` → `Record<string, ResponsableOT[]>`.
   - `registrarResponsable` se parte en `agregarResponsable` (ocupa un slot
     libre; error claro si ya hay 3) y `desactivarResponsable(id)` (un solo
     `UPDATE`). Las filas con `activo = false` se conservan como historial,
     igual que hoy.
   - `reemplazarResponsable` = desactivar + agregar. Son dos sentencias; si la
     segunda falla la OT queda con un responsable menos, nunca con datos
     inconsistentes. Se documenta en el código.

3. **`app/api/erp/ot/route.ts`:** el campo `responsable: Responsable | null` del
   JSON pasa a `responsables: Responsable[]`.

4. **`app/erp/ot/OTClient.tsx`:** el tipo de la fila y la línea que hoy pinta
   `o.responsable.correo` (una sola persona) pasan a listar hasta tres.

La designación inicial que hace `generarOT` sigue siendo válida: designa al
primero, y los otros dos se agregan después.

### 2.2 El estatus de la OT tiene CUATRO valores, y salen del Control de OT

El análisis del legacy había registrado siete valores observados
(PROCESO / EN PROCESO / ASIGNADA / TERMINADO / CERRADO / CANCELADO / FACTURADO).
Los reales son cuatro, y ahora se sabe de dónde vienen: del **Control de Órdenes
de Trabajo 2026**, que es la hoja donde el equipo lleva el estatus de cada OT.
Su catálogo tiene tres valores más el guion de "todavía no hay OT":

```
PROCESO · REVISIÓN · TERMINADO        ("-" = la cotización aún no tiene OT)
```

Con el mapeo al catálogo de la app:

| Control de OT 2026 | Estatus en la app |
|---|---|
| — | `""` (la OT nace vacía) |
| `PROCESO` | `En Proceso` |
| `REVISIÓN` | `Revisión` |
| `TERMINADO` | `Cerrado` |

```
(vacío) → En Proceso → Revisión → Cerrado
                ↑__________|
```

**Corrección de la versión anterior de esta sección.** Decía que los cuatro
valores eran `(vacío) → Asignado → En Ejecución → Cerrado`. Eso era una lectura
del legacy, no de la operación: **ninguna de las tres fuentes usa `Asignado` ni
`En Ejecución`** —ni el Control de OT, ni el de Cotizaciones, ni el de Proceso—,
así que eran dos estados que el código ofrecía y nadie escribía nunca. Salen del
catálogo. `TERMINADO`, `FACTURADO` y `EN PROCESO` tampoco existen como valores
guardados: `TERMINADO` es la grafía del Excel, que se mapea a `Cerrado`.

`PROCESO` a secas era un estatus de *cotización* filtrado a la tabla de OT; son
dos ejes distintos (la cotización llega a `ASIGNADA` justo cuando nace la OT).
El default de la columna pasó a vacío y `createOT` ya no lo escribe.

Transiciones, en `transicionValidaOT`, copiando el patrón de `transicionValida`
en [`src/lib/cotizaciones.ts`](../apps/web/src/lib/cotizaciones.ts):

| De | Puede pasar a |
|---|---|
| `""` (vacío) | `En Proceso` |
| `En Proceso` | `Revisión` |
| `Revisión` | `Cerrado`, `En Proceso` |
| `Cerrado` | — (terminal) |

El regreso `Revisión → En Proceso` es el **retrabajo**: el cliente revisa y pide
corregir. Sin él, la única salida de `Revisión` sería cerrar la OT o tocar SQL.

`Cerrado` es terminal: reabrir una OT cerrada no es mover un estatus, es un
hecho administrativo que necesita su propia regla y su propio rastro. La
cancelación de OT no aparece en la operación real; no se inventa.

**La columna no tiene `CHECK`.** Es `text`, así que la base acepta cualquier
cosa y una carga por SQL puede dejar un valor que la app no conoce. El código no
lo normaliza —adivinar la intención escondería el dato malo—: `transicionesDesdeOT`
devuelve lista vacía, la OT se queda quieta y la pantalla la marca en ámbar con
el valor crudo a la vista. Agregar el `CHECK` queda para un PR propio, después
de la recarga desde los Excel.

---

## 3. Tablas

Ya existen y se reutilizan: `ordenes_trabajo`, `ot_responsables`, `contadores`,
`bitacora`, `config_erp`.

### 3.1 `ot_documentos`

Le da su primer llamador al permiso `ot.documentos`. Campos:
`id` · `folio_ot` (FK `ON DELETE CASCADE`) · `tipo`
(OC / Factura / Evidencia / Entregable / Reporte / Otro) · `nombre` ·
`drive_file_id` · `carpeta` · `subido_por` · `fecha`. Índice por `folio_ot`.

Es el registro de "quién subió qué y cuándo" que en el legacy quedaba implícito
en Drive.

### 3.2 `pendientes`

El corazón del control operativo. Campos del archivo CO legacy (columnas B-R),
con dos cambios deliberados:

- **PK compuesta `(folio_ot, pd)`**, porque `PD-###` solo es único dentro de su OT.
- **No hay columna `estatus_real`.** En el legacy era una fórmula del Sheet.
  Aquí `Vencido` se calcula al leer (decisión D3): nunca se guarda y nunca es
  elegible a mano.

El resto: `descripcion` (≥5 caracteres) · `categoria` · `detectado_por`
(iniciales) · `responsable_correo` · `fecha_deteccion` · `fecha_compromiso`
(obligatoria) · `estatus` manual · `prioridad` (default Media) · `equipo`
(default Proyinstelec) · `accion_correctiva` · `evidencia` · `comentarios` ·
`actualizado_at` · `actividad_id` **nullable**, reservado para el vínculo con el
Weekly de la Fase 3.

Estatus manuales: `Abierto` · `En Proceso` · `Dependiente Cliente` · `Cerrado`.

### 3.3 `servicios`

Los renglones `SRV-###`. `folio` PK (contador global corrido, como el legacy) ·
`folio_ot` · `tipo` (Servicio / Suministro / Ambos) · `fecha_inicio` ·
`fecha_fin` · **`fecha_original`** · `personas` (`text[]` de correos) ·
`personas_externas` · `estatus` · `pendiente_origen` · `definido_por` · `notas`
(bitácora acumulativa) · `created_at`.

`fecha_original` **nunca se toca** después del primer movimiento: es el rastro de
cuánto se movió el servicio. Se protege no incluyéndola jamás en el `SET` de un
`UPDATE`.

Estatus: `Programado` → `En curso` → `Concluido`; `Cancelado` es terminal y solo
se llega por su propia vía.

### 3.4 Lo que deliberadamente NO es tabla

**Cabecera de control operativo.** El legacy guarda un registro de cabecera con
OT, proyecto, cliente, responsable y estatus. Todos esos campos ya viven en
`ordenes_trabajo` y `ot_responsables`; duplicarlos reintroduce la doble fuente de
verdad que D3 elimina. En su lugar: el control existe cuando
`ordenes_trabajo.tiene_control_operativo = true` (la columna ya existe y hoy
nadie la escribe), más dos columnas nuevas: `control_creado_por` y
`control_creado_at`. Las tres se escriben en el mismo `INSERT` que crea la OT
(§7.1), así que el control no cuesta ni una sentencia extra.

**Catálogos** de categorías, prioridades, equipos y tipos de documento:
constantes en `src/lib/`, como manda el plan de migración §5
("catálogos en código/config").

**Contadores.** No hace falta tabla nueva. `contadores.tipo` es `text` PK, así
que los PD por OT caben como filas `pendiente-OT001260`. Eso resuelve la nota
pendiente en [`src/lib/folios.ts`](../apps/web/src/lib/folios.ts): el tipo
`"pendiente"` estaba reservado y lo que faltaba decidir era justamente que la
numeración es **por OT**. `folioServicio` usa el contador global `"servicio"` sin
cambios.

---

## 4. Reglas derivadas (se calculan al leer, nunca se guardan)

### 4.1 Vencido

```
estatus <> 'Cerrado' AND fecha_compromiso < now()
```

### 4.2 Los seis indicadores

Pendientes **Totales · Abiertos · En Proceso · Dependiente Cliente · Vencidos ·
Cerrados**.

Ojo al leerlos: `Abiertos + En Proceso + Dependiente Cliente + Cerrados =
Totales`, pero **`Vencidos` es transversal** — un vencido es cualquier pendiente
no cerrado con la fecha pasada, así que ya está contado en una de las otras tres
tarjetas. Las seis cifras no suman al total y la UI no debe sugerir que sí.

Se calculan en **una sola consulta** con `count(*) FILTER (WHERE …)`, no con seis
consultas ni en memoria.

### 4.3 Semáforo y avance

- `vencidos > 0` → **ATRASADO**
- si no, `activos > 0` → **EN SEGUIMIENTO**
- si no → **CONTROLADO**

Avance % = `cerrados / totales`.

### 4.4 Numeración de PD con huecos

Los `PD-###` van corridos **por OT** y **admiten huecos** (`PD-002`, `PD-003`,
`PD-012` es una secuencia válida). Consecuencias:

- Se numeran con `siguienteNumero('pendiente-' || folioOt)`, que nunca reutiliza
  un número: si un alta falla, ese número se quema. Eso es el comportamiento
  deseado, no un defecto.
- **Nunca** se calcula el siguiente PD con `count(*) + 1` ni se rellenan huecos
  (AGENTS.md §6 ya lo prohíbe para folios).

---

## 5. Permisos

Ya están en el catálogo `modulo.ot`, `modulo.control.operativo`, `ot.crear`,
`ot.documentos` y `control.operativo.crear`. La Fase 2 les da su primer llamador
a los tres últimos.

**`control.operativo.crear` es un permiso de excepción**, no del flujo normal. El
control operativo se crea solo, junto con la OT (§7.1); este permiso cubre
únicamente repararlo en OT importadas del sistema viejo o en alguna que haya
quedado sin control. Conviene dárselo a poca gente y no ponerlo en la ruta de
alta.

**Se agrega uno nuevo: `ot.reasignar`** (al catálogo `PERMISOS` y al grupo
"Órdenes de Trabajo" de `GRUPOS_PERMISOS`). El reparto queda así:

| Acción | Permiso |
|---|---|
| Designar responsable al registrar la OC (o en la vía sin OC) | `ot.crear` — sin cambios |
| Agregar un responsable adicional (hasta 3) a mitad del proyecto | `ot.reasignar` |
| Desactivar o reemplazar un responsable | `ot.reasignar` |
| Cambiar el equipo de campo de un servicio | responsable activo de la OT (el líder) |

Por qué separarlo de `ot.crear`: `ot.crear` es un permiso comercial — lo tiene
quien registra la orden de compra. Reasignar a mitad del proyecto es una decisión
de operación. Separarlos permite dar reasignación a jefes de área sin darles
también el alta de OT.

El **equipo de campo es el tercer eje** y no requiere `ot.reasignar`: lo decide
el líder del proyecto, no la gerencia. La gerencia solo se entera de las
*reprogramaciones* (ver §7.4).

**Candado de fecha compromiso.** En el legacy, mover la `fecha_compromiso` de un
pendiente exigía `actividades.confirmar`, y los demás pedían reprogramación por
el flujo de solicitudes `SOL-####`. Ese flujo es Fase 3. En la Fase 2:
`fecha_compromiso` solo se mueve con `actividades.confirmar` (el permiso ya
existe) y la vía de solicitud llega después.

---

## 6. Rutas de API

Toda la lógica en `src/lib/pendientes.ts`, `src/lib/servicios.ts` y
`src/lib/documentos-ot.ts`; las rutas parsean, validan permiso y llaman a la lib
(AGENTS.md §4).

```
PATCH  /api/erp/ot/[folio]                      estatus de la OT (máquina §2.2)
POST   /api/erp/ot/[folio]/responsables         agregar          → ot.reasignar
DELETE /api/erp/ot/[folio]/responsables/[id]    desactivar       → ot.reasignar

GET    /api/erp/ot/[folio]/documentos           listar carpeta + subcarpetas
POST   /api/erp/ot/[folio]/documentos           subir            → ot.documentos
POST   /api/erp/ot/[folio]/carpetas             crear subcarpeta → ot.documentos

POST   /api/erp/ot/[folio]/control              SOLO excepción   → control.operativo.crear
GET    /api/erp/ot/[folio]/pendientes           listar (Vencido calculado)
POST   /api/erp/ot/[folio]/pendientes           alta de pendiente
PATCH  /api/erp/ot/[folio]/pendientes/[pd]      editar / cambiar estatus

POST   /api/erp/ot/[folio]/servicios            definir fecha (cierra el PD origen)
PATCH  /api/erp/servicios/[folio]               cambiar estatus
POST   /api/erp/servicios/[folio]/reprogramar   motivo ≥5
POST   /api/erp/servicios/[folio]/cancelar      motivo ≥5
POST   /api/erp/servicios/[folio]/equipo        cambio de equipo, 3 correos

GET    /api/erp/control-operativo               cobertura + indicadores del panel
POST   /api/cron/avisos-vencimiento             trigger diario (Vercel cron)
```

`src/lib/drive-erp.ts` necesita dos funciones nuevas: listar una carpeta con sus
subcarpetas (1 nivel) y crear subcarpeta idempotente. Hoy solo tiene
`ensureCarpetaOT` y `subirArchivoErp`.

---

## 7. Operaciones que necesitan cuidado (regla 2: sin transacciones)

### 7.1 El control operativo nace con la OT — ninguna OT existe sin él

**Regla de negocio: cada OT tiene su control operativo, y se crea en el mismo
momento que la OT.** No es un acto explícito del usuario, no es opcional y no
hay un estado intermedio de "OT sin control". Si existe la OT, existe su
control.

Las dos vías de alta se comportan igual —la que recibe orden de compra y la que
no— porque ambas comparten el núcleo `generarOT` de
`src/lib/cotizaciones-flujos.ts`. El control se crea en un solo lugar y las dos
lo heredan sin duplicar lógica.

**Se crea en la misma transacción que la OT**, no en un paso posterior. El
driver HTTP de Neon no tiene transacciones interactivas, así que el alta pasa a
ser un lote: el `INSERT` de `ordenes_trabajo`, el del control y el del `PD-001`
automático viajan juntos y entran o no entran los tres. Es lo que convierte la
regla en una garantía en vez de una intención: sin lote, un fallo entre el
primer insert y el segundo dejaría exactamente la OT sin control que la regla
prohíbe.

#### Las OT que ya existen

Una **migración con backfill** crea el control de todas las OT anteriores, **las
93 importadas de 2026 incluidas**. Va en la misma migración que crea la tabla,
para que no haya ni un despliegue en el que la regla sea falsa:

```sql
INSERT INTO control_operativo (folio_ot, creado_por, creado_at)
SELECT folio, 'migracion', created_at FROM ordenes_trabajo
ON CONFLICT (folio_ot) DO NOTHING;
```

`creado_at` toma el `created_at` de su OT y no `now()`: el control nació con la
OT, y fecharlo el día de la migración diría que todos los controles se crearon
el mismo día.

#### `tiene_control_operativo` queda redundante

Hoy la columna es `boolean NOT NULL DEFAULT false` y **nada en el código le
escribe `true` nunca** — ni una ruta, ni un script. Con la regla de arriba
cumplida, su respuesta es siempre la misma: toda OT tiene control.

En esta fase se resuelve de una de las dos formas, y es decisión al implementar:

- **Eliminarla**, si el control vive en su propia tabla con `folio_ot` único: la
  pregunta la responde la existencia de la fila.
- **Derivarla**, como columna generada o como vista, si conviene conservar el
  nombre para no tocar los lectores.

Lo que no se queda es una columna que afirma algo que nadie mantiene. Mientras
tanto, la pantalla de OT **no muestra ninguna etiqueta** de "sin control
operativo": señalaba una carencia en el 100% de las filas, y lo que faltaba era
la funcionalidad, no el dato.

### 7.2 Ruta de excepción: OT sin control

`POST /api/erp/ot/[folio]/control` con el permiso `control.operativo.crear` deja
de ser parte del flujo normal. Con §7.1 cumplida —alta en el mismo lote y
backfill de las existentes— no debería hacer falta nunca: queda como reparación
para el caso en que un control se pierda por una intervención manual en la base.

Tiene que ser idempotente, en una sola sentencia:

```sql
INSERT INTO control_operativo (folio_ot, creado_por, creado_at)
VALUES ($1, $2, now())
ON CONFLICT (folio_ot) DO NOTHING
RETURNING folio_ot
```

Cero filas devueltas = ya tenía control, así que se devuelve el existente sin
duplicar (regla del legacy) y sin leer-luego-escribir.

Que esta ruta se use es, en sí, una señal: significa que algo rompió la regla de
§7.1. El detector de excepciones del panel (§8) es el que debe encontrarlo.

### 7.3 Reprogramar un servicio

```sql
UPDATE servicios SET fecha_inicio = …, fecha_fin = …
 WHERE folio = $1 AND estatus <> 'Cancelado'
RETURNING *
```

Rechaza los cancelados sin consultarlos antes. `fecha_original` no aparece en el
`SET`, nunca.

### 7.4 Cambiar el equipo de campo

Los tres correos (SALEN / ENTRAN / SIGUEN) necesitan el equipo **anterior**, que
un `UPDATE … RETURNING` no devuelve. Patrón compare-and-swap: leer el equipo,
luego `UPDATE … WHERE folio = $1 AND personas = <las leídas>`; si devuelve cero
filas alguien más lo cambió y se reintenta una vez.

Validación: `personas` deben ser usuarios activos del catálogo;
`personas_externas` es texto libre. **Las dos vías se quedan** porque el catálogo
está incompleto: va personal de seguridad que acompaña al responsable y que hoy
no está dado de alta. Un `Suministro` no exige gente; `Servicio` y `Ambos`
exigen al menos una persona, de cualquiera de las dos listas.

Avisos: cambio de equipo y cancelación → solo al equipo. Reprogramación → equipo
**más gerencia** (activos con `dashboard.gerencial` o `actividades.ver.todas`).

### 7.5 Memoria de avisos de vencimiento

`bitacora.existeEvento(accion, referencia)` ya existe y es exactamente lo que
pide D7: tres avisos por pendiente en toda su vida (−3 días, −1 día, +1 día tras
vencer), con llave por aviso tipo `PD-001|OT001260|-3`. Un correo por persona por
día, con secciones VENCIÓ AYER / VENCE MAÑANA / VENCE EN 3 DÍAS. Cerrado nunca
avisa.

No hay crons configurados en el repo todavía: hay que agregar `vercel.json`.

---

## 8. Pantallas

- **Ficha de OT** `/erp/ot/[folio]` — nivel 2 del listado. Cuatro pestañas:
  **Resumen** (datos, responsables activos hasta 3, carpeta de Drive, tarjeta de
  control con semáforo), **Cotización origen**, **Control Operativo** (los seis
  indicadores, barra de avance, servicios con sus acciones, tabla de pendientes
  con filtros), **Documentos** (tabla + subir + crear carpeta). Reutiliza
  `app/_components/SectionTabs.tsx`.

  El estado "Falta — crear" del legacy deja de ser normal: toda OT nueva llega
  con su control ya creado. Si aparece, es una excepción y la tarjeta debe decir
  eso, no ofrecer un alta rutinaria.
- **Panel de cobertura** `/erp/control-operativo` — barra de cobertura (verde
  ≥80 %, azul ≥40 %, ámbar), los seis indicadores agregados y tabla filtrable
  (con vencidos / con activos / todo cerrado).

  La sección "les falta control operativo" es un **detector de excepciones**, no
  parte del flujo normal. Su estado vacío es el estado sano, y **la UI tiene que
  decirlo con palabras** — algo como "Todas las OT tienen control operativo" —
  porque una sección vacía sin explicación va a parecer que algo se rompió o que
  no cargó. Lo que liste ahí son OT importadas del sistema viejo o casos a
  reparar, y conviene etiquetarlas así.
- **Cuatro modales del flujo normal:** subir documento, definir fecha de servicio
  (calendario con marca de fin de semana, tope 120 días), nuevo pendiente, crear
  carpeta (con sugerencias Facturas / Evidencias / Entregables / Bitácora).
  Más una **acción de reparación** (crear control) que vive solo en la sección de
  excepciones del panel.
- Al terminar, `disponible: true` en los dos módulos de
  [`app/erp/modulos.ts`](../apps/web/app/erp/modulos.ts) (hoy `false`).

Diseño: tokens existentes de Tailwind, área táctil mínima 44×44, sin librerías
de componentes nuevas (AGENTS.md §7).

---

## 9. Relación con la OT ya construida

`folio_ot` es la llave de todo. Los enganches concretos:

1. **`tiene_control_operativo`** ya existe y hoy nadie lo escribe. Pasa a
   escribirse en el `INSERT` de `createOT` (§7.1); alimenta el badge del listado
   y el detector de excepciones del panel.
2. **`drive_folder_id` ya se guarda al crear la OT**, así que la pestaña de
   documentos no necesita la resolución por nombre con triple fallback y caché
   del legacy. Esa complejidad desaparece. Es también lo que permite que el
   control operativo nazca "dentro de la carpeta de la OT" sin buscarla.
3. **`ot_responsables` con `activo`** da el responsable del `PD-001` automático
   y valida el equipo de un servicio.
4. **`getUserByIniciales`** (en `src/lib/users.ts`) es el puente para
   `detectado_por` y `responsable`, que el ERP maneja en iniciales.
5. **`ordenes_trabajo.areas`** clasifica el trabajo; `config_erp.areas_ot` es su
   catálogo.

**El pendiente es la fuente de verdad.** En el legacy, dar de alta un pendiente
creaba una actividad del Weekly y las dos copias se sincronizaban. Aquí no existe
tabla `actividades` (es Fase 3) y no se crea una: el `PD-001` automático
"Definir fecha del servicio" (categoría Operativo, prioridad Alta, vence a +5
días) nace como pendiente **junto con la OT**, y `pendientes.actividad_id` queda
nullable para que la Fase 3 enganche sin migrar datos. Es lo que D3 implica: el
pendiente y su actividad son el mismo dato relacionado, no dos copias.

Consecuencia de orden: el `PD-001` necesita la tabla `pendientes`, así que el
alta automática solo puede cablearse una vez que exista (PR 3). Entre el PR 0 y
el PR 3, las OT que se den de alta nacerán sin control y las recogerá el detector
de excepciones — que es justo para lo que sirve.

---

## 10. Fuera de alcance

- **Costos.** El legacy tiene la hoja `Gastos` vacía, sin origen de datos; el
  propio análisis lo deja anotado y `modulo.control.costos` no está en el
  catálogo de permisos. No se toca.
- **Vínculo con el Weekly** (actividades, solicitudes de reprogramación): Fase 3.
- **Importador** de las hojas OT / OT_Responsables y de los archivos "Control
  Operativo" de Drive: es el trozo con más incertidumbre y no bloquea que el
  equipo empiece a operar OTs nuevas. Va al final o en su propia fase.

---

## 11. Orden de los PR

Cada PR deja `pnpm test:ci`, `pnpm lint` y `pnpm build` en verde por sí solo, y
ninguno deja pantallas a medio cablear. Los números de migración arrancan
después de `0002`, que llega con la rama de OT.

| PR | Contenido | Por qué en este lugar |
|---|---|---|
| **0** | Integrar `fix/validar-ot-folder-id`; adelantar `develop` | sin esto la migración colisiona y falta el listado de OT |
| **1** | Hasta 3 responsables activos: `slot` + índice parcial, `lib/ot.ts`, ruta de listado, `OTClient`, permiso `ot.reasignar` | corrige pérdida silenciosa de datos; todo lo demás se construye encima |
| **2** | Estatus de OT: cuatro estados, `transicionValidaOT`, `PATCH /api/erp/ot/[folio]` | segunda corrección del modelo; independiente de la anterior en revisión |
| **3** | Esquema de Fase 2 (`ot_documentos`, `pendientes`, `servicios`) + `lib/pendientes.ts` y `lib/servicios.ts` + tests. **Sin UI ni rutas** | las derivaciones (Vencido, semáforo, avance, seis indicadores) son funciones puras: máximo valor por test, cero riesgo de UI |
| **4** | Documentos de OT: helpers de Drive, dos rutas, pestaña | activa `ot.documentos`; independiente del control operativo |
| **5** | Pendientes: rutas, pestaña, tarjetas, semáforo. Alta automática del control y del `PD-001` dentro de `generarOT` (las dos vías), más la ruta de excepción | el núcleo de la fase; toca `cotizaciones-flujos.ts`, así que necesita la tabla `pendientes` del PR 3 |
| **6** | Servicios: definir fecha, reprogramar, cancelar, cambio de equipo con los 3 correos, estatus | el bloque más grande de reglas; depende del PD origen del PR 5 |
| **7** | Panel de cobertura + `disponible: true` en los módulos | necesita datos reales de los PR 5 y 6 para verse |
| **8** | Avisos de vencimiento: `vercel.json` con cron, ruta, memoria en bitácora | aislarlo permite probar el cron sin bloquear el resto |
| **D** | Corregir [`plan-migracion-erp.md`](plan-migracion-erp.md): sigue diciendo DynamoDB single-table con GSIs y NextAuth v4 | **PR propio de documentación**, en cualquier momento; no se mezcla con código |

Tests: cada archivo de `src/lib/` con lógica no trivial lleva su test en
`src/__tests__/lib/`, con el helper `dbFalso`, cubriendo el camino feliz **y** el
error esperado — permiso faltante, tope de 3 responsables, transición inválida,
`Suministro` sin gente, motivo de reprogramación corto (AGENTS.md §8).

---

## 12. Decisiones cerradas

Quedaron acordadas con el usuario y no se vuelven a discutir sin motivo nuevo:

| Decisión | Dónde vive en este plan |
|---|---|
| Una OT tiene hasta **3 responsables simultáneos**; el tope se impone con índice único parcial | §2.1 |
| El estatus de OT tiene **4 valores**: (vacío) → Asignado → En Ejecución → Cerrado. `PROCESO` era de cotizaciones y se corrige | §2.2 |
| **Sin tabla de cabecera** de control operativo: solo el flag y dos columnas | §3.4 |
| El **control operativo se crea automáticamente** al dar de alta la OC, y la vía sin OC hace lo mismo | §7.1 |
| `control.operativo.crear` es **permiso de excepción** (OT importadas o sin control) | §5, §7.2 |
| La sección "les falta control operativo" es un **detector de excepciones**, y la UI debe decirlo | §8 |
| **`ot.reasignar`** nuevo, separado de `ot.crear`; el equipo de campo lo decide el líder, no la gerencia | §5 |
| **Seis indicadores**, con `Vencidos` transversal (no suman al total) | §4.2 |
| Los `PD-###` van corridos por OT y **admiten huecos** | §4.4 |
| Las dos vías de equipo (`personas` y `personas_externas`) se quedan: el catálogo está incompleto | §7.4 |
| La corrección de `plan-migracion-erp.md` va en **su propio PR de documentación** | §11, PR D |
