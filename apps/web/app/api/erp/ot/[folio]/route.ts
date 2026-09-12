import { NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseFolioOT } from "@/src/lib/folios";
import { getOT, listResponsables } from "@/src/lib/ot";

/** Ficha de una OT: datos, historial de responsables y cotización que la originó. */
export async function GET(_req: Request, { params }: { params: { folio: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.ot");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const folio = params.folio.toUpperCase();
  if (!parseFolioOT(folio)) {
    return NextResponse.json({ error: "Folio de OT inválido" }, { status: 400 });
  }

  try {
    const ot = await getOT(folio);
    if (!ot) return NextResponse.json({ error: "OT no encontrada" }, { status: 404 });

    const responsables = await listResponsables(folio);
    return NextResponse.json({
      ot,
      responsables,
      // Llave con la que la pantalla de cotizaciones ubica el origen
      cotizacion: { numero: ot.numero_cotizacion, anio: ot.anio, version: ot.version },
    });
  } catch (err) {
    console.error("[erp/ot/[folio] GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
