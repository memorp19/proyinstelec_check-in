# Recarga de 2026 desde los controles en Excel

Cómo correr `pnpm importar:2026`, qué decide y qué queda pendiente.

La base de `app-pruebas` se cargó el 5 de octubre de 2026 con `INSERT`
generados fuera del repositorio. Quedó con 12 órdenes de compra perdidas, 20
versiones faltantes, estatus desactualizados y la OC/OT de la 002 escritas en la
versión equivocada. En vez de parchar fila por fila, se recarga desde la fuente
con un importador que vive aquí y que sirve igual para producción.

---

## 1. Las tres fuentes

Los Excel se copian a mano a `importacion/`, que está en `.gitignore`: traen
clientes, montos, folios y órdenes de compra reales y **nunca se versionan**.

| Archivo | Hoja | Qué aporta |
|---|---|---|
| `control-cotizaciones-2026.xlsx` | `Cotizaciones 2026` | **Manda.** Cotizaciones, versión aceptada, estatus, OC y folio de OT |
| `control-proceso-2026.xlsx` | `Proceso 2026` | Solo valida. Una fila **por factura** |
| `control-ot-2026.xlsx` | `Ordenes de Trabajo 2026` | Valida el folio de OT y aporta **el estatus de la OT**, que no está en ningún otro lado |

En los tres: encabezados en la fila 8, datos desde la 9, y la columna B marca
las filas de datos (`PCOTOP` en los dos primeros, `OT` en el tercero).

Si Proceso o el Control de OT discrepan de Cotizaciones, **se carga lo que dice
Cotizaciones y la diferencia se reporta**. La única excepción es el folio de OT:
si el de Cotizaciones no corresponde a su propia cotización y otra fuente trae
el correcto, se usa el correcto.

---

## 2. Correrlo

```bash
# 1. Reporte. No escribe nada, no necesita --destino.
pnpm importar:2026

# 2. Carga, cuando el reporte sale sin bloqueantes.
pnpm importar:2026 --aplicar --destino=ep-xxxx.neon.tech --limpiar
```

**`--destino` es obligatorio para escribir y tiene que ser idéntico al host que
el script imprime.** `DATABASE_URL` apunta a lo que tenga el `.env.local` de
quien ejecuta, y esto borra y recarga un año entero: teclear el host es la
confirmación de que quien corre el comando sabe dónde está parado.

El script **se niega a correr** si:

- el host coincide con `PRODUCTION_DATABASE_HOST`;
- ya hay cotizaciones de 2026 y no se pasó `--limpiar`;
- queda un solo hallazgo **bloqueante**.

Cada corrida deja `importacion/reportes/<fecha>.json` con todo el detalle.

### Para cargar producción

No se apunta el script a producción. Se crea una rama de Neon, se carga ahí, se
revisa, y se promueve la rama. `PRODUCTION_DATABASE_HOST` existe para que el
error de teclear la URL equivocada no sea posible.

---

## 3. Qué decide el importador

**Folios.** Se calculan con `folioCotizacion`, nunca se leen del Excel:
`PCOTOP-002-2026` para la v0 y `PCOTOP-002-2026-1` para la v1. La notación `-v`
que apareció en la carga anterior no puede volver a producirse.

**Órdenes de compra.** Se leen crudas. Varias están guardadas como número con
formato de fecha —`4501122596` se ve como una fecha de 1920— y el XML guarda las
largas en notación científica. El `-` del Excel significa "no hay OC" y se
carga como `NULL`. Una celda con ` / ` son dos OC y se guardan tal cual; ojo
que `Co0001/150/26/255492` es **una sola** OC con diagonales dentro.

**Estatus de OT.** Del Control de OT, con el mapeo `PROCESO → En Proceso`,
`REVISIÓN → Revisión`, `TERMINADO → Cerrado`. Un valor fuera de ese catálogo no
se adivina: esa OT no se carga, porque cargarla con un estatus inventado la
dejaría inmovilizable desde la app.

**Responsables de OT.** Vacíos. No hay fuente: ninguno de los tres Excel los
trae, y `ot_responsables` estaba vacía también en la carga anterior.

**NO ASIGNADA.** Se aplica durante la carga: las versiones en ENVIADA de una
cotización que ya tiene una ASIGNADA quedan en NO ASIGNADA. Si por encima de la
asignada hay una versión viva (PROCESO, REVISION, DEPENDIENTE), no se toca —
seguiría tapándola en el listado— y se reporta como bloqueante.

