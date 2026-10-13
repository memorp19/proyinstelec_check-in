CREATE TABLE "cat_servicios" (
	"codigo" text PRIMARY KEY NOT NULL,
	"familia" text NOT NULL,
	"descripcion" text NOT NULL,
	"unidad" text DEFAULT 'servicio' NOT NULL,
	"costo" numeric(18, 6),
	"moneda" text DEFAULT 'MXN' NOT NULL,
	"tipo" text DEFAULT 'SERVICIO' NOT NULL,
	"horas_por_dia" integer,
	"dias_por_semana" integer,
	"ingenieros" integer,
	"semanas" integer,
	"tarifa_hora" numeric(18, 6),
	"base_nodos" integer,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "cat_servicios_cambios" (
	"id" text PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"campo" text NOT NULL,
	"antes" text,
	"despues" text,
	"usuario" text NOT NULL,
	"motivo" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cot_armado" (
	"numero" integer NOT NULL,
	"anio" integer NOT NULL,
	"version" integer NOT NULL,
	"moneda" text DEFAULT 'MXN' NOT NULL,
	"moneda_gastos" text DEFAULT 'MXN' NOT NULL,
	"reparto_gastos" text DEFAULT 'IGUAL' NOT NULL,
	"asesoria_pct" numeric(9, 6) DEFAULT '10' NOT NULL,
	"iva_pct" numeric(9, 6) DEFAULT '16' NOT NULL,
	"tipo_cambio" numeric(12, 6),
	"tipo_cambio_origen" text,
	"tipo_cambio_motivo" text,
	"condiciones" jsonb,
	"documento" jsonb,
	"pdf_drive_id" text,
	"doc_drive_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cot_armado_numero_anio_version_pk" PRIMARY KEY("numero","anio","version"),
	CONSTRAINT "cot_armado_asesoria_pct_rango" CHECK ("cot_armado"."asesoria_pct" BETWEEN 0 AND 100),
	CONSTRAINT "cot_armado_iva_pct_rango" CHECK ("cot_armado"."iva_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "cot_conceptos" (
	"id" text PRIMARY KEY NOT NULL,
	"partida_id" text NOT NULL,
	"numero" integer NOT NULL,
	"anio" integer NOT NULL,
	"version" integer NOT NULL,
	"codigo" text,
	"descripcion_libre" text,
	"cantidad" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unidad" text,
	"costo" numeric(18, 6),
	"costo_catalogo" numeric(18, 6),
	"utilidad_pct" numeric(9, 6) DEFAULT '0' NOT NULL,
	"moneda_costo" text,
	"horas_por_dia" integer,
	"dias_por_semana" integer,
	"ingenieros" integer,
	"semanas" integer,
	"tarifa_hora" numeric(18, 6),
	"nodos" integer,
	"base_nodos" integer,
	"orden" integer DEFAULT 1 NOT NULL,
	"notas" text,
	CONSTRAINT "cot_conceptos_utilidad_pct_rango" CHECK ("cot_conceptos"."utilidad_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "cot_gastos" (
	"id" text PRIMARY KEY NOT NULL,
	"numero" integer NOT NULL,
	"anio" integer NOT NULL,
	"version" integer NOT NULL,
	"codigo" text,
	"descripcion_libre" text,
	"cantidad" numeric(18, 6) DEFAULT '0' NOT NULL,
	"costo" numeric(18, 6) DEFAULT '0' NOT NULL,
	"costo_catalogo" numeric(18, 6),
	"utilidad_pct" numeric(9, 6) DEFAULT '0' NOT NULL,
	"moneda_costo" text,
	"destino_partida_id" text,
	"orden" integer DEFAULT 1 NOT NULL,
	"notas" text,
	CONSTRAINT "cot_gastos_utilidad_pct_rango" CHECK ("cot_gastos"."utilidad_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "cot_importes" (
	"numero" integer NOT NULL,
	"anio" integer NOT NULL,
	"version" integer NOT NULL,
	"congelado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"congelado_por" text NOT NULL,
	"resultado" jsonb NOT NULL,
	"parametros" jsonb NOT NULL,
	"moneda" text NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"iva" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"letra" text NOT NULL,
	CONSTRAINT "cot_importes_numero_anio_version_pk" PRIMARY KEY("numero","anio","version")
);
--> statement-breakpoint
CREATE TABLE "cot_partidas" (
	"id" text PRIMARY KEY NOT NULL,
	"numero" integer NOT NULL,
	"anio" integer NOT NULL,
	"version" integer NOT NULL,
	"orden" integer NOT NULL,
	"titulo" text DEFAULT '' NOT NULL,
	"descripcion" text,
	"cantidad" numeric(18, 6) DEFAULT '1' NOT NULL,
	"unidad" text DEFAULT 'servicio' NOT NULL,
	"ajuste" numeric(18, 6) DEFAULT '0' NOT NULL,
	"precio_unitario_final" numeric(18, 6),
	"recibe_gastos_generales" boolean DEFAULT true NOT NULL,
	"gasto_manual" numeric(18, 6),
	"formato" text DEFAULT 'NORMAL' NOT NULL,
	"notas" text,
	CONSTRAINT "cot_partidas_identidad_uq" UNIQUE("id","numero","anio","version")
);
--> statement-breakpoint
ALTER TABLE "cotizaciones" ADD COLUMN "origen_monto" text;--> statement-breakpoint
ALTER TABLE "cat_servicios_cambios" ADD CONSTRAINT "cat_servicios_cambios_codigo_cat_servicios_codigo_fk" FOREIGN KEY ("codigo") REFERENCES "public"."cat_servicios"("codigo") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cot_armado" ADD CONSTRAINT "cot_armado_numero_anio_version_cotizaciones_numero_anio_version_fk" FOREIGN KEY ("numero","anio","version") REFERENCES "public"."cotizaciones"("numero","anio","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cot_conceptos" ADD CONSTRAINT "cot_conceptos_numero_anio_version_cotizaciones_numero_anio_version_fk" FOREIGN KEY ("numero","anio","version") REFERENCES "public"."cotizaciones"("numero","anio","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cot_conceptos" ADD CONSTRAINT "cot_conceptos_partida_id_numero_anio_version_cot_partidas_id_numero_anio_version_fk" FOREIGN KEY ("partida_id","numero","anio","version") REFERENCES "public"."cot_partidas"("id","numero","anio","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cot_gastos" ADD CONSTRAINT "cot_gastos_numero_anio_version_cotizaciones_numero_anio_version_fk" FOREIGN KEY ("numero","anio","version") REFERENCES "public"."cotizaciones"("numero","anio","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- El `SET NULL` de esta llave nombra SU columna, y es a mano.
--
-- La llave es compuesta para que el destino de un gasto sea una partida de la
-- MISMA versión. Pero un `ON DELETE SET NULL` a secas anularía las cuatro
-- columnas, y tres de ellas son NOT NULL: borrar una partida fallaría en vez
-- de devolver el gasto a general. Postgres 15 permite decir cuál se anula.
--
-- drizzle-kit todavía no genera esa lista, así que si alguien regenera esta
-- migración hay que volver a ponerla (está anotado también en schema.ts).
ALTER TABLE "cot_gastos" ADD CONSTRAINT "cot_gastos_destino_partida_id_numero_anio_version_cot_partidas_id_numero_anio_version_fk" FOREIGN KEY ("destino_partida_id","numero","anio","version") REFERENCES "public"."cot_partidas"("id","numero","anio","version") ON DELETE SET NULL ("destino_partida_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cot_importes" ADD CONSTRAINT "cot_importes_numero_anio_version_cotizaciones_numero_anio_version_fk" FOREIGN KEY ("numero","anio","version") REFERENCES "public"."cotizaciones"("numero","anio","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cot_partidas" ADD CONSTRAINT "cot_partidas_numero_anio_version_cotizaciones_numero_anio_version_fk" FOREIGN KEY ("numero","anio","version") REFERENCES "public"."cotizaciones"("numero","anio","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cat_servicios_familia_idx" ON "cat_servicios" USING btree ("familia","activo");--> statement-breakpoint
CREATE INDEX "cat_servicios_cambios_codigo_idx" ON "cat_servicios_cambios" USING btree ("codigo","fecha");--> statement-breakpoint
CREATE INDEX "cot_conceptos_partida_idx" ON "cot_conceptos" USING btree ("partida_id","orden");--> statement-breakpoint
CREATE INDEX "cot_conceptos_version_idx" ON "cot_conceptos" USING btree ("numero","anio","version");--> statement-breakpoint
CREATE INDEX "cot_gastos_version_idx" ON "cot_gastos" USING btree ("numero","anio","version");--> statement-breakpoint
CREATE INDEX "cot_partidas_version_idx" ON "cot_partidas" USING btree ("numero","anio","version");--> statement-breakpoint
CREATE UNIQUE INDEX "cot_partidas_orden_uq" ON "cot_partidas" USING btree ("numero","anio","version","orden");