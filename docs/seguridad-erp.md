# La seguridad del ERP nuevo, contra la revisión del 17 nov

La revisión de seguridad del 17 nov encontró en el Apps Script de producción
12 hallazgos de severidad alta (A1–A12), 13 media (M1–M13) y 12 baja
(B1–B12). El informe vive fuera del repo, en la carpeta del legacy
(`revision-seguridad-2026-11-17.md`), y los arreglos van en los paquetes
1117a–f, que aplica Guillermo.

Este documento es la otra mitad: **que el ERP nuevo no repita ninguno**. Por
cada hallazgo dice la regla equivalente aquí y en qué estado está. No copia
código del legacy: cada hallazgo se describe en una línea, lo justo para
reconocerlo.

| Estado | Qué quiere decir |
|---|---|
| ✅ **Por diseño** | El ERP no lo puede repetir por cómo está hecho. Se dice dónde, y qué prueba lo fija. |
| ✅ **PR #n** | Se corrigió en ese PR. |
| ⏳ **Pendiente · PR** | Falta, y se dice en qué PR va. |
| — **No existe aquí** | El módulo no está en el ERP. Se deja escrita la regla para cuando llegue. |

---

## 1. Resumen

|  | ✅ | ⏳ | — |
|---|---|---|---|
| **Altos (A1–A12)** | 8 | 4 | 0 |
| **Medios (M1–M13)** | 5 | 7 | 1 |
| **Bajos (B1–B12)** | 7 | 5 | 0 |

Los ⏳ caen en seis PR. Tres ya estaban previstos, dos salen de este mapa y
uno es la propuesta del folio:

| PR | Qué cierra | Por qué en ese orden |
|---|---|---|
| **Enviar al cliente** *(nuevo, chico)* | M7: destinatarios libres y el «Mensaje» como HTML | Es lo único que **sale de la empresa** hoy. |
| **Autoaprobación** | A4, y que «Elaboró» decida quién arma (§3.1) | Ya estaba en la brecha (punto 7). |
| **Endurecimiento** *(nuevo, chico)* | M11 (transiciones en una sentencia), ✅ B11 (iframe), la foto del check-in (§3.4), la bitácora del encabezado (§3.7) | Cambios cortos. La pantalla solo cambia para avisar «alguien más la cambió». Va en dos partes: la primera no toca cotizaciones (B11 y §3.4), para no chocar con los PR que esperan; M11 y §3.7, después. |
| **Eliminación auditada** | M9: cotizaciones y contactos | Ya estaba en el plan (§6.9). |
| **El folio** *(propuesta, §6)* | B7: el número y el año los decide el servidor (el año, decidido el 20 nov) | Cuando se apruebe la propuesta. |
| **Migración de OT y compras** | A1, A7, A12, M1–M3, M5, B3–B6 | Nada de eso existe todavía en el ERP: se escribe con las reglas de la §2. |

Este PR no cambia ningún comportamiento. Agrega este documento y dos pruebas
(§4), y escapa el título de `plantillaCorreo`. Hoy todos los títulos los arma
el código, así que ningún correo cambia.

---

## 2. Las reglas del ERP, y las decisiones de Eduardo que adopta

### 2.1 Las diez reglas

Cada hallazgo de la revisión es un caso de alguna de estas reglas.

1. **Toda ruta exige sesión y permiso, antes de tocar nada.** El middleware
   no cubre `/api` (`middleware.ts:61`), así que cada ruta se protege sola
   con `exigirPermiso` (`src/lib/permisos.ts:187`). Lo fija
   `seguridad/rutas-protegidas.test.ts`.
2. **El permiso de un módulo abre la pantalla, no todos los datos.**
   «Todas las OT» o «todos los gastos» lo da un permiso de quien aprueba,
   revisa o paga, nunca un `modulo.*` (A7).
3. **Quién eres lo dice la sesión, nunca un campo que se edita.** Ni
   «Elaboró» ni un correo que llega en el cuerpo de la petición deciden un
   permiso (A4, B12).
4. **Lo que pone el sistema no se acepta del navegador.** Números de versión,
   orígenes, estados y folios los decide el servidor. Las rutas que editan
   llevan una **lista blanca** de campos (M3, M6, B7).
5. **Lo que alguien teclea nunca es marcado.** React escapa lo que pinta, y los
   correos pasan cada dato por `escaparHtml`. Lo fija
   `seguridad/html-sin-escapar.test.ts` (A5, M7, M10).
6. **Cada escritura va por su llave y en una sola sentencia.** No hay
   «renglón siguiente» ni «mirar y luego escribir». Se usan llaves primarias,
   índices únicos, `UPDATE … WHERE <estado leído>`, `ON CONFLICT` y `db.batch`.
   El driver HTTP de Neon no tiene transacciones interactivas, y esto es lo
   que las reemplaza (A9–A12, M11).
7. **Nada se borra ni se cambia sin rastro.** Lo que se quita se marca o se
   copia antes, con motivo y bitácora. Lo que se edita deja en la bitácora
   quién, qué campo, antes y después (M9, la regla 3 del legacy y §2.3).
8. **Lo sensible va aparte y con su permiso.** No basta con no enseñarlo: no
   sale de su tabla sin el permiso (A1, M5).
9. **Los datos viven en la base, no en archivos compartidos.** Solo el
   servidor toca Postgres y Drive, con su propia cuenta, así que nadie puede
   editar a mano lo que protege el código (A2).
