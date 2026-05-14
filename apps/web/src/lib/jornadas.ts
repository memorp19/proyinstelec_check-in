import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { getDocClient } from "./dynamo-client";
import type { DeviceInfo } from "./device-info";

const TABLE = () => process.env.MAIN_TABLE ?? "proyinstelec-main";

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
  deviceInfo: DeviceInfo;
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
  // Single-table keys
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

// ── Write operations ──────────────────────────────────────────────────────────

export async function createJornada(params: {
  usuarioId: string;
  proyectoId: string;
  tipo: "planta" | "temporal";
  checkIn: CheckPoint;
}): Promise<Jornada> {
  const id = uuidv4();
  const ts = params.checkIn.timestamp;

  const item: Jornada = {
    id,
    usuarioId: params.usuarioId,
    proyectoId: params.proyectoId,
    tipo: params.tipo,
    checkIn: params.checkIn,
    estado: "abierta",
    pk: `JORNADA#${id}`,
    sk: "#METADATA",
    gsi1pk: params.proyectoId,
    gsi1sk: ts,
    gsi2pk: params.usuarioId,
    gsi2sk: ts,
  };

  await getDocClient().send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}

export async function closeJornada(
  jornadaId: string,
  checkOut: CheckPoint & { observaciones?: string },
  checkInTimestamp: string,
): Promise<number> {
  const checkInDate = new Date(checkInTimestamp);
  const checkOutDate = new Date(checkOut.timestamp);
  const duracionMinutos = Math.round(
    (checkOutDate.getTime() - checkInDate.getTime()) / 60_000,
  );

  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: `JORNADA#${jornadaId}`, sk: "#METADATA" },
      UpdateExpression:
        "SET checkOut = :co, duracionMinutos = :dur, estado = :e",
      ConditionExpression: "estado = :abierta",
      ExpressionAttributeValues: {
        ":co": checkOut,
        ":dur": duracionMinutos,
        ":e": "cerrada",
        ":abierta": "abierta",
      },
    }),
  );

  return duracionMinutos;
}

// ── Read operations ───────────────────────────────────────────────────────────

export async function getJornada(jornadaId: string): Promise<Jornada | null> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: TABLE(),
      Key: { pk: `JORNADA#${jornadaId}`, sk: "#METADATA" },
    }),
  );
  return (result.Item as Jornada) ?? null;
}

/** Returns the open jornada for a user today, or null if none. */
export async function getOpenJornada(usuarioId: string): Promise<Jornada | null> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "gsi2-usuario-ts",
      KeyConditionExpression:
        "gsi2pk = :uid AND gsi2sk >= :today",
      FilterExpression: "estado = :abierta",
      ExpressionAttributeValues: {
        ":uid": usuarioId,
        ":today": todayStart.toISOString(),
        ":abierta": "abierta",
      },
      Limit: 1,
    }),
  );

  return (result.Items?.[0] as Jornada) ?? null;
}

export async function getJornadasByUsuario(
  usuarioId: string,
  fromDate: string,
  toDate: string,
): Promise<Jornada[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "gsi2-usuario-ts",
      KeyConditionExpression: "gsi2pk = :uid AND gsi2sk BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":uid": usuarioId,
        ":from": fromDate,
        ":to": toDate,
      },
    }),
  );
  return (result.Items ?? []) as Jornada[];
}
