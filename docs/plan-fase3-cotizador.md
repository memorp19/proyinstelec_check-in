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
   fórmula. **Es el único lugar donde se resta.** Un gasto negativo es un
   error: se repartiría entre partidas y nadie entendería de dónde salió el
   descuento. Un descuento al cliente se captura como ajuste negativo de la
   partida, que es explícito, sale en el reporte y queda junto a lo que
   descuenta.
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

**De modelo** — cerradas al armar el PR del modelo, todas implementadas:

17. **El catálogo es una tabla propia** con historial aparte
    (`cat_servicios_cambios`), **motivo obligatorio** en cada cambio y permiso
    propio para editarlo (`catalogo.servicios.editar`). Un solo precio para
    todos los clientes.
18. **El concepto copia su costo al agregarse.** Un cambio de catálogo no mueve
    una cotización abierta. Se guardan **dos** costos —el usado y el del
    catálogo al copiarlo— para distinguir "el catálogo se movió" de "alguien
    negoció este precio". Actualizar es explícito y devuelve el antes y el
    después (§1.5).
19. **Los gastos van en tabla propia**, con destino opcional a una partida; la
    partida guarda si recibe los generales. Es lo que hace representable la 068.
20. **Precio unitario final** por partida: cuando está, el ajuste **se deriva**
    y queda visible, y avisa si la venta queda por debajo del costo (§1.4).
21. **Por versión** se guardan asesoría, IVA, tipo de cambio con origen y
    motivo, moneda, los ids de Drive y los bloques de condiciones y documento,
    **validados y con versión de esquema** (§1.3).
22. **Se congela al mandar a revisión**, no al enviar: es cuando los números
    dejan de moverse porque alguien más los va a mirar. Después, la versión no
    se edita (§1.6). Resuelve §6.2.
23. **La versión nueva copia todo con sus costos tal cual** y avisa si el
    catálogo cambió. No reprecia nada por su cuenta (§5).
24. **Las históricas conservan su monto** en `monto_mxn` / `monto_usd`, con
    `origen_monto` diciendo de dónde salió: `COTIZADOR`, `MANUAL` u `OC`.
25. **`config_erp`** guarda `ASESORIA_PCT_DEFAULT = 10`,
    `BASE_NODOS_ESTUDIO = 10` y `HORAS_DIA_ESTUDIO = 8`. Resuelve §6.8.

### El importe con letra corrige tres defectos del sistema anterior

Es el renglón que el cliente compara contra la cifra y el que un revisor usa
para cazar un dedazo, así que las tres cosas importan:

1. **Los dólares cerraban con `M.N.`** — `… DÓLARES AMERICANOS 24/100 M.N.`
   (`COT_05:276`). *M.N.* es **moneda nacional**: decirlo de un importe en
   dólares afirma dos monedas distintas en el mismo renglón, y es el tipo de
   contradicción que invalida un documento. Ahora cierra con `USD`:
   `… DÓLARES 50/100 USD`.
2. **Los veintipico perdían el acento.** `'VEINTI' + UNIDADES[u]`
   (`COT_05:243`) produce `VEINTIUN` y `VEINTIDOS`; se escriben **VEINTIÚN**,
   **VEINTIDÓS**, **VEINTITRÉS** y **VEINTISÉIS**. En esa misma línea hay un
   `.toLowerCase().toUpperCase()` que no hace nada, señal de que alguien ya
   había intentado arreglarlo. El PDF de la 250 llega más lejos y escribe
   "VEINTE Y UN".
3. **El centavo se redondeaba distinto que el cálculo.** La letra y la cifra
   usan ahora la misma función: si cada una redondeara por su cuenta, la letra
   podría decir 67 centavos debajo de una cifra que dice 68.

Los doce totales de 2026 están en el test, y **dos traen la letra mal impresa**
—la 068 y la 269 con el importe equivocado, la 250 con "VEINTE Y UN"—. El test
espera la forma correcta: es exactamente para lo que existe la función.

