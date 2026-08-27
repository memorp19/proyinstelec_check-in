import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getDocClient } from "./dynamo-client";
import { folioCotizacion, pad } from "./folios";

const TABLE = () => process.env.MAIN_TABLE ?? "proyinstelec-main";

// ── Types ─────────────────────────────────────────────────────────────────────

export const ESTATUS_COTIZACION = [
  "PROCESO",
  "REVISION",
  "ENVIADA",
  "ASIGNADA",
  "DEPENDIENTE PROVEEDOR",
  "DEPENDIENTE CLIENTE",
  "CANCELADA",
] as const;
export type EstatusCotizacion = (typeof ESTATUS_COTIZACION)[number];

export const PRIORIDADES = ["BAJA", "MEDIA", "ALTA"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

/**
 * Cotización — un ítem por versión.
 *   pk = COT#<numero3>-<anio> · sk = V#<version2>
 * Solo la versión VIGENTE (la más alta) lleva gsi4pk/gsi4sk:
 *   gsi4pk = COT#<anio> · gsi4sk = <estatus>#<numero3>
 * (así el dashboard y el buscador cuentan "solo la última versión",
 *  la regla central del versionado del legacy — sin filas ocultas).
 */
export interface Cotizacion {
  pk: string;
  sk: string;
  numero: number;
  anio: number;
  version: number;
  folio: string; // PCOTOP-NNN-AAAA[-v]
  cliente: string; // razón social
  cliente_id?: string;
  titulo: string;
  dirigida_a: string;
  prioridad: Prioridad;
  estatus: EstatusCotizacion;
  elaboro: string; // iniciales o nombre
  fecha_solicitud: string; // ISO
  fecha_entrega?: string; // compromiso (el legacy la mezclaba con fecha de envío; aquí separadas)
  fecha_envio?: string; // fecha real de envío al cliente
  orden_compra?: string;
  folio_ot?: string;
  drive_folder_id?: string;
  drive_folder_url?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  gsi4pk?: string;
  gsi4sk?: string;
}

export interface Aprobacion {
  pk: string;
  sk: string; // APROBACION#V<version2>
  numero: number;
  anio: number;
  version: number;
  aprobado_por: string;
  fecha: string;
}

// ── Llaves ────────────────────────────────────────────────────────────────────

export function cotPk(numero: number, anio: number): string {
  return `COT#${pad(numero, 3)}-${anio}`;
}

function versionSk(version: number): string {
  return `V#${pad(version, 2)}`;
}

function gsi4DeVigente(c: Pick<Cotizacion, "anio" | "estatus" | "numero">) {
  return { gsi4pk: `COT#${c.anio}`, gsi4sk: `${c.estatus}#${pad(c.numero, 3)}` };
}

/** "001-2026" → { numero, anio } (llave de las rutas API). */
export function parseCotKey(key: string): { numero: number; anio: number } | null {
  const m = key.trim().match(/^(\d{1,3})-(\d{4})$/);
  if (!m) return null;
  return { numero: parseInt(m[1], 10), anio: parseInt(m[2], 10) };
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Todas las versiones de una cotización, la más reciente primero. */
export async function getVersiones(numero: number, anio: number): Promise<Cotizacion[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :v)",
      ExpressionAttributeValues: { ":pk": cotPk(numero, anio), ":v": "V#" },
      ScanIndexForward: false,
    }),
  );
  return (result.Items ?? []) as Cotizacion[];
}

/** La versión vigente (más alta) o null si el número no existe. */
export async function getVigente(numero: number, anio: number): Promise<Cotizacion | null> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :v)",
      ExpressionAttributeValues: { ":pk": cotPk(numero, anio), ":v": "V#" },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  return ((result.Items?.[0] as Cotizacion) ?? null);
}

