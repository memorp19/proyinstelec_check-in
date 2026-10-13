import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

/**
 * Esquema relacional de Proyinstelec (Neon Postgres).
 *
 * Sustituye el diseño single-table de DynamoDB. Lo que antes eran trucos de
 * llaves (versión vigente vía GSI, contadores "max+1", unicidad de iniciales
 * validada en la aplicación) ahora son constraints e índices de verdad.
 */

// ── Auth.js ───────────────────────────────────────────────────────────────────

/**
 * Usuarios: columnas de Auth.js (id, name, email, emailVerified, image) más los
 * campos de dominio. El id lo genera Auth.js; `google_sub` vive en `accounts`.
 */
export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),

    // ── Dominio: identidad y acceso ──
    /** Naturaleza del usuario */
    tipo: text("tipo", { enum: ["planta", "temporal", "admin", "cliente"] })
      .notNull()
      .default("temporal"),
    /** Autorización base */
    rol: text("rol", { enum: ["campo", "admin", "cliente"] })
      .notNull()
      .default("campo"),
    /** Permisos finos del ERP (ver lib/permisos.ts); rol admin los tiene todos */
    permisos: text("permisos").array().notNull().default([]),
    /** Iniciales únicas (EAOL) — llave de cruce con el ERP anterior */
    iniciales: text("iniciales"),
    gerencia: text("gerencia"),
    activo: boolean("activo").notNull().default(true),
    /**
     * Super administrador: administra usuarios y nadie más puede degradarlo.
     * Vive en la base — no hay lista de personas en el código. Los primeros se
     * marcan con la siembra; después, un super admin puede nombrar a otro.
     */
    esSuperAdmin: boolean("es_super_admin").notNull().default(false),

    // ── Dominio: perfil de campo ──
    perfilCompleto: boolean("perfil_completo").notNull().default(false),
    odooSync: boolean("odoo_sync").notNull().default(false),
    nickname: text("nickname"),
    fotoUrl: text("foto_url"),
    telefono: text("telefono"),
    idOficial: text("id_oficial"),
    contactoEmergencia: jsonb("contacto_emergencia").$type<{
      nombre: string;
      telefono: string;
    }>(),
    terminosAceptadosAt: timestamp("terminos_aceptados_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    inicialesIdx: uniqueIndex("users_iniciales_idx").on(t.iniciales),
  }),
);

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
);

// ── Módulo de campo ───────────────────────────────────────────────────────────

export const empresas = pgTable("empresas", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  nombre: text("nombre").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const proyectos = pgTable(
  "proyectos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    empresaId: text("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "restrict" }),
    nombre: text("nombre").notNull(),
    descripcion: text("descripcion"),
    estado: text("estado", { enum: ["activo", "terminado"] })
      .notNull()
      .default("activo"),
    driveFolderId: text("drive_folder_id"),
    driveFolderUrl: text("drive_folder_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ empresaIdx: index("proyectos_empresa_idx").on(t.empresaId) }),
);

/** Asignación de trabajadores a proyectos (antes un array dentro del proyecto). */
export const proyectoUsuarios = pgTable(
  "proyecto_usuarios",
  {
    proyectoId: text("proyecto_id")
      .notNull()
      .references(() => proyectos.id, { onDelete: "cascade" }),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    asignadoAt: timestamp("asignado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.proyectoId, t.usuarioId] }),
    usuarioIdx: index("proyecto_usuarios_usuario_idx").on(t.usuarioId),
  }),
);

export const invitaciones = pgTable(
  "invitaciones",
  {
    token: text("token").primaryKey(),
    proyectoId: text("proyecto_id")
      .notNull()
      .references(() => proyectos.id, { onDelete: "cascade" }),
    creadoPor: text("creado_por").notNull(),
    nombreSugerido: text("nombre_sugerido"),
    estado: text("estado", { enum: ["pendiente", "usado", "expirado"] })
      .notNull()
      .default("pendiente"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usadaPor: text("usada_por").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ proyectoIdx: index("invitaciones_proyecto_idx").on(t.proyectoId) }),
);

/**
 * Jornadas de trabajo (check-in / check-out). Los dos puntos de control se
 * guardan en columnas planas: son consultables (rango de fechas, proyecto) y
 * evitan el JSON opaco del diseño anterior.
 */