La cuarta merece una nota, porque corrige un defecto real: la app nueva busca el
PDF **por nombre** y Apps Script lo busca **por ID** (`COT_05:667`), usando el
nombre solo como respaldo (`COT_01:1228`). Por eso a Apps Script nunca le dolió
tener dos convenciones de nombre —`PCOTOP-001-2026_TITULO_CLIENTE` para la v0 y
`PCOTOP-001-2026-1 TITULO_CLIENTE` para las demás, `COT_01:416-434`— y a la app
nueva sí: `esPdfConTitulo` exige folio + espacio, así que **no encuentra el PDF
de ninguna v0**. Guardar el id elimina la clase de problema.

---

## 1. Modelo de datos

> **Actualizado al cerrar el PR del modelo.** Lo que sigue es el esquema que se
> implementó, no el que se propuso: siete tablas y no cinco. Las diferencias
> contra la propuesta original están señaladas donde aparecen, con su motivo.

Todas cuelgan de una **versión** de cotización, no de la cotización: la llave es
`(numero, anio, version)`, que es la primaria de `cotizaciones`.

```
cotizaciones (numero, anio, version)  ← ya existe, + origen_monto
      │
      ├── cot_armado        1:1   encabezado, monedas, condiciones, documento
      │        ├── cot_partidas     1:N
      │        │        └── cot_conceptos  1:N
      │        └── cot_gastos       1:N   (con destino opcional a una partida)
      └── cot_importes      1:1   los números congelados al mandar a revisión

cat_servicios            catálogo, independiente de las cotizaciones
      └── cat_servicios_cambios   historial, con motivo obligatorio
```

### 1.1 `cat_servicios` — el catálogo