10. **Lo que no es de la pantalla no es una ruta.** Las herramientas de
    mantenimiento son scripts locales con guardas contra producción
    (`scripts/guardas.ts`), no funciones que el navegador pueda llamar (B10,
    M13).

### 2.2 Las decisiones de Eduardo (17 y 18 nov)

Se tomaron para el legacy y el ERP las adopta tal cual. Ninguna está
implementada todavía, porque los módulos a los que aplican no existen o el
flujo no se ha construido. Aquí queda cómo se van a implementar.

**Autoaprobación segura** (paquete 1117a, A4)
- **La regla:** una cotización queda aprobada sola **solo si quien pulsa
  «Mandar a revisión» es la persona que la elaboró y tiene
  `cotizaciones.aprobar`**. En cualquier otro caso, revisión normal, también
  si la manda otro aprobador.
- **En el ERP:** «la persona que la elaboró» es `created_by`, que pone el
  servidor desde la sesión y no se edita. **Nunca la columna `elaboro`**,
  que es texto que cualquiera puede cambiar (§3.1). Las importadas (con
  `created_by` = importador) van siempre a revisión normal.
- **Bitácora:** queda a nombre de quien pulsó.
- **Pruebas que tiene que traer el PR:**
  - alguien pone en «Elaboró» las iniciales de un aprobador → revisión
    normal;
  - otro aprobador la manda → revisión normal;
  - quien la elaboró y aprueba la manda → aprobada, y la bitácora a su
    nombre.

**La regla de compras** (paquete 1117b, A7, M2, M3, M4)
- **Todos ven, por OT,** las requisiciones, los gastos, los viáticos y el
  personal externo, con el importe de cada uno.
- **Los totales de la OT** (sumas, P&L, % de gasto, importes de OC, lo
  facturado y lo cobrado) son solo de `gastos.costos`.
- **Registrar a nombre de otro, marcar asistencias y pagar** piden su permiso
  específico, nunca un `modulo.*`. `gastos.cuadrilla` permite registrar a
  nombre de otro solo en las OT donde quien registra es parte del personal.
- **No aprueba** quien gastó ni quien registró.
- **Nadie registra, aprueba ni paga un importe que no ve.**
- **La terminación de tarjeta y el número de cheque** solo los ve
  `gastos.pagar`, y no van en el PDF de la requisición.
- **En el ERP:**
  - el filtro va **en la consulta** (SQL), no en la pantalla: lo que no se
    puede ver no sale de la ruta;
  - el origen de un gasto lo pone el servidor;
  - cada permiso nuevo (`gastos.*`, `externos.*`) entra al catálogo de
    `permisos.ts` con su comentario, como los de hoy.

**Los datos sensibles del personal externo, separados y con permiso**
(paquete 1117c, A1, M5)
- **Qué datos:** NSS, CURP, RFC, domicilio y alta IMSS van en una **tabla
  aparte** que solo leen rutas con `externos.datos`. El salario va aparte
  también, para `externos.datos` y `gastos.costos`.
- **Dónde nunca van:** en correos, en el PDF de la OT ni en la bitácora (que
  dice qué campo cambió, nunca el valor).
- **Contratos y listas de personal:** van a una carpeta de Drive que solo ve
  `externos.datos`. El supervisor se los manda a esas personas; nadie más
  sube ahí.
- **En el ERP:** que esté en otra tabla no es un adorno. Una consulta de la
  OT no puede traer esas columnas aunque alguien se equivoque al armar la
  respuesta.

**Pagos que no se duplican** (paquetes 1117a y 1117d, A12)
- **La regla:** un doble clic o dos personas a la vez no pagan dos veces los
  mismos días, ni reembolsan dos veces el mismo excedente.
- **En el ERP, apartar los días va en una sola sentencia:** primero
  `UPDATE asignaciones SET pago = <id del intento> WHERE id IN (…) AND pago
  IS NULL RETURNING id`, y después se crea el gasto.
- **El seguro de la base:** el pago lleva un **índice único** por
  asignación. Aunque el código se equivocara, la base no acepta dos pagos de
  la misma asignación.
- **Si falla a la mitad:** se liberan los días de quien no alcanzó gasto, con
  otro `UPDATE … WHERE pago = <id del intento>`.
- **Cerrar viáticos:** `UPDATE … WHERE estado = 'ENVIADA' RETURNING`, y solo
  quien recibe el renglón registra los excedentes.

### 2.3 Las decisiones del 20 nov (solo del ERP)

**El encabezado de una cotización es de todos; armarla, de su dueño**
- **El encabezado** (título, dirigida a, prioridad, fecha de entrega, montos y
  los estatus manuales, entre ellos cancelar) lo edita **cualquiera con
  `modulo.cotizaciones`**, también en una cotización ajena. Así era en el Apps
  Script, y así funciona ya el ERP: el `PATCH` de
  `app/api/erp/cotizaciones/[key]/route.ts` pide solo ese permiso.
- **Armar** (partidas, precios, documento) sigue siendo **de quien la dio de
  alta o de `cotizaciones.armar.todas`** (`accesoAlArmado`,
  `src/lib/cotizador-permisos.ts:38`).
- **«Elaboró» no cuenta como encabezado.** Hoy decide quién arma (§3.1), así
  que abrirlo a todos le daría el armado a cualquiera. Lo cambia solo quien la
  arma. La pantalla del encabezado ni siquiera lo manda
  (`CotizacionesClient.tsx:928-934`): hoy solo se cambia llamando a la ruta
  a mano.
