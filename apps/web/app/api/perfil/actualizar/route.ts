import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { updatePerfil } from "@/src/lib/users";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let body: { nickname?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { nickname } = body;

  if ("nickname" in body) {
    const trimmed = typeof nickname === "string" ? nickname.trim() : null;
    if (trimmed !== null && trimmed.length > 30) {
      return NextResponse.json({ error: "El nickname no puede superar 30 caracteres" }, { status: 422 });
    }
    await updatePerfil(session.user.id!, { nickname: trimmed || null });
  }

  return NextResponse.json({ ok: true });
}
