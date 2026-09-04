import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { listOTDeAnio, responsablesActivosPorFolio } from "@/src/lib/ot";

/**
 * Listado de órdenes de trabajo de un año, con el responsable vigente de cada
 * una resuelto en una sola consulta extra.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.ot");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const anioParam = req.nextUrl.searchParams.get("anio");
  const anio = parseInt(anioParam ?? String(new Date().getFullYear()), 10);
  if (isNaN(anio)) {
    return NextResponse.json({ error: "Año inválido" }, { status: 400 });
  }

  try {
    const ordenes = await listOTDeAnio(anio);
    const responsables = await responsablesActivosPorFolio(ordenes.map((o) => o.folio));
    return NextResponse.json({
      ordenes: ordenes.map((o) => ({ ...o, responsable: responsables[o.folio] ?? null })),
    });
  } catch (err) {
    console.error("[erp/ot GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
