import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { buscarCotizaciones } from "@/src/lib/cotizaciones";

/** Bandeja de revisión: cotizaciones en REVISION del año (permiso cotizaciones.aprobar). */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const rechazo = exigirPermiso(session?.user, "cotizaciones.aprobar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const anio = parseInt(
    req.nextUrl.searchParams.get("anio") ?? String(new Date().getFullYear()),
    10,
  );

  try {
    const enRevision = await buscarCotizaciones({ anio, estatus: "REVISION" });
    return NextResponse.json({ cotizaciones: enRevision });
  } catch (err) {
    console.error("[erp/revision GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
