/**
 * Revierte la migración `0006_cotizador_modelo` en una base de prueba.
 *
 * Existe por un motivo concreto y temporal: la primera versión de la 0006
 * guardaba los costos en `numeric(14,2)` y recortaba los decimales de las
 * **entradas** —el `2671.885` de la 068 se volvía `2671.89` y movía el total
 * diez centavos contra el PDF del cliente—. La corrección va en la propia 0006,
 * porque el PR no ha entrado a `develop` y una 0007 que parchara a la 0006 del
 * mismo PR sería un remiendo de algo que nadie ha visto todavía.
 *
 * Pero la 0006 vieja **ya está aplicada** en la base de prueba, y Drizzle no
 * vuelve a correr una migración cuyo renglón ya existe. Así que hay que quitar
 * las tablas y el renglón, y volver a migrar.
 *
 * **Solo sirve para eso.** Se niega si la 0006 aplicada no es la vieja, y borra
 * siete tablas enteras: no es un script que deba sobrevivir a este PR.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin `--aplicar` solo reporta.
 *
 * Uso, desde la raíz del repositorio:
 *   pnpm revertir:0006                                   # qué haría
 *   pnpm revertir:0006 --ensayo  --destino=ep-xxx.neon.tech
 *   pnpm revertir:0006 --aplicar --destino=ep-xxx.neon.tech
 *
 * Variables: DATABASE_URL y, opcionalmente, PRODUCTION_DATABASE_HOST.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { ejecutarLote, leerBanderas, verificarDestino } from "./guardas";

config({ path: "apps/web/.env.local" });

/**
 * El sha256 de la 0006 **vieja**, que es como Drizzle identifica una migración
 * aplicada (`readMigrationFiles`: `createHash("sha256").update(query)` sobre el
 * contenido del archivo). Van los dos finales de línea porque el hash es de los
 * bytes: quien generó el archivo lo tiene con LF, y un clon en Windows con
 * `core.autocrlf` lo deja con CRLF.
 */
const HASHES_VIEJOS = [
  "75efa843518cab6b4d857b8060436c4a7060b89a6a4f11683443d0b90dcb0b32", // LF
  "2986b3bdff900964042413e86d41ff664a8bd9d269ed9d6a6ae62aae3329c9ce", // CRLF
];

/** En orden: las que tienen llave foránea primero. */
const TABLAS = [
  "cot_importes",
  "cot_conceptos",
  "cot_gastos",
  "cot_partidas",
  "cot_armado",
  "cat_servicios_cambios",
  "cat_servicios",
];

/**
 * Un nombre de tabla, comprobado contra la lista antes de interpolarlo.
 *
 * `DROP TABLE` no admite parámetros —un identificador no es un valor—, así que
 * aquí sí se arma la sentencia con texto. La lista es una constante de este
 * archivo y nada de fuera llega hasta aquí; la comprobación está para que eso
 * siga siendo verdad el día que alguien toque la función.
 */
function identificador(tabla: string): string {
  if (!TABLAS.includes(tabla)) throw new Error(`Tabla fuera de la lista: ${tabla}`);
  return `"${tabla}"`;
}

const banderas = leerBanderas();

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const HOST = new URL(process.env.DATABASE_URL).host;

// ── Qué hay aplicado ──────────────────────────────────────────────────────────

interface Aplicada {
  id: number;
  hash: string;
  created_at: string;
}

async function migracionesAplicadas(): Promise<Aplicada[]> {
  try {
    return (await sql`
      SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id
    `) as Aplicada[];
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === "42P01" || (e?.message ?? "").includes("__drizzle_migrations")) {
      console.error(
        `\n❌  ${HOST} no tiene la tabla de migraciones de Drizzle.\n` +
          "    Esa base nunca corrió pnpm db:migrate: no hay nada que revertir.\n",
      );
      process.exit(1);
    }
    throw err;
  }
}

