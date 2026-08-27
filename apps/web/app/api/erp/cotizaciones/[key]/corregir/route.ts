import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { solicitarCorreccion } from "@/src/lib/cotizaciones-flujos";

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "cotizaciones.aprobar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: { comentario?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.comentario?.trim()) {
    return NextResponse.json({ error: "El comentario es obligatorio" }, { status: 400 });
  }

  try {
    const cotizacion = await solicitarCorreccion({
      numero: key.numero,
      anio: key.anio,
      comentario: body.comentario,
      usuario: session!.user.email ?? "",
    });
    return NextResponse.json({ cotizacion });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("al menos 10") || msg.includes("ya no está en revisión")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error("[erp/corregir POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
