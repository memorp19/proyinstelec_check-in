import { and, asc, between, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../db";
import { jornadas } from "../db/schema";
import type { DeviceInfo } from "./device-info";

/**
 * Jornadas de trabajo (check-in / check-out).
 *
 * En la base los dos puntos de control son columnas planas — así se pueden
 * filtrar y ordenar en SQL — pero hacia afuera se siguen exponiendo anidados,
 * que es como los arma y los lee la app.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CheckPoint {
  timestamp: string; // ISO UTC
  lat: number;
  lng: number;
  precision: number;
  driveFileId?: string;
  driveWebViewLink?: string;
  fotoHash?: string;
  uploadStatus?: "ok" | "pendiente";
  deviceInfo?: DeviceInfo;
}

export interface Jornada {
  id: string;
  usuarioId: string;
  proyectoId: string;
  tipo: "planta" | "temporal";
  checkIn: CheckPoint;
  checkOut?: CheckPoint & { observaciones?: string };
  duracionMinutos?: number;
  estado: "abierta" | "cerrada";
}

type Row = typeof jornadas.$inferSelect;

/** Tope de filas de los listados de historial (la app pagina en pantalla). */
const LIMITE_HISTORIAL = 200;

// ── Mapeo fila → Jornada ──────────────────────────────────────────────────────

function aCheckIn(row: Row): CheckPoint {
  return {
    timestamp: row.checkinTs.toISOString(),
    lat: row.checkinLat,
    lng: row.checkinLng,
    precision: row.checkinPrecision,
    driveFileId: row.checkinDriveFileId ?? undefined,
    driveWebViewLink: row.checkinDriveUrl ?? undefined,
    fotoHash: row.checkinFotoHash ?? undefined,
    uploadStatus: row.checkinUploadStatus ?? undefined,
    deviceInfo: (row.checkinDevice as DeviceInfo | null) ?? undefined,
  };
}

function aCheckOut(row: Row): (CheckPoint & { observaciones?: string }) | undefined {
  if (!row.checkoutTs) return undefined;
  return {
    timestamp: row.checkoutTs.toISOString(),
    lat: row.checkoutLat ?? 0,
    lng: row.checkoutLng ?? 0,
    precision: row.checkoutPrecision ?? 0,
    driveFileId: row.checkoutDriveFileId ?? undefined,
    driveWebViewLink: row.checkoutDriveUrl ?? undefined,
    fotoHash: row.checkoutFotoHash ?? undefined,
    uploadStatus: row.checkoutUploadStatus ?? undefined,
    deviceInfo: (row.checkoutDevice as DeviceInfo | null) ?? undefined,
    observaciones: row.observaciones ?? undefined,
  };
}

export function aJornada(row: Row): Jornada {
  return {
    id: row.id,
    usuarioId: row.usuarioId,
    proyectoId: row.proyectoId,
    tipo: row.tipo,
    estado: row.estado,
    checkIn: aCheckIn(row),
    checkOut: aCheckOut(row),
    duracionMinutos: row.duracionMinutos ?? undefined,
  };
}

// ── Escrituras ────────────────────────────────────────────────────────────────

export async function createJornada(params: {
  usuarioId: string;
  proyectoId: string;
  tipo: "planta" | "temporal";
  checkIn: CheckPoint;
}): Promise<Jornada> {
  const { checkIn } = params;

  const [row] = await getDb()
    .insert(jornadas)
    .values({
      usuarioId: params.usuarioId,
      proyectoId: params.proyectoId,
      tipo: params.tipo,
      estado: "abierta",
      checkinTs: new Date(checkIn.timestamp),
      checkinLat: checkIn.lat,
      checkinLng: checkIn.lng,
      checkinPrecision: checkIn.precision,
      checkinDriveFileId: checkIn.driveFileId ?? null,
      checkinDriveUrl: checkIn.driveWebViewLink ?? null,
      checkinFotoHash: checkIn.fotoHash ?? null,
      checkinUploadStatus: checkIn.uploadStatus ?? null,
      checkinDevice: checkIn.deviceInfo ?? null,
    })
    .returning();

  return aJornada(row);
}

/**
 * Cierra la jornada y devuelve su duración en minutos.
 *
 * El UPDATE exige `estado = 'abierta'`: si otra petición ya la cerró no
 * devuelve fila y aquí se lanza, en vez de sobrescribir el check-out original.
 */
export async function closeJornada(
  jornadaId: string,
  checkOut: CheckPoint & { observaciones?: string },
  checkInTimestamp: string,
): Promise<number> {
  const duracionMinutos = Math.round(
    (new Date(checkOut.timestamp).getTime() - new Date(checkInTimestamp).getTime()) / 60_000,
  );

  const filas = await getDb()
    .update(jornadas)
    .set({
      estado: "cerrada",
      duracionMinutos,
      checkoutTs: new Date(checkOut.timestamp),
      checkoutLat: checkOut.lat,
      checkoutLng: checkOut.lng,
      checkoutPrecision: checkOut.precision,
      checkoutDriveFileId: checkOut.driveFileId ?? null,
      checkoutDriveUrl: checkOut.driveWebViewLink ?? null,
      checkoutFotoHash: checkOut.fotoHash ?? null,
      checkoutUploadStatus: checkOut.uploadStatus ?? null,
      checkoutDevice: checkOut.deviceInfo ?? null,
      observaciones: checkOut.observaciones ?? null,
    })
    .where(and(eq(jornadas.id, jornadaId), eq(jornadas.estado, "abierta")))
    .returning({ id: jornadas.id });

  if (filas.length === 0) {
    throw new Error("La jornada ya fue cerrada o no existe");
  }

  return duracionMinutos;
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

export async function getJornada(jornadaId: string): Promise<Jornada | null> {
  const [row] = await getDb()
    .select()
    .from(jornadas)
    .where(eq(jornadas.id, jornadaId))
    .limit(1);
  return row ? aJornada(row) : null;
}

/** Jornada abierta del usuario en el día de hoy, o null. */
export async function getOpenJornada(usuarioId: string): Promise<Jornada | null> {
  const inicioDelDia = new Date();
  inicioDelDia.setHours(0, 0, 0, 0);

  const [row] = await getDb()
    .select()
    .from(jornadas)
    .where(
      and(
        eq(jornadas.usuarioId, usuarioId),
        eq(jornadas.estado, "abierta"),
        gte(jornadas.checkinTs, inicioDelDia),
      ),
    )
    .orderBy(desc(jornadas.checkinTs))
    .limit(1);

  return row ? aJornada(row) : null;
}

export async function getJornadasByUsuario(
  usuarioId: string,
  fromDate: string,
  toDate: string,
): Promise<Jornada[]> {
  const filas = await getDb()
    .select()
    .from(jornadas)
    .where(
      and(
        eq(jornadas.usuarioId, usuarioId),
        between(jornadas.checkinTs, new Date(fromDate), new Date(toDate)),
      ),
    )
    .orderBy(asc(jornadas.checkinTs));

  return filas.map(aJornada);
}

export async function getJornadasByUsuarioProyecto(
  usuarioId: string,
  proyectoId: string,
): Promise<Jornada[]> {
  const filas = await getDb()
    .select()
    .from(jornadas)
    .where(
      and(
        eq(jornadas.usuarioId, usuarioId),
        eq(jornadas.proyectoId, proyectoId),
        eq(jornadas.estado, "cerrada"),
      ),
    )
    .orderBy(desc(jornadas.checkinTs))
    .limit(LIMITE_HISTORIAL);

  return filas.map(aJornada);
}

export async function getJornadasHistorialByUsuario(usuarioId: string): Promise<Jornada[]> {
  const filas = await getDb()
    .select()
    .from(jornadas)
    .where(and(eq(jornadas.usuarioId, usuarioId), eq(jornadas.estado, "cerrada")))
    .orderBy(desc(jornadas.checkinTs))
    .limit(LIMITE_HISTORIAL);

  return filas.map(aJornada);
}
