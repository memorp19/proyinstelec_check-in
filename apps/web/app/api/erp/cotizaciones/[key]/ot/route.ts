import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { generarOTSinOrdenCompra } from "@/src/lib/cotizaciones-flujos";

/**
 * Genera la OT de una cotización aceptada sin orden de compra. La vía con OC
 * es POST .../oc; ambas terminan en la misma OT y en el mismo bloqueo de "una
 * cotización, una OT".
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "ot.crear");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: { responsableCorreo?: string; areas?: string[]; version?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // `version` llega del cliente: un valor basura entraría a la consulta y el
  // fallo saldría como 500. Se valida aquí; ausente = la vigente, como antes.
  if (
    body.version !== undefined &&
    (!Number.isInteger(body.version) || body.version < 0)
  ) {
    return NextResponse.json(
      { error: "La versión debe ser un entero mayor o igual a 0" },
      { status: 400 },
    );
  }

  if (!body.responsableCorreo || !Array.isArray(body.areas)) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: responsable y áreas" },
      { status: 400 },
    );
  }

  try {
    const { folioOt, avisos } = await generarOTSinOrdenCompra({
      numero: key.numero,
      anio: key.anio,
      version: body.version,
      responsableCorreo: body.responsableCorreo,
      areas: body.areas,
      usuario: session!.user.email ?? "",
    });
    return NextResponse.json({ folioOt, avisos }, { status: 201 });
  } catch (err) {
    const e = err as { message: string };
    if (e.message.includes("ya existe") || e.message.includes("ya tiene la OT")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (
      e.message.includes("Solo se puede") ||
      e.message.includes("iniciales") ||
      e.message.includes("no existe") ||
      e.message.includes("no tiene versión") ||
      e.message.includes("al menos un")
    ) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    console.error("[erp/ot POST]", err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
