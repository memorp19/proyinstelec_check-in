# Plan de migración — ERP Proyinstelec → App Next.js

**Fecha:** 27 de agosto de 2026
**Alcance acordado:** Cotizaciones, Órdenes de Trabajo (con Control Operativo) y Weekly/KPIs, migrados a DynamoDB dentro de la app existente (`Proyinstelec checkin:out`). La administración de usuarios se hará directamente con cuentas de Google — no se migra el catálogo de usuarios ni sus pantallas de alta.

---

## 1. Qué hay hoy

**App actual (destino):** PWA Next.js 14 (App Router, TS, Tailwind, pnpm monorepo) de check-in/out. NextAuth v4 con Google (`hd: proyinstelec.mx`), DynamoDB single-table (`proyinstelec-main` con pk/sk + 3 GSIs, más `proyinstelec-users`), Google Drive por service account, infra CDK, modo demo, 132 tests Vitest.

**ERP legacy (origen):** ~30,000 líneas de Google Apps Script sobre Google Sheets + Drive + MailApp. Tres bloques grandes:

- **Cotizaciones:** folio `PCOTOP-NNN-AAAA-v`, versiones (filas ocultas), flujo PROCESO → REVISION → aprobación (hoja aparte) → ENVIADA → OC → ASIGNADA, envío por correo con PDF, carpetas Drive `NNN - AAAA` con plantillas Doc/Sheet, clientes/contactos, dashboard con métricas, historial 2024-2026.
- **OT / Control Operativo:** folio `OT NNN AA v`, carpeta Drive por OT, archivo Sheet "Control Operativo" por OT con pendientes `PD-###`, servicios `SRV-###` (fechas, equipo, fin de semana), responsables, documentos, avisos de vencimiento (3 avisos: −3, −1, +1 días), vínculo bidireccional con actividades del Weekly.
- **Weekly / KPIs:** actividades `ACT-####` (semana lunes-domingo por fecha compromiso), solicitudes de reprogramación, ayudas entre áreas, comentarios, KPIs en 3 capas (plantilla → asignación → evaluación por periodo con snapshot), resumen automático de viernes, notificaciones por correo.

---

## 2. Decisiones de arquitectura

Decisiones confirmadas con Guillermo el 27/08/2026.

**D1 — Datos en `proyinstelec-main` (single-table).** Todas las entidades nuevas viven en la tabla existente con el mismo patrón pk/sk + GSIs denormalizados. Se agregan GSIs solo donde hay un patrón de acceso real (ver sección 3). Los Sheets actuales dejan de ser fuente de verdad; se importan una vez (script de migración) y quedan como respaldo.

**D2 — Usuarios con cuentas de Google, permisos simples.** No se migra el catálogo Usuarios/Roles del ERP ni sus 30+ permisos granulares. Se extiende el perfil existente (`proyinstelec-users`) con un campo `permisos: string[]` y se conserva un conjunto reducido de llaves (las que de verdad cambian comportamiento: `cotizaciones.enviar`, `cotizaciones.aprobar`, `actividades.confirmar`, `solicitudes.resolver`, `kpi.evaluar`, `kpi.administrar`, `ot.crear`, `control.operativo.crear`, más los `modulo.*` para mostrar/ocultar secciones). El rol `admin` existente los tiene todos. Las **iniciales** (EAOL, MNAA…) se agregan al perfil: son la llave con la que el ERP identifica personas en cotizaciones y controles operativos.

**D3 — El Control Operativo deja de ser un archivo Sheet por OT.** En el legacy cada OT tiene un Google Sheet con fórmulas y desplegables, y el ERP mantiene un índice-caché frágil (huérfanos, renglones preparados, iniciales coladas en catálogos). En la nueva app los pendientes son ítems de DynamoDB hijos de la OT: el "índice", el semáforo y el estatus Vencido se calculan al leer. Esto elimina de raíz los problemas de vínculos huérfanos, caché y sincronización bidireccional: el pendiente y su actividad Weekly son el mismo dato relacionado, no dos copias.

**D4 — Drive se conserva para lo documental.** Carpetas de cotización (`NNN - AAAA`), carpetas de OT (`OTxxxxx - CLIENTE` bajo carpeta del año), plantillas Doc/Sheet copiadas al crear cotización, subida de OC y documentos de OT. Todo con el service account ya integrado (`drive.ts`), guardando `drive_folder_id`/`drive_file_id` en los ítems para no volver a buscar por nombre.