**Clientes.** **Nunca** se descarta una fila porque el cliente no se resuelva.
Así se perdieron nueve filas en la carga anterior: las 327 que entraron tienen
`cliente_id` no nulo y las demás desaparecieron sin aviso. Si el cliente no está
en el catálogo, se da de alta. `scripts/alias-clientes.json` lleva los renombres
que no salen de normalizar texto, porque son decisiones humanas: CENTRO SANTA FE
es ADMINISTRADORA DE CENTROS COMERCIALES SANTA FE, y los planteles UVM facturan
a la matriz.

**Fechas.** `fecha_solicitud` es `NOT NULL`. Si falta, **la carga se detiene**:
rellenarla con la fecha de hoy es lo que dejó a la 002 v0 con un dato falso que
parece bueno. El reporte distingue la celda vacía de la capturada como texto —
la 136 v2 dice `19/5/0226`, con el año mal, y Excel nunca la convirtió.

**Bitácora.** Una entrada por cotización, `COTIZACION_IMPORTADA`, con el detalle
"carga inicial desde Control de Cotizaciones 2026". No una por versión: lo que
pasó es una carga, no un cambio de estatus fila por fila.

---

## 4. Qué corregir en los Excel antes de cargar

El reporte tiene que salir **sin bloqueantes**. Los conocidos:

| Caso | Qué pasa | Qué hacer |
|---|---|---|
| **002** | v0 sin fecha de solicitud | Capturarla. La versión aceptada es la **v1** (OC 9140, OT002261) |
| **136 v2** | Fecha `19/5/0226`, año mal y escrita como texto | Corregirla como fecha |
| **241** | Dos filas con versión 0 (una ENVIADA, otra ASIGNADA) | La asignada es la **v1**, OT241261 |
| **225 / 226** | Las dos reclaman `OT226260` | La 225 es `OT225260` |

Avisos que no detienen la carga pero conviene revisar: la **061** (Cotizaciones
dice `OT061260`, el Control de OT `OT061250`), la **178** (v1 y v2 comparten
`OT178261`), y la **255 v0**, cuya fecha de entrega dice `10/0972026` y se
cargaría vacía.

---

## 5. Facturas — pendiente, no está en este importador

El Control de Proceso trae 476 filas, **una por factura**: 94 con OT y 88 con
factura. No se cargan todavía porque **no existe tabla de facturas**.

Propuesta para su propio PR:

```
facturas
  folio            text PK        -- PFCOP-A115-OT001260
  folio_ot         text NOT NULL  → ordenes_trabajo.folio
  reporte          text           -- PREPOP-OT001260
  reporte_gastos   text           -- PREGOP-OT001260
  subtotal_mxn, iva_mxn, total_mxn   numeric(14,2)
  subtotal_usd, iva_usd, total_usd   numeric(14,2)
  complemento_pago text           -- B125
  estatus_pago     text           -- PAGADA | PENDIENTE
  fecha_pago       timestamptz
```

Cuatro decisiones que ya están tomadas y conviene no volver a discutir:

1. **MXN y USD nunca se suman.** Son importes independientes —mano de obra
   nacional y equipo importado— y sumarlos exigiría inventar un tipo de cambio.
   En los datos de 2026 no hay una sola factura con las dos monedas: 84 en pesos
   y 4 en dólares.
2. **El monto facturado no es el monto cotizado.** Son columnas distintas en
   tablas distintas; que coincidan es lo normal, pero no es una regla.
3. **La factura se liga a la OT por la columna K de su fila, nunca parseando el
   folio de la factura.** Las facturas A96 y A165 de la 002 dicen `OT002260` y
   pertenecen a `OT002261`; la de la 254 dice `OT254250`, con el año anterior.
   El folio de la factura es un nombre, no una llave foránea.
4. **`PAGADA` y `PAGADO` son lo mismo**, y hoy la fecha viene pegada al estatus
   en la misma celda (`"PAGADA 15/05/2026"`). Se separan en `estatus_pago` y
   `fecha_pago`.

Un caso que necesita a una persona antes de cargar nada: **la factura A230 está
en las filas de la 089 pero cita `OT090260`, que no existe** — la 090 es
`OT090261`.
