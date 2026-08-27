# Análisis del legacy — Bloque Cotizaciones (ERP Apps Script)

Inventario funcional extraído del código en "Respaldo del Codigo" (000_GS, 12_Cotizaciones, 18-23, 34, Dashboard, DashboardJS, Sidebar, VistasCotizacion, VistaDashboardCotizaciones, VistaHistorialCotizaciones, ModalesClientes, ComponentesComerciales). Sirve como checklist de implementación de la Fase 1 y 4.

## 1. Inventario funcional

### Web App / entrada
- `doGet` sin params → SPA "PROYINSTELEC ERP". Con `?action=aprobar|corregir|corregir_enviar&numero=` → páginas del flujo de aprobación por correo.

### Crear cotización
- Numeración: sugiere `max(número usado)+1`, padding 3 dígitos. Validación de duplicado onblur y al guardar; si existe con datos, bloquea y remite a "Nueva Versión".
- Folio: `PCOTOP-NNN-AAAA` (con versión: `PCOTOP-NNN-AAAA-v`).
- Título se guarda como `titulo_cliente` (convención usada para localizar el PDF).
- Drive: busca/crea carpeta `NNN - AAAA` bajo carpeta raíz. Si carpeta nueva o versión 0: copia 2 plantillas (Google Doc + Google Sheet) renombradas `PCOTOP-NNN-AAAA[-v] titulo_cliente`.

### Nueva versión
- Toma la versión máxima, crea fila con versión+1, estatus=PROCESO, fecha solicitud=hoy, hereda cliente/título/dirigida, limpia fechaEntrega/OC/OT. Oculta filas anteriores (mecanismo frágil → en la nueva app: ítem por versión, la última es la vigente). Copia plantillas de nuevo a la MISMA carpeta.
- Regla de lectura: dashboard/buscador agrupan por número+año y toman la versión máxima ("solo la última versión cuenta").

### Editar cotización
- UI solo permite corregir "Dirigida a" y "Título". Backend también acepta estatus, prioridad, elaboró, fechaEntrega.
- Si el estatus CAMBIA a REVISION: invalida aprobación previa de esa versión, busca el PDF en la carpeta (nombre estándar exacto) y dispara los correos de revisión.

### Flujo revisión/aprobación/corrección
- **Enviar a Revisión** (solo desde PROCESO).
- **Aprobar**: valida que siga en REVISION (link viejo = error); registra aprobación (clave número+año+versión, sin duplicar); NO cambia el estatus; correo al elaborador. "Enviar al Cliente" solo aparece si estatus=REVISION y existe aprobación de esa versión exacta.
- **Solicitar corrección**: comentario mín. 10 caracteres → estatus vuelve a PROCESO, correo al elaborador con comentarios. Un reenvío a REVISION posterior invalida cualquier aprobación previa.

### Envío al cliente
- Precondición: PROCESO → bloqueado; REVISION sin aprobación → bloqueado; REVISION aprobada / ENVIADA / ASIGNADA → permitido (incluye reenvíos).
- Prellenado: match empresa por razón social normalizada (quita S.A. de C.V. etc., contains bidireccional) → contactos con correo; contacto sugerido cruzando "Dirigida a" (quita títulos LIC./ING./ARQ./C.P./DR./MTRO./SR.; match exacto → parcial → por palabra >2 letras). Remitente validado contra equipo autorizado.
- Envío: PDF obligatorio (error si no está en la carpeta); asunto sugerido "Cotización PCOTOP-NNN - cliente" y cuerpo plantilla (personalizables); CC automático = otros remitentes del equipo; actualiza estatus→ENVIADA y fecha entrega = fecha de envío; auditoría en "Log Envios".

### Ingreso de OC → generación de OT
- Solo con estatus ENVIADA. Prellena áreas (catálogo) y responsables (solo activos con iniciales — el Control Operativo cruza por iniciales).
- Validaciones: OC obligatoria; ≥1 área; responsable existente, activo y con iniciales.
- Folio OT: `OT` + número 3 dígitos + año 2 dígitos + versión (ej. OT001260).
- Escribe en cotización: OC, folioOT, estatus ASIGNADA. Registra responsable (rol "Responsable de la actividad", el anterior pasa a inactivo, se guarda historial). Sincroniza a Control de Proceso y Control de OT.
- Drive: carpeta `folioOT - cliente` bajo raíz de OT + subcarpeta "OC" con el adjunto (base64, ≤15MB, PDF/imagen); copia también en subcarpeta "OC" de la carpeta de la cotización.
- Correo de aviso de nueva OT. El front prevé campos monetarios (moneda/subtotal/IVA/total/fechaOC) que el servidor legacy ignora.

### Búsqueda
- 8 filtros: empresa (contains), número (contains), elaboró (exact), dirigida a (contains), estatus (exact), mes de entrega, OT (contains), OC (contains).
- Devuelve solo la versión más alta por número; flag `aprobada`.
- Card: folio, badge estatus, cliente, dirigida, elaboró, fecha entrega, OT, OC. Acción según estado: PROCESO→"Enviar a Revisión"; REVISION+aprobada→"Enviar al Cliente"; REVISION sin aprobar→"Esperando aprobación"; ENVIADA sin OC→"Ingresar OC". Siempre: Editar, Ver Carpeta, Nueva Versión.
- Pestaña Versiones: TODAS las versiones, orden desc.

