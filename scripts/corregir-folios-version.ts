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
 * Cada corrida deja un corregir-folios-<fecha>.json con el detalle completo:
 * las dudosas son cola de trabajo humano y en una corrida única contra
 * producción no pueden depender del scrollback.
 *
 * Uso, desde la raíz del repo:
 *   pnpm corregir:folios              # reporte, no escribe
 *   pnpm corregir:folios --aplicar    # aplica la corrección
 *
 * Variables: DATABASE_URL (apps/web/.env.local o el entorno).
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

config({ path: "apps/web/.env.local" });

const APLICAR = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Las tres expresiones se usan dentro de una subconsulta correlacionada, donde
// una columna sin calificar se resolvería contra la tabla de dentro. Por eso
// todas van con el alias `c` y la tabla se aliasa siempre igual.

/**
 * El folio canónico, calculado desde (numero, anio, version). Es la misma regla
 * que `folioCotizacion` en src/lib/folios.ts, escrita en SQL para poder
 * compararla fila por fila dentro de la propia sentencia.
 */
const FOLIO_CANONICO = `
  'PCOTOP-' || lpad(c.numero::text, 3, '0') || '-' || c.anio ||
  CASE WHEN c.version > 0 THEN '-' || c.version ELSE '' END`;

/** El sufijo malo: "-v1", "-V12". Se acepta la V mayúscula por si acaso. */
const SUFIJO_MALO = `c.folio ~ '-[vV][0-9]+$'`;

/** Lo que quedaría tras quitar la "v". */
const FOLIO_CORREGIDO = `regexp_replace(c.folio, '-[vV]([0-9]+)$', '-\\1')`;

/**
 * ¿Hay ya OTRA fila con el folio que esta corrección produciría?
 *
 * `cotizaciones` no tiene índice único en `folio` —la PK es
 * (numero, anio, version)—, así que Postgres aceptaría sin protestar dos filas
 * con el mismo folio. Es el escenario de una carga mixta: una fila sana que ya
 * trae `PCOTOP-002-2026-1` y otra que trae `PCOTOP-002-2026-v1`. Corregir la
 * segunda crearía el duplicado en silencio, y a partir de ahí cualquier
 * búsqueda por folio devuelve dos cotizaciones distintas.
 */
const COLISIONA = `EXISTS (
  SELECT 1 FROM cotizaciones o
   WHERE o.folio = ${FOLIO_CORREGIDO}
     AND (o.numero, o.anio, o.version) IS DISTINCT FROM (c.numero, c.anio, c.version)
)`;

interface Fila {
  numero: number;
  anio: number;
  version: number;
  folio: string;
  corregido: string;
  canonico: string;
  colisiona: boolean;
}

/** Una fila que no se toca, con el porqué en texto para el reporte. */
interface Dudosa extends Fila {
  motivo: string;
}

