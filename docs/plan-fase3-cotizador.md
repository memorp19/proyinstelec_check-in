# Plan de la Fase 3 — el cotizador

Cómo se migra desde Apps Script la parte que arma la cotización: partidas,
conceptos, gastos, cálculo, condiciones comerciales y el documento que se le
manda al cliente.

Fuente: el export del 9 de octubre de 2026 (`Cotizaciones_servidor_2026-10-09`,
fuera del repositorio). Las referencias `COT_xx:NNN` apuntan a ese código.

---

## 0. Por qué esta fase y qué cierra

Hoy el ERP sabe **registrar** que una cotización existe, pero no sabe
**producirla**. Falta todo el cotizador: no hay partidas, ni conceptos, ni
catálogo de servicios, ni gastos, ni condiciones. La única cifra que guarda son
`monto_mxn` y `monto_usd`, capturados a mano.

Eso tiene una consecuencia de calendario que conviene dejar escrita: **el corte
a producción espera a esta fase.** El corte dice "desde este momento todo se
captura en el ERP", y mientras el ERP no pueda sacar una cotización de
principio a fin, esa frase no se puede cumplir. Apps Script sigue vivo hasta
que el PDF salga de aquí.

### Las decisiones que ya están tomadas

**De alcance:**

1. **El cotizador se migra completo.** No hay versión reducida, y **el corte a
   producción espera** a que el ERP pueda producir una cotización de principio
   a fin.
2. **Los importes se congelan al enviar una versión.** Cambiar un costo del
   catálogo después solo afecta a versiones nuevas. Es el pendiente que el
   propio Apps Script reconoce sin resolver (`PROCESO_COTIZACIONES.md:156`).
3. **El PDF lo genera el ERP con la misma plantilla de Google Docs** que usa
   Apps Script, vía la API de Docs, para que el documento salga idéntico.
4. **Se guarda el ID del PDF en la base.** El nombre queda de respaldo, no de
   llave.

**De cálculo** — todas implementadas y probadas en `src/lib/cotizador/`:

5. **Concepto**: `costo × cantidad × (1 + utilidad%)`. La utilidad es **por
   concepto**; en la práctica solo se usa en materiales.
6. **Gastos**: modos `IGUAL`, `PROPORCIONAL` y `MANUAL`. Se reparten primero en
   su moneda y **después** se convierten. La última partida absorbe la
   diferencia del redondeo. Una partida puede quedar **fuera** del reparto
   general (`recibeGastosGenerales: false`) y un gasto puede ir **entero a una
   partida** (`destino: { partida }`) — es lo que representa el caso de la 068.
7. **Asesoría**: UN solo porcentaje global, repartido **siempre en proporción
   al costo** de cada partida (conceptos con utilidad + gastos asignados), sin
   importar el modo de gastos. Por omisión 0 %. **Esto cambia la regla de Apps
   Script**, que la reparte por partes iguales en `IGUAL` y `MANUAL`
   (`COT_03:684-688`); ver §2.6.
8. **Ajuste por partida**: monto explícito y visible, nunca escondido en una
   fórmula.
9. **Redondeo** a dos decimales en cada paso.
   `precioUnitario = round(total / cantidad)`, `importe = unitario × cantidad`,
   `subtotal = Σ importes`, `iva = round(subtotal × 0.16)`,
   `total = subtotal + iva`. **El total es siempre la suma de lo que ve el
   cliente.**
10. **IVA 16 % por bloque de moneda.** MXN y USD nunca se suman.
11. **Tipo de cambio por versión**, con origen `BANXICO` o `PREFERENTE` (este
    con motivo obligatorio). El motor lo recibe como dato: no consulta Banxico.
    Sin tipo de cambio no reparte gastos a partidas de otra moneda, y avisa.
12. **Estudios por horas**:
    `horas = horas/día × días/semana × ingenieros × semanas`, y la regla de
    nodos de `COT_03`. `BASE_NODOS` sale de la configuración (10 por omisión).
    El motor **exige los parámetros explícitos**: nunca los toma del catálogo
    por su cuenta.
13. **Un solo total.** El subtotal por partida queda para un PR posterior.
14. **Nombres**: *costo total* para el panel interno (costo + gastos, sin
    asesoría) y *subtotal* solo para lo que ve el cliente.
15. **Avisos, no errores**: concepto o gasto con costo 0.
16. **Importe con letra**: función pura, en pesos y en dólares. Nunca se
    escribe a mano.

La cuarta merece una nota, porque corrige un defecto real: la app nueva busca el
PDF **por nombre** y Apps Script lo busca **por ID** (`COT_05:667`), usando el
nombre solo como respaldo (`COT_01:1228`). Por eso a Apps Script nunca le dolió
tener dos convenciones de nombre —`PCOTOP-001-2026_TITULO_CLIENTE` para la v0 y
`PCOTOP-001-2026-1 TITULO_CLIENTE` para las demás, `COT_01:416-434`— y a la app
nueva sí: `esPdfConTitulo` exige folio + espacio, así que **no encuentra el PDF
de ninguna v0**. Guardar el id elimina la clase de problema.

