# Análisis del legacy — Bloque Weekly, KPIs y Seguimiento (ERP Apps Script)

Extraído de 00-11, 29, 31 y las vistas Weekly/Actividades/KPI/Seguimiento/AdminUsuarios/AdminDashboards. Checklist de implementación de las Fases 0, 3 y 4. Nota: usuarios/roles se gestionarán con cuentas de Google — del legacy solo se toma el modelo de permisos, no las pantallas de administración de usuarios.

## 1. Inventario funcional

### Semana Weekly
- Semana = LUNES a DOMINGO. Selector con anterior/siguiente/hoy y número de semana ISO.
- La actividad cae en UNA semana por su **fecha compromiso** (no por fecha inicio).
- Pestañas: Administración y Operación (solo `dashboard.gerencial`; agrupan por gerencia→persona con barra de % por persona) y "Mi semana" (colaborador): actividades de la semana + panel "Pendientes y prioridades" = vencidas de semanas previas sin cerrar ("Arrastre") + las que vencen la semana siguiente ("Próxima semana").
- 5 tarjetas de cabecera: Actividades (canceladas fuera del cálculo), En tiempo, Completadas, Vencidas, Avance % (completadas/válidas).
- Acciones de gerencia desde la tabla (`actividades.confirmar`): Cancelar (motivo ≥5 obligatorio) y Reprogramar (fecha + motivo); ambas hacen eco al pendiente del Control Operativo si hay vínculo.
- Envío manual del Weekly por correo (`weekly.enviar`): destinatarios activos seleccionables, comentario de portada, resumen por estado + detalle por actividad.

### Actividades
- Alta (`actividades.asignar`): título obligatorio, responsable existente y activo, prioridad (default Media), estado (default "En tiempo"), fecha compromiso obligatoria; folio `ACT-####`; correo automático al responsable.
- Visibilidad: `actividades.ver.todas` → todas; `.ver.gerencia` → su gerencia + propias + las que asignó; default → solo las suyas.
- Edición: el responsable solo edita comentarios/adjuntos; **estado y fecha compromiso solo con `actividades.confirmar`** ("el estatus lo pone la gerencia"). Sincroniza el pendiente CO si hay vínculo.
- Estados: `En tiempo` | `Completado` | `Reprogramado` | `Cancelado`; "Vencida" derivado (compromiso < hoy y viva).
- Campos: ID, título, descripción, prioridad, responsable (correo), asignada por, fecha inicio, fecha compromiso, estado, comentarios, adjuntos, creada, última actualización, cotización (vínculo opcional), folio OT (opcional), pendiente PD (opcional).

### Seguimiento
- **Solicitudes de reprogramación** `SOL-####`: el colaborador pide mover fecha de SU actividad (fecha propuesta + motivo obligatorios; máx. 1 pendiente por actividad); correo a todos los `solicitudes.resolver`. Resolver: Aprobada → actividad "Reprogramado" con fecha nueva + eco al pendiente CO; Rechazada → solo respuesta. Correo al solicitante en ambos casos. Estados: Pendiente → Aprobada | Rechazada.
- **Ayudas entre áreas** `AYU-####`: asunto+detalle+área destino; correo SOLO a activos con `ayudas.responder` de esa gerencia (privacidad: terceros no la ven). Bandeja: recibidas (si puede responder y es su área) + enviadas. Estados: Abierta → Respondida → Cerrada.
- **Comentarios** `COM-####`: historial append-only; origen ACTIVIDAD | KPI | AYUDA; autor y papel (colaborador/gerente).
- **Notificaciones en app:** calculadas al vuelo (no almacenadas), campana con badge por urgencia: actividad vencida (3), vence en ≤2 días (2), solicitudes por resolver (3, solo resolutores), respuestas a mis solicitudes (1), ayudas abiertas a mi área (2), KPI del periodo en 0% (1).

### KPIs — tres capas
- **Capa 1 Plantilla** (`kpi.administrar`) `KPI-####`: nombre, gerencia, descripción, periodicidad (Única/Semanal/Mensual), vigencia; N actividades `ACK-####` con ponderación que **debe sumar 100** (validado en servidor). Editar plantilla NO toca historial (los periodos guardan snapshot). Eliminar solo si sin uso; si ya se usó → Inactiva.
- **Capa 2 Asignación** (`kpi.asignar`) `ASK-####`: plantilla activa + colaborador activo + fecha inicio (fin opcional; vacía = renovación indefinida); rechaza duplicado vigente; correo al colaborador.
- **Capa 3 Evaluación** `EVK-####`: renovación idempotente al abrir el módulo (opcional trigger diario). Periodo: Mensual = mes calendario (`AAAA-Mmm`), Semanal = lunes-domingo (`AAAA-Sss` ISO), Única = un periodo. Arranca en 0% con **snapshot JSON** de actividades+ponderaciones.
- **Medición:** avance nunca manual = suma de ponderaciones de actividades marcadas (marca el colaborador o `kpi.evaluar`; bloqueado si cerrada salvo evaluador). Calificación por rangos: ≥95 Excelente 🟢, ≥85 Muy Bueno 🔵, ≥75 Bueno 🟡, ≥60 Regular 🟠, <60 Deficiente 🔴.
- Comentario del colaborador y del gerente (van también al historial de comentarios). Cierre/reapertura (`kpi.evaluar`) congela avance + correo al colaborador.
- **Evidencias** `EVD-####` por actividad (tipo enlace/archivo/imagen + referencia + nota); quita solo quien subió o el evaluador.
- Visibilidad: `kpi.ver.todos` / `.ver.gerencia` / propios. Historial anual por colaborador.

