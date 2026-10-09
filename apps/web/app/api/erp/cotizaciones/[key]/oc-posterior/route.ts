import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import {
  modificarOcPosterior,
  MOTIVO_MINIMO,
  registrarOcPosterior,
} from "@/src/lib/cotizaciones-flujos";

/**
 * Registra la orden de compra de una cotización que ya está ASIGNADA y ya tiene
 * su OT.
 *
 * Ruta aparte de `/oc` a propósito: aquella crea la OT y exige responsable y
 * áreas. Aquí la OT ya existe y lo único que falta es el número de la orden de
 * compra, que el cliente emitió semanas después de autorizar el trabajo.
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "ot.crear");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: { ordenCompra?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (typeof body.ordenCompra !== "string" || body.ordenCompra.trim() === "") {
    return NextResponse.json({ error: "La orden de compra es obligatoria" }, { status: 400 });
  }

  try {
    const resultado = await registrarOcPosterior({
      numero: key.numero,
      anio: key.anio,
      ordenCompra: body.ordenCompra,
      usuario: session!.user.email ?? "",
    });
    return NextResponse.json(resultado);
  } catch (err) {
    const msg = (err as Error).message;
    // Ya tenía OC: no se pisa en silencio una orden de compra registrada.
    if (msg.includes("ya tiene la orden de compra")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    // No hay a qué colgarle la OC.
    if (msg.includes("no tiene una versión ASIGNADA")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    if (msg.includes("obligatoria")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[erp/oc-posterior POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Corrige una orden de compra ya registrada.
 *
 * Verbo y permiso distintos del POST a propósito: aquel llena un hueco, este
 * reescribe el número con el que se factura y se cobra. `ot.oc.modificar` lo
 * tiene menos gente, y el motivo es obligatorio.
 */
export async function PATCH(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "ot.oc.modificar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: { ordenCompra?: unknown; motivo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (typeof body.ordenCompra !== "string" || body.ordenCompra.trim() === "") {
    return NextResponse.json({ error: "La orden de compra es obligatoria" }, { status: 400 });
  }
  if (typeof body.motivo !== "string" || body.motivo.trim().length < MOTIVO_MINIMO) {
    return NextResponse.json(
      { error: `El motivo es obligatorio y debe tener al menos ${MOTIVO_MINIMO} caracteres` },
      { status: 400 },
    );
  }

  try {
    const resultado = await modificarOcPosterior({
      numero: key.numero,
      anio: key.anio,
      ordenCompra: body.ordenCompra,
      motivo: body.motivo,
      usuario: session!.user.email ?? "",
    });
    return NextResponse.json(resultado);
  } catch (err) {
    const msg = (err as Error).message;
    // Todavía no hay OC: esto es un alta, y va por el POST con su permiso.
    if (msg.includes("todavía no tiene orden de compra")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg.includes("no tiene una versión ASIGNADA")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    if (msg.includes("obligatoria") || msg.includes("motivo es obligatorio")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[erp/oc-posterior PATCH]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
