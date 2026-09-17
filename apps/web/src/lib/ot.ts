import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { ordenesTrabajo, otResponsables } from "../db/schema";
import { folioOT, pad } from "./folios";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Orden de Trabajo (Fase 1: alta desde el ingreso de OC; la ficha completa,
 * control operativo y servicios llegan en la Fase 2).
 */
export interface OrdenTrabajo {
  folio: string; // OT001260
  numero_cotizacion: number;
  anio: number;
  version: number;
  /** Ausente cuando la OT se generó sin orden de compra. */
  orden_compra?: string;
  fecha_oc?: string;
  cliente: string;
  titulo: string;
  dirigida_a?: string;
  /** "" | "Asignado" | "En Ejecución" | "Cerrado" — nace vacía. */
  estatus: string;
  areas: string[];
  drive_folder_id?: string;
  drive_folder_url?: string;
  tiene_control_operativo: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ResponsableOT {
  id: string;
  folio_ot: string;
  correo: string;
  rol: string; // "Responsable de la actividad"
  area?: string;
  asignado_por: string;
  fecha: string;
  activo: boolean;
  /** Posición 1-3 dentro de su OT. */
  slot: number;
}

/** Una OT puede tener hasta tres responsables a la vez. */
export const MAX_RESPONSABLES = 3;

// ── Estatus de la OT ──────────────────────────────────────────────────────────

/**
 * Los cuatro estatus reales de la operación. El legacy tenía siete valores
 * observados (PROCESO, EN PROCESO, TERMINADO, FACTURADO...); los que se usan
 * de verdad son estos, y la OT nace vacía.
 */
export const ESTATUS_OT = ["", "Asignado", "En Ejecución", "Cerrado"] as const;
export type EstatusOT = (typeof ESTATUS_OT)[number];

export function esEstatusOT(valor: string): valor is EstatusOT {
  return (ESTATUS_OT as readonly string[]).includes(valor);
}

/**
 * Transiciones permitidas. Lineal y sin vuelta atrás; no hay cancelación
 * porque no aparece en la operación real (si hiciera falta, se agrega con su
 * propia regla, no colando un valor nuevo).
 */
export function transicionValidaOT(de: string, a: string): boolean {
  if (de === a) return false;
  const mapa: Record<EstatusOT, EstatusOT[]> = {
    "": ["Asignado"],
    Asignado: ["En Ejecución"],
    "En Ejecución": ["Cerrado"],
    Cerrado: [],
  };
  // `de` se lee de la base, así que puede traer un valor fuera del catálogo
  // (importaciones, datos viejos). Se rechaza en vez de reventar.
  if (!esEstatusOT(de) || !esEstatusOT(a)) return false;
  return mapa[de].includes(a);
}

type FilaOT = typeof ordenesTrabajo.$inferSelect;
type FilaResponsable = typeof otResponsables.$inferSelect;

/** Violación de llave única (23505), venga como venga envuelta por el driver. */
function esDuplicado(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string } };
  return (
    e?.code === "23505" ||
    e?.cause?.code === "23505" ||
    /duplicate key|unique constraint/i.test(e?.message ?? "")
  );
}

