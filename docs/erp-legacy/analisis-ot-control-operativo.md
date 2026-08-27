# Análisis del legacy — Bloque OT y Control Operativo (ERP Apps Script)

Extraído de 13_Controles, 16_CarpetasOT, 17 controlot, 24-28, 30 catalogosco, 32 avisosvencimiento, 33 servicios, VistaOT, VistaControles. Checklist de implementación de la Fase 2.

**Arquitectura legacy:** doble fuente de verdad — archivos Sheets legacy (solo lectura) + catálogo del ERP; el Control Operativo de cada OT vive en un Sheet `"OT###### Control Operativo"` dentro de la carpeta Drive de la OT, y el ERP mantiene solo un índice-caché. En la nueva app (decisión D3) los pendientes son ítems de DynamoDB hijos de la OT y todo lo derivado (semáforo, vencidos, avance) se calcula al leer.

## 1. Inventario funcional

### Ficha de OT
- Listado buscable (folio/cliente/título/OC/cotización/año/estatus), marca "tiene control", orden desc por año+número, tope 300.
- Ficha completa: datos OT, cotización origen, responsables activos, control operativo (existe/falta — "toda OT debe tener uno"), semáforo, contadores (total/abiertos/vencidos/dependiente cliente), pendientes, carpeta Drive con subcarpetas, documentos registrados.
- Documentos: listar carpeta + subcarpetas (1 nivel), crear subcarpeta (nombre válido, idempotente), subir documento (tipo OC/Factura/Evidencia/Entregable/Reporte/Otro, registro con quién y cuándo).

### Carpetas Drive
- Estructura: raíz de años → `2026/` → `"OT##### - CLIENTE"` → archivo de control + subcarpetas (OC, Facturas, Evidencias, Entregables, Bitácora…).
- Resolución legacy por nombre con triple fallback y caché; en la nueva app se guarda `drive_folder_id` en el ítem OT al crear.

### Control operativo — pendientes
- Pendiente `PD-###`: descripción (≥5 chars), categoría, detectado por, responsable (iniciales de usuario activo), fecha detección, fecha compromiso obligatoria, prioridad (Alta/Media/Baja, default Media), equipo (Proyinstelec/Externo/Cliente, default Proyinstelec), acción correctiva, evidencia, comentarios, última actualización.
- **Estatus:** Abierto, En Proceso, Dependiente Cliente, Cerrado; **Vencido solo calculado** (no Cerrado + fecha compromiso pasada; nunca elegible manualmente).
- Semáforo derivado: vencidos>0 → ATRASADO; activos>0 → EN SEGUIMIENTO; si no → CONTROLADO. Avance % = cerrados/total.
- Categorías base: Ingeniería, Construcción, Operativo, Materiales, Pruebas, Reporte.
- Alta de pendiente crea/actualiza actividad Weekly vinculada: título `PD-00X · descripción`, responsable = correo (cruce por iniciales), correo de asignación. Vínculo = campos `folio_ot` + `pd` en la actividad.
- Traducción de estatus CO→Weekly: Cerrado→Completado, Dependiente Cliente→Reprogramado, resto→En tiempo. Weekly→CO: Completado/Cancelado→Cerrado; los demás no pisan el estatus del control.
- **Candado de fecha compromiso:** solo `actividades.confirmar` la mueve directo; los demás piden reprogramación (flujo de solicitudes del Weekly; al aprobarse baja la fecha).
- Editar pendiente: estatus editable excepto Vencido; responsable validado; refleja a la actividad.

### Crear control operativo
- Permiso `control.operativo.crear`. La OT debe existir; si ya tiene control devuelve el existente (no duplica).
- Al crear: datos de cabecera (OT, proyecto, cliente, responsable — default primer responsable activo de la OT o el creador —, estatus OT), y **primera actividad automática** "Definir fecha del servicio" (categoría Operativo, prioridad Alta, vence a +5 días) que también llega al Weekly. Bitácora.

### Vínculos y acciones de gerencia
- `cancelarActividad(id, motivo≥5)` — solo `actividades.confirmar`; estado→Cancelado + nota firmada + el pendiente queda Cerrado.
- `reprogramarActividad(id, fecha, motivo≥5)` — solo `actividades.confirmar`; rechaza canceladas; estado→Reprogramado, nota "de X a Y", propaga fecha al pendiente.
- Legacy tenía huérfanos (archivo de control borrado en Drive) y adopción de actividades sueltas; en la nueva app desaparecen (dato único).

### Avisos de vencimiento (trigger diario, default 8:00)
- **3 avisos por actividad en toda su vida: −3 días, −1 día, +1 día tras vencer.** Nada más.
- Completado/Cancelado nunca avisa. Memoria de enviados en bitácora con llave `ACT-0007|-3` (cada aviso se registra por separado).
- **1 correo por persona por día** con secciones VENCIÓ AYER / VENCE MAÑANA / VENCE EN 3 DÍAS. Omite inactivos/no registrados.
- Complemento manual/semanal: `avisarActividadesSinCerrar` (bloques VENCIDAS / VENCEN ESTA SEMANA; nadie sin contenido recibe correo).

