import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient } from "./dynamo-client";

const TABLE = () => process.env.INVITACIONES_TABLE ?? "proyinstelec-invitaciones";

export interface Invitacion {
  token: string;
  proyectoId: string;
  creadoPor: string;
  nombreSugerido: string;
  estado: "pendiente" | "usado" | "expirado";
  expiresAt: number; // Unix timestamp (used as DynamoDB TTL)
  usadaPor?: string;
}

export type TokenValidationResult =
  | { valid: true; invitacion: Invitacion }
  | { valid: false; reason: "not_found" | "expired" | "already_used" };

export async function validateToken(token: string): Promise<TokenValidationResult> {
  const result = await getDocClient().send(
    new GetCommand({ TableName: TABLE(), Key: { token } }),
  );

  if (!result.Item) {
    return { valid: false, reason: "not_found" };
  }

  const inv = result.Item as Invitacion;

  // DynamoDB TTL deletion is eventual; check expiry in application layer too
  if (inv.expiresAt < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "expired" };
  }

  if (inv.estado === "usado") {
    return { valid: false, reason: "already_used" };
  }

  return { valid: true, invitacion: inv };
}

/**
 * Marks a token as used and records which google_sub consumed it.
 * Called atomically after the onboarding form is submitted.
 */
export async function consumeToken(token: string, googleSub: string): Promise<void> {
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { token },
      UpdateExpression: "SET estado = :usado, usadaPor = :sub",
      // Guard: only mark used if still pending (prevents double-use race)
      ConditionExpression: "estado = :pendiente",
      ExpressionAttributeValues: {
        ":usado": "usado",
        ":pendiente": "pendiente",
        ":sub": googleSub,
      },
    }),
  );
}