/** Versiones vigentes de un año (una por número), vía GSI4. */
export async function listVigentesDeAnio(anio: number): Promise<Cotizacion[]> {
  const items: Cotizacion[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await getDocClient().send(
      new QueryCommand({
        TableName: TABLE(),
        IndexName: "gsi4-coleccion",
        KeyConditionExpression: "gsi4pk = :pk",
        ExpressionAttributeValues: { ":pk": `COT#${anio}` },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as Cotizacion[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items.sort((a, b) => b.numero - a.numero);
}

/** Siguiente número sugerido para el año (max + 1). */
export async function siguienteNumeroCotizacion(anio: number): Promise<number> {
  const vigentes = await listVigentesDeAnio(anio);
  const max = vigentes.reduce((m, c) => Math.max(m, c.numero), 0);
  return max + 1;
}

// ── Búsqueda (los 8 filtros del legacy) ───────────────────────────────────────

export interface FiltrosCotizacion {
  anio: number;
  empresa?: string; // contains
  numero?: string; // contains
  elaboro?: string; // exact
  dirigidaA?: string; // contains
  estatus?: EstatusCotizacion; // exact
  mesEntrega?: number; // 1-12, sobre fecha_entrega
  ot?: string; // contains
  oc?: string; // contains
}

export async function buscarCotizaciones(
  filtros: FiltrosCotizacion,
): Promise<Array<Cotizacion & { aprobada: boolean }>> {
  const vigentes = await listVigentesDeAnio(filtros.anio);
  const contiene = (campo: string | undefined, valor: string) =>
    (campo ?? "").toLowerCase().includes(valor.toLowerCase());

  const filtradas = vigentes.filter((c) => {
    if (filtros.empresa && !contiene(c.cliente, filtros.empresa)) return false;
    if (filtros.numero && !pad(c.numero, 3).includes(filtros.numero.replace(/\D/g, ""))) return false;
    if (filtros.elaboro && c.elaboro.toLowerCase() !== filtros.elaboro.toLowerCase()) return false;
    if (filtros.dirigidaA && !contiene(c.dirigida_a, filtros.dirigidaA)) return false;
    if (filtros.estatus && c.estatus !== filtros.estatus) return false;
    if (filtros.mesEntrega) {
      if (!c.fecha_entrega) return false;
      const mes = parseInt(c.fecha_entrega.slice(5, 7), 10);
      if (mes !== filtros.mesEntrega) return false;
    }
    if (filtros.ot && !contiene(c.folio_ot, filtros.ot)) return false;
    if (filtros.oc && !contiene(c.orden_compra, filtros.oc)) return false;
    return true;
  });

  // Flag de aprobación por versión exacta (1 lectura por resultado; volumen bajo)
  const conAprobacion = await Promise.all(
    filtradas.map(async (c) => ({
      ...c,
      aprobada: await tieneAprobacion(c.numero, c.anio, c.version),
    })),
  );
  return conAprobacion;
}

// ── Alta y versiones ──────────────────────────────────────────────────────────

export async function createCotizacion(params: {
  numero: number;
  anio: number;
  cliente: string;
  clienteId?: string;
  titulo: string;
  dirigidaA: string;
  prioridad?: Prioridad;
  elaboro: string;
  fechaEntrega?: string;
  createdBy: string;
}): Promise<Cotizacion> {
  const now = new Date().toISOString();
  const item: Cotizacion = {
    pk: cotPk(params.numero, params.anio),
    sk: versionSk(0),
    numero: params.numero,
    anio: params.anio,
    version: 0,
    folio: folioCotizacion(params.numero, params.anio, 0),
    cliente: params.cliente.trim(),
    cliente_id: params.clienteId,
    titulo: params.titulo.trim(),
    dirigida_a: params.dirigidaA.trim(),
    prioridad: params.prioridad ?? "MEDIA",
    estatus: "PROCESO",
    elaboro: params.elaboro.trim(),
    fecha_solicitud: now,
    fecha_entrega: params.fechaEntrega,
    created_by: params.createdBy,
    created_at: now,
    updated_at: now,
    ...gsi4DeVigente({ anio: params.anio, estatus: "PROCESO", numero: params.numero }),
  };

  await getDocClient().send(
    new PutCommand({
      TableName: TABLE(),
      Item: item,
      // El número no debe existir (la validación de duplicado del legacy, atómica)
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  );
  return item;
}

/**
 * Nueva versión: hereda datos de la vigente, estatus PROCESO, limpia
 * fecha de entrega/OC/OT, y mueve las llaves GSI4 a la versión nueva
 * (la anterior deja de contar en dashboards — el "ocultar filas" del legacy).
 */
export async function crearNuevaVersion(params: {
  numero: number;
  anio: number;
  prioridad?: Prioridad;
  elaboro?: string;
  createdBy: string;
}): Promise<Cotizacion> {
  const vigente = await getVigente(params.numero, params.anio);
  if (!vigente) throw new Error(`La cotización ${pad(params.numero, 3)}-${params.anio} no existe`);

  const version = vigente.version + 1;
  const now = new Date().toISOString();
  const item: Cotizacion = {
    ...vigente,
    sk: versionSk(version),
    version,
    folio: folioCotizacion(params.numero, params.anio, version),
    estatus: "PROCESO",
    prioridad: params.prioridad ?? vigente.prioridad,
    elaboro: params.elaboro?.trim() || vigente.elaboro,
    fecha_solicitud: now,
    fecha_entrega: undefined,
    fecha_envio: undefined,
    orden_compra: undefined,
    folio_ot: undefined,
    created_by: params.createdBy,
    created_at: now,
    updated_at: now,
    ...gsi4DeVigente({ anio: params.anio, estatus: "PROCESO", numero: params.numero }),
  };

  await getDocClient().send(
    new PutCommand({ TableName: TABLE(), Item: item, ConditionExpression: "attribute_not_exists(pk) OR attribute_not_exists(sk)" }),
  );

  // La versión anterior deja de ser vigente: se le quitan las llaves GSI4
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: vigente.pk, sk: vigente.sk },
      UpdateExpression: "REMOVE gsi4pk, gsi4sk SET updated_at = :ua",
      ExpressionAttributeValues: { ":ua": now },
    }),
  );

  return item;
}

// ── Edición y transiciones ────────────────────────────────────────────────────

/**
 * Actualiza campos de la versión vigente. El cambio de estatus pasa por
 * cambiarEstatus() (que mantiene GSI4 y las reglas de aprobación).
 */
export async function updateCotizacion(
  numero: number,
  anio: number,
  data: {
    titulo?: string;
    dirigidaA?: string;
    prioridad?: Prioridad;
    elaboro?: string;
    fechaEntrega?: string | null;
    ordenCompra?: string;
    folioOt?: string;
    fechaEnvio?: string;
    driveFolderId?: string;
    driveFolderUrl?: string;
    clienteId?: string;
  },
): Promise<void> {
  const vigente = await getVigente(numero, anio);
  if (!vigente) throw new Error("Cotización no encontrada");

  const sets: string[] = ["updated_at = :ua"];
  const values: Record<string, unknown> = { ":ua": new Date().toISOString() };
  const names: Record<string, string> = {};
  const removes: string[] = [];

  const set = (attr: string, val: unknown) => {
    names[`#${attr}`] = attr;
    sets.push(`#${attr} = :${attr}`);
    values[`:${attr}`] = val;
  };

  if (data.titulo !== undefined) set("titulo", data.titulo.trim());
  if (data.dirigidaA !== undefined) set("dirigida_a", data.dirigidaA.trim());
  if (data.prioridad !== undefined) set("prioridad", data.prioridad);
  if (data.elaboro !== undefined) set("elaboro", data.elaboro.trim());
  if (data.fechaEntrega !== undefined) {
    if (data.fechaEntrega) set("fecha_entrega", data.fechaEntrega);
    else removes.push("fecha_entrega");
  }
  if (data.ordenCompra !== undefined) set("orden_compra", data.ordenCompra.trim());
  if (data.folioOt !== undefined) set("folio_ot", data.folioOt);
  if (data.fechaEnvio !== undefined) set("fecha_envio", data.fechaEnvio);
  if (data.driveFolderId !== undefined) set("drive_folder_id", data.driveFolderId);
  if (data.driveFolderUrl !== undefined) set("drive_folder_url", data.driveFolderUrl);
  if (data.clienteId !== undefined) set("cliente_id", data.clienteId);

  let expr = `SET ${sets.join(", ")}`;
  if (removes.length > 0) expr += ` REMOVE ${removes.join(", ")}`;

  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: vigente.pk, sk: vigente.sk },
      UpdateExpression: expr,
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
    }),
  );
}

