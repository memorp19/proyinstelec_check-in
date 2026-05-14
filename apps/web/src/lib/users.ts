import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient } from "./dynamo-client";

const TABLE = () => process.env.USERS_TABLE ?? "proyinstelec-users";

export interface UserProfile {
  google_sub: string;
  email: string;
  nombre: string;
  foto_url?: string;
  tipo: "planta" | "temporal" | "admin" | "cliente";
  rol: "campo" | "admin" | "cliente";
  odoo_sync: boolean;
  perfil_completo: boolean;
  proyectos_asignados: string[];
  telefono?: string;
  id_oficial?: string;
  contacto_emergencia?: { nombre: string; telefono: string };
  terminos_aceptados_at?: string;
  created_at: string;
  updated_at: string;
}

export async function getUserByEmail(email: string): Promise<UserProfile | null> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "email-index",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: { ":email": email },
      Limit: 1,
    }),
  );
  const items = result.Items as UserProfile[] | undefined;
  return items?.[0] ?? null;
}

export async function deleteUser(googleSub: string): Promise<void> {
  await getDocClient().send(
    new DeleteCommand({ TableName: TABLE(), Key: { google_sub: googleSub } }),
  );
}

export async function getUserByGoogleSub(
  googleSub: string,
): Promise<UserProfile | null> {
  const result = await getDocClient().send(
    new GetCommand({ TableName: TABLE(), Key: { google_sub: googleSub } }),
  );
  return (result.Item as UserProfile) ?? null;
}

/**
 * Creates or fully replaces a user record.
 * Used on first login of a planta worker.
 */
export async function upsertUser(profile: UserProfile): Promise<void> {
  await getDocClient().send(
    new PutCommand({ TableName: TABLE(), Item: profile }),
  );
}

/**
 * Marks a temporal worker's profile as complete after onboarding form submission.
 */
export async function markProfileComplete(
  googleSub: string,
  data: {
    nombre: string;
    telefono: string;
    id_oficial: string;
    contacto_emergencia: { nombre: string; telefono: string };
    terminos_aceptados_at: string;
  },
): Promise<void> {
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { google_sub: googleSub },
      UpdateExpression:
        "SET perfil_completo = :t, nombre = :n, telefono = :tel, " +
        "id_oficial = :id, contacto_emergencia = :ce, " +
        "terminos_aceptados_at = :ts, updated_at = :ua",
      ExpressionAttributeValues: {
        ":t": true,
        ":n": data.nombre,
        ":tel": data.telefono,
        ":id": data.id_oficial,
        ":ce": data.contacto_emergencia,
        ":ts": data.terminos_aceptados_at,
        ":ua": new Date().toISOString(),
      },
    }),
  );
}

/**
 * Derives the initial user profile from a Google OAuth payload.
 * planta workers (@proyinstelec.mx) get odoo_sync: true and perfil_completo: true.
 * temporal workers need to complete the onboarding form first.
 */
export function buildInitialProfile(params: {
  googleSub: string;
  email: string;
  nombre: string;
  fotoUrl?: string;
  tipo: "planta" | "temporal";
}): UserProfile {
  const isPlanta = params.tipo === "planta";
  const now = new Date().toISOString();
  return {
    google_sub: params.googleSub,
    email: params.email,
    nombre: params.nombre,
    foto_url: params.fotoUrl,
    tipo: params.tipo,
    rol: "campo",
    odoo_sync: isPlanta,
    perfil_completo: isPlanta, // temporales must fill the onboarding form
    proyectos_asignados: [],
    created_at: now,
    updated_at: now,
  };
}

/**
 * Classifies an email as planta or temporal based on domain.
 */
export function classifyEmail(email: string): "planta" | "temporal" {
  return email.toLowerCase().endsWith("@proyinstelec.mx") ? "planta" : "temporal";
}
