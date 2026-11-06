import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { catalogoVigente } from "@/src/lib/cotizador-db";

/**
 * El catálogo de servicios para el buscador del cotizador.
 *
 * Son 87 renglones: se mandan todos y la pantalla filtra. Un buscador que va
 * al servidor en cada tecla se siente lento justo donde más se teclea, y el
 * catálogo cabe de sobra en una respuesta.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  try {
    const servicios = await catalogoVigente();
    return NextResponse.json({ servicios: servicios.filter((s) => s.activo) });
  } catch (err) {
    console.error("[erp/catalogo-servicios GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