export const jornadas = pgTable(
  "jornadas",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    proyectoId: text("proyecto_id")
      .notNull()
      .references(() => proyectos.id, { onDelete: "restrict" }),
    tipo: text("tipo", { enum: ["planta", "temporal"] }).notNull(),
    estado: text("estado", { enum: ["abierta", "cerrada"] }).notNull().default("abierta"),

    checkinTs: timestamp("checkin_ts", { withTimezone: true }).notNull(),
    checkinLat: real("checkin_lat").notNull(),
    checkinLng: real("checkin_lng").notNull(),
    checkinPrecision: real("checkin_precision").notNull(),
    checkinDriveFileId: text("checkin_drive_file_id"),
    checkinDriveUrl: text("checkin_drive_url"),
    checkinFotoHash: text("checkin_foto_hash"),
    checkinUploadStatus: text("checkin_upload_status", { enum: ["ok", "pendiente"] }),
    checkinDevice: jsonb("checkin_device"),

    checkoutTs: timestamp("checkout_ts", { withTimezone: true }),
    checkoutLat: real("checkout_lat"),
    checkoutLng: real("checkout_lng"),
    checkoutPrecision: real("checkout_precision"),
    checkoutDriveFileId: text("checkout_drive_file_id"),
    checkoutDriveUrl: text("checkout_drive_url"),
    checkoutFotoHash: text("checkout_foto_hash"),
    checkoutUploadStatus: text("checkout_upload_status", { enum: ["ok", "pendiente"] }),
    checkoutDevice: jsonb("checkout_device"),
    observaciones: text("observaciones"),

    duracionMinutos: integer("duracion_minutos"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    usuarioTsIdx: index("jornadas_usuario_ts_idx").on(t.usuarioId, t.checkinTs),
    proyectoTsIdx: index("jornadas_proyecto_ts_idx").on(t.proyectoId, t.checkinTs),
    estadoIdx: index("jornadas_estado_idx").on(t.estado),
  }),
);

/** Cola de reintentos de sincronización con Odoo. */
export const odooQueue = pgTable(
  "odoo_queue",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    jornadaId: text("jornada_id").notNull(),
    usuarioId: text("usuario_id").notNull(),
    estado: text("estado", { enum: ["pendiente", "error", "ok"] })
      .notNull()
      .default("pendiente"),
    intento: integer("intento").notNull().default(0),
    error: text("error"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ estadoIdx: index("odoo_queue_estado_idx").on(t.estado) }),
);

// ── ERP: clientes ─────────────────────────────────────────────────────────────

export const clientes = pgTable(
  "clientes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    razonSocial: text("razon_social").notNull(),
    /** Razón social sin sufijos legales ni acentos — base del anti-duplicados */
    razonNormalizada: text("razon_normalizada").notNull(),
    direccion: text("direccion"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ normIdx: index("clientes_norm_idx").on(t.razonNormalizada) }),
);

export const contactos = pgTable(
  "contactos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clienteId: text("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    /** Nombre sin títulos (LIC./ING./…) — unicidad real por empresa */
    nombreNormalizado: text("nombre_normalizado").notNull(),
    puesto: text("puesto"),
    telefono: text("telefono"),
    correo: text("correo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unicoPorEmpresa: uniqueIndex("contactos_cliente_nombre_idx").on(
      t.clienteId,
      t.nombreNormalizado,
    ),
  }),
);

// ── ERP: cotizaciones ─────────────────────────────────────────────────────────

/**
 * Una fila por versión. La "vigente" es la de mayor versión por (numero, anio):
 * con SQL sale de un DISTINCT ON, así que desaparecen tanto las filas ocultas
 * del sistema anterior como el índice espejo que había que mantener a mano.
 */