Migra desde la hoja `Cat_Servicios` (`COT_03:71-78`) y se carga del formato
`PFAD-024-2026` con `scripts/importar-catalogo-2026.ts`.

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text` PK | En mayúsculas. `SP001`, `AR003`, `COSTO_AYUDANTE`… |
| `familia` | `text NOT NULL` | `SP`, `PR`, `AR`, `IN`, `BT`, `COSTO` |
| `descripcion` | `text NOT NULL` | |
| `unidad` | `text NOT NULL DEFAULT 'servicio'` | |
| `costo` | `numeric(14,2)` | Costo de venta: ya trae margen dentro |
| `moneda` | `text NOT NULL DEFAULT 'MXN'` | |
| `tipo` | `text NOT NULL` | `SERVICIO` \| `ESTUDIO` \| `GASTO` |
| `horas_por_dia`, `dias_por_semana`, `ingenieros`, `semanas` | `integer` | Solo `ESTUDIO` |
| `tarifa_hora` | `numeric(14,2)` | Solo `ESTUDIO` |
| `base_nodos` | `integer` | Solo `ESTUDIO`; sin él, el de `config_erp` |
| `activo` | `boolean NOT NULL DEFAULT true` | |
| `updated_by`, `created_at`, `updated_at` | | |

**`ESTUDIO` es un tipo y no una familia** (la propuesta tenía dos valores). La
familia `AR` es el caso raro: un estudio no tiene precio de lista, **se estima
por esfuerzo**, y esas cinco columnas son la propuesta que el catálogo ofrece.
Cada cotización las puede ajustar.

**Un solo precio para todos los clientes.** No hay precios por cliente, y es una
decisión y no una omisión: un descuento vive en la cotización que lo concede
—como utilidad del concepto o como ajuste de la partida—, donde se ve y se puede
explicar. Pegado al catálogo se volvería invisible.

### 1.2 `cat_servicios_cambios` — el historial

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `text` PK | uuid |
| `codigo` | `text NOT NULL` | FK a `cat_servicios`, `ON DELETE CASCADE` |
| `campo`, `antes`, `despues` | `text` | Qué cambió y de qué a qué |
| `usuario` | `text NOT NULL` | |
| `motivo` | `text NOT NULL` | **Obligatorio**: sin él el renglón no se escribe |
| `fecha` | `timestamptz NOT NULL DEFAULT now()` | |

Es tabla propia y no un renglón de `bitacora` —como proponía la versión anterior
de este plan— porque el motivo es **obligatorio** y la bitácora no puede
exigirlo, y porque la pregunta que hay que poder contestar es "qué le ha pasado
a este código", que contra `bitacora` sería una búsqueda de texto.

Apps Script lleva `Cat_Servicios_Cambios` precisamente porque recargar el
catálogo desde el Excel borraba lo editado a mano
(`PROCESO_COTIZACIONES.md:157`).

**Editarlo exige permiso propio**: `catalogo.servicios.editar`, en el grupo
Comercial. Cotizar no es lo mismo que mover el precio de lista de toda la
empresa.

### 1.3 `cot_armado` — el encabezado de la versión

| Columna | Tipo | Notas |
|---|---|---|
| `numero`, `anio`, `version` | `integer` | PK compuesta |
| `moneda` | `text NOT NULL DEFAULT 'MXN'` | La del resultado |
| `moneda_gastos` | `text NOT NULL DEFAULT 'MXN'` | Los gastos llevan la suya |
| `reparto_gastos` | `text NOT NULL DEFAULT 'IGUAL'` | `IGUAL` \| `PROPORCIONAL` \| `MANUAL` |
| `asesoria_pct` | `numeric(5,2) NOT NULL DEFAULT 10` | De `config_erp` al crear |
| `iva_pct` | `numeric(5,2) NOT NULL DEFAULT 16` | Por versión, ver §1.6 |
| `tipo_cambio` | `numeric(10,4)` | Solo si conviven monedas |
| `tipo_cambio_origen` | `text` | `BANXICO` \| `PREFERENTE` |
| `tipo_cambio_motivo` | `text` | Obligatorio si es `PREFERENTE` |
| `condiciones` | `jsonb` | Bloque validado, con versión de esquema |
| `documento` | `jsonb` | Bloque validado, con versión de esquema |
| `pdf_drive_id`, `doc_drive_id` | `text` | El PDF enviado y el Doc que lo generó |
| `created_by`, `created_at`, `updated_at` | | |

**No hay columna `modo`.** El modo `POR_PARTIDA` quedó fuera del alcance
(decisión 13) y una columna para un modo que no existe solo invita a leerla.

**Las condiciones son un bloque y no cuatro columnas.** Pago, entrega, lugar y
vigencia crecen con la plantilla, no con el modelo. Pero `jsonb` sin validar es
texto: todo lo que entra pasa por `normalizarCondiciones` /
`normalizarDocumento`, que devuelven el bloque en forma válida y **una lista de
avisos**, nunca un error — una cotización a medio armar tiene que poder
guardarse (§2.9). Cada bloque lleva su `esquema`: uno más nuevo del que el
código entiende se deja intacto y se avisa, en vez de "arreglarlo" perdiendo
datos.

### 1.4 `cot_partidas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `text` PK | uuid, **nuevo en cada versión** |
| `numero`, `anio`, `version` | `integer` | |
| `orden` | `integer NOT NULL` | 1, 2, 3… el renglón del documento |
| `titulo` | `text NOT NULL DEFAULT ''` | |
| `descripcion` | `text` | El alcance completo, **con saltos de línea** |
| `cantidad` | `numeric(14,4) NOT NULL DEFAULT 1` | |
| `unidad` | `text NOT NULL DEFAULT 'servicio'` | |
| `ajuste` | `numeric(14,2) NOT NULL DEFAULT 0` | Suma o resta, visible |
| `precio_unitario_final` | `numeric(14,2)` | El precio al que se decidió vender |
| `recibe_gastos_generales` | `boolean NOT NULL DEFAULT true` | `false` la saca del reparto |
| `gasto_manual` | `numeric(14,2)` | Solo con reparto `MANUAL` |
| `formato` | `text NOT NULL DEFAULT 'NORMAL'` | `NORMAL` \| `NEGRITAS` \| `OCULTO` |
| `notas` | `text` | Interna, no sale en el documento |