**D5 — Correo transaccional: Gmail API** (✅ confirmado). Service account con delegación de dominio — los correos salen de una cuenta real del dominio, sin costo nuevo y con continuidad para el equipo. Requiere configurar la delegación en la consola de administrador de Google Workspace. Los envíos se registran en bitácora (equivalente del "Log Envios").

**D6 — Aprobación autenticada, no por link abierto.** En el legacy cualquiera con el link del correo podía aprobar (documentado como riesgo). Nueva versión: el correo de revisión lleva un link a la app; el revisor entra con su cuenta Google y aprueba/solicita corrección desde una pantalla protegida por `cotizaciones.aprobar`. Se conserva el registro de aprobación por versión exacta y su invalidación al reentrar a revisión.

**D7 — Tareas programadas con EventBridge Scheduler → Lambda** (la infra CDK ya tiene Lambda): avisos de vencimiento (diario 8:00) y resumen de viernes (viernes 17:00), ambos con la lógica del legacy (3 avisos por actividad con memoria en bitácora; correo personal solo a quien tiene contenido + correo único a gerencia).

**D8 — Histórico 2024 pospuesto** (✅ confirmado). El bloque de historial multi-año (validación 2024, ajustes, captura de montos desde PDFs, actas) queda fuera de estas fases; se decidirá después si se migra o se queda como consulta en Sheets. El historial 2025/2026 sí queda cubierto: los datos vivirán en DynamoDB desde la importación.

**D9 — Folios y estados se conservan tal cual** (`PCOTOP-NNN-AAAA-v`, `OT` + número + año + versión, `PD-###`, `ACT-####`, `SRV-###`, `SOL-####`, `AYU-####`; estatus PROCESO/REVISION/ENVIADA/ASIGNADA, etc.), para que el equipo no cambie de vocabulario y los datos importados cuadren. Los contadores de folio se implementan con ítems `COUNTER#` y updates atómicos (adiós "max+1" leyendo toda la hoja).

**D10 — Bitácora unificada.** Ítem `BITACORA` por evento (acción, usuario, detalle, referencia), TTL opcional. Cubre auditoría, "Log Envios" y la memoria de avisos enviados (`ACT-X|-3`).

---

## 3. Modelo de datos (proyinstelec-main)

Convención: mismos patrones que jornadas/proyectos (atributos planos + llaves GSI denormalizadas, ids uuid o folio, timestamps ISO, estados en español).

| Entidad | pk | sk | Accesos principales |
|---|---|---|---|
| Cliente (empresa) | `CLIENTE#{id}` | `#METADATA` | listado (scan por prefijo, volumen bajo) |
| Contacto | `CLIENTE#{id}` | `CONTACTO#{id}` | contactos de una empresa (query pk) |
| Cotización | `COT#{numero}-{anio}` | `V#{version}` | todas las versiones (query pk); última versión (query desc limit 1) |
| — | | | GSI4 `gsi4pk=COT#{anio}`, `gsi4sk={estatus}#{numero}` → dashboard y búsqueda por año/estatus |
| Aprobación | `COT#{numero}-{anio}` | `APROBACION#V{version}` | ¿versión aprobada? (get directo) |
| OT | `OT#{folio}` | `#METADATA` | ficha (get); GSI4 `gsi4pk=OT#{anio}` → listado por año |
| Responsable OT | `OT#{folio}` | `RESP#{ts}` | historial de responsables (query pk, flag activo) |
| Pendiente CO | `OT#{folio}` | `PD#{num}` | control operativo de la OT (query pk) |
| Servicio | `OT#{folio}` | `SRV#{num}` | servicios de la OT; GSI5 por fecha para "qué se trabaja este fin de semana" |
| Documento OT | `OT#{folio}` | `DOC#{id}` | documentos registrados |
| Actividad Weekly | `ACT#{id}` | `#METADATA` | GSI2 existente (`gsi2pk=responsable`, `gsi2sk=fecha compromiso`) → mi semana; GSI4 `gsi4pk=ACT#SEMANA#{aaaa-ss}` → weekly de gerencia; atributos `folio_ot`/`pd`/`cotizacion` para el vínculo |
| Solicitud reprog. | `ACT#{actividadId}` | `SOL#{id}` | solicitudes de una actividad; GSI4 por estado=Pendiente → bandeja de resolutores |
| Ayuda | `AYUDA#{id}` | `#METADATA` | GSI4 `gsi4pk=AYUDA#{area}` → bandeja del área |
| Comentario | `{origen}#{ref}` | `COM#{ts}` | historial append-only bajo la entidad |
| KPI plantilla | `KPI#{id}` | `#METADATA` + `ACTK#{id}` | plantilla con sus actividades (query pk) |
| KPI asignación | `KPIA#{id}` | `#METADATA` | GSI2 por colaborador |
| KPI evaluación | `KPIA#{id}` | `EVAL#{periodo}` | periodos de una asignación; snapshot JSON de actividades; GSI2 por colaborador |
| Contadores | `COUNTER#{tipo}` | `#N` | folio siguiente (UpdateItem ADD atómico) |
| Bitácora | `BITACORA#{aaaa-mm}` | `{ts}#{id}` | auditoría por mes; memoria de avisos |