/** Las tablas de la 0006 que de verdad existen en esta base. */
async function tablasPresentes(): Promise<string[]> {
  const filas = (await sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name::text = ANY(${TABLAS}::text[])
  `) as Array<{ table_name: string }>;
  return TABLAS.filter((t) => filas.some((f) => f.table_name === t));
}

/**
 * La escala de un costo, que es lo que distingue la 0006 vieja de la nueva.
 *
 * El hash dice qué archivo se aplicó; esto dice qué quedó en la base. Son dos
 * preguntas distintas y conviene contestar las dos antes de borrar siete
 * tablas.
 */
async function escalaDelCosto(): Promise<number | null> {
  const [fila] = (await sql`
    SELECT numeric_scale FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cot_conceptos' AND column_name = 'costo'
  `) as Array<{ numeric_scale: number }>;
  return fila ? Number(fila.numeric_scale) : null;
}

/** Cuántos renglones hay en cada tabla: borrarlas con datos dentro no es gratis. */
async function conDatos(tablas: string[]): Promise<Array<{ tabla: string; filas: number }>> {
  const fuera: Array<{ tabla: string; filas: number }> = [];
  for (const t of tablas) {
    const [fila] = (await sql(`SELECT count(*)::int AS n FROM ${identificador(t)}`)) as Array<{ n: number }>;
    if (fila.n > 0) fuera.push({ tabla: t, filas: fila.n });
  }
  return fuera;
}

// ── Lo que se revierte ────────────────────────────────────────────────────────

function sentencias(tablas: string[]) {
  const lote: unknown[] = [];
  // `CASCADE` por las llaves foráneas entre ellas; el orden ya las ordena, pero
  // una base a medio migrar puede tener restricciones que no están en la lista.
  for (const t of tablas) lote.push(sql(`DROP TABLE IF EXISTS ${identificador(t)} CASCADE`));
  lote.push(sql`ALTER TABLE cotizaciones DROP COLUMN IF EXISTS origen_monto`);
  lote.push(sql`DELETE FROM drizzle.__drizzle_migrations WHERE hash = ANY(${HASHES_VIEJOS}::text[])`);
  return lote;
}

async function main() {
  console.log("\n⏪  Revertir la migración 0006 (la versión con numeric(14,2))\n");
  verificarDestino(HOST, banderas, "Este script borra siete tablas enteras");

  const aplicadas = await migracionesAplicadas();
  const vieja = aplicadas.find((m) => HASHES_VIEJOS.includes(m.hash));
  const escala = await escalaDelCosto();
  const presentes = await tablasPresentes();

  console.log(`🗃️  ${aplicadas.length} migraciones aplicadas; la última es ${aplicadas.at(-1)?.hash.slice(0, 12)}…`);
  console.log(`    cot_conceptos.costo: ${escala === null ? "la tabla no existe" : `escala ${escala}`}`);
  console.log(`    tablas de la 0006 presentes: ${presentes.length ? presentes.join(", ") : "ninguna"}\n`);

  if (!vieja) {
    console.error(
      "❌  En esta base no está aplicada la 0006 vieja.\n" +
        `    Ninguna migración aplicada tiene el hash esperado:\n` +
        HASHES_VIEJOS.map((h) => `      ${h}`).join("\n") +
        "\n\n    Si la base ya tiene la 0006 corregida, no hay nada que revertir.\n" +
        "    Si tiene otra cosa, míralo antes: este script no la va a adivinar.\n",
    );
    process.exit(1);
  }

  if (escala !== null && escala !== 2) {
    console.error(
      `❌  El renglón de la 0006 vieja está, pero cot_conceptos.costo tiene escala ${escala}\n` +
        "    y la vieja la dejaba en 2. La base no está como este script espera.\n",
    );
    process.exit(1);
  }

  const ocupadas = await conDatos(presentes);
  if (ocupadas.length) {
    console.log("⚠️   Estas tablas tienen datos y se van a perder:");
    for (const o of ocupadas) console.log(`    ${o.tabla.padEnd(24)} ${o.filas} renglones`);
    console.log(
      "\n    Si son la cotización de prueba 9068/2099 y el catálogo cargado, está\n" +
        "    bien: los dos se vuelven a crear corriendo sus scripts.\n",
    );
  }

  console.log("Se va a:");
  for (const t of presentes) console.log(`    DROP TABLE ${t}`);
  console.log("    ALTER TABLE cotizaciones DROP COLUMN origen_monto");
  console.log(`    DELETE del renglón ${vieja.id} de drizzle.__drizzle_migrations\n`);

  if (!banderas.escribe) {
    console.log(`👀  Solo reporte. Para hacerlo: --aplicar --destino=${HOST}\n`);
    return;
  }

  const lote = sentencias(presentes);
  const { aplicado } = await ejecutarLote(sql, lote, banderas);

  if (!aplicado) {
    console.log(
      `✅  Ensayo correcto: las ${lote.length} sentencias corrieron y la transacción\n` +
        "    revirtió. La base sigue como estaba.\n",
    );
    return;
  }

  console.log(
    "✅  Revertida. Ahora:\n" +
      "       pnpm db:migrate          # aplica la 0006 corregida\n" +
      "       pnpm catalogo:importar --aplicar --destino=" + HOST + "\n" +
      "       pnpm prueba:068 --aplicar --destino=" + HOST + "\n",
  );
}

main().catch((err) => {
  console.error("\n❌ ", err instanceof Error ? err.message : err);
  process.exit(1);
});