**`precio_unitario_final` no sustituye al ajuste: lo produce.** Cuando está, el
motor deriva `ajuste = precio × cantidad − total calculado` y lo marca como
derivado. Así el documento enseña el precio que se decidió **y** sigue viéndose
de dónde sale la diferencia, en vez de aparecer un número sin explicación. Si el
precio queda por debajo del costo de la partida —conceptos con utilidad más
gastos asignados— sale un aviso con el faltante: vender con pérdida puede ser
una decisión, pero tiene que ser una decisión y no un descuido.

`descripcion` es `text` y no `varchar`: algunas llegan a cincuenta líneas con
viñetas, y los saltos se conservan tal cual (`COT_04:99-107`).

Índice único en `(numero, anio, version, orden)` para que no haya dos partidas
compitiendo por el renglón 3 del documento.

### 1.5 `cot_conceptos` y `cot_gastos`

**Son dos tablas y no una con `tipo`**, como proponía la versión anterior. El
motivo es la 068: sus gastos no son todos del proyecto —la partida de tierras
trae los suyos— y eso pide una columna `destino_partida_id` que en un concepto
de partida no significa nada. Dos tablas dicen la verdad; una con la mitad de
las columnas en `NULL`, no.

`cot_conceptos`:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `text` PK | uuid |
| `partida_id` | `text NOT NULL` | FK a `cot_partidas`, `ON DELETE CASCADE` |
| `numero`, `anio`, `version` | `integer` | Para consultar la versión sin unir |
| `codigo` | `text` | Del catálogo, o nulo si es libre |
| `descripcion_libre` | `text` | Cuando no hay catálogo detrás |
| `cantidad` | `numeric(14,4) NOT NULL DEFAULT 0` | |
| `unidad` | `text` | |
| `costo` | `numeric(14,2)` | **El que se está usando** |
| `costo_catalogo` | `numeric(14,2)` | **Lo que el catálogo decía al copiarlo** |
| `utilidad_pct` | `numeric(5,2) NOT NULL DEFAULT 0` | |
| `moneda_costo` | `text` | Si difiere, se convierte con el tipo de cambio |
| `horas_por_dia`, `dias_por_semana`, `ingenieros`, `semanas`, `nodos`, `base_nodos` | `integer` | Estudios |
| `tarifa_hora` | `numeric(14,2)` | Estudios |
| `orden` | `integer NOT NULL` | |
| `notas` | `text` | |

`cot_gastos` repite lo pertinente y añade:

| Columna | Tipo | Notas |
|---|---|---|
| `destino_partida_id` | `text` | **NULL = general**, se reparte. Con valor, va entero a esa partida |

**Dos columnas de costo, y es el centro del asunto.** El concepto **copia** su
costo al agregarse: un cambio de catálogo no mueve una cotización abierta. Con
las dos columnas se distingue "el catálogo se movió" de "alguien negoció este
precio", que es la diferencia entre actualizar sin pensar y borrarle el
descuento a un cliente. `detectarDesfases` compara contra `costo_catalogo` y
marca aparte los negociados; `actualizarDesdeCatalogo` recibe los ids que se
decidió mover y devuelve el antes y el después de cada uno. Actualizar es un
acto explícito, nunca un efecto de abrir la versión.

Es lo contrario de lo que hace Apps Script, donde los importes se recalculan al
leer y cambiar un costo base mueve cotizaciones ya enviadas
(`PROCESO_COTIZACIONES.md:156`).

### 1.6 `cot_importes` — los números congelados

Es la tabla que materializa la decisión 2. **No existe en Apps Script**: ahí los
importes se recalculan siempre, que es justo el defecto que se corrige.

| Columna | Tipo | Notas |
|---|---|---|
| `numero`, `anio`, `version` | `integer` | PK compuesta |
| `congelado_at` | `timestamptz NOT NULL DEFAULT now()` | Cuándo |
| `congelado_por` | `text NOT NULL` | Quién |
| `resultado` | `jsonb NOT NULL` | El resultado completo de `calcularCotizacion` |
| `parametros` | `jsonb NOT NULL` | La entrada con la que se calculó |
| `moneda` | `text NOT NULL` | |
| `subtotal`, `iva`, `total` | `numeric(14,2) NOT NULL` | Fuera del jsonb, para listar sin abrirlo |
| `letra` | `text NOT NULL` | El renglón que el cliente compara contra la cifra |