/** Transiciones permitidas (reglas del legacy). */
export function transicionValida(de: EstatusCotizacion, a: EstatusCotizacion): boolean {
  if (de === a) return false;
  const mapa: Record<EstatusCotizacion, EstatusCotizacion[]> = {
    PROCESO: ["REVISION", "DEPENDIENTE PROVEEDOR", "DEPENDIENTE CLIENTE", "CANCELADA"],
    REVISION: ["PROCESO", "ENVIADA", "CANCELADA"], // PROCESO = corrección; ENVIADA requiere aprobación
    ENVIADA: ["ASIGNADA", "CANCELADA"],
    ASIGNADA: ["CANCELADA"],
    "DEPENDIENTE PROVEEDOR": ["PROCESO", "REVISION", "CANCELADA"],
    "DEPENDIENTE CLIENTE": ["PROCESO", "REVISION", "CANCELADA"],
    CANCELADA: [],
  };
  return mapa[de].includes(a);
}

/**
 * Cambia el estatus de la versión vigente manteniendo GSI4 en sincronía.
 * Al REENTRAR a REVISION invalida la aprobación previa de esa versión
 * (nuevo ciclo de revisión, regla del legacy).
 */
export async function cambiarEstatus(
  numero: number,
  anio: number,
  nuevo: EstatusCotizacion,
): Promise<Cotizacion> {
  const vigente = await getVigente(numero, anio);
  if (!vigente) throw new Error("Cotización no encontrada");
  if (!transicionValida(vigente.estatus, nuevo)) {
    throw new Error(`Transición no permitida: ${vigente.estatus} → ${nuevo}`);
  }

  const { gsi4pk, gsi4sk } = gsi4DeVigente({ anio, estatus: nuevo, numero });
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: vigente.pk, sk: vigente.sk },
      UpdateExpression: "SET estatus = :e, gsi4pk = :g4p, gsi4sk = :g4s, updated_at = :ua",
      ExpressionAttributeValues: {
        ":e": nuevo,
        ":g4p": gsi4pk,
        ":g4s": gsi4sk,
        ":ua": new Date().toISOString(),
      },
    }),
  );

  if (nuevo === "REVISION") {
    await eliminarAprobacion(numero, anio, vigente.version);
  }

  return { ...vigente, estatus: nuevo, gsi4pk, gsi4sk };
}

