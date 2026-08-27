import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { enviarARevision } from "@/src/lib/cotizaciones-flujos";

export async function POST(_req: NextRequest, { params }: { params: { key: string } }) {
  const session = await getServerSession(authOptions);
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  try {
    const { cotizacion, avisos } = await enviarARevision({
      numero: key.numero,
      anio: key.anio,
      usuario: session!.user.email ?? "",
    });
    return NextResponse.json({ cotizacion, avisos });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Transición no permitida")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error("[erp/revision POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
