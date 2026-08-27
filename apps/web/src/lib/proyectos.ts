import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { getDocClient } from "./dynamo-client";

const TABLE = () => process.env.MAIN_TABLE ?? "proyinstelec-main";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Empresa {
  empresa_id: string;
  nombre: string;
  created_at: string;
  updated_at: string;
  // Single-table keys
  pk: string; // EMPRESA#{empresa_id}
  sk: string; // #METADATA
}

export interface Proyecto {
  proyecto_id: string;
  empresa_id: string;
  empresa_nombre: string; // denormalized for display
  nombre: string;
  descripcion?: string;
  estado: "activo" | "terminado";
  drive_folder_id?: string;
  drive_folder_url?: string;
  usuarios_asignados: string[]; // google_sub array
  created_at: string;
  updated_at: string;
  // Single-table keys
  pk: string; // PROYECTO#{proyecto_id}
  sk: string; // #METADATA
}

// ── Empresa CRUD ──────────────────────────────────────────────────────────────

export async function createEmpresa(nombre: string): Promise<Empresa> {
  const empresa_id = uuidv4();
  const now = new Date().toISOString();
  const item: Empresa = {
    empresa_id,
    nombre,
    created_at: now,
    updated_at: now,
    pk: `EMPRESA#${empresa_id}`,
    sk: "#METADATA",
  };
  await getDocClient().send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}

export async function listEmpresas(): Promise<Empresa[]> {
  const result = await getDocClient().send(
    new ScanCommand({
      TableName: TABLE(),
      FilterExpression: "begins_with(pk, :prefix)",
      ExpressionAttributeValues: { ":prefix": "EMPRESA#" },
    }),
  );
  return ((result.Items ?? []) as Empresa[]).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es"),
  );
}

export async function getEmpresa(empresa_id: string): Promise<Empresa | null> {
  const result = await getDocClient().send(
    new GetCommand({ TableName: TABLE(), Key: { pk: `EMPRESA#${empresa_id}`, sk: "#METADATA" } }),
  );
  return (result.Item as Empresa) ?? null;
}

// ── Proyecto CRUD ─────────────────────────────────────────────────────────────

export async function createProyecto(params: {
  empresa_id: string;
  empresa_nombre: string;
  nombre: string;
  descripcion?: string;
  drive_folder_id?: string;
  drive_folder_url?: string;
}): Promise<Proyecto> {
  const proyecto_id = uuidv4();
  const now = new Date().toISOString();
  const item: Proyecto = {
    proyecto_id,
    empresa_id: params.empresa_id,
    empresa_nombre: params.empresa_nombre,
    nombre: params.nombre,
    descripcion: params.descripcion,
    estado: "activo",
    drive_folder_id: params.drive_folder_id,
    drive_folder_url: params.drive_folder_url,
    usuarios_asignados: [],
    created_at: now,
    updated_at: now,
    pk: `PROYECTO#${proyecto_id}`,
    sk: "#METADATA",
  };
  await getDocClient().send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}

export async function listProyectos(empresa_id?: string): Promise<Proyecto[]> {
  const result = await getDocClient().send(
    new ScanCommand({
      TableName: TABLE(),
      FilterExpression: empresa_id
        ? "begins_with(pk, :prefix) AND empresa_id = :eid"
        : "begins_with(pk, :prefix)",
      ExpressionAttributeValues: empresa_id
        ? { ":prefix": "PROYECTO#", ":eid": empresa_id }
        : { ":prefix": "PROYECTO#" },
    }),
  );
  return ((result.Items ?? []) as Proyecto[]).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es"),
  );
}

export async function getProyecto(proyecto_id: string): Promise<Proyecto | null> {
  const result = await getDocClient().send(
    new GetCommand({ TableName: TABLE(), Key: { pk: `PROYECTO#${proyecto_id}`, sk: "#METADATA" } }),
  );
  return (result.Item as Proyecto) ?? null;
}

export async function asignarUsuario(proyecto_id: string, google_sub: string): Promise<void> {
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: `PROYECTO#${proyecto_id}`, sk: "#METADATA" },
      UpdateExpression:
        "SET usuarios_asignados = list_append(if_not_exists(usuarios_asignados, :empty), :user), updated_at = :ua",
      ConditionExpression: "not contains(usuarios_asignados, :sub)",
      ExpressionAttributeValues: {
        ":user": [google_sub],
        ":sub": google_sub,
        ":empty": [],
        ":ua": new Date().toISOString(),
      },
    }),
  );
}

export async function desasignarUsuario(proyecto_id: string, google_sub: string): Promise<void> {
  // DynamoDB doesn't support removing a specific list element by value in one operation.
  // Fetch the current list and re-write without the target.
  const proyecto = await getProyecto(proyecto_id);
  if (!proyecto) return;
  const updated = proyecto.usuarios_asignados.filter((s) => s !== google_sub);
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: `PROYECTO#${proyecto_id}`, sk: "#METADATA" },
      UpdateExpression: "SET usuarios_asignados = :list, updated_at = :ua",
      ExpressionAttributeValues: { ":list": updated, ":ua": new Date().toISOString() },
    }),
  );
}

export async function updateProyectoEstado(
  proyecto_id: string,
  estado: "activo" | "terminado",
): Promise<void> {
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: `PROYECTO#${proyecto_id}`, sk: "#METADATA" },
      UpdateExpression: "SET estado = :e, updated_at = :ua",
      ExpressionAttributeValues: { ":e": estado, ":ua": new Date().toISOString() },
    }),
  );
}

// ── GSI query: proyectos by empresa (uses gsi1 if configured) ─────────────────
// Falls back to listProyectos(empresa_id) which does a filtered scan.
export async function listProyectosByEmpresa(empresa_id: string): Promise<Proyecto[]> {
  return listProyectos(empresa_id);
}
