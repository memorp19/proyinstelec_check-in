import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { contadores } from "../db/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Contadores de folio del ERP. Cada tipo lleva su propia secuencia; los que
 * dependen del año (cotizaciones) usan un contador por año.
 * Reemplaza el "max + 1 leyendo toda la hoja" del ERP legacy con un
 * incremento atómico en una sola sentencia (fila de `contadores`).
 */
export type TipoFolio =
  | `cotizacion-${number}` // por año: cotizacion-2026
  | "actividad"            // ACT-####
  | "solicitud"            // SOL-####
  | "ayuda"                // AYU-####
  | "kpi-plantilla"        // KPI-####
  | "kpi-asignacion"       // ASK-####
  | "kpi-evaluacion"       // EVK-####
  | "servicio"             // SRV-###  (global; el legacy los numeraba corrido)
  | "pendiente";           // reservado: los PD-### van por OT, ver siguientePendienteDeOT en Fase 2

// ── Contador atómico ──────────────────────────────────────────────────────────

/**
 * Devuelve el siguiente número de la secuencia `tipo` (1, 2, 3, ...).
 * Atómico: el INSERT ... ON CONFLICT DO UPDATE resuelve alta y incremento en
 * una sola sentencia, así que dos llamadas concurrentes nunca reciben el mismo
 * número (el driver HTTP de Neon no tiene transacciones interactivas).
 */
export async function siguienteNumero(tipo: string): Promise<number> {
  const [fila] = await getDb()
    .insert(contadores)
    .values({ tipo, n: 1 })
    .onConflictDoUpdate({
      target: contadores.tipo,
      set: { n: sql`${contadores.n} + 1` },
    })
    .returning({ n: contadores.n });
  return fila.n;
}

/**
 * Fija el contador en un valor (para importaciones: dejarlo en el máximo
 * encontrado en los Sheets antes de empezar a operar). Solo sube, nunca baja:
 * el WHERE del ON CONFLICT descarta el caso en que ya va más adelante.
 */
export async function asegurarContadorMinimo(tipo: string, minimo: number): Promise<void> {
  await getDb()
    .insert(contadores)
    .values({ tipo, n: minimo })
    .onConflictDoUpdate({
      target: contadores.tipo,
      set: { n: minimo },
      setWhere: sql`${contadores.n} < ${minimo}`,
    });
}

// ── Formato de folios (convenciones del ERP legacy, sin cambios) ──────────────

export function pad(n: number, ancho: number): string {
  return String(n).padStart(ancho, "0");
}

/** PCOTOP-001-2026 (versión 0) · PCOTOP-001-2026-2 (versión ≥1) */
export function folioCotizacion(numero: number, anio: number, version = 0): string {
  const base = `PCOTOP-${pad(numero, 3)}-${anio}`;
  return version > 0 ? `${base}-${version}` : base;
}

/** OT + número 3 dígitos + año 2 dígitos + versión: OT001260 */
export function folioOT(numero: number, anio: number, version = 0): string {
  return `OT${pad(numero, 3)}${pad(anio % 100, 2)}${version}`;
}

export function folioActividad(n: number): string {
  return `ACT-${pad(n, 4)}`;
}

export function folioSolicitud(n: number): string {
  return `SOL-${pad(n, 4)}`;
}

export function folioAyuda(n: number): string {
  return `AYU-${pad(n, 4)}`;
}

export function folioServicio(n: number): string {
  return `SRV-${pad(n, 3)}`;
}

export function folioPendiente(n: number): string {
  return `PD-${pad(n, 3)}`;
}

// ── Parseo (para importadores y búsquedas) ────────────────────────────────────

/** Descompone PCOTOP-NNN-AAAA[-v]; acepta también "NNN-AAAA" y "NNN". */
export function parseFolioCotizacion(
  texto: string,
): { numero: number; anio?: number; version?: number } | null {
  const limpio = texto.trim().toUpperCase().replace(/^PCOTOP-?/, "");
  const m = limpio.match(/^(\d{1,3})(?:-(\d{4}))?(?:-(\d+))?$/);
  if (!m) return null;
  return {
    numero: parseInt(m[1], 10),
    anio: m[2] ? parseInt(m[2], 10) : undefined,
    version: m[3] ? parseInt(m[3], 10) : undefined,
  };
}

/** Descompone OT001260 → { numero: 1, anio: 2026, version: 0 } */
export function parseFolioOT(texto: string): { numero: number; anio: number; version: number } | null {
  const m = texto.trim().toUpperCase().match(/^OT(\d{3})(\d{2})(\d+)$/);
  if (!m) return null;
  return {
    numero: parseInt(m[1], 10),
    anio: 2000 + parseInt(m[2], 10),
    version: parseInt(m[3], 10),
  };
}