### Resumen de viernes (trigger viernes ~17:00)
- Fuente: solo actividades (nunca los archivos de Drive). 3 listas mutuamente excluyentes por fecha compromiso: **Pendientes** (vencidas sin cerrar), **Fin de semana** (sábado/domingo próximos), **Próxima semana** (lunes a domingo siguientes). Lo que vence hoy o más allá no entra.
- **Correo personal:** solo a quien tiene contenido (evita fatiga); cada línea con título, vence, OT/PD o "sin OT", estado, días de vencida; asunto dinámico.
- **Correo de gerencia:** uno solo a activos con `actividades.ver.todas` o `dashboard.gerencial`: totales + desglose por persona ordenado por pendientes.
- En Fase 2 se integran los servicios en rango (qué se trabaja el fin de semana y quién va).

### Bitácora
Fecha/hora · correo · acción · detalle. Acciones tipo: ACCESO_DENEGADO, ALTA/EDITA_ACTIVIDAD, CORREO_ENVIADO/OMITIDO/ERROR, SOLICITUD_*, AYUDA_*, WEEKLY_ENVIADO, RESUMEN_VIERNES, KPI_*, AVISO_VENCIMIENTO, CO_*, SERVICIO_*. Nunca interrumpe la operación principal.

## 2. Modelo de roles/permisos (referencia para el modelo simplificado)

- Mecánica legacy: permisos efectivos = rol ∪ permisos extra individuales; validación siempre en servidor; usuario Inactivo = cero permisos, no recibe correos, no es asignable.
- Catálogo completo: `dashboard.gerencial/.administracion/.operacion/.cotizaciones`; `actividades.asignar/.ver.todas/.ver.gerencia/.ver.propias/.confirmar`; `kpi.administrar/.asignar/.evaluar/.ver.todos/.ver.gerencia/.ver.propios`; `solicitudes.enviar/.resolver`; `ayudas.solicitar/.responder`; `weekly.enviar`; `cotizaciones.enviar/.aprobar`; `modulo.cotizaciones/.clientes/.ot/.control.operativo/.control.costos/.weekly/.kpi/.control.ot`; `ot.crear/.asignar/.documentos`; `control.operativo.crear`; `historial.ver/.validar`; `usuarios.administrar`; `documentos.administrar`.
- Roles base: ADMINISTRADOR_SISTEMA y GERENTE_GENERAL (todo); GERENTE_AREA (todo lo operativo/comercial de su ámbito, ver.gerencia, sin administrar usuarios); COLABORADOR_ADMIN (propias + módulos comerciales); COLABORADOR_OPERACION (propias + módulos operativos + control.operativo.crear).
- Campos del usuario que sí se migran al perfil: **gerencia, iniciales (2-5 mayúsculas, únicas — llave de cruce con el CO), permisos**.

## 3. Notificaciones (resumen)

Actividad asignada (responsable) · Solicitud creada (resolutores) · Solicitud resuelta (solicitante) · Ayuda (respondedores del área destino) · Ayuda respondida (solicitante) · KPI asignado (colaborador) · Evaluación cerrada/reabierta (colaborador) · Weekly manual (seleccionados) · Resumen viernes personal + gerencia. Todas filtran inactivos y registran en bitácora.

## 4. Pantallas

- **Weekly:** selector de semana, pestañas por dashboard, 5 tarjetas, tabla semanal (con chip de origen CO: OT·PD / solo OT), tabla de pendientes (Arrastre / Próxima semana), tarjetas por persona con barra; modales Cancelar y Reprogramar.
- **Actividades:** 5 tarjetas, buscador + filtro por estatus, tabla; modales Alta y Detalle (bloque de cambio de estatus solo gerencia).
- **KPI:** pestañas Mis KPIs / Tablero (barras por periodicidad — nunca mezclar meses con semanas — y por colaborador) / Catálogo / Asignaciones / Historial; modales Plantilla (suma de ponderación en vivo, deshabilita guardar si ≠100), Asignación, Evaluación (checklist con evidencias, comentarios, cerrar/reabrir).
- **Seguimiento:** pestañas Reprogramaciones (badge, tarjetas antes→después, aprobar/rechazar) y Apoyo entre áreas (dirigidas a tu área / las que mandaste); modales Pedir cambio de fecha, Pedir apoyo, Enviar Weekly.
