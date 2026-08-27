import { DeleteCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { getDocClient } from "./dynamo-client";

const TABLE = () => process.env.MAIN_TABLE ?? "proyinstelec-main";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Clientes del ERP (empresas a las que se cotiza) y sus contactos.
 * Distintos de las "empresas" del módulo de campo (proyectos.ts).
 *
 * Ítems: CLIENTE#<id> / #METADATA  (empresa)
 *        CLIENTE#<id> / CONTACTO#<id>
 */
export interface ClienteEmpresa {
  pk: string;
  sk: "#METADATA";
  cliente_id: string;
  razon_social: string;
  /** Razón social normalizada (sin sufijos legales) para anti-duplicados y match */
  razon_normalizada: string;
  direccion?: string;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface Contacto {
  pk: string;
  sk: string;
  contacto_id: string;
  cliente_id: string;
  nombre: string;
  puesto?: string;
  telefono?: string;
  correo?: string;
  created_at: string;
  updated_at: string;
}

// ── Normalización (reglas del ERP legacy) ─────────────────────────────────────

const SUFIJOS_LEGALES =
  /\b(s\.?\s?a\.?\s?p\.?\s?i\.?|s\.?\s?a\.?\s?b?\.?|de\s+c\.?\s?v\.?|s\.?\s+de\s+r\.?\s?l\.?|s\.?\s?c\.?|a\.?\s?c\.?|s\.?\s?r\.?\s?l\.?)\b/gi;

/**
 * Normaliza una razón social: minúsculas, sin acentos, sin sufijos legales
 * (S.A. de C.V., S. de R.L., etc.), sin puntuación ni espacios dobles.
 */
export function normalizarRazonSocial(razon: string): string {
  return razon
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SUFIJOS_LEGALES, " ")
    .replace(/[.,;:()\-&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Títulos personales que se quitan al comparar nombres de contacto (legacy). */
const TITULOS = /^(lic|ing|arq|c\.?p|dr|dra|mtro|mtra|sr|sra|srita)\.?\s+/i;

export function normalizarNombreContacto(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(TITULOS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match de empresa por razón social normalizada.
 * "exacta" reutiliza automáticamente; "parcial" (contains bidireccional)
 * requiere confirmación del usuario (regla del legacy).
 */
export function compararRazones(a: string, b: string): "exacta" | "parcial" | "ninguna" {
  const na = normalizarRazonSocial(a);
  const nb = normalizarRazonSocial(b);
  if (!na || !nb) return "ninguna";
  if (na === nb) return "exacta";
  if (na.includes(nb) || nb.includes(na)) return "parcial";
  return "ninguna";
}

// ── Empresas ──────────────────────────────────────────────────────────────────

export async function listClientes(): Promise<ClienteEmpresa[]> {
  const result = await getDocClient().send(
    new ScanCommand({
      TableName: TABLE(),
      FilterExpression: "begins_with(pk, :p) AND sk = :meta",
      ExpressionAttributeValues: { ":p": "CLIENTE#", ":meta": "#METADATA" },
    }),
  );
  return ((result.Items ?? []) as ClienteEmpresa[]).sort((a, b) =>
    a.razon_social.localeCompare(b.razon_social, "es"),
  );
}

/**
 * Busca empresas cuyo nombre coincide exacta o parcialmente con `razon`.
 * Para el flujo de alta con verificación de duplicados.
 */
export async function buscarEmpresasParecidas(
  razon: string,
): Promise<Array<{ empresa: ClienteEmpresa; match: "exacta" | "parcial" }>> {
  const todas = await listClientes();
  const resultados: Array<{ empresa: ClienteEmpresa; match: "exacta" | "parcial" }> = [];
  for (const e of todas) {
    const match = compararRazones(razon, e.razon_social);
    if (match !== "ninguna") resultados.push({ empresa: e, match });
  }
  return resultados.sort((a) => (a.match === "exacta" ? -1 : 1));
}

export async function createClienteEmpresa(params: {
  razonSocial: string;
  direccion?: string;
  createdBy: string;
}): Promise<ClienteEmpresa> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const item: ClienteEmpresa = {
    pk: `CLIENTE#${id}`,
    sk: "#METADATA",
    cliente_id: id,
    razon_social: params.razonSocial.trim(),
    razon_normalizada: normalizarRazonSocial(params.razonSocial),
    direccion: params.direccion?.trim() || undefined,
    created_at: now,
    created_by: params.createdBy,
    updated_at: now,
  };
  await getDocClient().send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}

export async function getClienteEmpresa(clienteId: string): Promise<ClienteEmpresa | null> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: { ":pk": `CLIENTE#${clienteId}`, ":sk": "#METADATA" },
    }),
  );
  return ((result.Items?.[0] as ClienteEmpresa) ?? null);
}

// ── Contactos ─────────────────────────────────────────────────────────────────

export async function listContactos(clienteId: string): Promise<Contacto[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :c)",
      ExpressionAttributeValues: { ":pk": `CLIENTE#${clienteId}`, ":c": "CONTACTO#" },
    }),
  );
  return ((result.Items ?? []) as Contacto[]).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es"),
  );
}

