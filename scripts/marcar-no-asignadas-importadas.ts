/**
 * Descarta las versiones que quedaron en ENVIADA tras haberse asignado otra.
 *
 * Al registrar la OC desde la app, `marcarNoAsignadas` deja las versiones
 * hermanas en NO ASIGNADA. Los datos importados nunca pasaron por ahí, así que
 * conservan en ENVIADA versiones que ya estaban descartadas de hecho.
 *
 * Importa porque `ORDEN_VIGENTE` salta NO ASIGNADA y CANCELADA, pero NO
 * ENVIADA: mientras una de esas tenga la versión más alta, es ella la vigente.
 * El listado muestra entonces ENVIADA sin OC ni OT, y los filtros por orden de
 * compra y por folio de OT no encuentran la cotización — esos datos viven en la
 * versión que sí se asignó.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin --aplicar solo reporta.
 *
 * Idempotente: tras aplicarlo ya no hay ENVIADA con hermana ASIGNADA, así que
 * una segunda corrida encuentra 0.
 *
 * Uso, desde la raíz del repo:
 *   pnpm marcar:no-asignadas
 *   pnpm marcar:no-asignadas --anio 2026
 *   pnpm marcar:no-asignadas --aplicar
 *
 * Variables: DATABASE_URL (apps/web/.env.local o el entorno).
 */
import { config } from "dotenv";
import {
  clasificarImportadas,
  getVersiones,
  getVigente,
  marcarNoAsignadas,
  type Cotizacion,
} from "../apps/web/src/lib/cotizaciones";
import { getDb } from "../apps/web/src/db";
import { cotizaciones } from "../apps/web/src/db/schema";
import { and, eq, sql } from "drizzle-orm";

config({ path: "apps/web/.env.local" });

const APLICAR = process.argv.includes("--aplicar");
const ANIO_FILTRO = (() => {
  const i = process.argv.indexOf("--anio");
  if (i < 0) return null;
  const valor = process.argv[i + 1];
  if (!valor || !/^\d{4}$/.test(valor)) {
    console.error("❌  --anio necesita un año de 4 dígitos, p. ej. --anio 2026");
    process.exit(1);
  }
  return parseInt(valor, 10);
})();

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}

/**
 * Queda en bitácora igual que una corrección hecha desde la app, pero
 * identificable: nadie debe confundir esto con una decisión de un comercial.
 */
const USUARIO = "corrección de importación";

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

const montos = (c: Cotizacion) =>
  [c.monto_mxn ? `$${c.monto_mxn} MXN` : "", c.monto_usd ? `$${c.monto_usd} USD` : ""]
    .filter(Boolean)
    .join(" + ") || "sin monto";

