import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { getDocClient } from "./dynamo-client";

const TABLE = () => process.env.MAIN_TABLE ?? "proyinstelec-main";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Bitácora del ERP (heredada del legacy): auditoría de acciones, registro de
 * correos enviados/omitidos y memoria de avisos de vencimiento.
 *
 * Ítems: pk = BITACORA#YYYY-MM · sk = <timestamp ISO>#<uuid corto>
 * Consulta natural: por mes, orden cronológico.
 * `referencia` permite filtrar por entidad (p. ej. "COT#001-2026", "ACT-0007|-3").
 */
export interface EventoBitacora {
  pk: string;
  sk: string;
  accion: string;      // p. ej. COTIZACION_CREADA, CORREO_ENVIADO, AVISO_VENCIMIENTO
  usuario: string;     // correo o "sistema"
  detalle?: string;
  referencia?: string; // llave de la entidad afectada
  timestamp: string;
}

// ── Write ─────────────────────────────────────────────────────────────────────

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
  const timestamp = new Date().toISOString();
  const item: EventoBitacora = {
    pk: `BITACORA#${timestamp.slice(0, 7)}`,
    sk: `${timestamp}#${randomUUID().slice(0, 8)}`,
    accion: evento.accion,
    usuario: evento.usuario,
    detalle: evento.detalle,
    referencia: evento.referencia,
    timestamp,
  };
  try {
    await getDocClient().send(new PutCommand({ TableName: TABLE(), Item: item }));
  } catch (err) {
    console.error("[bitacora]", (err as Error).message);
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Eventos de un mes (YYYY-MM), más recientes primero.
 */
export async function listarBitacora(
  mes: string,
  opts?: { accion?: string; referencia?: string; limit?: number },
): Promise<EventoBitacora[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `BITACORA#${mes}` },
      ScanIndexForward: false,
      Limit: opts?.limit ?? 500,
    }),
  );
  let items = (result.Items ?? []) as EventoBitacora[];
  if (opts?.accion) items = items.filter((e) => e.accion === opts.accion);
  if (opts?.referencia) items = items.filter((e) => e.referencia === opts.referencia);
  return items;
}

/**
 * ¿Existe ya un evento con esta acción y referencia en los últimos `meses`?
 * Usado como memoria de avisos ("ACT-0007|-3 ya se mandó, no repetir").
 */
export async function existeEvento(
  accion: string,
  referencia: string,
  meses = 2,
): Promise<boolean> {
  const ahora = new Date();
  for (let i = 0; i < meses; i++) {
    const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - i, 1));
    const mes = d.toISOString().slice(0, 7);
    const eventos = await listarBitacora(mes, { accion, referencia, limit: 1000 });
    if (eventos.length > 0) return true;
  }
  return false;
}
