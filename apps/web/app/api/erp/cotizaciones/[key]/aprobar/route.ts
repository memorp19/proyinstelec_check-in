import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { aprobarCotizacion } from "@/src/lib/cotizaciones-flujos";

export async function POST(_req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "cotizaciones.aprobar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  try {
    const cotizacion = await aprobarCotizacion({
      numero: key.numero,
      anio: key.anio,
      aprobadoPor: session!.user.email ?? "",
    });
    return NextResponse.json({ cotizacion });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("ya no está en revisión")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error("[erp/aprobar POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
