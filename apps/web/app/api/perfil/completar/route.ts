import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { markProfileComplete } from "@/src/lib/users";
import { consumeToken, validateToken } from "@/src/lib/invitaciones";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (session.user.perfil_completo) {
    return NextResponse.json({ error: "El perfil ya está completo" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const {
    nombre,
    telefono,
    id_oficial,
    contacto_emergencia,
    pending_token,
  } = body as Record<string, unknown>;

  if (
    typeof nombre !== "string" || !nombre.trim() ||
    typeof telefono !== "string" || !telefono.trim() ||
    typeof id_oficial !== "string" || !id_oficial.trim() ||
    typeof contacto_emergencia !== "object" ||
    contacto_emergencia === null ||
    typeof (contacto_emergencia as Record<string, unknown>).nombre !== "string" ||
    typeof (contacto_emergencia as Record<string, unknown>).telefono !== "string"
  ) {
    return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
  }

  const ce = contacto_emergencia as { nombre: string; telefono: string };

  // If a token was provided, validate it before writing anything
  if (pending_token !== undefined) {
    if (typeof pending_token !== "string") {
      return NextResponse.json({ error: "Token inválido" }, { status: 400 });
    }
    const validation = await validateToken(pending_token);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "El token de invitación no es válido o ya fue utilizado." },
        { status: 400 },
      );
    }
  }

  await markProfileComplete(session.user.id, {
    nombre: nombre.trim(),
    telefono: telefono.trim(),
    id_oficial: id_oficial.trim(),
    contacto_emergencia: { nombre: ce.nombre.trim(), telefono: ce.telefono.trim() },
    terminos_aceptados_at: new Date().toISOString(),
  });

  if (typeof pending_token === "string") {
    // consumeToken uses a ConditionExpression so a race condition won't double-consume
    try {
      await consumeToken(pending_token, session.user.id);
    } catch {
      // Token already consumed by a concurrent request — profile is saved, ignore
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
