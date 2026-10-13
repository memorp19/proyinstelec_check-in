/**
 * Guardas comunes de los scripts que escriben en la base.
 *
 * Nacieron en el importador de 2026 (`scripts/importar-excel-2026.ts`, PR #18)
 * y se extrajeron aquí al necesitarlas el segundo script. La idea es siempre la
 * misma: **no se escribe por accidente**. Sin `--aplicar` solo se reporta, y
 * para escribir hay que teclear el host al que se escribe.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

/** El cliente tal como lo devuelve `neon(url)`: sin modo arreglo ni resultados completos. */
type Sql = NeonQueryFunction<false, false>;

export interface Banderas {
  /** Escribe de verdad. */
  aplicar: boolean;
  /** Escribe y revierte: comprueba tipos y restricciones sin dejar renglones. */
  ensayo: boolean;
  /** El host que quien ejecuta afirma tener delante. */
  destino: string | null;
  escribe: boolean;
}

export function leerBanderas(argv: string[] = process.argv): Banderas {
  const aplicar = argv.includes("--aplicar");
  const ensayo = argv.includes("--ensayo");
  return {
    aplicar,
    ensayo,
    destino: (argv.find((a) => a.startsWith("--destino=")) ?? "").split("=")[1] || null,
    escribe: aplicar || ensayo,
  };
}

/** El valor de `--algo=valor`, o `null`. */
export function opcion(nombre: string, argv: string[] = process.argv): string | null {
  const arg = argv.find((a) => a.startsWith(`--${nombre}=`));
  if (!arg) return null;
  return arg.slice(nombre.length + 3) || null;
}

/**
 * Escribir exige nombrar el host al que se escribe.
 *
 * `DATABASE_URL` apunta a lo que tenga el `.env.local` de quien ejecuta.
 * Teclear el host es la confirmación de que quien corre esto sabe en qué base
 * está parado; y si ese host es el de producción, no se ejecuta.
 */
export function verificarDestino(host: string, banderas: Banderas, queHace: string): void {
  console.log(`🔌  Base: ${host}\n`);

  const produccion = process.env.PRODUCTION_DATABASE_HOST?.trim();
  if (produccion && host === produccion) {
    console.error(
      `❌  ${host} es el host de producción (PRODUCTION_DATABASE_HOST).\n` +
        `    ${queHace}; no se ejecuta aquí.\n` +
        "    Hazlo sobre una rama de Neon y promuévela.",
    );
    process.exit(1);
  }

  if (!banderas.escribe) return;

  if (!banderas.destino) {
    console.error(`❌  Para escribir hay que nombrar el destino:\n       --destino=${host}`);
    process.exit(1);
  }
  if (banderas.destino !== host) {
    console.error(`❌  --destino=${banderas.destino} no es la base conectada (${host}). No se escribe nada.`);
    process.exit(1);
  }
}

// ── El ensayo ─────────────────────────────────────────────────────────────────

export const MARCA_ENSAYO = "ENSAYO_ROLLBACK_DELIBERADO";

/**
 * Hace fallar la transacción a propósito, para el modo de ensayo: todas las
 * escrituras se ejecutan de verdad —y sus restricciones se comprueban— pero el
 * lote revierte y no queda nada.
 *
 * Es un cast imposible y no un `RAISE EXCEPTION` dentro de un bloque `DO`
 * porque ahí el cuerpo va entre `$$...$$`: un `$1` dentro de esas comillas no
 * es un parámetro sino texto literal, así que la sentencia declararía cero
 * parámetros y el driver mandaría uno.
 */
export function abortarEnsayo(sql: Sql) {
  return sql`SELECT CAST(${MARCA_ENSAYO} AS integer)`;
}

/** Postgres incluye el valor rechazado en el mensaje: así se reconoce. */
export function esAbortoDeEnsayo(err: unknown): boolean {
  return (err instanceof Error ? err.message : String(err)).includes(MARCA_ENSAYO);
}

/**
 * Corre el lote en una sola transacción. En ensayo, le añade el aborto al final
 * y devuelve `false` cuando revirtió como se esperaba.
 */
export async function ejecutarLote(
  sql: Sql,
  lote: unknown[],
  banderas: Banderas,
): Promise<{ aplicado: boolean }> {
  const consultas = banderas.ensayo ? [...lote, abortarEnsayo(sql)] : lote;
  try {
    await sql.transaction(consultas as Parameters<typeof sql.transaction>[0]);
    return { aplicado: true };
  } catch (err) {
    if (banderas.ensayo && esAbortoDeEnsayo(err)) return { aplicado: false };
    throw err;
  }
}