export const cotizaciones = pgTable(
  "cotizaciones",
  {
    numero: integer("numero").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull().default(0),
    folio: text("folio").notNull(),
    cliente: text("cliente").notNull(),
    clienteId: text("cliente_id").references(() => clientes.id, { onDelete: "set null" }),
    titulo: text("titulo").notNull(),
    dirigidaA: text("dirigida_a").notNull(),
    prioridad: text("prioridad", { enum: ["BAJA", "MEDIA", "ALTA"] })
      .notNull()
      .default("MEDIA"),
    estatus: text("estatus", {
      enum: [
        "PROCESO",
        "REVISION",
        "ENVIADA",
        "ASIGNADA",
        /** El cliente tomó otra versión de esta cotización. Terminal. */
        "NO ASIGNADA",
        "DEPENDIENTE PROVEEDOR",
        "DEPENDIENTE CLIENTE",
        "CANCELADA",
      ],
    })
      .notNull()
      .default("PROCESO"),
    elaboro: text("elaboro").notNull(),
    fechaSolicitud: timestamp("fecha_solicitud", { withTimezone: true }).notNull().defaultNow(),
    /** Compromiso de entrega */
    fechaEntrega: timestamp("fecha_entrega", { withTimezone: true }),
    /** Envío real al cliente (el sistema anterior mezclaba ambas en una columna) */
    fechaEnvio: timestamp("fecha_envio", { withTimezone: true }),

    /**
     * Importe de la cotización, capturado al elaborarla (antes del envío al
     * cliente), no al ingresar la orden de compra.
     *
     * Son DOS columnas y no un par (monto, moneda) porque una misma cotización
     * lleva partidas en pesos y en dólares a la vez —mano de obra nacional y
     * equipo importado—, y son importes independientes: sumarlos exigiría
     * inventar un tipo de cambio, así que se guardan y se reportan por separado.
     *
     * `numeric` y no `real`: el flotante binario no representa centavos exactos.
     * Nullable a propósito — un monto que todavía no se localiza se queda en
     * NULL y nunca en 0; una cotización aceptada sin monto sigue contando como
     * aceptada, y el monto puede capturarse después sin tocar el estatus.
     */
    montoMxn: numeric("monto_mxn", { precision: 14, scale: 2 }),
    montoUsd: numeric("monto_usd", { precision: 14, scale: 2 }),

    /**
     * De dónde salió el monto.
     *
     * `COTIZADOR` lo puso el congelado de esta versión; `OC` se capturó al
     * registrar la orden de compra; `MANUAL` lo tecleó alguien. Importa para
     * las históricas: las que nunca pasaron por el cotizador conservan su
     * monto y hay que poder saber que no es un cálculo.
     */
    origenMonto: text("origen_monto", { enum: ["COTIZADOR", "MANUAL", "OC"] }),

    /**
     * Una orden de compra puede cubrir VARIAS cotizaciones: SYMRISE mandó una
     * sola OC para la 005 (planta Monterrey) y la 006 (Cuautitlán Izcalli). Hoy
     * eso se captura repitiendo el número de OC en cada cotización. La relación
     * muchos-a-muchos no se modela: la operación se separa por planta a partir
     * de 2027, así que la excepción vive solo hasta 2026.
     */
    ordenCompra: text("orden_compra"),
    folioOt: text("folio_ot"),
    driveFolderId: text("drive_folder_id"),
    driveFolderUrl: text("drive_folder_url"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.numero, t.anio, t.version] }),
    anioIdx: index("cotizaciones_anio_idx").on(t.anio, t.numero),
    estatusIdx: index("cotizaciones_estatus_idx").on(t.anio, t.estatus),
  }),
);

/** Aprobación por versión exacta; se borra al reentrar a revisión. */
export const aprobaciones = pgTable(
  "aprobaciones",
  {
    numero: integer("numero").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull(),
    aprobadoPor: text("aprobado_por").notNull(),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.numero, t.anio, t.version] }) }),
);

// ── ERP: órdenes de trabajo ───────────────────────────────────────────────────

/**
 * Orden de trabajo. Una por cotización: los agregados y excedentes no amplían
 * la OT existente, se levanta una cotización nueva que genera su propia OT. La
 * versión del folio dice qué versión de la cotización se aceptó — no habilita
 * una segunda OT (el bloqueo vive en `getOTDeCotizacion`, lib/ot.ts).
 *
 * El monto NO se copia aquí: se lee de la cotización origen por
 * (numero_cotizacion, anio). Como la relación es 1:1 no hay ambigüedad, y así
 * un monto capturado después de crear la OT se refleja solo en vez de quedar
 * congelado en la copia.
 */
export const ordenesTrabajo = pgTable(
  "ordenes_trabajo",
  {
    folio: text("folio").primaryKey(),
    numeroCotizacion: integer("numero_cotizacion").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull().default(0),
    /** Nullable: una cotización aceptada sin OC también genera OT. */
    ordenCompra: text("orden_compra"),
    fechaOc: timestamp("fecha_oc", { withTimezone: true }),
    cliente: text("cliente").notNull(),
    titulo: text("titulo").notNull(),
    dirigidaA: text("dirigida_a"),
    /**
     * Estatus de la OT: "" → Asignado → En Proceso → En Ejecución →
     * Revisión → Cerrado. Nace vacía.
     * Antes tenía default "PROCESO", que es un estatus de COTIZACIÓN colado
     * aquí: no existe en la operación real de las órdenes de trabajo.
     */
    estatus: text("estatus").notNull().default(""),
    areas: text("areas").array().notNull().default([]),
    driveFolderId: text("drive_folder_id"),
    driveFolderUrl: text("drive_folder_url"),
    tieneControlOperativo: boolean("tiene_control_operativo").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    anioIdx: index("ot_anio_idx").on(t.anio),
    /**
     * Una cotización, una OT. `createOT` ya lo comprueba antes de insertar,
     * pero esa comprobación es leer-y-luego-escribir: dos altas simultáneas de
     * versiones distintas pasan las dos. El folio no lo impide porque lleva la
     * versión dentro, así que son folios distintos. Aquí se cierra de verdad;
     * el catch del 23505 ya existe.
     */
    cotizacionUq: uniqueIndex("ot_cotizacion_uq").on(t.numeroCotizacion, t.anio),
  }),
);

