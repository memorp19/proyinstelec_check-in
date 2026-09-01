import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { createProyecto, listProyectos, getEmpresa } from "@/src/lib/proyectos";
import { createEmpresaProyectoFolder } from "@/src/lib/drive";
import { DEMO_MODE } from "@/src/demo";

function requireAdmin(rol: string) {
  return rol === "admin";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !requireAdmin(session.user.rol)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const empresa_id = new URL(req.url).searchParams.get("empresa_id") ?? undefined;
  const proyectos = await listProyectos(empresa_id);
  return NextResponse.json({ proyectos });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !requireAdmin(session.user.rol)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { empresa_id: string; nombre: string; descripcion?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { empresa_id, nombre, descripcion } = body;
  if (!empresa_id) return NextResponse.json({ error: "empresa_id es requerido" }, { status: 422 });
  const nombreTrimmed = nombre?.trim();
  if (!nombreTrimmed) return NextResponse.json({ error: "El nombre es requerido" }, { status: 422 });

  const empresa = await getEmpresa(empresa_id);
  if (!empresa) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  // Create Google Drive folder (skip in demo mode)
  let drive_folder_id: string | undefined;
  let drive_folder_url: string | undefined;

  if (!DEMO_MODE) {
    try {
      const folder = await createEmpresaProyectoFolder({
        empresaNombre: empresa.nombre,
        proyectoNombre: nombreTrimmed,
      });
      drive_folder_id = folder.folderId;
      drive_folder_url = folder.folderUrl;
    } catch (err) {
      console.error("[admin/proyectos] Drive folder creation failed:", err);
      // Continue without Drive folder — can be retried later
    }
  }

  const proyecto = await createProyecto({
    empresa_id,
    empresa_nombre: empresa.nombre,
    nombre: nombreTrimmed,
    descripcion: descripcion?.trim(),
    drive_folder_id,
    drive_folder_url,
  });

  return NextResponse.json({ proyecto }, { status: 201 });
}