- **Cada cambio del encabezado queda en la bitácora** con quién, qué campo,
  antes y después. Hoy no se cumple: ⏳ PR de endurecimiento (§3.7).

**El año de una cotización nueva es siempre el año en curso**
- Sin excepción: no hay opción para dar de alta con el año anterior, ni
  siquiera en los primeros días de enero.
- Lo toma el servidor **de su propia fecha, en la zona horaria de México**, y
  no acepta uno que mande el navegador. Cómo se implementa: §6, punto 4.

---

## 3. Lo que este mapa encontró en el ERP

Siete cosas, ninguna grave, pero cinco repiten en chico un hallazgo del legacy.

### 3.1 «Elaboró» decide quién arma una cotización importada (como el A4)

- **Qué pasa:** `puedeArmar` (`src/lib/cotizador/armado.ts:486`) deja armar a
  quien la dio de alta (`created_by`) **o a quien tenga las iniciales de
  «Elaboró»** (línea 500).
- **Por qué es un problema:** «Elaboró» se edita por el `PATCH` del
  encabezado (`app/api/erp/cotizaciones/[key]/route.ts:89-98`), que solo pide
  `modulo.cotizaciones` y no revisa de quién es la cotización. Un cotizador
  puede poner sus iniciales en una importada de otro y armarla. Es el mismo
  defecto de raíz del A4: una columna de texto decidiendo un permiso.
- **El mismo `PATCH`** deja cambiar el título, los montos o cancelar
  cualquier cotización. **Eso se queda así** (decisión del 20 nov, §2.3): el
  encabezado es de todos los que tienen `modulo.cotizaciones`, como en el Apps
  Script. Lo que falta es su bitácora (§3.7).
- **⏳ PR de autoaprobación:**
  - `elaboro` sale de la lista blanca del `PATCH` abierto. Solo lo cambia
    quien la arma (o `cotizaciones.armar.todas`), validado contra las
    iniciales del catálogo de usuarios. La pantalla del encabezado no lo
    manda, así que nadie pierde nada;
  - la propiedad de una importada se reasigna explícitamente, con bitácora,
    no tecleando iniciales;
  - prueba: alguien con solo `modulo.cotizaciones` cambia el título de una
    cotización ajena (200) pero no su `elaboro` (403).

### 3.2 «Enviar al cliente» manda a cualquiera, y el mensaje va como HTML (el M7, igual)

- **(a) Destinatarios:** `enviarAlCliente`
  (`src/lib/cotizaciones-flujos.ts:545`) solo revisa que haya al menos uno.
  La pantalla ofrece los contactos del cliente, pero el servidor acepta
  cualquier correo. La cotización queda ENVIADA aunque no le haya llegado
  al cliente.
- **(b) Mensaje:** la pantalla arma
  `` `<p …>${mensaje}</p>` `` **sin escapar**
  (`app/erp/cotizaciones/CotizacionesClient.tsx:1210`), y el servidor lo
  manda tal cual (`cotizaciones-flujos.ts:587`). Lo que se teclea en
  «Mensaje» viaja como marcado en un correo que sale de la empresa. La
  descripción del #32 lo llamó «marcado que compone quien envía», pero en
  realidad es texto tecleado envuelto en un `<p>`.
- **⏳ PR «Enviar al cliente»,** con las decisiones del 18 nov:
  - solo contactos activos con correo del cliente, más correos de la empresa;
  - al menos uno tiene que ser del cliente;
  - si uno no cuadra, no sale nada;
  - el mensaje llega como **texto**, y el servidor lo escapa conservando los
    saltos de línea.
  - **Al cerrarlo:** se quita la excepción `mensaje` de
    `html-sin-escapar.test.ts`.

### 3.3 Las transiciones de estatus miran y luego escriben (el M11)

- **Qué pasa:** `cambiarEstatus` (`src/lib/cotizaciones.ts:644`) lee la
  versión, valida la transición y escribe con un `WHERE` que no incluye el
  estatus que leyó. `aprobarCotizacion` y `solicitarCorreccion`
  (`cotizaciones-flujos.ts:366` y `:408`) revisan `estatus === "REVISION"`
  en una lectura aparte.
- **Ejemplos de lo que deja pasar:**
  - un revisor aprueba mientras otro pide corrección, y la versión queda en
    PROCESO con una aprobación registrada;
  - un doble clic en «Enviar al cliente» le manda el correo **dos veces**
    al cliente: los dos pasan la revisión antes de que el primero marque
    ENVIADA.
- **⏳ PR de endurecimiento:** el patrón que ya usa el autoguardado
  (`src/lib/cotizador-db.ts:345-358`), un `UPDATE … WHERE estatus =
  <el leído> RETURNING`. Si no regresa renglón, «cambió mientras tanto, no
  se hizo nada». En el envío al cliente, la cotización se marca primero y
  el correo sale después.
- **Lo que ya está bien:** eliminar
  (`cotizaciones.ts:827`, la condición va dentro del `DELETE`), descartar
  versiones (`marcarNoAsignadas`) y registrar la OC posterior (`WHERE estatus
  = 'ASIGNADA'`).

### 3.4 La foto del check-in acepta cualquier sesión (como el A8, en chico)