Se agregan **2 GSIs nuevos** (GSI4 "colección por año/semana/estado", GSI5 "servicios por fecha"); el resto reutiliza GSI2. Detalle fino de atributos por entidad se definirá al arrancar cada fase, partiendo de los campos ya inventariados del legacy.

---

## 4. Fases

Cada fase termina con: lib + rutas API + pantallas + tests + actualización del script de importación desde Sheets. Nada de una fase posterior bloquea entregar la anterior.

### Fase 0 — Fundamentos (base común)
Extensión del perfil (`permisos`, `iniciales`, `gerencia`), helper de autorización para API routes (`exigirPermiso`), GSI4/GSI5 en CDK y create-tables, contadores de folio, bitácora, módulo de correo (según D5) con plantillas HTML, y el esqueleto de navegación del ERP dentro de la app (nueva sección `/erp` con menú lateral filtrado por `modulo.*`). Actualizar seed/demo.

### Fase 1 — Clientes y Cotizaciones
- CRUD de clientes/contactos con anti-duplicados por razón social normalizada (misma lógica del legacy: quitar S.A. de C.V., match exacto → parcial con confirmación).
- Crear cotización: folio automático, carpeta Drive `NNN - AAAA`, copia de plantillas Doc/Sheet; nueva versión (hereda datos, misma carpeta, la última versión es la vigente — sin filas ocultas).
- Búsqueda con los 8 filtros del legacy + tarjetas con acción según estado; pestaña de versiones.
- Flujo completo: enviar a revisión (correo a revisores con PDF), aprobar / solicitar corrección (en la app, autenticado, D6), envío al cliente (contactos sugeridos, asunto/cuerpo editables, PDF adjunto obligatorio, CC al equipo, registro en bitácora), estados y transiciones idénticos al legacy.
- Ingreso de OC → generación de OT: folio OT, carpeta Drive de la OT + subcarpeta OC con el adjunto, registro de responsable, correo de aviso a áreas.
- Importador: Sheets "Cotizaciones 2026" + Clientes + Aprobaciones → DynamoDB.
- **Entregable:** el equipo comercial opera cotizaciones completas en la app.

### Fase 2 — OT y Control Operativo
- Listado y ficha de OT (resumen, cotización origen, responsables, carpeta Drive con subcarpetas, documentos con subida y registro).
- Control operativo nativo (D3): pendientes con categorías/prioridades/equipos, estatus Vencido calculado, semáforo y avance derivados; crear control = alta de la OT en el módulo + primera actividad automática "Definir fecha del servicio" (+5 días).
- Servicios: definir fecha (tipo Servicio/Suministro/Ambos, equipo validado, calendario con fin de semana), reprogramar (fecha original inmutable), cancelar, cambio de equipo con los 3 correos (salen/entran/siguen), cambio de estatus.
- Panel de cobertura ("toda OT debe tener control operativo").
- Avisos de vencimiento (D7): trigger diario, 3 avisos por actividad con memoria en bitácora, 1 correo por persona.
- Importador: hojas OT/OT_Responsables + lectura de los archivos "Control Operativo" existentes en Drive → pendientes en DynamoDB.
- **Entregable:** operación gestiona OTs, pendientes y servicios sin los Sheets.