### Dashboard
- KPIs: total, enviadas, asignadas (=con OC), en proceso, total empresas; gráfico mensual; Top 5 clientes (total/asignadas/% aceptación); por colaborador top 5; desglose por estatus; alerta de cotizaciones en PROCESO con fecha vencida.
- Dashboard General (1 llamada, permiso `dashboard.cotizaciones`): conversión %, enviadas %, en proceso %, clientes activos, mejor mes, promedio mensual; histórico mensual (cantidad, acumulado, variación %); KPIs del equipo comercial (del módulo KPI); cruce Weekly (cotizaciones por persona vía iniciales→correo; actividades abiertas/vencidas/completadas; actividades ligadas/sin ligar).
- `actividadesDeCotizacion(numero)` y ligar actividad↔cotización (permiso `actividades.asignar`).

### Clientes
- Alta con verificación de empresa existente por razón social normalizada (exacta → auto-reutiliza ID Emp y dirección; parcial → confirmación). Anti-duplicado empresa+contacto. IDs autoincrementales.
- Búsqueda contains por razón social o contacto; editar (solo puesto/teléfono/correo); eliminar con confirmación.

### Historial multi-año (POSPUESTO — decisión D8 del plan)
- Diagnóstico solo-lectura de fuentes 2024; validación 2024 (control de cotizaciones vs control de facturas, llave número-año, OT descompuesta, montos por moneda nunca sumados entre sí; cifras de referencia 275 · 86 · 31.27%).
- Módulo Histórico persistente: hojas Hist_Anios / Hist_Ajustes (AJU-####, tipos MONTO_FACTURADO | MONTO_COTIZADO | OT | ACEPTACION | ANIO | EXCLUIR, motivo obligatorio) / Hist_Montos (MON-####, doble moneda independiente, IVA auto 16%) / Hist_Validacion (acta por año). Clasificación: Aceptada / Aceptada - monto no localizado / Monto confirmado - OT no localizada / No aceptada.

## 2. Entidades y campos

### Cotización (hoja "Cotizaciones 2026", datos desde fila 9)
B=Prefijo "PCOTOP" · C=Número (3 dígitos) · D=Año · E=Versión (0=original) · F=Cliente (razón social) · G=Título (`titulo_cliente`) · H=Dirigida a · I=Prioridad (BAJA/MEDIA/ALTA) · J=Estatus · K=Elaboró (nombre o iniciales) · L=Fecha solicitud · M=Fecha entrega (sobrescrita con fecha de envío) · N=Orden de Compra · O=OT Interna.

**Estatus:** PROCESO → REVISION → (aprobación en registro aparte, estatus sigue REVISION) → ENVIADA → ASIGNADA. REVISION → (corrección) → PROCESO. Manuales: DEPENDIENTE PROVEEDOR, DEPENDIENTE CLIENTE, CANCELADA. La aprobación vive fuera del estatus, por versión exacta; se invalida al reentrar a REVISION.

### Cliente
ID Emp (agrupa contactos de la misma empresa) · ID Cliente · Razón social · Contacto · Puesto · Teléfono · Correo · Dirección (compartida por empresa).

### Aprobación
Fecha · Hora · Número · Año · Versión · Cliente. Clave `numero-anio-version`. Alta al aprobar; borrado al reenviar a revisión.

### Log de envío
Fecha · Hora · No. Cotización · Cliente · Versión · Remitente · Destinatarios · CC · Asunto.

### OT_Responsables
Folio OT · Correo · Rol · Área · Quién asigna · Fecha · Activo (historial por inactivación).

## 3. Notificaciones

1. Estatus → REVISION: al elaborador (confirmación) y a revisores (folio+versión+cliente, PDF adjunto, botones Aprobar / Solicitar corrección).
2. Aprobación: al elaborador ("ya puedes enviarla al cliente").
3. Corrección: al elaborador (folio, cliente, "devuelta a PROCESO", comentarios del revisor).
4. Envío al cliente: a contactos seleccionados; CC al equipo; PDF adjunto; registro en log.
5. Nueva OT: To correos de áreas seleccionadas; CC áreas no seleccionadas + lista CC + responsable; tabla con folio OT, responsable, OC, cotización origen, cliente, título, áreas; OC adjunta.

## 4. Permisos (mapeo del legacy → nueva app)

- `modulo.cotizaciones` (buscar/nueva/versiones), `modulo.clientes`, `dashboard.cotizaciones`, `cotizaciones.enviar` (reemplaza EQUIPO_REMITENTES hardcodeado), `cotizaciones.aprobar` (revisores), `historial.ver`, `actividades.asignar` (ligar actividad↔cotización).
- Nota del legacy: ocultar en UI no protege — la protección real va en servidor.

## 5. Pantallas

Buscador (8 filtros + cards por estado) · Nueva cotización · Editar (2 campos) · Envío al cliente (contactos, asunto/mensaje editables, preview CC) · Ingreso OC (responsable, OC, adjunto, áreas checkbox) · Versiones · Clientes (búsqueda/tabla/alta/editar/eliminar) · Dashboard 7 pestañas (Resumen, Cotizaciones, Clientes, Estadísticas, Histórico, Weekly, KPIs) · Historial (pospuesto).

## 6. Dependencias

- Drive: raíz cotizaciones → `NNN - AAAA` (Doc+Sheet copiados, PDF con nombre estándar, subcarpeta OC); raíz OT → `folioOT - cliente`/OC. Plantillas Doc y Sheet configurables.
- El PDF lo genera el usuario manualmente; el sistema lo localiza por nombre exacto.
- Observaciones para la reimplementación: links de aprobación sin autenticar (corregir, D6); col M mezcla fecha entrega y fecha de envío (separar en dos campos); sufijo `_cliente` en título acoplado al nombre del PDF; listas de correos hardcodeadas → permisos.
