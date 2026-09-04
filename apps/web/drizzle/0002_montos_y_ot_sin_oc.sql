ALTER TABLE "ordenes_trabajo" ALTER COLUMN "orden_compra" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cotizaciones" ADD COLUMN "monto_mxn" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "cotizaciones" ADD COLUMN "monto_usd" numeric(14, 2);