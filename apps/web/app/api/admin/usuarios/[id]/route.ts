import { NextRequest, NextResponse } from "next/server";
import { auth, isSuperAdmin } from "@/src/auth";
import { updateUserRol, updateUserErp, getUserById, listUsers, classifyEmail } from "@/src/lib/users";
import { esPermisoValido, esInicialesValidas } from "@/src/lib/permisos";
import { DEMO_MODE } from "@/src/demo";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.es_super_admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const usuarioId = params.id;

  // Cannot modify the superAdmin account
  if (DEMO_MODE) {
    return NextResponse.json({ ok: true }); // optimistic in demo
  }

  const target = await getUserById(usuarioId);
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  // Protect the superAdmin email from being demoted
  if (isSuperAdmin(target.email)) {
    return NextResponse.json({ error: "No se puede modificar al Super Admin" }, { status: 403 });
  }

  let body: {
    accion: "promover" | "revocar" | "actualizar_erp";
    permisos?: string[];
    iniciales?: string | null;
    gerencia?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (body.accion === "actualizar_erp") {
    // Permisos: solo llaves del catálogo
    if (body.permisos !== undefined) {
      if (!Array.isArray(body.permisos) || body.permisos.some((p) => !esPermisoValido(p))) {
        return NextResponse.json({ error: "Permisos inválidos" }, { status: 422 });
      }
    }
    // Iniciales: formato 2-5 mayúsculas y únicas entre usuarios
    let iniciales = body.iniciales;
    if (typeof iniciales === "string" && iniciales !== "") {
      iniciales = iniciales.toUpperCase().trim();
      if (!esInicialesValidas(iniciales)) {
        return NextResponse.json(
          { error: "Iniciales inválidas: 2 a 5 letras mayúsculas" },
          { status: 422 },
        );
      }
      const existentes = await listUsers();
      const choque = existentes.find(
        (u) => u.iniciales === iniciales && u.id !== usuarioId,
      );
      if (choque) {
        return NextResponse.json(
          { error: `Las iniciales ${iniciales} ya pertenecen a ${choque.nombre}` },
          { status: 409 },
        );
      }
    }
    await updateUserErp(usuarioId, {
      permisos: body.permisos,
      iniciales: "iniciales" in body ? (iniciales as string | null) : undefined,
      gerencia: "gerencia" in body ? body.gerencia : undefined,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.accion === "promover") {
    await updateUserRol(usuarioId, "admin", "admin");
  } else if (body.accion === "revocar") {
    const tipo = classifyEmail(target.email) === "planta" ? "planta" : "temporal";
    await updateUserRol(usuarioId, "campo", tipo);
  } else {
    return NextResponse.json({ error: "accion inválida" }, { status: 422 });
  }

  return NextResponse.json({ ok: true });
}
