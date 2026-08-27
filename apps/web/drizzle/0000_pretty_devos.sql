CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "aprobaciones" (
	"numero" integer NOT NULL,
	"anio" integer NOT NULL,
	"version" integer NOT NULL,
	"aprobado_por" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aprobaciones_numero_anio_version_pk" PRIMARY KEY("numero","anio","version")
);
--> statement-breakpoint
CREATE TABLE "bitacora" (
	"id" text PRIMARY KEY NOT NULL,
	"accion" text NOT NULL,
	"usuario" text NOT NULL,
	"detalle" text,
	"referencia" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" text PRIMARY KEY NOT NULL,
	"razon_social" text NOT NULL,
	"razon_normalizada" text NOT NULL,
	"direccion" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_erp" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contactos" (
	"id" text PRIMARY KEY NOT NULL,
	"cliente_id" text NOT NULL,
	"nombre" text NOT NULL,
	"nombre_normalizado" text NOT NULL,
	"puesto" text,
	"telefono" text,
	"correo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contadores" (
	"tipo" text PRIMARY KEY NOT NULL,
	"n" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cotizaciones" (
	"numero" integer NOT NULL,
	"anio" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"folio" text NOT NULL,
	"cliente" text NOT NULL,
	"cliente_id" text,
	"titulo" text NOT NULL,
	"dirigida_a" text NOT NULL,
	"prioridad" text DEFAULT 'MEDIA' NOT NULL,
	"estatus" text DEFAULT 'PROCESO' NOT NULL,
	"elaboro" text NOT NULL,
	"fecha_solicitud" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_entrega" timestamp with time zone,
	"fecha_envio" timestamp with time zone,
	"orden_compra" text,
	"folio_ot" text,
	"drive_folder_id" text,
	"drive_folder_url" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotizaciones_numero_anio_version_pk" PRIMARY KEY("numero","anio","version")
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitaciones" (
	"token" text PRIMARY KEY NOT NULL,
	"proyecto_id" text NOT NULL,
	"creado_por" text NOT NULL,
	"nombre_sugerido" text,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"usada_por" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jornadas" (
	"id" text PRIMARY KEY NOT NULL,
	"usuario_id" text NOT NULL,
	"proyecto_id" text NOT NULL,
	"tipo" text NOT NULL,
	"estado" text DEFAULT 'abierta' NOT NULL,
	"checkin_ts" timestamp with time zone NOT NULL,
	"checkin_lat" real NOT NULL,
	"checkin_lng" real NOT NULL,
	"checkin_precision" real NOT NULL,
	"checkin_drive_file_id" text,
	"checkin_drive_url" text,
	"checkin_foto_hash" text,
	"checkin_upload_status" text,
	"checkin_device" jsonb,
	"checkout_ts" timestamp with time zone,
	"checkout_lat" real,
	"checkout_lng" real,
	"checkout_precision" real,
	"checkout_drive_file_id" text,
	"checkout_drive_url" text,
	"checkout_foto_hash" text,
	"checkout_upload_status" text,
	"checkout_device" jsonb,
	"observaciones" text,
	"duracion_minutos" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odoo_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"jornada_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"intento" integer DEFAULT 0 NOT NULL,
	"error" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ordenes_trabajo" (
	"folio" text PRIMARY KEY NOT NULL,
	"numero_cotizacion" integer NOT NULL,
	"anio" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"orden_compra" text NOT NULL,
	"fecha_oc" timestamp with time zone,
	"cliente" text NOT NULL,
	"titulo" text NOT NULL,
	"dirigida_a" text,
	"estatus" text DEFAULT 'PROCESO' NOT NULL,
	"areas" text[] DEFAULT '{}' NOT NULL,
	"drive_folder_id" text,
	"drive_folder_url" text,
	"tiene_control_operativo" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ot_responsables" (
	"id" text PRIMARY KEY NOT NULL,
	"folio_ot" text NOT NULL,
	"correo" text NOT NULL,
	"rol" text DEFAULT 'Responsable de la actividad' NOT NULL,
	"area" text,
	"asignado_por" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proyecto_usuarios" (
	"proyecto_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"asignado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proyecto_usuarios_proyecto_id_usuario_id_pk" PRIMARY KEY("proyecto_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "proyectos" (
	"id" text PRIMARY KEY NOT NULL,
	"empresa_id" text NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"estado" text DEFAULT 'activo' NOT NULL,
	"drive_folder_id" text,
	"drive_folder_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"tipo" text DEFAULT 'temporal' NOT NULL,
	"rol" text DEFAULT 'campo' NOT NULL,
	"permisos" text[] DEFAULT '{}' NOT NULL,
	"iniciales" text,
	"gerencia" text,
	"activo" boolean DEFAULT true NOT NULL,
	"perfil_completo" boolean DEFAULT false NOT NULL,
	"odoo_sync" boolean DEFAULT false NOT NULL,
	"nickname" text,
	"foto_url" text,
	"telefono" text,
	"id_oficial" text,
	"contacto_emergencia" jsonb,
	"terminos_aceptados_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contactos" ADD CONSTRAINT "contactos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_proyecto_id_proyectos_id_fk" FOREIGN KEY ("proyecto_id") REFERENCES "public"."proyectos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_usada_por_users_id_fk" FOREIGN KEY ("usada_por") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jornadas" ADD CONSTRAINT "jornadas_usuario_id_users_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jornadas" ADD CONSTRAINT "jornadas_proyecto_id_proyectos_id_fk" FOREIGN KEY ("proyecto_id") REFERENCES "public"."proyectos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ot_responsables" ADD CONSTRAINT "ot_responsables_folio_ot_ordenes_trabajo_folio_fk" FOREIGN KEY ("folio_ot") REFERENCES "public"."ordenes_trabajo"("folio") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proyecto_usuarios" ADD CONSTRAINT "proyecto_usuarios_proyecto_id_proyectos_id_fk" FOREIGN KEY ("proyecto_id") REFERENCES "public"."proyectos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proyecto_usuarios" ADD CONSTRAINT "proyecto_usuarios_usuario_id_users_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bitacora_accion_ref_idx" ON "bitacora" USING btree ("accion","referencia");--> statement-breakpoint
CREATE INDEX "bitacora_fecha_idx" ON "bitacora" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "clientes_norm_idx" ON "clientes" USING btree ("razon_normalizada");--> statement-breakpoint
CREATE UNIQUE INDEX "contactos_cliente_nombre_idx" ON "contactos" USING btree ("cliente_id","nombre_normalizado");--> statement-breakpoint
CREATE INDEX "cotizaciones_anio_idx" ON "cotizaciones" USING btree ("anio","numero");--> statement-breakpoint
CREATE INDEX "cotizaciones_estatus_idx" ON "cotizaciones" USING btree ("anio","estatus");--> statement-breakpoint
CREATE INDEX "invitaciones_proyecto_idx" ON "invitaciones" USING btree ("proyecto_id");--> statement-breakpoint
CREATE INDEX "jornadas_usuario_ts_idx" ON "jornadas" USING btree ("usuario_id","checkin_ts");--> statement-breakpoint
CREATE INDEX "jornadas_proyecto_ts_idx" ON "jornadas" USING btree ("proyecto_id","checkin_ts");--> statement-breakpoint
CREATE INDEX "jornadas_estado_idx" ON "jornadas" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "odoo_queue_estado_idx" ON "odoo_queue" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "ot_anio_idx" ON "ordenes_trabajo" USING btree ("anio");--> statement-breakpoint
CREATE INDEX "ot_responsables_folio_idx" ON "ot_responsables" USING btree ("folio_ot");--> statement-breakpoint
CREATE INDEX "proyecto_usuarios_usuario_idx" ON "proyecto_usuarios" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "proyectos_empresa_idx" ON "proyectos" USING btree ("empresa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_iniciales_idx" ON "users" USING btree ("iniciales");