- **Quién tiene sesión:** `signIn` acepta **cualquier cuenta de Google**
  (`src/auth.ts:59`); el `hd` de `auth.config.ts:40` es solo una sugerencia
  a Google. Es a propósito: así entran los temporales con su Gmail. Pero
  quien entra queda con sesión y el perfil incompleto, y el middleware solo
  lo detiene en las páginas, no en `/api`.
- **`POST /api/upload`:** pide sesión y nada más. El proyecto y el nombre de
  la carpeta llegan del navegador (`app/api/upload/route.ts:38-67`). Cualquier
  cuenta de Google puede subir imágenes de hasta 8 MB a la carpeta de
  check-in de la empresa, con el nombre de cualquier trabajador.
- **`POST /api/jornada`** sí revisa que un temporal fiche solo en sus
  proyectos (`app/api/jornada/route.ts:50-58`, prueba en
  `api/jornada.test.ts`). Guarda el `driveFileId` y el enlace que le manda
  el navegador, pero solo se le enseñan a la misma persona.
- **⏳ PR de endurecimiento:**
  - `upload` exige el perfil completo y rol `campo` o `admin`;
  - toma el proyecto de la asignación, como `jornada`, y el nombre de la
    sesión;
  - al cerrarlo, su excepción en `rutas-protegidas.test.ts` se queda (sigue
    siendo de solo sesión), pero sin «PENDIENTE».

### 3.5 Un contacto se borra (el M9)

- **Qué pasa:** `deleteContacto` (`src/lib/clientes.ts:254`) borra el
  renglón. Deja una línea en bitácora, pero sin copia de lo que había.
- **⏳ PR de eliminación auditada,** con la decisión del 18 nov:
  - se inactiva con motivo, quién y desde cuándo;
  - deja de ofrecerse para enviar;
  - se puede reactivar.

### 3.6 El ERP se podía meter en un iframe (el B11) — ✅ cerrado

Lo que había: `next.config.js` no mandaba `X-Frame-Options` ni
`Content-Security-Policy: frame-ancestors`. Una página ajena podía mostrar el
ERP en un marco y engañar a un aprobador para que hiciera clic.

**✅ PR de endurecimiento:** `headers()` en `next.config.js`, para todas las
respuestas (páginas, `/api`, estáticos y las redirecciones del middleware):
- `Content-Security-Policy: frame-ancestors 'none'` y `X-Frame-Options: DENY`;
- de paso, `X-Content-Type-Options: nosniff` y
  `Referrer-Policy: strict-origin-when-cross-origin`.

La CSP lleva **solo** `frame-ancestors`. Una completa (scripts, estilos,
conexiones) pide inventariar lo que carga la app, y un error ahí rompe el
inicio de sesión o la PWA; si se quiere, va aparte. El visor del PDF de Drive
no cambia: es el ERP el que enmarca a Drive, no al revés.

Prueba: `src/__tests__/seguridad/encabezados.test.ts` (§4.3).

### 3.7 Los cambios del encabezado no dejan rastro completo

La decisión del 20 nov (§2.3) pide que cada cambio del encabezado quede en la
bitácora con quién, qué campo, antes y después. Revisado el 20 nov:

| Qué se cambia | ¿Queda en la bitácora? |
|---|---|
| Estatus manual (cancelar, dependiente de proveedor o de cliente, volver a PROCESO) | **A medias.** Queda `COTIZACION_ESTATUS` con quién y el estatus nuevo (`app/api/erp/cotizaciones/[key]/route.ts:151-156`). Falta el anterior: `cambiarEstatus` lo lee y no lo devuelve (`src/lib/cotizaciones.ts:644`). |
| Título, dirigida a, prioridad, fecha de entrega, montos y «Elaboró» | **No.** `updateCotizacion` escribe y no registra nada (`src/lib/cotizaciones.ts:534`). |

Además, con el encabezado abierto a todos, es más fácil que dos personas
editen la misma cotización a la vez. Hoy gana el último en guardar. La
pantalla manda el formulario entero en cada guardado
(`CotizacionesClient.tsx:928-934`), así que el segundo borra sin aviso lo que
cambió el primero.

**⏳ PR de endurecimiento:**
- **Un renglón por campo que cambió:** `COTIZACION_ENCABEZADO`, con quién (la
  sesión), el campo, el valor de antes, el de después y la versión.
- **Solo lo que cambió de verdad.** Como la pantalla manda el formulario
  entero, el servidor compara contra lo que había. Guardar sin cambios no
  deja ninguna línea.
- **No se pisa lo de otro.** Es el mismo patrón que el autoguardado del
  armado (`guardarArmado` y `ConflictoDeEdicion`, `src/lib/cotizador-db.ts`):
  - la pantalla manda el `updated_at` que leyó al abrir el formulario;
  - el `UPDATE` va con `WHERE updated_at = <ese>`;
  - si no regresa renglón, la respuesta es 409, «alguien más la cambió,
    vuelve a abrirla», y no se escribe nada.
- **El cambio y su línea, en una sola sentencia:**
  `WITH c AS (UPDATE … RETURNING …) INSERT INTO bitacora … FROM c`.
  - Hoy `registrarBitacora` nunca lanza, a propósito, y por eso un cambio
    puede quedar sin su línea.
  - Aquí la línea es lo que dice quién movió un monto de otro, así que van
    juntos.
  - El «antes» es lo que el servidor leyó, y el `WHERE updated_at` asegura
    que nadie lo cambió entre la lectura y la escritura.
- **El estatus:** el `UPDATE … WHERE estatus = <leído> RETURNING` de la §3.3
  ya da el anterior, y la línea dice, por ejemplo, «PROCESO → CANCELADA».