---

## 1. Modelo de datos

Cinco tablas nuevas. Todas cuelgan de una **versión** de cotización, no de la
cotización: la llave es `(numero, anio, version)`, que es la primaria de
`cotizaciones`.

```
cotizaciones (numero, anio, version)  ← ya existe
      │
      ├── cot_armado        1:1   encabezado, modo, moneda, condiciones, documento
      │        ├── cot_partidas     1:N
      │        │        └── cot_conceptos  1:N   (tipo PARTIDA)
      │        └── cot_conceptos    1:N         (tipo GASTO, sin partida)
      └── cot_importes      1:1   los números congelados al enviar

cat_servicios   catálogo, independiente de las cotizaciones
```

### 1.1 `cat_servicios` — el catálogo

Migra desde la hoja `Cat_Servicios` (`COT_03:71-78`).

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text` PK | En mayúsculas. `SP-01`, `AR-03`… |
| `descripcion` | `text NOT NULL` | |
| `costo` | `numeric(14,2)` | Costo de venta: ya trae margen dentro |
| `unidad` | `text NOT NULL DEFAULT 'servicio'` | |
| `familia` | `text NOT NULL` | `SP`, `PR`, `AR`, `IN`, `BT`, `AD` (`COT_03:84-91`) |
| `tipo` | `text NOT NULL` | `SERVICIO` \| `GASTO` |
| `activo` | `boolean NOT NULL DEFAULT true` | |
| `dias`, `ingenieros`, `semanas` | `integer` | Solo familia `AR` |
| `tarifa_hora` | `numeric(14,2)` | Solo familia `AR` |
| `base_nodos` | `integer` | Solo familia `AR`, por omisión 10 |
| `actualizado_por`, `updated_at` | | |

La familia `AR` (Análisis de Redes) es el caso raro: **un estudio no tiene
precio de lista, se estima por esfuerzo**, y esas cinco columnas son la
propuesta que el catálogo ofrece. Cada cotización las puede ajustar.

**Bitácora de cambios.** Apps Script lleva `Cat_Servicios_Cambios` precisamente
porque recargar el catálogo desde el Excel borraba lo editado a mano
(`PROCESO_COTIZACIONES.md:157`). Aquí no hace falta tabla nueva: se registra en
`bitacora` con acción `CATALOGO_SERVICIO_CAMBIO`.

### 1.2 `cot_armado` — el encabezado de la versión

Migra desde `Cot_Encabezado` (`COT_04:48-67`).

| Columna | Tipo | Notas |
|---|---|---|
| `numero`, `anio`, `version` | `integer` | PK compuesta, FK a `cotizaciones` |
| `modo` | `text NOT NULL DEFAULT 'GENERAL'` | `GENERAL` \| `POR_PARTIDA` |
| `moneda` | `text NOT NULL DEFAULT 'MXN'` | La general |
| `moneda_gastos` | `text NOT NULL DEFAULT 'MXN'` | Los gastos llevan la suya |
| `tipo_cambio` | `numeric(10,4)` | Solo si conviven monedas |
| `reparto_gastos` | `text NOT NULL DEFAULT 'IGUAL'` | `IGUAL` \| `PROPORCIONAL` \| `MANUAL` |
| `asesoria_pct` | `numeric(5,2) NOT NULL DEFAULT 0` | |
| `condiciones_pago` | `text` | |
| `tiempo_entrega` | `text` | |
| `lugar_entrega` | `text` | |
| `vigencia_dias` | `integer NOT NULL DEFAULT 30` | |
| `documento` | `jsonb` | Contacto corregido, normas, párrafos, reporte |
| `created_by`, `created_at`, `updated_at` | | |

`documento` queda como JSON igual que en Apps Script: son los textos que cambian
entre cotizaciones y no tienen estructura fija. Modelarlos en columnas obligaría
a una migración cada vez que la plantilla gane un párrafo.

### 1.3 `cot_partidas`

Migra desde `Cot_Partidas` (`COT_04:92-110`).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `text` PK | uuid |
| `numero`, `anio`, `version` | `integer` | FK a `cot_armado`, `ON DELETE CASCADE` |
| `orden` | `integer NOT NULL` | 1, 2, 3… Es el "Numero" de la hoja |
| `titulo` | `text NOT NULL` | |
| `descripcion` | `text` | El alcance completo, **con saltos de línea** |
| `cantidad` | `numeric(14,4) NOT NULL DEFAULT 1` | |
| `unidad` | `text NOT NULL DEFAULT 'servicio'` | |
| `moneda` | `text` | Solo en modo `POR_PARTIDA` |
| `asesoria_pct` | `numeric(5,2)` | Solo en modo `POR_PARTIDA` |
| `ajuste` | `numeric(14,2) NOT NULL DEFAULT 0` | Suma o resta sobre el subtotal |
| `gasto_manual` | `numeric(14,2)` | Solo con reparto `MANUAL` |
| `formato` | `text NOT NULL DEFAULT 'NORMAL'` | `NORMAL` \| `NEGRITAS` \| `OCULTO` |
| `notas` | `text` | Interna, no sale en el documento |

`descripcion` es `text` y no `varchar`: algunas llegan a cincuenta líneas con
viñetas, y los saltos se conservan tal cual (`COT_04:99-107`).

Índice único en `(numero, anio, version, orden)` para que no haya dos partidas
compitiendo por el renglón 3 del documento.

### 1.4 `cot_conceptos`

Migra desde `Cot_Conceptos` (`COT_04:112-122`). **Guarda las dos cosas**: los
conceptos de una partida y los gastos del proyecto, distinguidos por `tipo`. Es
como lo hace Apps Script y tiene sentido: los dos salen del mismo catálogo y
comparten costo, margen y cantidad.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `text` PK | uuid |
| `numero`, `anio`, `version` | `integer` | FK a `cot_armado`, `ON DELETE CASCADE` |
| `partida_id` | `text` | FK a `cot_partidas`. **NULL cuando `tipo = 'GASTO'`** |
| `tipo` | `text NOT NULL` | `PARTIDA` \| `GASTO` |
| `codigo` | `text` | Del catálogo, o `LIBRE` |
| `descripcion_libre` | `text` | Cuando no hay catálogo detrás |
| `cantidad` | `numeric(14,4) NOT NULL DEFAULT 0` | |
| `unidad` | `text` | |
| `costo` | `numeric(14,2)` | Capturado; manda sobre el del catálogo |
| `margen_pct` | `numeric(5,2) NOT NULL DEFAULT 0` | |
| `nodos`, `base_nodos`, `dias`, `ingenieros`, `semanas` | `integer` | Estudios AR |
| `tarifa_hora` | `numeric(14,2)` | Estudios AR |
| `orden` | `integer NOT NULL` | |
| `notas` | `text` | |

**`CHECK (tipo = 'GASTO') = (partida_id IS NULL)`** — un gasto no cuelga de una
partida y un concepto de partida siempre lo hace. La base lo impone, no el
código.

`costo` y `margen_pct` viven aquí y no en el catálogo porque son decisiones de
**esta** cotización: un descuento a un cliente no debe quedarse pegado al
catálogo (`COT_03:370-384`).

### 1.5 `cot_importes` — los números congelados

Es la tabla que materializa la decisión 2. **No existe en Apps Script**: ahí los
importes se recalculan siempre, que es justo el defecto que se corrige.

| Columna | Tipo | Notas |
|---|---|---|
| `numero`, `anio`, `version` | `integer` | PK compuesta, FK a `cotizaciones` |
| `congelado_at` | `timestamptz NOT NULL` | Cuándo |
| `congelado_por` | `text NOT NULL` | Quién |
| `calculo` | `jsonb NOT NULL` | El resultado completo de `calcularCotizacion` |
| `total_mxn`, `total_usd` | `numeric(14,2)` | Extraídos para poder filtrar y sumar |

**Cómo funciona.** Mientras la versión está en `PROCESO` o `REVISION`, los
importes se calculan al vuelo desde el catálogo vigente, igual que hoy. **Al
pasar a `ENVIADA` se escribe `cot_importes` y a partir de ahí es la fuente.**
Una versión enviada no cambia de precio nunca más.

`calculo` guarda el objeto entero —partidas con su costo directo, gasto
asignado, asesoría y total; bloques por moneda; avisos— y no solo los totales,
porque el documento se tiene que poder regenerar idéntico meses después.
`total_mxn` y `total_usd` se duplican fuera del JSON para que el listado y el
dashboard no tengan que abrirlo.

**Y resuelve el `monto_mxn` / `monto_usd` de `cotizaciones`**: dejan de
capturarse a mano y pasan a derivarse de aquí al congelar.

### 1.6 Qué se migra y cómo

| Origen | Destino | Cómo |
|---|---|---|
| `Cat_Servicios` | `cat_servicios` | Directo, una fila por código activo. Los inactivos entran con `activo = false`: hay cotizaciones viejas que los referencian |
| `Cot_Encabezado` | `cot_armado` | Directo. `Documento` (JSON) pasa tal cual a `documento` |
| `Cot_Partidas` | `cot_partidas` | `Numero` → `orden`; el `ID` de la hoja se conserva para poder religar los conceptos |
| `Cot_Conceptos` | `cot_conceptos` | `Partida ID` resuelve el FK. `Tipo` distingue gasto de concepto |
| — | `cot_importes` | **No se migra.** Se calcula una vez con el catálogo actual y se congela para las versiones ya `ENVIADA` o `ASIGNADA`, dejando constancia de que es un congelado retroactivo |

Esa última fila es una decisión incómoda y conviene verla de frente: **los
importes de las cotizaciones históricas ya no son reconstruibles con exactitud**,
porque el catálogo cambió desde que se enviaron. Congelarlas con el catálogo de
hoy produce un número que puede no ser el que vio el cliente. Las alternativas
están en §6.

El importador va en `scripts/`, con el mismo patrón que
`importar-excel-2026.ts` —que llega con `feat/importador-excel-2026`—: reporta
por omisión, escribe con `--aplicar`, exige `--destino`, y las reglas puras
viven en `src/lib/` para poder probarlas.

---

## 2. Las reglas de cálculo

Todas salen de `calcularCotizacion` (`COT_03:473`) y se conservan **tal cual**.
Van en orden de ejecución, porque el orden importa: cambiarlo cambia los
números.

### 2.1 Redondeo a dos decimales en cada paso

`COT_03:307-310` — `Math.round(n * 100) / 100`, aplicado en **cada** operación
intermedia, no solo al final.

> 240 h × $350.00 = $84,000.00 → se redondea aquí, no al final.

No es cosmético: redondear al final daría diferencias de centavos contra lo que
el cliente ya recibió. En Postgres `numeric(14,2)` con `round(x, 2)` explícito
en cada paso.

### 2.2 Costo de un concepto

`costoDeConcepto_` (`COT_03:386-445`). Cuatro formas:

**`FIJO`** — costo (capturado o de catálogo) más margen, por cantidad.

> Pala, costo base $100.00, margen 15 %, cantidad 4
> unitario = round(100 × 1.15) = **$115.00** · importe = round(115 × 4) = **$460.00**

El margen es **por concepto** y no de la partida: en la misma partida puede
haber material con margen e instalación sin él (`COT_03:378-384`).

**`LIBRE`** — sin catálogo detrás; el precio es el que se escribió. Exige
descripción: sin ella nadie sabe qué se cotizó (`COT_03:531`).

**`ESFUERZO`** — estudios AR. `costoPorEsfuerzo_` (`COT_03:327-347`), con
`HORAS_DIA_ESTUDIO = 8` (`COT_03:133`):

```
horasSemana = 8 × dias
horasTotal  = horasSemana × semanas × ingenieros
costo       = round(horasTotal × tarifaHora)
```

> dias 5, ingenieros 2, semanas 3, tarifa $350.00
> horasSemana = 40 · horasTotal = 40 × 3 × 2 = **240** · costo = **$84,000.00**
> con margen 15 % → **$96,600.00**

Si falta `dias`, `semanas` o `tarifaHora`, devuelve `null` y el concepto cae a
`FIJO`. `ingenieros` vacío se asume 1.

**`NODOS`** — un estudio cuyo precio escala con el número de nodos.
`BASE_NODOS_ESTUDIO = 10` (`COT_03:142`):

> costoEstudio $96,600.00, base 10 nodos, cotizado para 14
> importe = round(96,600 / 10 × 14) = **$135,240.00**

Sin nodos, el estudio se multiplica por la cantidad.

### 2.3 Un concepto de tipo GASTO no puede ir en una partida

`COT_03:534-538`. Se rechaza con aviso: *"es un gasto del proyecto, no un
servicio"*. Los gastos se reparten entre partidas, no se suman dentro de una.

### 2.4 Los gastos se reparten antes de convertirse

`COT_03:584-654`. Es la regla más fácil de romper al reimplementar.

Los gastos llevan **su propia moneda** —unos viáticos son en pesos aunque la
cotización tenga partidas en dólares— y se reparten **primero en esa moneda**.
Solo después se convierte lo que le tocó a una partida de otra moneda.

> Convertir el total antes de repartir daría otro número cuando el reparto es
> proporcional, porque el peso de cada partida se mediría en monedas distintas.

**Solo reciben gastos** las partidas de la misma moneda, o las de otra si hay
tipo de cambio capturado. Si no lo hay, esas partidas reciben 0 y se avisa
(`COT_03:600-612`).

Tres repartos:

**`IGUAL`** — total entre número de partidas que reciben.

> $4,500.00 entre 2 → **$2,250.00** cada una

**`PROPORCIONAL`** — según el costo directo de cada partida.

> $4,500.00, P1 directo $10,000 y P2 $30,000 (suma $40,000)
> P1 = round(4,500 × 10,000/40,000) = **$1,125.00**
> P2 = round(4,500 × 30,000/40,000) = **$3,375.00**

**`MANUAL`** — lo que se capturó en cada partida. Si la suma no cuadra con el
total, se avisa cuánto falta (`COT_03:625-634`).

**La conversión**, al final y solo donde hace falta (`COT_03:644-653`):

> gastos en MXN, partida en USD, tipo de cambio 17.50
> $3,500.00 MXN → round(3,500 / 17.50) = **US$200.00**
>
> gastos en USD, partida en MXN, mismo tipo de cambio
> US$200.00 → round(200 × 17.50) = **$3,500.00 MXN**

### 2.5 La última partida absorbe la diferencia del redondeo

`COT_03:636-641` para gastos, `COT_03:694-698` para asesoría.

> $100.00 entre 3 partidas → round(100/3) = $33.33 cada una
> 33.33 × 3 = $99.99 · diferencia $0.01 → la tercera queda en **$33.34**

Sin esto, el total de los gastos no cuadra con la suma de lo repartido y el
documento muestra dos números distintos para lo mismo.

### 2.6 La asesoría va dentro del precio — y aquí cambiamos la regla

`COT_03:656-702`. La parte que no se debe "mejorar":

> En el documento no aparece como renglón aparte: va dentro del precio unitario
> que ve el cliente. Es lo que hacía el Excel con `X8*1.1`, y por eso ninguna de
> las cotizaciones reales tiene una línea de asesoría.

Por omisión **0 %**. Si pasa de 100 se avisa, pero se respeta.

**Lo que sí cambia: cómo se reparte.** Apps Script la reparte con el mismo
criterio que los gastos —proporcional si los gastos fueron proporcionales, y
**por partes iguales** en `IGUAL` y `MANUAL` (`COT_03:684-688`)—. Aquí es
**siempre proporcional al costo de la partida**.

El motivo es que la práctica manual en los Excel reales es poner el **mismo
porcentaje a cada partida**, y un porcentaje plano sobre cada base es
matemáticamente idéntico a repartir el total en proporción a esas bases. El
reparto por partes iguales hace otra cosa: la partida barata subsidia a la cara.

Con dos partidas de 27,600 y 25,800 y 10 % de asesoría:

| | Proporcional (esta regla) | Partes iguales (Apps Script) |
|---|---|---|
| Partida 1 | **30,360** | 30,270 |
| Partida 2 | **28,380** | 28,470 |

Está probado en el caso dorado C, que afirma las dos cifras: la que se adopta y
la que se descarta.

### 2.7 El cierre: el total es lo que el cliente puede sumar

```
costoTotal     = round(costoConceptos + gastoAsignado)     ← panel interno
total          = round(costoTotal + asesoria + ajuste)
precioUnitario = cantidad > 0 ? round(total / cantidad) : 0
importe        = round(precioUnitario × cantidad)          ← lo que ve el cliente
subtotal       = round(Σ importes)
iva            = round(subtotal × 0.16)
total          = round(subtotal + iva)
```

**El importe se recompone desde el unitario redondeado**, y no es lo mismo que
el total de la partida. Si el cliente multiplica lo que ve por la cantidad y
suma, le tiene que dar el subtotal impreso. El Excel de la 070 sumaba los
totales internos y daba **un centavo de diferencia** contra su propio PDF.

> Partida de 1,000.00 en cantidad 3 → unitario round(333.333…) = **333.33**
> importe = 333.33 × 3 = **999.99**, no 1,000.00

**IVA 16 % por bloque de moneda**, y MXN y USD nunca se suman. Mientras el modo
sea "un solo total" (decisión 13) hay un único bloque; el día que entre el
modo por partida, cada moneda cierra el suyo.

> Subtotal $1,046,113.00 → IVA round(× 0.16) = **$167,378.08**
> total = **$1,213,491.08**  *(caso dorado A, al centavo contra el PDF)*

### 2.9 Avisos que no bloquean

Se juntan y se muestran, sin impedir guardar (`COT_03:477`): código fuera del
catálogo, concepto libre sin descripción, partida sin título o sin conceptos,
gastos repartidos a mano que no cuadran, asesoría mayor a 100 %, partidas de otra
moneda sin tipo de cambio.

Es deliberado: una cotización a medio armar tiene que poder guardarse.

### 2.10 Condiciones comerciales por omisión

`COT_04:75-81`:

| Campo | Valor |
|---|---|
| Pago | `100% contra entrega de factura.` |
| Tiempo de entrega | `de 4 semanas en sitio, salvo confirmación de tiempo de entrega de materiales.` |
| Lugar | *(vacío)* |
| Vigencia | **30 días** |

Y cinco formas de pago frecuentes para ofrecer de un clic (`COT_04:83-89`).

---

## 3. Flujo de pantallas

Una pantalla, cuatro secciones plegables, en el orden en que se piensa una
cotización. No un asistente por pasos: se salta entre secciones todo el tiempo.

### 3.1 Partidas

Lo primero y lo más pesado. Por partida: título, descripción (área de texto
multilínea, los saltos se respetan), cantidad, unidad, formato del título, y la
lista de conceptos.

Por concepto: código del catálogo con autocompletado, o concepto libre con
descripción; cantidad, unidad, costo (propuesto por el catálogo, editable) y
margen %. Si el código es de familia `AR`, se abren los campos de esfuerzo —
días, ingenieros, semanas, tarifa, nodos— con la propuesta del catálogo.

**Valida:** código inexistente (aviso), concepto libre sin descripción (aviso),
concepto de tipo `GASTO` dentro de una partida (**rechazo**, §2.3), partida sin
título o sin conceptos (aviso).

### 3.2 Gastos del proyecto

Lista aparte, con su propia moneda y su criterio de reparto. Va separada de las
partidas a propósito: mezclarlas haría que alguien metiera "Hospedaje" como
concepto de una partida (`COT_03:284-288`).

Con reparto `MANUAL` aparece una columna por partida para asignar a mano, y el
aviso de cuánto falta por asignar.

### 3.3 Moneda, modo y asesoría

Modo `GENERAL` o `POR_PARTIDA`; moneda general; moneda de los gastos; tipo de
cambio si conviven; porcentaje de asesoría.

Debajo, **el bloque de totales en vivo**: costo directo, gastos, subtotal,
asesoría (con su porcentaje efectivo), IVA y total, uno por moneda. Es lo que
convierte el cotizador en una herramienta de decisión y no en un formulario.

### 3.4 Condiciones y documento

Condiciones de pago (con las cinco frecuentes), tiempo y lugar de entrega,
vigencia. Y los datos del documento: contacto —tomado del catálogo de clientes,
corregible aquí sin tocar el catálogo—, actividades generales, normas, reporte.

### 3.5 Autoguardado y bloqueo

**Autoguardado** cada pocos segundos mientras haya cambios, como hoy
(`autoguardarCotizacion`). Guarda el armado, **nunca los importes**: esos se
recalculan al leer, hasta que se congelan.

**El bloqueo depende del estatus**, igual que `permisoDeEdicion_`:

| Estatus | ¿Se edita? |
|---|---|
| `PROCESO`, `DEPENDIENTE PROVEEDOR`, `DEPENDIENTE CLIENTE` | Sí |
| `REVISION` | No — solo consulta |
| `ENVIADA`, `ASIGNADA`, `NO ASIGNADA`, `CANCELADA` | No |

En una versión ≥ 1, arriba aparece un panel plegable con lo cotizado en la
anterior, solo de consulta.

---

## 4. El documento y el PDF

### 4.1 Marcadores de la plantilla

`COT_05:438-453`. La sustitución acepta **cualquier número de llaves**
(`\{+CLIENTE\}+`), para que una plantilla con `{{{{CLIENTE}}}}` no deje llaves a
la vista.

| Marcador | De dónde sale |
|---|---|
| `{{CLIENTE}}` | Razón social |
| `{{FOLIO}}` | `PCOTOP-NNN-AAAA[-V]` — **la versión solo si no es cero** (`COT_05:383`) |
| `{{FECHA}}` | Fecha del documento, en largo |
| `{{TITULO}}` | Título con `_` convertido en ` - ` (`COT_06:93`) |
| `{{SITIO}}` | Derivado del título y el cliente |
| `{{CONTACTO}}`, `{{TELEFONO}}`, `{{EMAIL}}` | Contacto, con lo corregido en el cotizador encima |
| `{{DIRECCION_1}}`, `{{DIRECCION_2}}` | Dirección. La segunda, si viene vacía, **borra su renglón** |
| `{{PAGO}}`, `{{ENTREGA}}`, `{{LUGAR}}`, `{{VIGENCIA}}` | Condiciones comerciales |

Lo que la plantilla no traiga se avisa en la vista previa en vez de fallar
(`COT_05:456-458`). También se sustituye en el **encabezado** del documento.

### 4.2 La tabla de partidas

Se localiza **por contenido**: la primera tabla cuya celda (0,0) diga `PARTIDA`
(`COT_05:492-499`). No por posición, que cambiaría al editar la plantilla.

Un renglón por partida: número, título con su formato (`NORMAL`, `NEGRITAS`,
`OCULTO`), descripción con sus viñetas, cantidad, unidad, precio unitario e
importe. Un bloque de totales por moneda al final.

La viñeta se clona de una existente del documento (`prototipoDeVineta_`), para
que el estilo salga idéntico.

### 4.3 Saltos de página

Los términos y condiciones empiezan en hoja nueva con `pageBreakBefore`
(`COT_05:1418`). **No existe en `DocumentApp`**: se aplica después de guardar,
con la API de Docs. Por eso la API de Docs es un requisito y no una comodidad —
sin ella el documento sale, pero con los términos pegados a la tabla.

### 4.4 Nombre, carpeta y cómo se encuentra

**Nombre: `<folio> <titulo>`**, con espacio, siempre. Es lo que ya produce
`copiarPlantillasCotizacion` ([drive-erp.ts:131](../apps/web/src/lib/drive-erp.ts))
y lo que `esPdfConTitulo` espera. **No se reproduce la convención de Apps
Script**, que usa `_` para la v0 y espacio para el resto.

**Carpeta:** la de la cotización, `{raíz}/{año}/{NNN-AAAA}`, resuelta con
`ensureCarpetaCotizacion`.

**Cómo se encuentra después:** por el **id guardado**, no por el nombre. Dos
columnas nuevas en `cotizaciones`:

| Columna | Para qué |
|---|---|
| `pdf_drive_id` | El PDF que se adjunta al enviar |
| `doc_drive_id` | El Doc que lo generó, para poder rehacerlo |

`buscarPdfCotizacion` pasa a: **1)** si hay `pdf_drive_id`, ese; **2)** si no,
buscar por nombre como hoy. El respaldo se queda para las cotizaciones que
nunca pasaron por aquí.

Esto arregla de paso el problema de las v0 históricas: en cuanto una cotización
genere su PDF desde el ERP, deja de depender del nombre.

### 4.5 Rehacer el PDF

Dos botones, como hoy:

- **Generar documento** — copia la plantilla, la llena, exporta el PDF. Se
  niega si el revisor o el cliente ya tienen ese PDF, salvo que se fuerce
  (`COT_05:320-344`).
- **Actualizar PDF** — rehace solo el PDF desde el Doc como esté ahora, para
  recoger ediciones hechas a mano en el documento (`COT_05:597`). Antes de
  mandar a revisión, solo si el Doc cambió después del PDF — con dos minutos de
  tolerancia (`COT_05:626-630`).

Lo anterior se aparta **después** de tener lo nuevo: si algo falla a medio
camino, el documento anterior sigue ahí (`COT_05:399-401`).

---

## 5. Copiar a una versión nueva

`crearNuevaVersion_` (`COT_01:587`) + `copiarCotizacionAVersion`.

**Se copia:** encabezado (modo, monedas, reparto, asesoría), condiciones
comerciales, el JSON del documento, todas las partidas con su descripción y
formato, todos los conceptos con su **costo capturado y su margen**, y los
gastos.

**No se copia:**

- **Los importes congelados.** La versión nueva nace sin `cot_importes` y
  calcula contra el catálogo vigente. Es el punto de tener versiones.
- **El PDF ni el Doc.** `pdf_drive_id` y `doc_drive_id` nacen vacíos: el folio
  cambió, así que el documento ya no corresponde.
- **La aprobación.** Es por versión exacta; la nueva nace sin aprobar.

**El matiz que importa:** los costos **capturados a mano** se copian tal cual;
los que venían del catálogo se quedan "del catálogo" y se re-resuelven con el
precio vigente (`PROCESO_COTIZACIONES.md:74`). Así una versión nueva recoge los
aumentos de lista pero respeta los descuentos que alguien negoció.

La versión anterior no se toca.

---

## 6. Riesgos y preguntas abiertas

Por importancia. Las cinco primeras conviene cerrarlas antes del PR 1.

### 6.1 🔴 Qué hacer con los importes de las cotizaciones históricas

Las versiones ya `ENVIADA` o `ASIGNADA` se enviaron con un catálogo que hoy ya
no existe. Tres caminos:

1. **Congelar con el catálogo actual** y marcarlo como congelado retroactivo.
   Barato, y produce un número que puede no ser el que vio el cliente.
2. **Capturar el total a mano** desde el PDF de cada una. Exacto y caro — es
   justo lo que costó "más de quinientos PDF" en 2024 y 2025 (`COT_01:2338`).
3. **Dejarlas sin congelar** y que el listado muestre el monto de la OC, que sí
   es un dato duro.

Mi recomendación es la **3 para el histórico y la 1 solo si alguien necesita el
desglose**, pero es tu decisión y condiciona el importador.

### 6.2 🔴 Qué pasa si se edita el catálogo con cotizaciones en REVISION

Una versión en `REVISION` todavía no congela. Si alguien cambia un costo base
mientras el revisor la mira, **el revisor aprueba un número y se envía otro**.

Opciones: congelar al **enviar a revisión** en vez de al enviar al cliente;
avisar al revisor si el cálculo cambió desde que se le mandó; o no hacer nada y
aceptar la ventana.

### 6.3 🔴 Permisos del catálogo de servicios

Apps Script usa `cotizaciones.costos` para la pantalla de Costos base. Hace
falta decidir el equivalente aquí y, sobre todo, **quién puede cambiar un costo
que afecta a todas las cotizaciones no enviadas**. No está en el catálogo de
`src/lib/permisos.ts`.

### 6.4 🟡 La plantilla de Google Docs es un punto único de fallo

Si alguien la edita y quita un marcador, las cotizaciones salen con huecos.
Apps Script lo detecta y avisa (`COT_05:456`). ¿Se replica ese aviso, se
versiona la plantilla, o se valida en un test contra una copia conocida?

### 6.5 🟡 Apps Script y el ERP conviviendo

Mientras dure la fase, las dos herramientas pueden cotizar. ¿Se corta de golpe
al terminar el PR 6, o conviven un tiempo? Si conviven, el catálogo se edita en
dos lados y diverge.

### 6.6 🟡 `monto_mxn` / `monto_usd` de `cotizaciones`

Hoy se capturan a mano; con `cot_importes` se derivan. ¿Se eliminan, se derivan
como columna generada, o se quedan como captura manual para lo que nunca pase
por el cotizador (las cotizaciones con tabulador en Excel que menciona
`COT_01:2347`)?

### 6.7 🟡 Modo `POR_PARTIDA` — ¿cuánto se usa?

Añade complejidad real: moneda y asesoría por partida, y varios bloques de
totales. Si en 2026 no lo usó nadie, podría quedar fuera del PR 2 y entrar
después. **Se puede medir** contando filas de `Cot_Encabezado` con
`Modo = 'POR_PARTIDA'`.

### 6.8 🔵 La familia AR y los nodos

`BASE_NODOS_ESTUDIO = 10` y `HORAS_DIA_ESTUDIO = 8` están escritos en el código.
¿Van al catálogo, a `config_erp`, o se quedan como constantes?

### 6.9 🔵 Qué se hace con `Cat_Servicios_Cambios`

¿Se migra el historial de cambios del catálogo, o se empieza en limpio
registrando en `bitacora` de aquí en adelante?

---

## 7. División en PRs

Siete, en orden. Cada uno se puede probar solo y ninguno deja la app peor que
antes.

### PR 1 · El catálogo de servicios

Tabla `cat_servicios` + migración, lectura en `src/lib/catalogo-servicios.ts`,
importador desde `Cat_Servicios`, y pantalla de solo lectura.

**Probable por sí mismo:** el catálogo se ve en pantalla y el importador reporta
sin escribir. Nada más lo usa todavía.

### PR 2 · El cálculo, puro ✅ **hecho**

`src/lib/cotizador/` — `calculo.ts`, `letras.ts`, `tipos.ts`. Sin base de datos
y sin pantalla.

Fue antes que el modelo a propósito: el cálculo es lo que hay que acertar, y se
prueba sin decidir una sola columna. Está verificado contra cuatro
**casos dorados** reconstruidos celda por celda desde los Excel reales —no desde
los totales del PDF—, y cuadra **al centavo**:

| Caso | Qué prueba |
|---|---|
| **068** | Once partidas, dos monedas, gastos generales y propios, seis ajustes. Subtotal 1,046,113.00 · IVA 167,378.08 · total 1,213,491.08 |
| **070** | Tres partidas, asesoría 10 %, ajuste de veinte centavos. Total 184,647.64 |
| **450** | La regla nueva de asesoría contra la de Apps Script |
| Estudios | AR001 = 9,600 y AR002 = 80,000 por horas |

Más el importe con letra, que corrige dos defectos del sistema anterior: los
dólares cerraban con `M.N.` y el redondeo del centavo no coincidía con el del
cálculo.

### PR 3 · El modelo y el armado

Tablas `cot_armado`, `cot_partidas`, `cot_conceptos` + migración. Lectura y
escritura del armado en `src/lib/cotizador.ts`. Rutas `GET` y `PUT`.

**Probable por sí mismo:** se guarda y se relee un armado completo por API, y el
cálculo del PR 2 produce números sobre él.

### PR 4 · El importador del armado histórico

Migra `Cot_Encabezado`, `Cot_Partidas` y `Cot_Conceptos`. Mismo patrón que
`importar-excel-2026`: reporte por omisión, `--aplicar`, `--destino`, reglas
puras en `src/lib/`.

**Probable por sí mismo:** el reporte corre contra los datos reales y dice qué
cargaría sin escribir.

### PR 5 · La pantalla del cotizador

Las cuatro secciones de §3, autoguardado, bloqueo por estatus y totales en vivo.

**Probable por sí mismo:** se arma una cotización de cero y se vuelve a abrir.

### PR 6 · El documento y el PDF

Marcadores, tabla de partidas, saltos con la API de Docs, nombre
`<folio> <titulo>`, `pdf_drive_id` y `doc_drive_id`, y `buscarPdfCotizacion`
prefiriendo el id.

**Probable por sí mismo:** se genera un PDF y se compara con el que produce Apps
Script para la misma cotización. Es la prueba de aceptación de toda la fase.

### PR 7 · Congelar los importes

Tabla `cot_importes`, el congelado al pasar a `ENVIADA`, y la lectura que
prefiere lo congelado sobre lo calculado.

**Probable por sí mismo:** se envía una versión, se cambia un costo del
catálogo, y la versión enviada no se mueve mientras una nueva sí.

Va al final porque necesita que todo lo anterior produzca números, y porque es
la regla que más cuesta deshacer si se decide mal.

---

## 8. Lo que esta fase NO incluye

- **Facturas.** Siguen fuera. La propuesta de tabla está en
  `docs/recarga-2026-desde-excel.md` §5, que llega con el PR del importador
  (`feat/importador-excel-2026`) y todavía no está en `develop`.
- **El Control Operativo**, que es la Fase 2
  ([`plan-fase2-control-operativo.md`](plan-fase2-control-operativo.md)).
- **El dashboard y el histórico de Apps Script** (COT_02, COT_20 a COT_33).
  Leen las mismas hojas y pueden migrarse después sin bloquear nada.
- **El tipo de cambio automático de Banxico** (COT_31). Por ahora el tipo de
  cambio se captura a mano, que es lo que el cálculo necesita.
