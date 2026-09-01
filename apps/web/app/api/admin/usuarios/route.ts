import { NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { listUsers } from "@/src/lib/users";
import { DEMO_MODE, DEMO_USERS } from "@/src/demo";

export async function GET() {
  const session = await auth();
  if (!session?.user?.es_super_admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  if (DEMO_MODE) {
    return NextResponse.json({ usuarios: DEMO_USERS });
  }

  const usuarios = await listUsers();
  return NextResponse.json({ usuarios });
}
