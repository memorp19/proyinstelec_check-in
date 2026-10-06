import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseFolioOT } from "@/src/lib/folios";
import {
  cambiarEstatusOT,
  esEstatusOT,
  getOT,
  listResponsables,
  ESTATUS_OT,
} from "@/src/lib/ot";

/** Ficha de una OT: datos, historial de responsables y cotización que la originó. */
export async function GET(_req: Request, { params }: { params: { folio: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.ot");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const folio = params.folio.toUpperCase();
  if (!parseFolioOT(folio)) {
    return NextResponse.json({ error: "Folio de OT inválido" }, { status: 400 });
  }

  try {
    const ot = await getOT(folio);
    if (!ot) return NextResponse.json({ error: "OT no encontrada" }, { status: 404 });

    const responsables = await listResponsables(folio);
    return NextResponse.json({
      ot,
      responsables,
      // Llave con la que la pantalla de cotizaciones ubica el origen
      cotizacion: { numero: ot.numero_cotizacion, anio: ot.anio, version: ot.version },
    });
  } catch (err) {
    console.error("[erp/ot/[folio] GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Mueve el estatus de la OT: "" → Asignado → En Ejecución → Cerrado.
 *
 * Bajo `ot.reasignar` por el mismo motivo que los responsables: avanzar una OT
 * es una decisión de operación, no del alta comercial.
 */
export async function PATCH(req: NextRequest, { params }: { params: { folio: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "ot.reasignar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const folio = params.folio.toUpperCase();
  if (!parseFolioOT(folio)) {
    return NextResponse.json({ error: "Folio de OT inválido" }, { status: 400 });
  }

  let body: { estatus?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  // `estatus` puede ser "" (el estado inicial), así que no vale con `!body.estatus`.
  if (typeof body.estatus !== "string" || !esEstatusOT(body.estatus)) {
    return NextResponse.json(
      { error: `Estatus inválido. Los válidos son: ${ESTATUS_OT.filter(Boolean).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const ot = await cambiarEstatusOT(folio, body.estatus);
    return NextResponse.json({ ot });
  } catch (err) {
    const e = err as { message: string };
    if (e.message.includes("no existe")) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    // Transición inválida o carrera con otro cambio: son reglas, no fallos.
    if (e.message.includes("Transición no permitida") || e.message.includes("mientras se guardaba")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[erp/ot/[folio] PATCH]", err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