- **Las pruebas:**
  - cambiar el título de una cotización ajena deja una línea con quién,
    `titulo`, antes y después;
  - guardar el formulario sin cambios no deja ninguna;
  - cancelar deja «<anterior> → CANCELADA»;
  - dos guardados con el mismo `updated_at`: el segundo recibe 409, sin
    escribir nada y sin línea.

### Fuera del código

Lo que no se puede ver desde aquí: quién es miembro de la unidad
compartida de Drive donde viven las carpetas, los Doc y los PDF de las
cotizaciones. Ahí cualquier miembro puede editar a mano, como en el A2. Vale
la pena revisar esa lista en Drive.

---

## 4. Las pruebas de seguridad

### 4.1 `src/__tests__/seguridad/rutas-protegidas.test.ts`

Es el equivalente de «funciones públicas sin permiso» (A3, A6, A8, M13).

- **Qué revisa:** recorre `app/api` en el disco y **llama** a cada método
  exportado de cada `route.ts` (hoy 36 rutas). Una ruta nueva entra sola.
- **Sin sesión:** tiene que contestar 401 o 403.
- **Con sesión y sin ningún permiso,** con rol `campo` y con rol `cliente`:
  también 401 o 403.
- **En los dos casos, sin tocar nada antes:** la base, Google (Drive, Docs,
  correo), la red y `enviarCorreo` están doblados para anotar quién los
  llamó. Una ruta que consulta y después rechaza ya filtró o escribió algo.
- **Las excepciones** van en una lista con su porqué:
  - `auth/[...nextauth]`, que no pide nada porque es el inicio de sesión;
  - las de check-in y perfil, que piden solo sesión y trabajan con los datos
    de quien llama;
  - `upload`, marcada PENDIENTE (§3.4).
  - Si una excepción ya no existe, la prueba falla.
- **Se comprobó que falla:** quitando el `if (rechazo)` de una ruta, la ruta
  contesta 200 y la prueba lo marca. Una ruta nueva que consulta la base
  antes de revisar la sesión también se marca, como «tocó la base».

### 4.2 `src/__tests__/seguridad/html-sin-escapar.test.ts`

Es el equivalente del A5 y el M10.

- **HTML directo en la página:** ningún `dangerouslySetInnerHTML`,
  `innerHTML`, `outerHTML`, `insertAdjacentHTML` ni `document.write` en
  `app/` ni en `src/`. Hoy no hay ninguno, y la lista de permitidos está
  vacía.
- **HTML armado como texto** (los correos): en toda plantilla o concatenación
  que lleve una etiqueta HTML, cada `${…}` tiene que cumplir una de tres:
  - pasar por `escaparHtml`;
  - ser una función que ya devuelve HTML escapado (`filaTabla`,
    `plantillaCorreo`…), cuyo cuerpo revisa la misma prueba;
  - estar en una lista de permitidas, con su porqué.
- **Cómo lee el código:** con el compilador de TypeScript, no con
  expresiones regulares. Por eso sabe qué es un `${…}` y qué función se
  llama.
- **Las permitidas de hoy:**
  - `folio`: lo arma el sistema;
  - `urlSistema()` y `url`: salen de la configuración;
  - `carpetaUrl`: la devuelve Drive;
  - `params.cuerpoHtml`: es HTML por contrato, y su armado se revisa aparte;
  - dos de `excel.ts`, que no arman HTML sino que leen el XML de un `.xlsx`;
  - `mensaje`, marcada PENDIENTE (§3.2).
  - Si una permitida deja de hacer falta, la prueba falla.
- **Se comprobó que falla:** quitando el `escaparHtml` del título en el
  correo al cliente, devolviendo el título de `plantillaCorreo` a como estaba
  y agregando un `dangerouslySetInnerHTML`.

### 4.3 `src/__tests__/seguridad/encabezados.test.ts`

Es la del B11, y llegó con el PR de endurecimiento.

- **Qué revisa:** lee `next.config.js` como lo carga Next, con `next-pwa`
  encima, y con el mismo comparador de rutas de Next comprueba que páginas,
  `/api`, el inicio de sesión y los estáticos llevan `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff` y `Referrer-Policy`.
- **La CSP:** tiene que traer solo `frame-ancestors`. Ampliarla es una
  decisión aparte, y la prueba obliga a tomarla.
- **Se comprobó que falla:** sin `headers()`, con una regla que deja fuera la
  raíz o solo cubre `/erp`, con `SAMEORIGIN`, con otra directiva en la CSP y
  sin `nosniff`.

---

## 5. Hallazgo por hallazgo

### Severidad alta