export const otResponsables = pgTable(
  "ot_responsables",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    folioOt: text("folio_ot")
      .notNull()
      .references(() => ordenesTrabajo.folio, { onDelete: "cascade" }),
    correo: text("correo").notNull(),
    rol: text("rol").notNull().default("Responsable de la actividad"),
    area: text("area"),
    asignadoPor: text("asignado_por").notNull(),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
    /** El anterior queda inactivo pero se conserva como historial */
    activo: boolean("activo").notNull().default(true),
    /**
     * Posición 1-3 del responsable dentro de su OT. Existe para que el tope de
     * tres lo imponga la BASE y no el código: contar antes de insertar no es
     * seguro bajo READ COMMITTED (dos altas concurrentes ven 2 y dejan 4).
     * El `default` solo sirve para poder rellenar las filas ya existentes al
     * migrar; el código siempre escribe el slot explícitamente.
     */
    slot: smallint("slot").notNull().default(1),
  },
  (t) => ({
    folioIdx: index("ot_responsables_folio_idx").on(t.folioOt),
    /** El tope de tres: solo se controlan los activos, el historial no ocupa slot. */
    slotActivoUq: uniqueIndex("ot_responsables_slot_activo_uq")
      .on(t.folioOt, t.slot)
      .where(sql`${t.activo}`),
    /**
     * La misma persona no puede ocupar dos slots de la misma OT: es un error de
     * captura real. Solo aplica a los activos — reasignar a alguien que ya lo
     * fue antes es legítimo y su fila vieja sigue en el historial.
     */
    correoActivoUq: uniqueIndex("ot_responsables_correo_activo_uq")
      .on(t.folioOt, t.correo)
      .where(sql`${t.activo}`),
    slotRango: check("ot_responsables_slot_rango", sql`${t.slot} between 1 and 3`),
  }),
);

// ── ERP: infraestructura común ────────────────────────────────────────────────

/** Auditoría, registro de correos y memoria de avisos ya enviados. */
export const bitacora = pgTable(
  "bitacora",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accion: text("accion").notNull(),
    usuario: text("usuario").notNull(),
    detalle: text("detalle"),
    /** Entidad afectada: "COT#001-2026", "ACT-0007|-3", … */
    referencia: text("referencia"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accionRefIdx: index("bitacora_accion_ref_idx").on(t.accion, t.referencia),
    fechaIdx: index("bitacora_fecha_idx").on(t.createdAt),
  }),
);

/** Secuencias de folio (PCOTOP, ACT, SRV…): incremento atómico con RETURNING. */
export const contadores = pgTable("contadores", {
  tipo: text("tipo").primaryKey(),
  n: integer("n").notNull().default(0),
});

