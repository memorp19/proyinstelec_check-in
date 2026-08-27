import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { ingresarOrdenCompra } from "@/src/lib/cotizaciones-flujos";

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await getServerSession(authOptions);
  const rechazo = exigirPermiso(session?.user, "ot.crear");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: {
    ordenCompra?: string;
    responsableCorreo?: string;
    areas?: string[];
    adjunto?: { filename: string; mimeType: string; base64: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.ordenCompra?.trim() || !body.responsableCorreo || !Array.isArray(body.areas)) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: orden de compra, responsable y áreas" },
      { status: 400 },
    );
  }

  try {
    const { folioOt, avisos } = await ingresarOrdenCompra({
      numero: key.numero,
      anio: key.anio,
      ordenCompra: body.ordenCompra,
      responsableCorreo: body.responsableCorreo,
      areas: body.areas,
      adjunto: body.adjunto,
      usuario: session!.user.email ?? "",
    });
    return NextResponse.json({ folioOt, avisos }, { status: 201 });
  } catch (err) {
    const e = err as { name?: string; message: string };
    if (e.name === "ConditionalCheckFailedException") {
      return NextResponse.json({ error: "Esa OT ya existe" }, { status: 409 });
    }
    if (
      e.message.includes("Solo se puede") ||
      e.message.includes("obligatoria") ||
      e.message.includes("iniciales") ||
      e.message.includes("no existe") ||
      e.message.includes("al menos un")
    ) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    console.error("[erp/oc POST]", err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
