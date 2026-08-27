import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient } from "./dynamo-client";
import { folioOT } from "./folios";

const TABLE = () => process.env.MAIN_TABLE ?? "proyinstelec-main";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Orden de Trabajo (Fase 1: alta desde el ingreso de OC; la ficha completa,
 * control operativo y servicios llegan en la Fase 2).
 *
 * Ítems: OT#<folio> / #METADATA  ·  OT#<folio> / RESP#<ts>
 * GSI4:  gsi4pk = OT#<anio> · gsi4sk = <folio>
 */
export interface OrdenTrabajo {
  pk: string;
  sk: "#METADATA";
  folio: string; // OT001260
  numero_cotizacion: number;
  anio: number;
  version: number;
  orden_compra: string;
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
  gsi4pk: string;
  gsi4sk: string;
}

export interface ResponsableOT {
  pk: string;
  sk: string; // RESP#<ts>
  folio_ot: string;
  correo: string;
  rol: string; // "Responsable de la actividad"
  area?: string;
  asignado_por: string;
  fecha: string;
  activo: boolean;
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

export async function getOT(folio: string): Promise<OrdenTrabajo | null> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: { ":pk": `OT#${folio}`, ":sk": "#METADATA" },
    }),
  );
  return ((result.Items?.[0] as OrdenTrabajo) ?? null);
}

export async function listOTDeAnio(anio: number): Promise<OrdenTrabajo[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "gsi4-coleccion",
      KeyConditionExpression: "gsi4pk = :pk",
      ExpressionAttributeValues: { ":pk": `OT#${anio}` },
      ScanIndexForward: false,
    }),
  );
  return (result.Items ?? []) as OrdenTrabajo[];
}

export async function listResponsables(folio: string): Promise<ResponsableOT[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :r)",
      ExpressionAttributeValues: { ":pk": `OT#${folio}`, ":r": "RESP#" },
      ScanIndexForward: false,
    }),
  );
  return (result.Items ?? []) as ResponsableOT[];
}

// ── Alta (desde el ingreso de OC) ─────────────────────────────────────────────

export async function createOT(params: {
  numeroCotizacion: number;
  anio: number;
  version: number;
  ordenCompra: string;
  cliente: string;
  titulo: string;
  dirigidaA?: string;
  areas: string[];
  createdBy: string;
}): Promise<OrdenTrabajo> {
  const folio = folioOT(params.numeroCotizacion, params.anio, params.version);
  const now = new Date().toISOString();
  const item: OrdenTrabajo = {
    pk: `OT#${folio}`,
    sk: "#METADATA",
    folio,
    numero_cotizacion: params.numeroCotizacion,
    anio: params.anio,
    version: params.version,
    orden_compra: params.ordenCompra.trim(),
    cliente: params.cliente,
    titulo: params.titulo,
    dirigida_a: params.dirigidaA,
    estatus: "PROCESO",
    areas: params.areas,
    tiene_control_operativo: false,
    created_by: params.createdBy,
    created_at: now,
    updated_at: now,
    gsi4pk: `OT#${params.anio}`,
    gsi4sk: folio,
  };
  await getDocClient().send(
    new PutCommand({
      TableName: TABLE(),
      Item: item,
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  );
  return item;
}

/**
 * Registra al responsable de la actividad. El anterior (si existe) pasa a
 * inactivo pero se conserva como historial (regla del legacy).
 */
export async function registrarResponsable(params: {
  folioOt: string;
  correo: string;
  area?: string;
  asignadoPor: string;
}): Promise<ResponsableOT> {
  const previos = await listResponsables(params.folioOt);
  const now = new Date().toISOString();

  // Desactivar responsables activos previos (historial)
  for (const prev of previos.filter((r) => r.activo)) {
    await getDocClient().send(
      new PutCommand({ TableName: TABLE(), Item: { ...prev, activo: false } }),
    );
  }

  const item: ResponsableOT = {
    pk: `OT#${params.folioOt}`,
    sk: `RESP#${now}`,
    folio_ot: params.folioOt,
    correo: params.correo.toLowerCase(),
    rol: "Responsable de la actividad",
    area: params.area,
    asignado_por: params.asignadoPor,
    fecha: now,
    activo: true,
  };
  await getDocClient().send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}