/** Configuración operativa del ERP: áreas de OT, correos en copia, etc. */
export const configErp = pgTable("config_erp", {
  clave: text("clave").primaryKey(),
  valor: jsonb("valor").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── ERP: el cotizador (Fase 3) ────────────────────────────────────────────────

/**
 * La precisión de los montos del cotizador, y por qué son dos.
 *
 * **Lo que ENTRA al motor se guarda completo**: `numeric(18,6)`. Un costo de
 * catálogo no es dinero todavía, es el dato con el que se calcula el dinero, y
 * recortarlo mueve el resultado. Pasó de verdad: el concepto
 * `COSTO_DISPONIBLE_006` de la 068 cuesta **2,671.885 USD**, y guardado en
 * `numeric(14,2)` se volvía 2,671.89; multiplicado por su utilidad y por el
 * tipo de cambio, esos cinco milésimos crecían hasta diez centavos y movían el
 * total de la cotización contra el PDF que recibió el cliente.
 *
 * **Lo que SALE del motor se guarda en centavos**: `numeric(14,2)`. El
 * subtotal, el IVA y el total son dinero que alguien va a sumar a mano, y el
 * motor ya redondea en cada paso. Guardarlos con seis decimales solo invitaría
 * a que alguien los volviera a redondear por su cuenta.
 *
 * Seis decimales y no cuatro porque la franja entre lo que un proveedor cotiza
 * por unidad y lo que vale una pieza no la decide esta columna: doce dígitos
 * enteros llegan a los billones y el margen sobra.
 */
const MONTO = { precision: 18, scale: 6 } as const;
/** Los porcentajes son entradas igual que los costos: 12.3456 % es válido. */
const PORCENTAJE = { precision: 9, scale: 6 } as const;
/** Lo que el motor produce y el cliente suma. */
const IMPORTE = { precision: 14, scale: 2 } as const;

/**
 * Todas las tablas del cotizador cuelgan de una VERSIÓN de cotización, y lo
 * dicen con una llave foránea a `cotizaciones (numero, anio, version)`.
 *
 * Sin ella, un armado podía referenciar una versión que no existe y nadie
 * limpiaba nada si una desaparecía: la integridad quedaba cuidada dentro del
 * módulo —`cot_conceptos` → `cot_partidas`— y no en su frontera. `CASCADE`
 * porque un armado sin su cotización no significa nada.
 */
const versionDeCotizacion = (t: {
  numero: AnyPgColumn;
  anio: AnyPgColumn;
  version: AnyPgColumn;
}) =>
  foreignKey({
    columns: [t.numero, t.anio, t.version],
    foreignColumns: [cotizaciones.numero, cotizaciones.anio, cotizaciones.version],
  }).onDelete("cascade");

/**
 * El catálogo de servicios: un solo precio para todos los clientes.
 *
 * No hay precios por cliente, y es una decisión, no una omisión: un descuento
 * vive en la cotización que lo concede —como utilidad del concepto o como
 * ajuste de la partida—, donde se ve y se puede explicar. Pegado al catálogo
 * se volvería invisible y se arrastraría a cotizaciones que nadie revisó.
 */
export const catServicios = pgTable(
  "cat_servicios",
  {
    codigo: text("codigo").primaryKey(),
    /** `SP`, `PR`, `AR`, `IN`, `BT`, `CO`. Sale del prefijo del código. */
    familia: text("familia").notNull(),
    descripcion: text("descripcion").notNull(),
    unidad: text("unidad").notNull().default("servicio"),
    /**
     * Costo de venta: el catálogo ya trae su margen dentro. Un suministro que
     * se compra a un proveedor entra con su costo real y la utilidad se le
     * pone en el concepto.
     */
    costo: numeric("costo", MONTO),
    moneda: text("moneda", { enum: ["MXN", "USD"] })
      .notNull()
      .default("MXN"),
    /**
     * `GASTO` se reparte entre partidas y no puede ir dentro de una;
     * `ESTUDIO` se cotiza por esfuerzo y no por precio de lista.
     */
    tipo: text("tipo", { enum: ["SERVICIO", "ESTUDIO", "GASTO"] })
      .notNull()
      .default("SERVICIO"),

    /** Parámetros base de un estudio. El cotizador los propone; cada cotización los ajusta. */
    horasPorDia: integer("horas_por_dia"),
    diasPorSemana: integer("dias_por_semana"),
    ingenieros: integer("ingenieros"),
    semanas: integer("semanas"),
    tarifaHora: numeric("tarifa_hora", MONTO),
    baseNodos: integer("base_nodos"),

    /** Los inactivos no se ofrecen, pero no se borran: hay cotizaciones que los citan. */
    activo: boolean("activo").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => ({
    familiaIdx: index("cat_servicios_familia_idx").on(t.familia, t.activo),
  }),
);

/**
 * Cada cambio del catálogo, con su motivo.
 *
 * El motivo es obligatorio porque un costo base afecta a todas las
 * cotizaciones abiertas que lo usan: sin el porqué, un cambio de precio es
 * indistinguible de un dedazo.
 */
export const catServiciosCambios = pgTable(
  "cat_servicios_cambios",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    codigo: text("codigo")
      .notNull()
      .references(() => catServicios.codigo, { onDelete: "cascade" }),
    campo: text("campo").notNull(),
    antes: text("antes"),
    despues: text("despues"),
    usuario: text("usuario").notNull(),
    motivo: text("motivo").notNull(),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ codigoIdx: index("cat_servicios_cambios_codigo_idx").on(t.codigo, t.fecha) }),
);

/**
 * El encabezado del armado de UNA versión de cotización.
 *
 * Todo lo que aquí se guarda es "con qué se calculó": si mañana cambia la tasa
 * de IVA o el tipo de cambio, esta versión se sigue reimprimiendo con los
 * suyos. Es la misma razón por la que se congelan los importes.
 */
export const cotArmado = pgTable(
  "cot_armado",
  {
    numero: integer("numero").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull(),

    /** La moneda en la que cierra. Un solo total por ahora. */
    moneda: text("moneda", { enum: ["MXN", "USD"] })
      .notNull()
      .default("MXN"),
    /** Los gastos llevan la suya: unos viáticos son en pesos aunque se cotice en dólares. */
    monedaGastos: text("moneda_gastos", { enum: ["MXN", "USD"] })
      .notNull()
      .default("MXN"),
    repartoGastos: text("reparto_gastos", { enum: ["IGUAL", "PROPORCIONAL", "MANUAL"] })
      .notNull()
      .default("IGUAL"),
    asesoriaPct: numeric("asesoria_pct", PORCENTAJE).notNull().default("10"),
    /**
     * Parece una constante y no lo es: la franja fronteriza tuvo 8 % y la tasa
     * cambia por decreto.
     */
    ivaPct: numeric("iva_pct", PORCENTAJE).notNull().default("16"),

    /**
     * Banxico publica el FIX con cuatro decimales, pero un tipo pactado con un
     * cliente puede traer los que traiga: la columna no es quien decide eso.
     */
    tipoCambio: numeric("tipo_cambio", { precision: 12, scale: 6 }),
    /** `PREFERENTE` exige motivo: usar un tipo distinto del oficial es una decisión comercial. */
    tipoCambioOrigen: text("tipo_cambio_origen", { enum: ["BANXICO", "PREFERENTE"] }),
    tipoCambioMotivo: text("tipo_cambio_motivo"),

    /**
     * Condiciones comerciales y textos del documento, como bloque estructurado.
     * Llevan `esquema` dentro para poder migrarlos cuando la plantilla cambie.
     */
    condiciones: jsonb("condiciones"),
    documento: jsonb("documento"),

    /** El PDF se encuentra por id, no por nombre. El nombre queda de respaldo. */
    pdfDriveId: text("pdf_drive_id"),
    docDriveId: text("doc_drive_id"),

    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.numero, t.anio, t.version] }),
    version: versionDeCotizacion(t),
    /**
     * Un porcentaje fuera de 0–100 no es un caso raro: es un error de captura.
     * El motor avisa, y esto cierra la otra puerta — la de quien escriba por
     * SQL sin pasar por el motor.
     */
    asesoriaRango: check("cot_armado_asesoria_pct_rango", sql`${t.asesoriaPct} BETWEEN 0 AND 100`),
    ivaRango: check("cot_armado_iva_pct_rango", sql`${t.ivaPct} BETWEEN 0 AND 100`),
  }),
);