function aOT(f: FilaOT): OrdenTrabajo {
  return {
    folio: f.folio,
    numero_cotizacion: f.numeroCotizacion,
    anio: f.anio,
    version: f.version,
    orden_compra: f.ordenCompra ?? undefined,
    fecha_oc: f.fechaOc?.toISOString(),
    cliente: f.cliente,
    titulo: f.titulo,
    dirigida_a: f.dirigidaA ?? undefined,
    estatus: f.estatus,
    areas: f.areas ?? [],
    drive_folder_id: f.driveFolderId ?? undefined,
    drive_folder_url: f.driveFolderUrl ?? undefined,
    tiene_control_operativo: f.tieneControlOperativo,
    created_by: f.createdBy,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

function aResponsable(f: FilaResponsable): ResponsableOT {
  return {
    id: f.id,
    folio_ot: f.folioOt,
    correo: f.correo,
    rol: f.rol,
    area: f.area ?? undefined,
    asignado_por: f.asignadoPor,
    fecha: f.fecha.toISOString(),
    activo: f.activo,
    slot: f.slot,
  };
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/**
 * OT de una cotización, si ya tiene. Busca por (numero, anio) y NO por folio:
 * el folio lleva la versión dentro, así que una versión nueva produciría otro
 * folio y se colaría una segunda OT sin chocar con la llave primaria.
 */
export async function getOTDeCotizacion(
  numero: number,
  anio: number,
): Promise<OrdenTrabajo | null> {
  const [fila] = await getDb()
    .select()
    .from(ordenesTrabajo)
    .where(and(eq(ordenesTrabajo.numeroCotizacion, numero), eq(ordenesTrabajo.anio, anio)))
    .limit(1);
  return fila ? aOT(fila) : null;
}

export async function getOT(folio: string): Promise<OrdenTrabajo | null> {
  const [fila] = await getDb()
    .select()
    .from(ordenesTrabajo)
    .where(eq(ordenesTrabajo.folio, folio))
    .limit(1);
  return fila ? aOT(fila) : null;
}

export async function listOTDeAnio(anio: number): Promise<OrdenTrabajo[]> {
  const filas = await getDb()
    .select()
    .from(ordenesTrabajo)
    .where(eq(ordenesTrabajo.anio, anio))
    .orderBy(desc(ordenesTrabajo.folio));
  return filas.map(aOT);
}

/** Responsables de una OT, el más reciente primero (incluye el historial). */
export async function listResponsables(folio: string): Promise<ResponsableOT[]> {
  const filas = await getDb()
    .select()
    .from(otResponsables)
    .where(eq(otResponsables.folioOt, folio))
    .orderBy(desc(otResponsables.fecha));
  return filas.map(aResponsable);
}

/**
 * Responsables activos de varias OT, indexados por folio. Una sola consulta
 * para todo el listado: sin esto la pantalla haría una por tarjeta.
 *
 * Devuelve una LISTA por folio. Antes devolvía uno solo y el índice se armaba
 * con `Object.fromEntries`, que conserva únicamente la última fila de cada
 * clave: con más de un responsable activo los demás se perdían en silencio, y
 * cuál sobrevivía dependía del orden en que Postgres devolviera las filas.
 */
export async function responsablesActivosPorFolio(
  folios: string[],
): Promise<Record<string, ResponsableOT[]>> {
  if (folios.length === 0) return {};
  const filas = await getDb()
    .select()
    .from(otResponsables)
    .where(and(inArray(otResponsables.folioOt, folios), eq(otResponsables.activo, true)))
    .orderBy(otResponsables.slot);

  const porFolio: Record<string, ResponsableOT[]> = {};
  for (const f of filas) {
    (porFolio[f.folioOt] ??= []).push(aResponsable(f));
  }
  return porFolio;
}

// ── Alta (desde el ingreso de OC) ─────────────────────────────────────────────

export async function createOT(params: {
  numeroCotizacion: number;
  anio: number;
  version: number;
  /** null cuando el cliente aceptó sin emitir orden de compra. */
  ordenCompra: string | null;
  cliente: string;
  titulo: string;
  dirigidaA?: string;
  areas: string[];
  createdBy: string;
}): Promise<OrdenTrabajo> {
  const folio = folioOT(params.numeroCotizacion, params.anio, params.version);

  // Una cotización, una OT: los agregados van en una cotización nueva. Se
  // comprueba antes de insertar porque la llave primaria no lo detecta — el
  // folio cambia con la versión.
  const existente = await getOTDeCotizacion(params.numeroCotizacion, params.anio);
  if (existente) {
    throw new Error(
      `La cotización ${pad(params.numeroCotizacion, 3)}-${params.anio} ya tiene la OT ${existente.folio}. ` +
        `Los agregados o excedentes no amplían una OT existente: levanta una cotización nueva con esos ` +
        `suministros y esa cotización generará su propia OT.`,
    );
  }

  try {
    const [fila] = await getDb()
      .insert(ordenesTrabajo)
      .values({
        folio,
        numeroCotizacion: params.numeroCotizacion,
        anio: params.anio,
        version: params.version,
        ordenCompra: params.ordenCompra?.trim() || null,
        cliente: params.cliente,
        titulo: params.titulo,
        dirigidaA: params.dirigidaA ?? null,
        // El estatus lo pone el default de la columna: la OT nace vacía y se
        // mueve con `cambiarEstatusOT`. Antes se escribía "PROCESO", que es un
        // estatus de cotización y no existe en la operación de las OT.
        areas: params.areas,
        createdBy: params.createdBy,
      })
      .returning();
    return aOT(fila);
  } catch (err) {
    if (esDuplicado(err)) throw new Error(`La OT ${folio} ya existe`);
    throw err;
  }
}

/** Carpeta de Drive de la OT (se conoce después de crearla). */
export async function setCarpetaDriveOT(
  folio: string,
  carpeta: { folderId: string; folderUrl: string },
): Promise<void> {
  await getDb()
    .update(ordenesTrabajo)
    .set({
      driveFolderId: carpeta.folderId,
      driveFolderUrl: carpeta.folderUrl,
      updatedAt: new Date(),
    })
    .where(eq(ordenesTrabajo.folio, folio));
}

async function slotsOcupados(folioOt: string): Promise<number[]> {
  const filas = await getDb()
    .select({ slot: otResponsables.slot })
    .from(otResponsables)
    .where(and(eq(otResponsables.folioOt, folioOt), eq(otResponsables.activo, true)));
  return filas.map((f) => f.slot);
}

/**
 * Agrega un responsable a la OT, hasta `MAX_RESPONSABLES` a la vez.
 *
 * Antes esta función desactivaba a TODOS los activos antes de insertar, así
 * que era imposible tener más de uno. Ahora solo añade: para quitar a alguien
 * está `desactivarResponsable`.
 *
 * El tope lo impone el índice único parcial `(folio_ot, slot) WHERE activo`,
 * no este código: contar y luego insertar no es seguro bajo READ COMMITTED.
 * Si dos altas eligen el mismo slot a la vez, la segunda revienta con 23505 y
 * se reintenta con el siguiente libre — el mismo idioma que usa `createOT`.
 */
export async function agregarResponsable(params: {
  folioOt: string;
  correo: string;
  area?: string;
  asignadoPor: string;
}): Promise<ResponsableOT> {
  for (let intento = 0; intento < MAX_RESPONSABLES; intento++) {
    const ocupados = await slotsOcupados(params.folioOt);
    if (ocupados.length >= MAX_RESPONSABLES) {
      throw new Error(
        `La OT ${params.folioOt} ya tiene ${MAX_RESPONSABLES} responsables activos. ` +
          `Quita a uno antes de agregar otro.`,
      );
    }
    const libre = [1, 2, 3].find((s) => !ocupados.includes(s));
    if (!libre) continue;

    try {
      const [fila] = await getDb()
        .insert(otResponsables)
        .values({
          folioOt: params.folioOt,
          correo: params.correo.toLowerCase(),
          rol: "Responsable de la actividad",
          area: params.area ?? null,
          asignadoPor: params.asignadoPor,
          slot: libre,
        })
        .returning();
      return aResponsable(fila);
    } catch (err) {
      if (!esDuplicado(err)) throw err;
      // Otro proceso ocupó ese slot entre la lectura y el insert: se reintenta.
    }
  }
  throw new Error(
    `No se pudo asignar responsable en la OT ${params.folioOt}: los ${MAX_RESPONSABLES} slots ` +
      `se ocuparon durante el intento.`,
  );
}

/**
 * Da de baja a un responsable. La fila se conserva como historial (regla del
 * legacy) y su slot queda libre para otro.
 */
export async function desactivarResponsable(id: string): Promise<void> {
  const filas = await getDb()
    .update(otResponsables)
    .set({ activo: false })
    .where(and(eq(otResponsables.id, id), eq(otResponsables.activo, true)))
    .returning({ id: otResponsables.id });
  if (filas.length === 0) {
    throw new Error("El responsable no existe o ya estaba inactivo");
  }
}

/**
 * Cambia el estatus de la OT respetando la máquina de transiciones.
 *
 * El `WHERE estatus = <esperado>` hace el cambio atómico: si alguien lo movió
 * entre la validación y la escritura, el UPDATE no toca nada en lugar de pisar
 * un estado que ya no era el que se validó.
 */
export async function cambiarEstatusOT(folio: string, nuevo: EstatusOT): Promise<OrdenTrabajo> {
  const actual = await getOT(folio);
  if (!actual) throw new Error(`La OT ${folio} no existe`);
  if (!transicionValidaOT(actual.estatus as EstatusOT, nuevo)) {
    throw new Error(
      `Transición no permitida: ${actual.estatus || "(vacío)"} → ${nuevo || "(vacío)"}`,
    );
  }

  const [fila] = await getDb()
    .update(ordenesTrabajo)
    .set({ estatus: nuevo, updatedAt: new Date() })
    .where(and(eq(ordenesTrabajo.folio, folio), eq(ordenesTrabajo.estatus, actual.estatus)))
    .returning();
  if (!fila) {
    throw new Error(`El estatus de la OT ${folio} cambió mientras se guardaba; vuelve a intentar`);
  }
  return aOT(fila);
}