| # | El hallazgo, en una línea | La regla en el ERP | Estado | Dónde, y qué prueba |
|---|---|---|---|---|
| A1 | Los datos sensibles del personal externo se leían abriendo un archivo compartido | 8 · tabla aparte, solo `externos.datos` (§2.2) | ⏳ Migración de OT y compras | — |
| A2 | Todo el personal editaba a mano los archivos que el servidor protege | 9 · los datos están en Postgres; solo el servidor los toca | ✅ Por diseño | Las rutas son la única entrada (prueba de §4.1). Fuera del código: los miembros de la unidad de Drive (§3) |
| A3 | Una función del navegador cambiaba fechas del Control Operativo sin revisar nada | 1 · ninguna ruta sin sesión y permiso | ✅ Por diseño | `rutas-protegidas.test.ts`. El Control Operativo no está migrado: cuando llegue, además, que sea de una OT donde se participa |
| A4 | Un cotizador se autoaprobaba poniendo las iniciales de un aprobador en «Elaboró» | 3 · la sesión, no un campo editable (§2.2) | ⏳ Autoaprobación | Hoy el ERP no autoaprueba: aprobar siempre es explícito, con `cotizaciones.aprobar` y bitácora a nombre de quien aprueba. Pero «Elaboró» ya decide quién arma (§3.1) |
| A5 | XSS guardado: cliente, título o contacto se pintaban como HTML con la cuenta de quien abría la vista | 5 · React escapa; los correos, `escaparHtml` | ✅ Por diseño y ✅ PR #32 | `html-sin-escapar.test.ts`; `lib/cotizaciones-flujos.test.ts` («el texto tecleado va escapado en los correos») |
| A6 | Con un permiso de consulta se reescribía el catálogo de costos, sin historial | 10 · ninguna ruta escribe `cat_servicios` | ✅ Por diseño | La carga es `scripts/importar-catalogo-2026.ts`, con guardas, y deja historial con usuario y motivo (líneas 269-297). La pantalla de edición, cuando exista, pide `catalogo.servicios.editar` |
| A7 | Los permisos de módulo de compras abrían todas las OT a todo el personal | 2 · el módulo abre la pantalla, no los datos (§2.2) | ⏳ Migración de OT y compras | Hoy `modulo.ot` lista las OT sin un solo importe, que es lo que pide la regla |
| A8 | Cualquiera cambiaba la carpeta de adjuntos de todo el sistema | 1 y 10 · la configuración no tiene ruta | ✅ Por diseño | Las carpetas salen de variables de entorno; `config_erp` no tiene ruta que la escriba (`saveConfigErp` no se llama desde ningún lado). Una ruta futura cae en `rutas-protegidas.test.ts` |
| A9 | Se escribía en el renglón de la cotización de al lado | 6 · toda escritura va por llave | ✅ Por diseño | Llave `(numero, anio, version)` en `src/db/schema.ts:413`; `lib/cotizaciones.test.ts` («updateCotizacion con versión NO usa el WHERE de la vigente») |
| A10 | El renglón nuevo de Proceso y del Control de OT salía de «el último más uno» | 6 · una OT por cotización, por índice único | ✅ Por diseño | `ot_cotizacion_uq` en `schema.ts:482`; `lib/ot.test.ts` (los casos del 23505) |
| A11 | El autoguardado y el ingreso de la OC caían en el mismo renglón de montos | 6 · cada monto es una columna de su versión | ✅ Por diseño | El autoguardado no escribe montos y reclama la versión con `UPDATE … WHERE updated_at` (`src/lib/cotizador-db.ts:345-358`). El congelado los escribe una vez, por llave, al mandar a revisión (`:483-497`); la OC llega después, por su flujo |
| A12 | Un doble clic pagaba dos veces los mismos días al personal externo | 6 · apartar en una sentencia e índice único (§2.2) | ⏳ Migración de OT y compras | — |

### Severidad media

| # | El hallazgo, en una línea | La regla en el ERP | Estado | Dónde, y qué prueba |
|---|---|---|---|---|
| M1 | La carta al cliente se podía mandar a cualquier dirección, sin botón | 1 · y la carta solo a contactos del cliente, sin reenvío | ⏳ Migración de OT y compras | Hoy no hay carta en el ERP |
| M2 | Quien registraba un gasto a nombre de otro se lo aprobaba | 3 · no aprueba quien gastó ni quien registró (§2.2) | ⏳ Migración de OT y compras | — |
| M3 | El origen del gasto llegaba del navegador y lo sacaba del P&L | 4 · el servidor pone el origen | ⏳ Migración de OT y compras | La regla ya se aplica en cotizaciones: lista blanca del `PATCH` (`app/api/erp/cotizaciones/[key]/route.ts:89-98`), con prueba en `api/oc-posterior.test.ts` («lista blanca de campos») |
| M4 | Todo el personal veía los importes de las OC y la facturación | 2 · importes de OC y cobranza, solo `gastos.costos` (§2.2) | ✅ Por diseño | La OT no lleva un solo importe. Cuando entre la cobranza, con la regla de §2.2 |
| M5 | El enlace al contrato del personal externo le llegaba a cualquiera | 8 · contratos en carpeta restringida (§2.2) | ⏳ Migración de OT y compras | — |
| M6 | Un parámetro del navegador saltaba el candado de una versión aprobada | 4 · lo editable lo decide el servidor | ✅ Por diseño | `accesoAlArmado` (`src/lib/cotizador-permisos.ts`); `api/cotizador-armado.test.ts` («en revisión no se guarda ni siendo quien la elaboró»), `api/cotizador-documento.test.ts` («una versión ya mandada a revisión, 403») |
| M7 | El envío al cliente aceptaba cualquier destinatario y el mensaje como HTML | 5 · solo contactos; el mensaje es texto | ⏳ Enviar al cliente | §3.2 |
| M8 | Firmar el acta del Histórico pedía solo «ver», y la captura de montos pisaba la de la OC | 1 y 6 | — No existe aquí | Si se migra el Histórico: firmar con su permiso, y los montos de OC solo por su flujo |
| M9 | Eliminar un cliente borraba el renglón, sin rastro | 7 · inactivar con motivo | ⏳ Eliminación auditada | Cotizaciones: solo PROCESO, condición dentro del `DELETE` (`cotizaciones.ts:827`), con bitácora. Contactos: se borran (§3.5) |
| M10 | Un escape de HTML usado dentro de `onclick`, que el navegador deshace | 5 · React no usa JS en texto | ✅ Por diseño | Los manejadores son funciones, no cadenas; `html-sin-escapar.test.ts` |
| M11 | Rechazar, cancelar o pagar sin releer el estado; IDs y PD repetidos | 6 · `UPDATE … WHERE <estado leído>` | ⏳ Endurecimiento | IDs: los da la base. Responsables de OT: índice único y reintento (`ot.test.ts`, «si otro proceso gana el slot (23505)…»). Falta: las transiciones de cotización (§3.3) |
| M12 | Un solo candado para todo el sistema, y el cotizador lo ocupaba mucho | 6 · cada sentencia es atómica | ✅ Por diseño | Postgres bloquea por renglón; el documento y el PDF se hacen sin candado |
| M13 | Funciones del núcleo mandaban correos o creaban activadores sin permiso | 1 y 10 | ✅ Por diseño | No hay crons (no hay `vercel.json`); el correo solo sale de flujos detrás de un permiso. `rutas-protegidas.test.ts` dobla `enviarCorreo` y marca a quien lo llame antes de revisar |