export const cotPartidas = pgTable(
  "cot_partidas",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    numero: integer("numero").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull(),

    orden: integer("orden").notNull(),
    titulo: text("titulo").notNull().default(""),
    /** El alcance, con sus saltos de línea y viñetas. Algunas llegan a cincuenta líneas. */
    descripcion: text("descripcion"),
    cantidad: numeric("cantidad", MONTO).notNull().default("1"),
    unidad: text("unidad").notNull().default("servicio"),

    /**
     * Ajuste explícito sobre el total. En los Excel reales vive escondido dentro
     * de las fórmulas (`+10`, `+55`, `-0.06`); aquí se ve.
     *
     * Con `precio_unitario_final` capturado, este campo guarda el ajuste
     * **derivado**, para que siga siendo visible de dónde sale la diferencia.
     */
    ajuste: numeric("ajuste", MONTO).notNull().default("0"),
    /**
     * El precio al que se decidió vender, cuando se fija a mano. El ajuste se
     * deriva de él: `precio × cantidad − total calculado`.
     */
    precioUnitarioFinal: numeric("precio_unitario_final", MONTO),

    /**
     * `false` la saca del reparto de gastos generales: es la partida que trae
     * su propio equipo y sus propios viáticos, y cargarle además la parte del
     * gasto común la cobraría dos veces.
     */
    recibeGastosGenerales: boolean("recibe_gastos_generales").notNull().default(true),
    /** Lo que le toca con reparto MANUAL, en la moneda de los gastos. */
    gastoManual: numeric("gasto_manual", MONTO),

    /** Cómo sale el título en el documento. */
    formato: text("formato", { enum: ["NORMAL", "NEGRITAS", "OCULTO"] })
      .notNull()
      .default("NORMAL"),
    notas: text("notas"),
  },
  (t) => ({
    versionIdx: index("cot_partidas_version_idx").on(t.numero, t.anio, t.version),
    ordenUq: uniqueIndex("cot_partidas_orden_uq").on(t.numero, t.anio, t.version, t.orden),
    version: versionDeCotizacion(t),
    /**
     * Redundante con la llave primaria, y no está de adorno: es el destino de
     * la llave foránea compuesta de las hijas. Sin este `UNIQUE`, Postgres no
     * deja apuntar a `(id, numero, anio, version)`, y sin esa llave el trío de
     * un concepto podría no coincidir con el de su partida.
     */
    identidad: unique("cot_partidas_identidad_uq").on(t.id, t.numero, t.anio, t.version),
  }),
);