// ── Aprobaciones (por versión exacta, fuera del estatus — legacy) ─────────────

export async function registrarAprobacion(params: {
  numero: number;
  anio: number;
  version: number;
  aprobadoPor: string;
}): Promise<Aprobacion> {
  const item: Aprobacion = {
    pk: cotPk(params.numero, params.anio),
    sk: `APROBACION#${versionSk(params.version)}`,
    numero: params.numero,
    anio: params.anio,
    version: params.version,
    aprobado_por: params.aprobadoPor,
    fecha: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}

export async function tieneAprobacion(
  numero: number,
  anio: number,
  version: number,
): Promise<boolean> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: TABLE(),
      Key: { pk: cotPk(numero, anio), sk: `APROBACION#${versionSk(version)}` },
    }),
  );
  return result.Item != null;
}

export async function eliminarAprobacion(
  numero: number,
  anio: number,
  version: number,
): Promise<void> {
  await getDocClient().send(
    new DeleteCommand({
      TableName: TABLE(),
      Key: { pk: cotPk(numero, anio), sk: `APROBACION#${versionSk(version)}` },
    }),
  );
}

/**
 * ¿Puede enviarse al cliente? (validación del legacy)
 * PROCESO → no; REVISION sin aprobación → no;
 * REVISION aprobada / ENVIADA / ASIGNADA → sí (incluye reenvíos).
 */
export async function puedeEnviarseAlCliente(
  numero: number,
  anio: number,
): Promise<{ puede: boolean; motivo?: string; cotizacion: Cotizacion | null }> {
  const c = await getVigente(numero, anio);
  if (!c) return { puede: false, motivo: "No existe", cotizacion: null };
  if (c.estatus === "ENVIADA" || c.estatus === "ASIGNADA") return { puede: true, cotizacion: c };
  if (c.estatus !== "REVISION") {
    return { puede: false, motivo: `La cotización está en ${c.estatus}; debe pasar por revisión`, cotizacion: c };
  }
  const aprobada = await tieneAprobacion(numero, anio, c.version);
  if (!aprobada) {
    return { puede: false, motivo: "Esperando aprobación del revisor", cotizacion: c };
  }
  return { puede: true, cotizacion: c };
}
