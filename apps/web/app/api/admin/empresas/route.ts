import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { createEmpresa, listEmpresas } from "@/src/lib/proyectos";

function requireAdmin(rol: string) {
  return rol === "admin";
}

export async function GET() {
  const session = await auth();
  if (!session || !requireAdmin(session.user.rol)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const empresas = await listEmpresas();
  return NextResponse.json({ empresas });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !requireAdmin(session.user.rol)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { nombre: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const nombre = body.nombre?.trim();
  if (!nombre) return NextResponse.json({ error: "El nombre es requerido" }, { status: 422 });

  const empresa = await createEmpresa(nombre);
  return NextResponse.json({ empresa }, { status: 201 });
}