/**
 * Un concepto de partida.
 *
 * **El costo se COPIA del catálogo al agregarlo.** Un cambio de catálogo no
 * mueve una cotización abierta: el precio que se armó es el que se sigue
 * viendo, hasta que alguien decida actualizarlo y vea el antes y el después.
 *
 * Por eso hay dos columnas de costo. `costo` es el que se usa; `costo_catalogo`
 * es el que el catálogo decía cuando se copió. La diferencia entre ambas dice
 * si alguien negoció un precio distinto; la diferencia contra el catálogo de
 * HOY dice si el catálogo se movió por debajo.
 */
export const cotConceptos = pgTable(
  "cot_conceptos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /**
     * La partida de la que cuelga. Su llave foránea es **compuesta** —abajo,
     * con el resto—: lleva también el trío de la versión, de modo que un
     * concepto no pueda apuntar a una partida de otra.
     */
    partidaId: text("partida_id").notNull(),
    numero: integer("numero").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull(),

    codigo: text("codigo"),
    /** Para los conceptos libres, que no tienen catálogo detrás. */
    descripcionLibre: text("descripcion_libre"),
    cantidad: numeric("cantidad", MONTO).notNull().default("0"),
    unidad: text("unidad"),

    costo: numeric("costo", MONTO),
    costoCatalogo: numeric("costo_catalogo", MONTO),
    /** Utilidad POR CONCEPTO: en la misma partida puede haber material con margen e instalación sin él. */
    utilidadPct: numeric("utilidad_pct", PORCENTAJE).notNull().default("0"),
    monedaCosto: text("moneda_costo", { enum: ["MXN", "USD"] }),

    /** Parámetros del estudio en ESTA cotización. */
    horasPorDia: integer("horas_por_dia"),
    diasPorSemana: integer("dias_por_semana"),
    ingenieros: integer("ingenieros"),
    semanas: integer("semanas"),
    tarifaHora: numeric("tarifa_hora", MONTO),
    nodos: integer("nodos"),
    baseNodos: integer("base_nodos"),

    orden: integer("orden").notNull().default(1),
    notas: text("notas"),
  },
  (t) => ({
    partidaIdx: index("cot_conceptos_partida_idx").on(t.partidaId, t.orden),
    versionIdx: index("cot_conceptos_version_idx").on(t.numero, t.anio, t.version),
    version: versionDeCotizacion(t),
    /**
     * El trío viaja en las hijas para poder consultar una versión sin unir
     * (§1.5 del plan), y esta llave es lo que garantiza que sea el mismo trío
     * que el de su partida. Antes nada lo impedía.
     */
    partida: foreignKey({
      columns: [t.partidaId, t.numero, t.anio, t.version],
      foreignColumns: [cotPartidas.id, cotPartidas.numero, cotPartidas.anio, cotPartidas.version],
    }).onDelete("cascade"),
    utilidadRango: check("cot_conceptos_utilidad_pct_rango", sql`${t.utilidadPct} BETWEEN 0 AND 100`),
  }),
);

/**
 * Los gastos del proyecto. Tabla propia porque se usan distinto: los conceptos
 * forman partidas y los gastos se reparten entre ellas.
 *
 * `destino_partida_id` carga el gasto entero a una partida en vez de
 * repartirlo. Con eso y `recibe_gastos_generales` se representa la 068: diez
 * partidas comparten los viáticos generales y la de tierras lleva los suyos.
 */