### Fase 3 — Weekly y Seguimiento
- Actividades: alta con correo al responsable, visibilidad por permiso (todas / gerencia / propias), edición restringida (estatus y fecha solo con `actividades.confirmar`), cancelar/reprogramar con motivo y eco al pendiente CO (ahora una relación directa, no sincronización).
- Vista Weekly: semana lunes-domingo por fecha compromiso, pestañas gerencia/mi semana, tarjetas KPI, arrastre y próxima semana.
- Solicitudes de reprogramación (flujo completo con correos) y ayudas entre áreas (privacidad por gerencia destino).
- Comentarios append-only y campana de notificaciones calculadas al vuelo.
- Resumen de viernes (D7): correo personal + correo de gerencia.
- Envío manual del Weekly.
- **Entregable:** el ciclo semanal completo vive en la app.

### Fase 4 — KPIs y Dashboards
- KPIs 3 capas: plantillas (ponderaciones que suman 100), asignaciones (renovación por periodo), evaluaciones (snapshot, avance calculado al marcar actividades, calificación por rangos, cierre/reapertura, evidencias, comentarios).
- Dashboard de cotizaciones: KPIs, conversión, top clientes, por colaborador, histórico mensual, cruce con Weekly y KPIs del equipo comercial.
- **Entregable:** medición y tableros completos; fin de la dependencia del ERP legacy (salvo histórico, D8).

---

## 5. Simplificaciones deliberadas respecto al legacy

Cosas que el legacy hacía por limitaciones de Apps Script/Sheets y que desaparecen: filas ocultas como versionado (→ ítems por versión), índice-caché del control operativo y vínculos huérfanos (→ dato único relacionado), renglones "preparados" y catálogos con huecos (→ catálogos en código/config), listas de correos hardcodeadas (→ permisos en el perfil), búsqueda de carpetas Drive por nombre en cada operación (→ ids guardados), links de aprobación sin autenticar (→ pantalla protegida), protección de columnas del Sheets (→ autorización en servidor), límite de 6 minutos y cuota de MailApp (→ Lambda/SES o Gmail API).

Lo que **no** se simplifica: folios, estados, reglas de negocio (aprobación por versión exacta e invalidación, candado de fecha compromiso, 3 avisos y se acaba, Suministro sin equipo, fecha original inmutable, correo solo a quien tiene contenido, usuarios inactivos nunca reciben correo).

---

## 6. Riesgos y puntos de atención

- **Importación de datos vivos:** los Sheets 2026 siguen operándose; el importador debe poder correrse varias veces (idempotente) y habrá un corte definido por módulo al hacer el switch.
- **Iniciales como llave de personas:** los controles operativos y cotizaciones identifican gente por iniciales; hay que capturar iniciales en cada perfil antes de importar (el importador reportará las que no crucen).
- **PDF de la cotización:** en el legacy el PDF lo genera una persona manualmente en la carpeta y el sistema lo busca por nombre exacto. Mantendremos ese flujo (buscar el PDF en la carpeta al enviar), pero conviene decidir después si la app lo genera.
- **Delegación de dominio para Gmail API** (si eliges D5-a) requiere configuración en la consola de administrador de Google Workspace.

---

## 7. Decisiones confirmadas (27/08/2026)

1. **Correo:** Gmail API con cuenta del dominio (delegación de dominio en Workspace).
2. **Histórico 2024:** pospuesto.
3. **Ubicación:** sección nueva `/erp` junto a `/app` (campo) y `/admin`, con menú lateral filtrado por permisos.
4. **Datos:** importación por módulo — al terminar cada fase corre un importador idempotente desde los Sheets 2026 y se define la fecha de corte del Sheet correspondiente.
5. **Odoo:** fuera del alcance del ERP; sigue solo para la sincronización de jornadas existente.

---

*Análisis fuente: 52 archivos de "Respaldo del Codigo" (~30k líneas GAS) y el código actual de "Proyinstelec checkin:out". Los inventarios funcionales detallados por módulo (campos, correos, permisos y pantallas, uno a uno) están documentados y se usarán como checklist al implementar cada fase.*