**Se congela al mandar a revisión**, no al enviar: es el momento en que los
números dejan de moverse porque alguien más los va a mirar. De ahí en adelante
la versión no se edita; lo que sigue es una **versión nueva**.

**Se guarda el resultado completo y también los parámetros.** El resultado,
porque el PDF enseña cada partida con su precio unitario y reimprimirlo
recalculando daría otros números en cuanto el catálogo se mueva. Los
parámetros, porque sin ellos no se puede rehacer el cálculo para comparar: con
los dos, cualquiera puede comprobar que el documento sale de lo que dice que
sale. `scripts/prueba-068.ts` hace exactamente eso contra un PDF real.

**La tasa de IVA se guarda por versión**, en `cot_armado.iva_pct`. Hoy es 16 %
en todo el país y parece una constante, pero no lo es: la franja fronteriza tuvo
8 % y la tasa cambia por decreto. Una cotización enviada tiene que poder
reimprimirse con el IVA que se le aplicó, no con el vigente el día que alguien
la reabre — por la misma razón que se congelan los importes. El motor la recibe
como parámetro (`ivaPct`) y usa el vigente solo si no viene.

**Y resuelve el `monto_mxn` / `monto_usd` de `cotizaciones`**: al congelar se
llena el de la moneda del resultado —`montoDeCongelado`— y `origen_monto` queda
en `COTIZADOR`. Son dos columnas independientes y no un par (monto, moneda)
porque sumarlas exigiría inventar un tipo de cambio. Las históricas conservan
su monto con `origen_monto` en `MANUAL` u `OC`: hay que poder saber que ese
número no es un cálculo.

### 1.7 Qué se migra y cómo

| Origen | Destino | Cómo |
|---|---|---|
| `Cat_Servicios` | `cat_servicios` | Directo, una fila por código activo. Los inactivos entran con `activo = false`: hay cotizaciones viejas que los referencian |
| `Cot_Encabezado` | `cot_armado` | Directo. `Documento` (JSON) pasa tal cual a `documento` |
| `Cot_Partidas` | `cot_partidas` | `Numero` → `orden`; el `ID` de la hoja se conserva para poder religar los conceptos |
| `Cot_Conceptos` | `cot_conceptos` **o** `cot_gastos` | `Partida ID` resuelve el FK. El `Tipo` de la hoja decide a qué tabla va |
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

**El matiz que importa, y aquí cambiamos la regla de Apps Script.** Allá los
costos que venían del catálogo se re-resuelven con el precio vigente
(`PROCESO_COTIZACIONES.md:74`). Aquí **no se reprecia nada**: la versión nueva
arranca siendo la anterior, costo por costo, y si el catálogo se movió sale un
aviso por cada línea con el precio de entonces y el de ahora.

El motivo es que reprecias en silencio o avisas, pero no las dos. Una versión
nueva se hace casi siempre para cambiar una cosa —una cantidad, una partida—, y
que de paso se le muevan ocho costos que nadie pidió es cómo se manda una
cotización con un número que su autor no reconoce. Actualizar al precio vigente
está a un clic (`actualizarDesdeCatalogo`), con el antes y el después a la
vista.

Los ids de partidas y conceptos **se renuevan**: son la llave de esa versión, y
conservarlos haría que un gasto de la v1 apuntara a la partida de la v0.

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

### 6.2 ✅ Qué pasa si se edita el catálogo con cotizaciones en REVISION

Una versión en `REVISION` todavía no congela. Si alguien cambia un costo base
mientras el revisor la mira, **el revisor aprueba un número y se envía otro**.

**Cerrada:** se congela al **mandar a revisión**. El revisor mira números que
ya no se mueven, y lo que se envía al cliente es exactamente lo aprobado.

### 6.3 ✅ Permisos del catálogo de servicios

**Cerrada:** `catalogo.servicios.editar`, en el grupo Comercial de
`src/lib/permisos.ts`. Es permiso aparte de `modulo.cotizaciones` a propósito:
cotizar no es lo mismo que mover el precio de lista de toda la empresa. Se
asigna a los cotizadores y al gerente de operaciones.

