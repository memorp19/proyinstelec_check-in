import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { invitaciones } from "../db/schema";

/**
 * Invitaciones a proyecto: un token de un solo uso que un admin comparte con un
 * trabajador temporal. El token se consume al terminar el alta de perfil.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Invitacion {
  token: string;
  proyectoId: string;
  creadoPor: string;
  nombreSugerido?: string;
  estado: "pendiente" | "usado" | "expirado";
  expiresAt: Date;
  usadaPor?: string;
  createdAt: Date;
}

export type TokenValidationResult =
  | { valid: true; invitacion: Invitacion }
  | { valid: false; reason: "not_found" | "expired" | "already_used" };

type Row = typeof invitaciones.$inferSelect;

function aInvitacion(row: Row): Invitacion {
  return {
    token: row.token,
    proyectoId: row.proyectoId,
    creadoPor: row.creadoPor,
    nombreSugerido: row.nombreSugerido ?? undefined,
    estado: row.estado,
    expiresAt: row.expiresAt,
    usadaPor: row.usadaPor ?? undefined,
    createdAt: row.createdAt,
  };
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

export async function validateToken(token: string): Promise<TokenValidationResult> {
  const [row] = await getDb()
    .select()
    .from(invitaciones)
    .where(eq(invitaciones.token, token))
    .limit(1);

  if (!row) return { valid: false, reason: "not_found" };

  const inv = aInvitacion(row);

  // La vigencia manda sobre el estado: un token vencido nunca sirve, aunque
  // nadie haya corrido todavía la limpieza que lo marca como "expirado".
  if (inv.expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: "expired" };
  }

  if (inv.estado !== "pendiente") {
    return { valid: false, reason: "already_used" };
  }

  return { valid: true, invitacion: inv };
}

export async function getInvitacion(token: string): Promise<Invitacion | null> {
  const [row] = await getDb()
    .select()
    .from(invitaciones)
    .where(eq(invitaciones.token, token))
    .limit(1);
  return row ? aInvitacion(row) : null;
}

// ── Escrituras ────────────────────────────────────────────────────────────────

export async function crearInvitacion(params: {
  proyectoId: string;
  creadoPor: string;
  nombreSugerido?: string;
  diasVigencia?: number;
}): Promise<Invitacion> {
  const dias = params.diasVigencia ?? 7;
  const expiresAt = new Date(Date.now() + dias * 86_400_000);

  const [row] = await getDb()
    .insert(invitaciones)
    .values({
      token: crypto.randomUUID(),
      proyectoId: params.proyectoId,
      creadoPor: params.creadoPor,
      nombreSugerido: params.nombreSugerido ?? null,
      expiresAt,
    })
    .returning();

  return aInvitacion(row);
}

/**
 * Marca el token como usado y registra qué usuario lo consumió.
 *
 * El UPDATE filtra por `estado = 'pendiente'`, así que dos peticiones
 * simultáneas sólo pueden ganar una: la perdedora no recibe fila y lanza.
 */
export async function consumeToken(token: string, usuarioId: string): Promise<void> {
  const filas = await getDb()
    .update(invitaciones)
    .set({ estado: "usado", usadaPor: usuarioId })
    .where(and(eq(invitaciones.token, token), eq(invitaciones.estado, "pendiente")))
    .returning({ token: invitaciones.token });

  if (filas.length === 0) {
    throw new Error("La invitación ya fue utilizada o no está vigente");
  }
}