### Severidad baja

| # | El hallazgo, en una línea | La regla en el ERP | Estado | Dónde, y qué prueba |
|---|---|---|---|---|
| B1 | Completar una OT no revisaba la OT ni su estatus | 1 y 6 | ✅ Por diseño | Generar la OT pide `ot.crear` y la cotización ENVIADA (`cotizaciones-flujos.ts:672-674`); una sola OT por cotización (`schema.ts:482`) |
| B2 | Una revisión de cobros sin chequeo, que cualquiera disparaba | 1 y 10 | ✅ Por diseño | No hay procesos sin ruta; toda ruta, en `rutas-protegidas.test.ts` |
| B3 | Se tomaba un folio de requisición apartado para otra persona | 4 · los folios los da el contador | ⏳ Migración de OT y compras | `src/lib/folios.ts` |
| B4 | IDs de archivos de Drive llegaban del navegador | 4 · solo IDs de esa solicitud | ⏳ Migración de OT y compras | En el check-in, el enlace de la foto también llega del navegador, pero solo se le enseña a la misma persona (§3.4) |
| B5 | El tipo de archivo se aceptaba por lo que decía el navegador; los gastos sin tope | 4 | ⏳ Migración de OT y compras | Hoy: fotos con lista de tipos y tope de tamaño (`upload`, `perfil/foto`) |
| B6 | Una sola persona firmaba los cuatro pasos de una requisición | 3 | ⏳ Migración de OT y compras | Decidir con la regla de compras: al menos «Aprobó» ≠ quien elaboró |
| B7 | El alta confiaba en la versión y el año que mandaba el navegador | 4 | ⏳ El folio (§6) | La versión ya no: `createCotizacion` la fuerza a 0 (`lib/cotizaciones.test.ts`, «crea la versión 0 en PROCESO…»). El número y el año sí llegan del navegador. Decidido el 20 nov: el año lo pone el servidor con la fecha de México, sin excepción (§2.3) |
| B8 | Un enlace de correo aprobaba con un solo GET | 1 · aprobar es un POST con sesión y permiso | ✅ Por diseño | Los correos llevan a la pantalla (`/erp/revision`), no a una acción |
| B9 | Si no se podía leer el estatus, la cotización se trataba como editable | 6 | ✅ Por diseño | Si la lectura falla, la ruta contesta error y no guarda |
| B10 | Unas 45 herramientas del editor sin chequeo, que enseñaban IDs y costos | 10 | ✅ Por diseño | Son scripts locales (`scripts/`), con guardas contra producción |
| B11 | La página se podía incrustar en cualquier sitio | — | ✅ Endurecimiento | `frame-ancestors 'none'` y `X-Frame-Options: DENY` en todas las respuestas (`next.config.js`, `seguridad/encabezados.test.ts`, §3.6) |
| B12 | En un activador, la identidad caía a la del dueño | 3 | ✅ Por diseño | Quién es lo dice el JWT de la sesión; la cuenta de servicio de Google nunca se registra como usuario |

---

## 6. El folio: de `MAX(numero) + 1` al contador atómico (propuesta, sin cambiar nada)

### Cómo está hoy

1. La pantalla de alta pide `GET /api/erp/cotizaciones?siguiente=1`
   (`app/erp/cotizaciones/CotizacionesClient.tsx:821`), que calcula
   `MAX(numero) + 1` del año (`src/lib/cotizaciones.ts:323`).
2. Ese número aparece en un campo que **se puede editar**.
3. El `POST` recibe `numero` y `anio` del navegador. El año sale del reloj
   del navegador (`CotizacionesClient.tsx:197`). El `GET` que no recibe año
   usa el del servidor (`app/api/erp/cotizaciones/route.ts:20`).
4. Si el número ya existe, la llave primaria `(numero, anio, version)` lo
   rechaza y la ruta contesta 409 (`cotizaciones.ts:444`).

**Lo que está bien:** no se corrompe nada. Dos cotizaciones no pueden
compartir número, porque lo impide la base.

**Lo que no:**
- Dos personas que abren el alta a la vez ven **el mismo número**. La segunda
  recibe un 409 y tiene que volver a intentar.
