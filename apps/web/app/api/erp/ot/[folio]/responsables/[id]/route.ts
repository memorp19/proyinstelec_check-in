import { NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseFolioOT } from "@/src/lib/folios";
import { desactivarResponsable, listResponsables } from "@/src/lib/ot";

/**
 * Da de baja a un responsable de la OT. No borra: la fila queda como historial
 * (regla del legacy) y su slot se libera para otra persona.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { folio: string; id: string } },
) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "ot.reasignar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const folio = params.folio.toUpperCase();
  if (!parseFolioOT(folio)) {
    return NextResponse.json({ error: "Folio de OT inválido" }, { status: 400 });
  }

  try {
    // El id es único, pero se comprueba que pertenezca a esta OT: sin esto la
    // ruta dejaría dar de baja a un responsable de otra orden desde esta URL.
    const responsables = await listResponsables(folio);
    const objetivo = responsables.find((r) => r.id === params.id);
    if (!objetivo) {
      return NextResponse.json({ error: "Ese responsable no es de esta OT" }, { status: 404 });
    }

    await desactivarResponsable(params.id);
    return NextResponse.json({ responsables: await listResponsables(folio) });
  } catch (err) {
    const e = err as { message: string };
    if (e.message.includes("no existe o ya estaba inactivo")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[erp/ot/[folio]/responsables/[id] DELETE]", err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
