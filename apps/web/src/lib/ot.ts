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
  estatus: string; // PROCESO al crear
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
}

type FilaOT = typeof ordenesTrabajo.$inferSelect;
type FilaResponsable = typeof otResponsables.$inferSelect;

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
 * Responsable activo de varias OT, indexado por folio. Una sola consulta para
 * todo el listado: sin esto la pantalla haría una por tarjeta.
 */
export async function responsablesActivosPorFolio(
  folios: string[],
): Promise<Record<string, ResponsableOT>> {
  if (folios.length === 0) return {};
  const filas = await getDb()
    .select()
    .from(otResponsables)
    .where(and(inArray(otResponsables.folioOt, folios), eq(otResponsables.activo, true)));
  return Object.fromEntries(filas.map((f) => [f.folioOt, aResponsable(f)]));
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
        estatus: "PROCESO",
        areas: params.areas,
        createdBy: params.createdBy,
      })
      .returning();
    return aOT(fila);
  } catch (err) {
    const e = err as { code?: string; message?: string; cause?: { code?: string } };
    if (
      e?.code === "23505" ||
      e?.cause?.code === "23505" ||
      /duplicate key|unique constraint/i.test(e?.message ?? "")
    ) {
      throw new Error(`La OT ${folio} ya existe`);
    }
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

/**
 * Registra al responsable de la actividad. El anterior (si existe) pasa a
 * inactivo pero se conserva como historial (regla del legacy): un solo UPDATE
 * sobre los activos, sin leerlos antes.
 */
export async function registrarResponsable(params: {
  folioOt: string;
  correo: string;
  area?: string;
  asignadoPor: string;
}): Promise<ResponsableOT> {
  await getDb()
    .update(otResponsables)
    .set({ activo: false })
    .where(and(eq(otResponsables.folioOt, params.folioOt), eq(otResponsables.activo, true)));

  const [fila] = await getDb()
    .insert(otResponsables)
    .values({
      folioOt: params.folioOt,
      correo: params.correo.toLowerCase(),
      rol: "Responsable de la actividad",
      area: params.area ?? null,
      asignadoPor: params.asignadoPor,
    })
    .returning();
  return aResponsable(fila);
}