async function main() {
  console.log(
    `🔁  Corrección de folios con "-vN"${APLICAR ? "" : "  (REPORTE — no escribe nada)"}\n`,
  );

  // ── 1. Qué hay ──────────────────────────────────────────────────────────────
  const candidatas = (await sql(`
    SELECT c.numero, c.anio, c.version, c.folio,
           ${FOLIO_CORREGIDO} AS corregido,
           ${FOLIO_CANONICO}  AS canonico,
           ${COLISIONA}       AS colisiona
      FROM cotizaciones c
     WHERE ${SUFIJO_MALO}
     ORDER BY c.anio, c.numero, c.version
  `)) as Fila[];

  if (candidatas.length === 0) {
    console.log('✅  No hay folios con el sufijo "-vN". Nada que hacer.\n');
    return;
  }

  // Solo se tocan las filas donde quitar la "v" produce EXACTAMENTE el folio
  // canónico y además nadie ocupa ya ese folio. Si no, lo decide una persona:
  // corregir a ciegas escribiría un folio inventado o un duplicado.
  const seguras: Fila[] = [];
  const dudosas: Dudosa[] = [];

  for (const c of candidatas) {
    if (c.corregido !== c.canonico) {
      dudosas.push({
        ...c,
        motivo: `quitar la "v" daría ${c.corregido}, pero por (${c.numero}, ${c.anio}, v${c.version}) el folio debería ser ${c.canonico}`,
      });
    } else if (c.colisiona) {
      dudosas.push({
        ...c,
        motivo: `otra fila ya tiene el folio ${c.corregido}; corregir esta crearía un duplicado`,
      });
    } else {
      seguras.push(c);
    }
  }

  console.log(`── Se corregirían (${seguras.length}) ──`);
  for (const c of seguras) {
    console.log(`  ${c.folio}  →  ${c.corregido}`);
  }

  if (dudosas.length > 0) {
    console.log(`\n── ⚠️  NO se tocan (${dudosas.length}) ──`);
    for (const d of dudosas) {
      console.log(`  ${d.folio}  →  ${d.motivo}`);
    }
    console.log("\n      Revísalas a mano antes de volver a correr el script.");
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
  let actualizadas: Array<{ folio: string }> = [];
  let verificacion: { quedanConV: number; desalineados: number } | null = null;

  if (APLICAR && seguras.length > 0) {
    // El driver HTTP de Neon no tiene transacciones interactivas, pero sí acepta
    // un lote de sentencias que se ejecuta como una sola transacción. Aquí basta
    // con una, así que el UPDATE ya es atómico por sí mismo; el lote deja el
    // patrón listo si mañana hay que tocar más de una tabla.
    //
    // Las tres condiciones del WHERE repiten la clasificación de arriba: el
    // script no le pasa a la base una lista de filas, sino la regla, así que lo
    // que se escribe no puede desviarse de lo que se reportó.
    const resultado = await sql.transaction([
      sql(`
        UPDATE cotizaciones c
           SET folio = ${FOLIO_CORREGIDO}
         WHERE ${SUFIJO_MALO}
           AND ${FOLIO_CORREGIDO} = ${FOLIO_CANONICO}
           AND NOT ${COLISIONA}
        RETURNING c.numero, c.anio, c.version, c.folio
      `),
    ]);

    actualizadas = (resultado[0] ?? []) as Array<{ folio: string }>;
    console.log(`\n✅  ${actualizadas.length} folios corregidos.`);

    // ── 4. Verificación ───────────────────────────────────────────────────────
    const [{ quedan }] = (await sql(`
      SELECT count(*)::int AS quedan FROM cotizaciones c WHERE ${SUFIJO_MALO}
    `)) as Array<{ quedan: number }>;
    const [{ desalineados }] = (await sql(`
      SELECT count(*)::int AS desalineados
        FROM cotizaciones c WHERE c.folio <> ${FOLIO_CANONICO}
    `)) as Array<{ desalineados: number }>;

    verificacion = { quedanConV: quedan, desalineados };
    console.log(`    Quedan con "-v": ${quedan}${quedan > 0 ? "  ← las dudosas de arriba" : ""}`);
    console.log(`    Folios que no coinciden con su forma canónica: ${desalineados}`);
  }

  // ── 5. Reporte a archivo ────────────────────────────────────────────────────
  // Las dudosas son cola de trabajo humano, y una corrida contra producción se
  // hace una sola vez: no pueden quedarse solo en el scrollback.
  const archivo = `corregir-folios-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    archivo,
    JSON.stringify(
      {
        corrida: new Date().toISOString(),
        modo: APLICAR ? "aplicar" : "reporte",
        totales: {
          candidatas: candidatas.length,
          seguras: seguras.length,
          dudosas: dudosas.length,
          corregidas: actualizadas.length,
        },
        seguras: seguras.map((c) => ({
          numero: c.numero,
          anio: c.anio,
          version: c.version,
          folio: c.folio,
          corregido: c.corregido,
        })),
        dudosas: dudosas.map((d) => ({
          numero: d.numero,
          anio: d.anio,
          version: d.version,
          folio: d.folio,
          corregido: d.corregido,
          canonico: d.canonico,
          colisiona: d.colisiona,
          motivo: d.motivo,
        })),
        corregidas: actualizadas.map((a) => a.folio),
        rastroEnBitacora: rastro,
        verificacion,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`\n📄  Reporte completo: ${archivo}`);

  if (!APLICAR) {
    console.log(
      `\n📋  Reporte, no se escribió nada. Con --aplicar se corregirían ${seguras.length} folios.\n`,
    );
    return;
  }
  if (seguras.length === 0) {
    console.log("\n⚠️   No hay ninguna fila segura que corregir. No se escribió nada.\n");
    return;
  }
  console.log();
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
