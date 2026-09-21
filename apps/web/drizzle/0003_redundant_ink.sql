-- Las OT creadas antes de esta migracion tienen estatus 'PROCESO', que es un
-- estatus de COTIZACION colado a esta tabla y no existe en la maquina de
-- transiciones de la OT. Se normaliza a vacio, que es como nace una OT.
UPDATE "ordenes_trabajo" SET "estatus" = '' WHERE "estatus" = 'PROCESO';--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ALTER COLUMN "estatus" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "ot_responsables" ADD COLUMN "slot" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ot_responsables_slot_activo_uq" ON "ot_responsables" USING btree ("folio_ot","slot") WHERE "ot_responsables"."activo";--> statement-breakpoint
ALTER TABLE "ot_responsables" ADD CONSTRAINT "ot_responsables_slot_rango" CHECK ("ot_responsables"."slot" between 1 and 3);