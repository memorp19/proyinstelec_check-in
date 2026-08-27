import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { datosParaEnvio, enviarAlCliente } from "@/src/lib/cotizaciones-flujos";

export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  const session = await getServerSession(authOptions);
  const rechazo = exigirPermiso(session?.user, "cotizaciones.enviar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  try {
    const datos = await datosParaEnvio({
      numero: key.numero,
      anio: key.anio,
      remitente: session!.user.email ?? "",
    });
    return NextResponse.json(datos);
  } catch (err) {
    console.error("[erp/enviar GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await getServerSession(authOptions);
  const rechazo = exigirPermiso(session?.user, "cotizaciones.enviar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: { destinatarios?: string[]; asunto?: string; mensajeHtml?: string; telefonoFirma?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!Array.isArray(body.destinatarios) || body.destinatarios.length === 0) {
    return NextResponse.json({ error: "Selecciona al menos un destinatario" }, { status: 400 });
  }

  try {
    const { cotizacion } = await enviarAlCliente({
      numero: key.numero,
      anio: key.anio,
      destinatarios: body.destinatarios,
      asunto: body.asunto,
      mensajeHtml: body.mensajeHtml,
      telefonoFirma: body.telefonoFirma,
      remitente: {
        email: session!.user.email ?? "",
        nombre: session!.user.name ?? session!.user.email ?? "",
      },
    });
    return NextResponse.json({ cotizacion });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("PDF") || msg.includes("no puede enviarse") || msg.includes("aprobación")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error("[erp/enviar POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
