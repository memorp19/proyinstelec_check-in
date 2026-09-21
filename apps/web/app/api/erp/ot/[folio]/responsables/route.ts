import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseFolioOT } from "@/src/lib/folios";
import { agregarResponsable, getOT, listResponsables } from "@/src/lib/ot";
import { getUserByEmail } from "@/src/lib/users";

/**
 * Agrega un responsable a la OT (hasta tres activos).
 *
 * Va bajo `ot.reasignar` y no bajo `ot.crear`: designar al primero es parte del
 * alta comercial, pero mover el equipo a mitad del proyecto es una decisión de
 * operación.
 */
export async function POST(req: NextRequest, { params }: { params: { folio: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "ot.reasignar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const folio = params.folio.toUpperCase();
  if (!parseFolioOT(folio)) {
    return NextResponse.json({ error: "Folio de OT inválido" }, { status: 400 });
  }

  let body: { correo?: string; area?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const correo = body.correo?.trim().toLowerCase();
  if (!correo) {
    return NextResponse.json({ error: "Falta el correo del responsable" }, { status: 400 });
  }

  try {
    const ot = await getOT(folio);
    if (!ot) return NextResponse.json({ error: "OT no encontrada" }, { status: 404 });

    // Las iniciales son la llave con la que el ERP identifica personas: sin
    // ellas el responsable no cruza con nada (misma regla que el alta de OT).
    const usuario = await getUserByEmail(correo);
    if (!usuario) {
      return NextResponse.json(
        { error: "El responsable no existe en el catálogo de usuarios" },
        { status: 422 },
      );
    }
    if (!usuario.iniciales) {
      return NextResponse.json(
        {
          error: `${usuario.nombre} no tiene iniciales registradas; captúralas en Admin → Usuarios → ERP antes de asignarle una OT`,
        },
        { status: 422 },
      );
    }

    const responsable = await agregarResponsable({
      folioOt: folio,
      correo,
      area: body.area?.trim() || undefined,
      asignadoPor: session!.user.email ?? "",
    });
    return NextResponse.json({ responsable, responsables: await listResponsables(folio) }, {
      status: 201,
    });
  } catch (err) {
    const e = err as { message: string };
    // Tope de tres y persona repetida: son reglas de negocio, no fallos.
    if (e.message.includes("responsables activos") || e.message.includes("ya es responsable")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[erp/ot/[folio]/responsables POST]", err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
