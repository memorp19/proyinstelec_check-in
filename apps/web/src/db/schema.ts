import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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

export const ordenesTrabajo = pgTable(
  "ordenes_trabajo",
  {
    folio: text("folio").primaryKey(),
    numeroCotizacion: integer("numero_cotizacion").notNull(),
    anio: integer("anio").notNull(),
    version: integer("version").notNull().default(0),
    ordenCompra: text("orden_compra").notNull(),
    fechaOc: timestamp("fecha_oc", { withTimezone: true }),
    cliente: text("cliente").notNull(),
    titulo: text("titulo").notNull(),
    dirigidaA: text("dirigida_a"),
    estatus: text("estatus").notNull().default("PROCESO"),
    areas: text("areas").array().notNull().default([]),
    driveFolderId: text("drive_folder_id"),
    driveFolderUrl: text("drive_folder_url"),
    tieneControlOperativo: boolean("tiene_control_operativo").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ anioIdx: index("ot_anio_idx").on(t.anio) }),
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
  },
  (t) => ({ folioIdx: index("ot_responsables_folio_idx").on(t.folioOt) }),
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
