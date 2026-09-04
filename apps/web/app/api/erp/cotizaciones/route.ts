import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import {
  buscarCotizaciones,
  siguienteNumeroCotizacion,
  ESTATUS_COTIZACION,
  type EstatusCotizacion,
  type Prioridad,
} from "@/src/lib/cotizaciones";
import { crearCotizacionCompleta } from "@/src/lib/cotizaciones-flujos";

export async function GET(req: NextRequest) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const q = req.nextUrl.searchParams;
  const anio = parseInt(q.get("anio") ?? String(new Date().getFullYear()), 10);

  try {
    if (q.get("siguiente") === "1") {
      const numero = await siguienteNumeroCotizacion(anio);
      return NextResponse.json({ numero, anio });
    }

    const estatusParam = q.get("estatus") ?? undefined;
    const estatus = ESTATUS_COTIZACION.includes(estatusParam as EstatusCotizacion)
      ? (estatusParam as EstatusCotizacion)
      : undefined;

    const resultados = await buscarCotizaciones({
      anio,
      empresa: q.get("empresa") ?? undefined,
      numero: q.get("numero") ?? undefined,
      elaboro: q.get("elaboro") ?? undefined,
      dirigidaA: q.get("dirigidaA") ?? undefined,
      estatus,
      mesEntrega: q.get("mesEntrega") ? parseInt(q.get("mesEntrega")!, 10) : undefined,
      ot: q.get("ot") ?? undefined,
      oc: q.get("oc") ?? undefined,
    });
    return NextResponse.json({ cotizaciones: resultados });
  } catch (err) {
    console.error("[erp/cotizaciones GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  let body: {
    numero?: number;
    anio?: number;
    cliente?: string;
    clienteId?: string;
    titulo?: string;
    dirigidaA?: string;
    prioridad?: Prioridad;
    elaboro?: string;
    fechaEntrega?: string;
    montoMxn?: string | number | null;
    montoUsd?: string | number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { numero, anio, cliente, titulo, dirigidaA, elaboro } = body;
  if (!numero || !anio || !cliente?.trim() || !titulo?.trim() || !dirigidaA?.trim() || !elaboro?.trim()) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: número, año, cliente, título, dirigida a, elaboró" },
      { status: 400 },
    );
  }

  try {
    const { cotizacion, avisos } = await crearCotizacionCompleta({
      numero,
      anio,
      cliente,
      clienteId: body.clienteId,
      titulo,
      dirigidaA,
      prioridad: body.prioridad,
      elaboro,
      fechaEntrega: body.fechaEntrega,
      montoMxn: body.montoMxn,
      montoUsd: body.montoUsd,
      createdBy: session!.user.email ?? "",
    });
    return NextResponse.json({ cotizacion, avisos }, { status: 201 });
  } catch (err) {
    const e = err as { message: string };
    // El choque de número duplicado lo detecta la llave primaria de la tabla
    if (e.message.includes("ya existe")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e.message.includes("Monto") || e.message.includes("monto")) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    console.error("[erp/cotizaciones POST]", err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