export const cotGastos = pgTable(
  "cot_gastos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    numero: integer("numero").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull(),

    codigo: text("codigo"),
    descripcionLibre: text("descripcion_libre"),
    cantidad: numeric("cantidad", MONTO).notNull().default("0"),
    costo: numeric("costo", MONTO).notNull().default("0"),
    costoCatalogo: numeric("costo_catalogo", MONTO),
    utilidadPct: numeric("utilidad_pct", PORCENTAJE).notNull().default("0"),
    monedaCosto: text("moneda_costo", { enum: ["MXN", "USD"] }),

    /**
     * Null = general, se reparte. Con valor = entero a esa partida. Su llave
     * foránea es compuesta y se declara abajo.
     */
    destinoPartidaId: text("destino_partida_id"),

    orden: integer("orden").notNull().default(1),
    notas: text("notas"),
  },
  (t) => ({
    versionIdx: index("cot_gastos_version_idx").on(t.numero, t.anio, t.version),
    version: versionDeCotizacion(t),
    /**
     * `SET NULL` y no `CASCADE`: borrar la partida a la que iba dirigido un
     * gasto no debe borrar el gasto. El viático se gastó igual — lo que
     * desaparece es a quién se le carga, y sin destino vuelve a ser general.
     * Es degradar en vez de perder.
     *
     * **Ojo al regenerar la migración.** La llave es compuesta, así que un
     * `SET NULL` a secas anularía las cuatro columnas y tres son `NOT NULL`:
     * borrar una partida fallaría. En el SQL se nombra la columna que se
     * anula —`ON DELETE SET NULL ("destino_partida_id")`, Postgres 15+—, y eso
     * drizzle-kit todavía no lo genera: hay que volver a ponerlo a mano.
     */
    destino: foreignKey({
      columns: [t.destinoPartidaId, t.numero, t.anio, t.version],
      foreignColumns: [cotPartidas.id, cotPartidas.numero, cotPartidas.anio, cotPartidas.version],
    }).onDelete("set null"),
    utilidadRango: check("cot_gastos_utilidad_pct_rango", sql`${t.utilidadPct} BETWEEN 0 AND 100`),
  }),
);

/**
 * El resultado congelado de una versión.
 *
 * Se escribe al mandar a revisión y a partir de ahí la versión no se edita: si
 * hay que cambiar algo, se levanta una versión nueva. Guarda el resultado
 * COMPLETO —no solo los totales— porque el documento tiene que poder
 * regenerarse idéntico meses después, con el catálogo que ya cambió.
 */
export const cotImportes = pgTable(
  "cot_importes",
  {
    numero: integer("numero").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull(),

    congeladoAt: timestamp("congelado_at", { withTimezone: true }).notNull().defaultNow(),
    congeladoPor: text("congelado_por").notNull(),

    /** El `ResultadoCotizacion` entero: partidas, conceptos, gastos y avisos. */
    resultado: jsonb("resultado").notNull(),
    /** Con qué se calculó: asesoría, IVA, tipo de cambio, reparto, base de nodos. */
    parametros: jsonb("parametros").notNull(),

    moneda: text("moneda", { enum: ["MXN", "USD"] }).notNull(),
    subtotal: numeric("subtotal", IMPORTE).notNull(),
    iva: numeric("iva", IMPORTE).notNull(),
    total: numeric("total", IMPORTE).notNull(),
    /** El importe con letra, tal como sale en el documento. */
    letra: text("letra").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.numero, t.anio, t.version] }),
    version: versionDeCotizacion(t),
  }),
);

// ── Tipos inferidos ───────────────────────────────────────────────────────────

export type UserRow = typeof users.$inferSelect;
export type EmpresaRow = typeof empresas.$inferSelect;
export type ProyectoRow = typeof proyectos.$inferSelect;
export type InvitacionRow = typeof invitaciones.$inferSelect;
export type JornadaRow = typeof jornadas.$inferSelect;
export type ClienteRow = typeof clientes.$inferSelect;
export type ContactoRow = typeof contactos.$inferSelect;
export type CotizacionRow = typeof cotizaciones.$inferSelect;
export type OrdenTrabajoRow = typeof ordenesTrabajo.$inferSelect;
export type BitacoraRow = typeof bitacora.$inferSelect;
export type CatServicioRow = typeof catServicios.$inferSelect;
export type CotArmadoRow = typeof cotArmado.$inferSelect;
export type CotPartidaRow = typeof cotPartidas.$inferSelect;
export type CotConceptoRow = typeof cotConceptos.$inferSelect;
export type CotGastoRow = typeof cotGastos.$inferSelect;
export type CotImportesRow = typeof cotImportes.$inferSelect;