async function main() {
  console.log(
    `🔁  Versiones ENVIADA con una hermana ASIGNADA${APLICAR ? "" : "  (REPORTE — no escribe nada)"}\n`,
  );

  // Cotizaciones con al menos una ENVIADA y al menos una ASIGNADA.
  const afectadas = (await getDb()
    .selectDistinct({ numero: cotizaciones.numero, anio: cotizaciones.anio })
    .from(cotizaciones)
    .where(
      and(
        ANIO_FILTRO ? eq(cotizaciones.anio, ANIO_FILTRO) : undefined,
        eq(cotizaciones.estatus, "ENVIADA"),
        sql`EXISTS (
          SELECT 1 FROM cotizaciones a
           WHERE a.numero = ${cotizaciones.numero}
             AND a.anio   = ${cotizaciones.anio}
             AND a.version <> ${cotizaciones.version}
             AND a.estatus = 'ASIGNADA'
        )`,
      ),
    )
    .orderBy(cotizaciones.anio, cotizaciones.numero)) as Array<{ numero: number; anio: number }>;

  if (afectadas.length === 0) {
    console.log("✅  No hay versiones en ENVIADA con una hermana ASIGNADA. Nada que hacer.\n");
    return;
  }

  const corregibles: Array<{ numero: number; anio: number; caerian: number }> = [];
  const conflictivas: Array<{ numero: number; anio: number; asignadas: Cotizacion[] }> = [];

  for (const { numero, anio } of afectadas) {
    const versiones = await getVersiones(numero, anio);
    const { asignadas, enviadasMayores, enviadasMenores } = clasificarImportadas(versiones);

    // ── Dos o más ASIGNADA: violan "una cotización, una OT" ───────────────────
    if (asignadas.length !== 1) {
      conflictivas.push({ numero, anio, asignadas });
      continue;
    }

    const asignada = asignadas[0];
    console.log(`── ${String(numero).padStart(3, "0")}-${anio} ──`);
    console.log(
      `  ASIGNADA   v${asignada.version}  ${asignada.folio}` +
        `  ·  OC ${asignada.orden_compra ?? "—"}  ·  OT ${asignada.folio_ot ?? "—"}`,
    );

    const linea = (c: Cotizacion) =>
      `  ENVIADA    v${c.version}  ${c.folio}  ·  ${fecha(c.fecha_solicitud)}  ·  ${montos(c)}`;

    if (enviadasMayores.length > 0) {
      console.log("  ↓ versión MAYOR que la asignada — son las que hoy la tapan en el listado");
      for (const c of enviadasMayores) console.log(linea(c));
    }
    if (enviadasMenores.length > 0) {
      console.log("  ↓ versión MENOR que la asignada — no tapan, pero quedan mal reportadas");
      for (const c of enviadasMenores) console.log(linea(c));
    }
    console.log();

    corregibles.push({
      numero,
      anio,
      caerian: enviadasMayores.length + enviadasMenores.length,
    });
  }

  // ── Las que necesitan a una persona ─────────────────────────────────────────
  if (conflictivas.length > 0) {
    console.log(`── ⚠️  NO se tocan: dos o más versiones en ASIGNADA (${conflictivas.length}) ──`);
    for (const c of conflictivas) {
      const detalle = c.asignadas
        .map((a) => `v${a.version}${a.folio_ot ? ` (OT ${a.folio_ot})` : ""}`)
        .join(", ");
      console.log(`  ${String(c.numero).padStart(3, "0")}-${c.anio}  →  ${detalle}`);
    }
    console.log(
      '\n      Violan "una cotización, una OT". Hay que decidir a mano cuál es la buena' +
        "\n      antes de descartar nada: el script no puede saberlo.\n",
    );
  }

  const totalCaerian = corregibles.reduce((n, c) => n + c.caerian, 0);

  if (!APLICAR) {
    console.log(
      `📋  Reporte, no se escribió nada. Con --aplicar caerían ${totalCaerian} versiones ` +
        `en ${corregibles.length} cotizaciones.\n`,
    );
    return;
  }

  // ── Aplicar ─────────────────────────────────────────────────────────────────
  let descartadas = 0;
  for (const { numero, anio } of corregibles) {
    const versiones = await getVersiones(numero, anio);
    const { asignadas } = clasificarImportadas(versiones);
    // Releído: si algo cambió entre el reporte y ahora, no se fuerza.
    if (asignadas.length !== 1) continue;
    descartadas += await marcarNoAsignadas(numero, anio, asignadas[0].version, USUARIO);
  }
  console.log(`✅  ${descartadas} versiones quedaron en NO ASIGNADA.\n`);

  // ── Verificación: la vigente debe ser ahora la ASIGNADA ─────────────────────
  const malas: string[] = [];
  for (const { numero, anio } of corregibles) {
    const vigente = await getVigente(numero, anio);
    if (vigente?.estatus !== "ASIGNADA") {
      malas.push(
        `${String(numero).padStart(3, "0")}-${anio} → vigente v${vigente?.version} (${vigente?.estatus ?? "sin versiones"})`,
      );
    }
  }

  if (malas.length === 0) {
    console.log("✅  En todas las corregidas, la vigente es ahora la versión ASIGNADA.\n");
  } else {
    console.log(`⚠️   ${malas.length} cotizaciones siguen sin tener la ASIGNADA como vigente:`);
    for (const m of malas) console.log(`  ${m}`);
    console.log(
      "\n    Suele significar que hay una versión en un estatus que ORDEN_VIGENTE no" +
        "\n    descarta (PROCESO, REVISION, DEPENDIENTE…) por encima de la asignada.\n",
    );
  }
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