### Servicios
- Una OT puede tener N servicios `SRV-###` (renglones). La jornada se decide por servicio, no por persona.
- **Definir fecha** (cierra el pendiente "Definir fecha del servicio" con datos): tipo ∈ Servicio/Suministro/Ambos; fecha inicio obligatoria; fin ≥ inicio (default = inicio); **Suministro no exige gente**; Servicio/Ambos exige personas (activas) o externos. Calendario de días con marca de fin de semana (tope 120 días). Estatus Programado, Fecha original = inicio. Notifica al equipo. Cierra el pendiente origen (también en Weekly).
- **Reprogramar** (motivo ≥5): rechaza cancelados; **Fecha original nunca se toca** (rastro de cuánto se movió); nota acumulativa; avisa a equipo + gerencia (gerencia = activos con `dashboard.gerencial` o `actividades.ver.todas`).
- **Cancelar** (motivo ≥5): estatus→Cancelado, no borra; avisa solo al equipo.
- **Cambiar equipo** (motivo ≥5): valida activos; no permite dejar sin nadie (salvo Suministro); 3 correos separados: SALEN ("ya no hace falta que vayas"), ENTRAN (ficha completa), SIGUEN (con quién van ahora).
- **Cambiar estatus:** Programado/En curso/Concluido (Cancelado solo por su vía).
- `serviciosEnRango_` alimenta el resumen del viernes: qué se trabaja el fin de semana y quién va.

### Costos
- Módulo previsto sin origen de datos en el legacy (hoja Gastos vacía: ID gasto, Folio OT, Concepto, Categoría, Monto, Moneda, Fecha, Proveedor, Factura, archivo, Registrado por, Estatus). Fuera del alcance de las fases actuales; el modelo queda anotado.

## 2. Entidades y campos

### OT (catálogo)
Folio OT · Número cotización · Año · Versión autorizada · Número OC · Fecha OC · Cliente · Empresa · Título · Fecha entrega · Estatus OT · ID carpeta Drive · Tiene control operativo · Fecha creación · Creada por · Fecha cierre · Notas. Estatus observados: PROCESO/EN PROCESO/ASIGNADA/TERMINADO/CERRADO/CANCELADO/FACTURADO.

### Pendiente (archivo CO legacy, cols B-R)
ID (PD-###) · OT · Proyecto · Fecha detección · Descripción · Categoría · Detectado por (iniciales) · Responsable (iniciales) · Fecha compromiso · Estatus manual · Estatus real (fórmula → en la nueva app: calculado) · Prioridad · Equipo · Acción correctiva · Última actualización · Evidencia · Comentarios.

### Servicio
ID (SRV-###) · Folio OT · Tipo (Servicio/Suministro/Ambos) · Fecha inicio · Fecha fin · Fecha original (inmutable tras 1er movimiento) · Personas (correos) · Personas externas (texto libre) · Estatus (Programado→En curso→Concluido; Cancelado terminal) · Pendiente origen · Definido por · Fecha registro · Notas (bitácora acumulativa).

### OT_Responsables / OT_Documentos
Responsables: Folio OT · Correo · Rol · Área · Asignado por · Fecha · Activo. Documentos: ID · Folio OT · Tipo · Nombre · ID archivo Drive · Subido por · Fecha · Carpeta.

## 3. Notificaciones

Alta de pendiente (al responsable) · Avisos de vencimiento (diario, 1 correo/persona) · Actividades sin cerrar (semanal) · Servicio programado (equipo) · Servicio reprogramado (equipo + gerencia, antes/ahora, quién y por qué) · Servicio cancelado (equipo) · Cambio de equipo (3 correos: salen/entran/siguen). Todas filtran usuarios inactivos.

## 4. Permisos

`modulo.ot` · `modulo.control.operativo` · `modulo.control.costos` (futuro) · `ot.crear` · `ot.asignar` · `ot.documentos` · `control.operativo.crear` · `actividades.confirmar` (gerencia: cancelar/reprogramar, mover fecha directo) · `solicitudes.resolver` · `dashboard.gerencial`/`actividades.ver.todas` (definen "gerencia" para avisos de servicios).

## 5. Pantallas

- **Vista OT:** nivel 1 lista (KPIs, buscador, badge CO); nivel 2 ficha con 4 pestañas: Resumen (orden, responsables, carpeta Drive, tarjeta CO con semáforo o "Falta — crear"), Cotización origen, Control Operativo (6 tarjetas de conteo, barra de avance, servicios con acciones, tabla de pendientes con filtros, botón "Definir la fecha" en el pendiente de fecha), Documentos (tabla + subir + crear carpeta).
- **Modales:** subir documento (con vista previa), crear control (responsable/estatus sugeridos + checkbox 1ª actividad), definir fecha de servicio (tipo con botones, calendario, equipo, externos), nuevo pendiente, crear carpeta (sugerencias Facturas/Evidencias/Entregables/Bitácora).
- **Vista Control Operativo:** barra de cobertura (% con color: verde ≥80, azul ≥40, ámbar), 5 KPIs, tabla de OTs con control (filtros: con vencidos / con activos / todo cerrado), sección "les falta control operativo" con botón crear.