export async function createContacto(params: {
  clienteId: string;
  nombre: string;
  puesto?: string;
  telefono?: string;
  correo?: string;
}): Promise<Contacto> {
  // Anti-duplicado empresa+contacto (regla del legacy)
  const existentes = await listContactos(params.clienteId);
  const nombreNorm = normalizarNombreContacto(params.nombre);
  if (existentes.some((c) => normalizarNombreContacto(c.nombre) === nombreNorm)) {
    throw new Error(`El contacto "${params.nombre}" ya existe en esta empresa`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const item: Contacto = {
    pk: `CLIENTE#${params.clienteId}`,
    sk: `CONTACTO#${id}`,
    contacto_id: id,
    cliente_id: params.clienteId,
    nombre: params.nombre.trim(),
    puesto: params.puesto?.trim() || undefined,
    telefono: params.telefono?.trim() || undefined,
    correo: params.correo?.trim().toLowerCase() || undefined,
    created_at: now,
    updated_at: now,
  };
  await getDocClient().send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}

/** Solo puesto/teléfono/correo son editables (regla del legacy). */
export async function updateContacto(
  clienteId: string,
  contactoId: string,
  data: { puesto?: string | null; telefono?: string | null; correo?: string | null },
): Promise<void> {
  const sets: string[] = ["updated_at = :ua"];
  const values: Record<string, unknown> = { ":ua": new Date().toISOString() };
  const removes: string[] = [];

  const campos: Array<[keyof typeof data, string]> = [
    ["puesto", "puesto"],
    ["telefono", "telefono"],
    ["correo", "correo"],
  ];
  for (const [key, attr] of campos) {
    if (data[key] !== undefined) {
      if (data[key]) {
        sets.push(`${attr} = :${attr}`);
        values[`:${attr}`] =
          key === "correo" ? String(data[key]).trim().toLowerCase() : String(data[key]).trim();
      } else {
        removes.push(attr);
      }
    }
  }

  let expr = `SET ${sets.join(", ")}`;
  if (removes.length > 0) expr += ` REMOVE ${removes.join(", ")}`;

  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: `CLIENTE#${clienteId}`, sk: `CONTACTO#${contactoId}` },
      UpdateExpression: expr,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteContacto(clienteId: string, contactoId: string): Promise<void> {
  await getDocClient().send(
    new DeleteCommand({
      TableName: TABLE(),
      Key: { pk: `CLIENTE#${clienteId}`, sk: `CONTACTO#${contactoId}` },
    }),
  );
}

// ── Match para el envío de cotizaciones ───────────────────────────────────────

/**
 * Localiza la empresa de una cotización por razón social (match del legacy)
 * y sugiere el contacto que corresponde a "Dirigida a".
 */
export async function contactosParaEnvio(params: {
  razonSocial: string;
  dirigidaA?: string;
}): Promise<{
  empresa: ClienteEmpresa | null;
  contactos: Contacto[];
  sugeridoId: string | null;
}> {
  const parecidas = await buscarEmpresasParecidas(params.razonSocial);
  const empresa = parecidas[0]?.empresa ?? null;
  if (!empresa) return { empresa: null, contactos: [], sugeridoId: null };

  const contactos = (await listContactos(empresa.cliente_id)).filter((c) => c.correo);

  let sugeridoId: string | null = null;
  if (params.dirigidaA) {
    const objetivo = normalizarNombreContacto(params.dirigidaA);
    // exacto → parcial → por palabra (>2 letras), como el legacy
    const exacto = contactos.find((c) => normalizarNombreContacto(c.nombre) === objetivo);
    const parcial =
      exacto ??
      contactos.find((c) => {
        const n = normalizarNombreContacto(c.nombre);
        return n.includes(objetivo) || objetivo.includes(n);
      });
    const porPalabra =
      parcial ??
      contactos.find((c) => {
        const palabras = normalizarNombreContacto(c.nombre).split(" ");
        return objetivo.split(" ").some((p) => p.length > 2 && palabras.includes(p));
      });
    sugeridoId = porPalabra?.contacto_id ?? null;
  }

  return { empresa, contactos, sugeridoId };
}
