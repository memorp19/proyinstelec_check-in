/**
 * Corrige los folios de cotización cargados con "-vN" en vez de "-N".
 *
 * El formato correcto es `PCOTOP-002-2026` (v0) y `PCOTOP-002-2026-1` (v1).
 * La carga de `app-pruebas` se generó desde una base de laboratorio y escribió
 * `PCOTOP-002-2026-v1`: el "-v" de la documentación legacy
 * (`docs/erp-legacy/analisis-cotizaciones.md`) es notación para "-{versión}" y
 * se tomó literal. Ningún código del repo produce ese formato.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin --aplicar solo lista lo que haría.
 *
 * Idempotente: el WHERE solo alcanza folios con el sufijo malo, así que una
 * segunda corrida no encuentra nada y no cambia nada.
 *
 * Uso, desde la raíz del repo:
 *   pnpm corregir:folios              # reporte, no escribe
 *   pnpm corregir:folios --aplicar    # aplica la corrección
 *
 * Variables: DATABASE_URL (apps/web/.env.local o el entorno).
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: "apps/web/.env.local" });

const APLICAR = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

/**
 * El folio canónico, calculado desde (numero, anio, version). Es la misma regla
 * que `folioCotizacion` en src/lib/folios.ts, escrita en SQL para poder
 * compararla fila por fila dentro de la propia sentencia.
 */
const FOLIO_CANONICO = `
  'PCOTOP-' || lpad(numero::text, 3, '0') || '-' || anio ||
  CASE WHEN version > 0 THEN '-' || version ELSE '' END`;

/** El sufijo malo: "-v1", "-V12". Se acepta la V mayúscula por si acaso. */
const SUFIJO_MALO = `folio ~ '-[vV][0-9]+$'`;

/** Lo que quedaría tras quitar la "v". */
const FOLIO_CORREGIDO = `regexp_replace(folio, '-[vV]([0-9]+)$', '-\\1')`;

async function main() {
  console.log(
    `🔁  Corrección de folios con "-vN"${APLICAR ? "" : "  (REPORTE — no escribe nada)"}\n`,
  );

  // ── 1. Qué hay ──────────────────────────────────────────────────────────────
  const candidatas = (await sql(`
    SELECT numero, anio, version, folio,
           ${FOLIO_CORREGIDO} AS corregido,
           ${FOLIO_CANONICO}  AS canonico
      FROM cotizaciones
     WHERE ${SUFIJO_MALO}
     ORDER BY anio, numero, version
  `)) as Array<{
    numero: number;
    anio: number;
    version: number;
    folio: string;
    corregido: string;
    canonico: string;
  }>;

  if (candidatas.length === 0) {
    console.log("✅  No hay folios con el sufijo \"-vN\". Nada que hacer.\n");
    return;
  }

  // Solo se tocan las filas donde quitar la "v" produce EXACTAMENTE el folio
  // canónico. Si no coincide, el folio tiene algún otro problema y lo decide
  // una persona: corregirlo a ciegas escribiría un folio inventado.
  const seguras = candidatas.filter((c) => c.corregido === c.canonico);
  const dudosas = candidatas.filter((c) => c.corregido !== c.canonico);

  console.log(`── Se corregirían (${seguras.length}) ──`);
  for (const c of seguras) {
    console.log(`  ${c.folio}  →  ${c.corregido}`);
  }

  if (dudosas.length > 0) {
    console.log(`\n── ⚠️  NO se tocan: quitar la "v" no da el folio canónico (${dudosas.length}) ──`);
    for (const d of dudosas) {
      console.log(
        `  ${d.folio}  →  quedaría ${d.corregido}, pero por (${d.numero}, ${d.anio}, v${d.version}) debería ser ${d.canonico}`,
      );
    }
    console.log("\n      Revísalas a mano: el folio no solo tiene la 'v' de más.");
  }

  // ── 2. Rastro en bitácora, solo informativo ─────────────────────────────────
  const [{ rastro }] = (await sql(`
    SELECT count(*)::int AS rastro FROM bitacora WHERE detalle ~ '-[vV][0-9]+'
  `)) as Array<{ rastro: number }>;

  if (rastro > 0) {
    console.log(
      `\nℹ️   ${rastro} registros de bitácora mencionan un folio con "-v" en su detalle.` +
        "\n    NO se tocan: la bitácora es un registro de auditoría y reescribirla" +
        "\n    falsificaría lo que de verdad pasó en su momento.",
    );
  }

  // ── 3. Aplicar ──────────────────────────────────────────────────────────────
  if (!APLICAR) {
    console.log(
      `\n📋  Reporte, no se escribió nada. Con --aplicar se corregirían ${seguras.length} folios.\n`,
    );
    return;
  }

  if (seguras.length === 0) {
    console.log("\n⚠️   No hay ninguna fila segura que corregir. No se escribe nada.\n");
    return;
  }

  // El driver HTTP de Neon no tiene transacciones interactivas, pero sí acepta
  // un lote de sentencias que se ejecuta como una sola transacción. Aquí basta
  // con una, así que el UPDATE ya es atómico por sí mismo; el lote deja el
  // patrón listo si mañana hay que tocar más de una tabla.
  const resultado = await sql.transaction([
    sql(`
      UPDATE cotizaciones
         SET folio = ${FOLIO_CORREGIDO}
       WHERE ${SUFIJO_MALO}
         AND ${FOLIO_CORREGIDO} = ${FOLIO_CANONICO}
      RETURNING numero, anio, version, folio
    `),
  ]);

  const actualizadas = (resultado[0] ?? []) as Array<{ folio: string }>;
  console.log(`\n✅  ${actualizadas.length} folios corregidos.`);

  // ── 4. Verificación ─────────────────────────────────────────────────────────
  const [{ quedan }] = (await sql(`
    SELECT count(*)::int AS quedan FROM cotizaciones WHERE ${SUFIJO_MALO}
  `)) as Array<{ quedan: number }>;
  const [{ desalineados }] = (await sql(`
    SELECT count(*)::int AS desalineados
      FROM cotizaciones WHERE folio <> ${FOLIO_CANONICO}
  `)) as Array<{ desalineados: number }>;

  console.log(`    Quedan con "-v": ${quedan}${quedan > 0 ? "  ← las dudosas de arriba" : ""}`);
  console.log(`    Folios que no coinciden con su forma canónica: ${desalineados}\n`);
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
