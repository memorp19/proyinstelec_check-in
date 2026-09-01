import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { bitacora } from "../db/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Bitácora del ERP (heredada del legacy): auditoría de acciones, registro de
 * correos enviados/omitidos y memoria de avisos de vencimiento.
 *
 * `referencia` identifica la entidad afectada (p. ej. "COT#001-2026",
 * "ACT-0007|-3") y es la llave con la que `existeEvento` recuerda qué avisos
 * ya salieron.
 */
export interface EventoBitacora {
  id: string;
  accion: string;      // p. ej. COTIZACION_CREADA, CORREO_ENVIADO, AVISO_VENCIMIENTO
  usuario: string;     // correo o "sistema"
  detalle?: string;
  referencia?: string;
  created_at: string;  // ISO
}

type Fila = typeof bitacora.$inferSelect;

function aEvento(fila: Fila): EventoBitacora {
  return {
    id: fila.id,
    accion: fila.accion,
    usuario: fila.usuario,
    detalle: fila.detalle ?? undefined,
    referencia: fila.referencia ?? undefined,
    created_at: fila.createdAt.toISOString(),
  };
}

/** "2026-08" → [inicio, finExclusivo) en UTC. */
function rangoDelMes(mes: string): { inicio: Date; fin: Date } {
  const [anio, m] = mes.split("-").map((v) => parseInt(v, 10));
  const inicio = new Date(Date.UTC(anio, m - 1, 1));
  const fin = new Date(Date.UTC(anio, m, 1));
  return { inicio, fin };
}

// ── Escritura ─────────────────────────────────────────────────────────────────

/**
 * Registra un evento. Nunca lanza: la bitácora jamás interrumpe la operación
 * principal (regla del legacy).
 */
export async function registrarBitacora(evento: {
  accion: string;
  usuario: string;
  detalle?: string;
  referencia?: string;
}): Promise<void> {
  try {
    await getDb().insert(bitacora).values({
      accion: evento.accion,
      usuario: evento.usuario,
      detalle: evento.detalle ?? null,
      referencia: evento.referencia ?? null,
    });
  } catch (err) {
    console.error("[bitacora]", (err as Error).message);
  }
}

// ── Lectura ───────────────────────────────────────────────────────────────────

/** Eventos de un mes ("AAAA-MM"), más recientes primero. */
export async function listarBitacora(
  mes: string,
  opts?: { accion?: string; referencia?: string; limit?: number },
): Promise<EventoBitacora[]> {
  const { inicio, fin } = rangoDelMes(mes);
  const condiciones: SQL[] = [gte(bitacora.createdAt, inicio), lt(bitacora.createdAt, fin)];
  if (opts?.accion) condiciones.push(eq(bitacora.accion, opts.accion));
  if (opts?.referencia) condiciones.push(eq(bitacora.referencia, opts.referencia));

  const filas = await getDb()
    .select()
    .from(bitacora)
    .where(and(...condiciones))
    .orderBy(desc(bitacora.createdAt))
    .limit(opts?.limit ?? 500);
  return filas.map(aEvento);
}

/**
 * ¿Existe ya un evento con esta acción y referencia en los últimos `meses`?
 * Memoria de avisos ("ACT-0007|-3 ya se mandó, no repetir").
 */
export async function existeEvento(
  accion: string,
  referencia: string,
  meses = 2,
): Promise<boolean> {
  const ahora = new Date();
  const desdeFecha = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - (meses - 1), 1),
  );
  const filas = await getDb()
    .select({ id: bitacora.id })
    .from(bitacora)
    .where(
      and(
        eq(bitacora.accion, accion),
        eq(bitacora.referencia, referencia),
        gte(bitacora.createdAt, desdeFecha),
      ),
    )
    .limit(1);
  return filas.length > 0;
}