- El servidor acepta **cualquier número y año**: el 999, o el 2030. La §6.9
  del plan dice que un número por arriba del consecutivo no se ofrece, porque
  brincaría la numeración. Es el B7, a medias.
- **El año sale de un reloj que no es el de México:** el del navegador, o el
  del servidor, que en Vercel corre en UTC. Desde las 18:00 del 31 de
  diciembre, hora de México, `new Date().getFullYear()` en el servidor ya da
  el año nuevo.
- `src/lib/folios.ts:14` ya reserva un contador `cotizacion-AAAA` que **nadie
  usa**. Si alguien lo empezara a usar sin sembrarlo, arrancaría en 1 con
  cientos de cotizaciones ya dadas de alta.

### La propuesta

**1. El número lo toma el servidor, en una sola sentencia que también da de
alta la cotización:**

```sql
-- ${anio} = anioEnMexico(), punto 4. Nunca del navegador.
WITH n AS (
  INSERT INTO contadores (tipo, n)
  VALUES ('cotizacion-' || ${anio},
          (SELECT COALESCE(MAX(numero), 0) + 1 FROM cotizaciones WHERE anio = ${anio}))
  ON CONFLICT (tipo) DO UPDATE SET n = GREATEST(contadores.n + 1, EXCLUDED.n)
  RETURNING n
)
INSERT INTO cotizaciones (numero, anio, version, folio, …)
SELECT n.n, ${anio}, 0, 'PCOTOP-' || lpad(n.n::text, 3, '0') || '-' || ${anio}, …
FROM n
RETURNING *;
```

- **Atómica:** dos altas a la vez reciben números distintos. El renglón del
  contador queda bloqueado hasta que termina la primera.
- **No gasta números:** si el alta falla (un dato inválido, la llave), el
  contador tampoco se mueve. Es una sola sentencia, y se deshace entera.
- **Se siembra sola:** el `GREATEST` con `MAX(numero) + 1` cubre el año que
  empieza, las importaciones y un contador que se quedó atrás. No hace falta
  correr `asegurarContadorMinimo` a mano, aunque se puede seguir usando.
- Es `db.execute(sql\`…\`)` de Drizzle: el driver HTTP de Neon la corre como
  cualquier otra sentencia.

**2. La sugerencia se queda, pero solo informa.**
- `GET ?siguiente=1` devuelve `GREATEST(contador, MAX(numero)) + 1` sin
  mover nada.
- La pantalla lo muestra como «Siguiente: 451», ya no como un campo
  editable.
- Si al dar de alta salió otro, la respuesta trae el número real y la
  pantalla lo dice: «Se dio de alta como la 452: la 451 la tomó alguien más
  mientras tanto».

**3. El número a mano deja de llegar del navegador,** salvo un caso: un
**número libre por debajo del consecutivo** (§6.9, PR de eliminación
auditada).
- Ese se toma con su propia sentencia,
  `DELETE FROM numeros_libres WHERE anio = $1 AND numero = $2 RETURNING
  numero`, dentro del mismo `WITH`.
- Si otro lo tomó primero, 409 con el porqué.

**4. El año lo pone el servidor, con la fecha de México** (decidido el 20
nov, §2.3).
- **Siempre el año en curso, sin excepción.** No hay opción para dar de alta
  con el año anterior.
- **Una sola función, `anioEnMexico(ahora = new Date())`,** con
  `Intl.DateTimeFormat` y `timeZone: "America/Mexico_City"`, como ya hacen
  las fechas del check-in. La usan el alta y la sugerencia. Nunca
  `getFullYear()`, que en el servidor da el año en UTC (ver «Lo que no»).
- **El `POST` ya no lleva `anio`.** Si llega, contesta 400, «El año lo pone
  el servidor», con una lista blanca como la del `PATCH`. Ignorarlo en
  silencio escondería una pantalla vieja que siga en caché.
- **`?siguiente=1` tampoco recibe año.** El año del filtro del listado sí
  sigue llegando del navegador: solo decide qué se ve.
- **Lo que no cambia:**
  - una versión nueva conserva el año de su cotización: la v1 de la
    450-2026 sigue siendo 2026 aunque se haga en enero. La regla es solo
    para el alta;
  - las importaciones del legacy (`scripts/`) traen su año, porque no pasan
    por la ruta.
- **El cambio de año:** si alguien abre el alta el 31 de diciembre y guarda
  pasada la medianoche, la cotización sale con el año nuevo. La pantalla lo
  dice con el mismo aviso del punto 2.

**5. Las pruebas del PR:**
- dos altas a la vez reciben números distintos (la sentencia es una sola: la
  prueba fija que no haya lectura y luego escritura);
- pedir la sugerencia no mueve el contador;
- un alta que falla no gasta número;
- con el contador atrás del `MAX` (una importación), toma `MAX + 1`;
- con el reloj fijo:
  - el 31 de diciembre a las 23:30, hora de México (05:30 UTC del 1 de
    enero), da de alta en el año que termina;
  - el 1 de enero a las 00:05 da de alta en el año nuevo, con el número 1;
- un `POST` que trae `anio` contesta 400 y no da de alta nada.

**Lo que no resuelve:** mientras el Apps Script siga dando de alta
cotizaciones (§6.5 del plan), el ERP no ve esos números hasta que se
importan. Ese riesgo existe igual con `MAX + 1`. Lo cierra dar de alta en un
solo lado.