### 6.4 🟡 La plantilla de Google Docs es un punto único de fallo

Si alguien la edita y quita un marcador, las cotizaciones salen con huecos.
Apps Script lo detecta y avisa (`COT_05:456`). ¿Se replica ese aviso, se
versiona la plantilla, o se valida en un test contra una copia conocida?

### 6.5 🟡 Apps Script y el ERP conviviendo

Mientras dure la fase, las dos herramientas pueden cotizar. ¿Se corta de golpe
al terminar el PR 6, o conviven un tiempo? Si conviven, el catálogo se edita en
dos lados y diverge.

### 6.6 ✅ `monto_mxn` / `monto_usd` de `cotizaciones`

**Cerrada:** se quedan como columnas normales y se llenan de tres maneras, que
ahora se distinguen con `origen_monto`: `COTIZADOR` al congelar, `OC` al
registrar la orden de compra, `MANUAL` si alguien lo tecleó. No son columna
generada porque las históricas nunca van a tener un congelado detrás, y hay que
poder saber que ese número no es un cálculo.

### 6.7 🟡 Modo `POR_PARTIDA` — ¿cuánto se usa?

Añade complejidad real: moneda y asesoría por partida, y varios bloques de
totales. Si en 2026 no lo usó nadie, podría quedar fuera del PR 2 y entrar
después. **Se puede medir** contando filas de `Cot_Encabezado` con
`Modo = 'POR_PARTIDA'`.

### 6.8 ✅ La familia AR y los nodos

**Cerrada:** a `config_erp`, junto con `ASESORIA_PCT_DEFAULT`. Son valores que
cambian con el negocio y no deberían necesitar un despliegue. El catálogo puede
además traer su propio `base_nodos` por código: el de la configuración es el
punto de partida, no un techo.

### 6.9 🟡 Qué se hace con `Cat_Servicios_Cambios`

La tabla destino ya existe (`cat_servicios_cambios`, §1.2). Queda por decidir si
se migra el historial viejo o se empieza en limpio. La carga del catálogo 2026
escribe un renglón por cada costo que cambia, así que el historial arranca con
lo que esa carga mueva.

---

## 7. División en PRs

Siete, en orden. Cada uno se puede probar solo y ninguno deja la app peor que
antes.

> **El orden real cambió.** El cálculo fue primero y el catálogo entró con el
> modelo, porque el modelo no se podía cerrar sin decidir cómo se copia un costo
> del catálogo. Lo que sigue refleja lo que se hizo.

### PR 1 · El catálogo de servicios — *entró con el PR 3*

Tabla `cat_servicios`, historial y permiso. La pantalla de solo lectura queda
para el PR de la pantalla del cotizador, que es donde se va a usar.

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

### PR 3 · El modelo ✅ **hecho**

Las siete tablas + migración `0006`, el puente con el motor
(`src/lib/cotizador/persistencia.ts`), el catálogo y sus desfases
(`catalogo.ts`), los bloques del documento (`documento.ts`) y el permiso.

**Probado por sí mismo** de dos maneras. En memoria, con la 068 escrita como
filas de la base y vuelta a leer. Y contra una base de verdad, con
`scripts/prueba-068.ts`: escribe la cotización **9068/2099**, la relee, la
calcula, la congela y compara contra el PDF del cliente. Si el total cambia un
centavo, el modelo perdió algo por el camino.

El catálogo real se carga con `scripts/importar-catalogo-2026.ts` desde el
formato `PFAD-024-2026`: 87 códigos de los 176 que trae el archivo —el resto son
huecos reservados— y los siete estudios con su desglose de esfuerzo.

Quedan para el PR siguiente las rutas `GET` y `PUT` del armado.

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

La tabla `cot_importes` y `congelar()` ya están (PR 3). Falta engancharlo al
flujo: congelar al pasar a `REVISION`, bloquear la edición después, y la lectura
que prefiere lo congelado sobre lo calculado.

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
