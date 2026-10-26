import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { accesoAlArmado } from "@/src/lib/cotizador-permisos";
import { ConflictoDeEdicion, catalogoVigente, getArmado, guardarArmado } from "@/src/lib/cotizador-db";
import { MontoFueraDeEscala, type Armado } from "@/src/lib/cotizador";

/** `?version=` es opcional: sin él, la v0. */
function leerVersion(req: NextRequest): number | null {
  const crudo = req.nextUrl.searchParams.get("version");
  if (crudo === null) return 0;
  const n = Number(crudo);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  const version = leerVersion(req);
  if (!key || version === null) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  try {
    const completo = await getArmado(key.numero, key.anio, version);
    if (!completo) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

    const acceso = accesoAlArmado(completo.cotizacion, session!.user);
    // El catálogo viaja con el armado: la pantalla lo necesita para el buscador
    // y para proponer costos, y son dos viajes que siempre se piden juntos.
    return NextResponse.json({ ...completo, acceso, catalogo: await catalogoVigente() });
  } catch (err) {
    console.error("[erp/armado GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let cuerpo: { armado?: Armado; actualizadoEn?: string | null };
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const armado = cuerpo.armado;
  if (!armado || !Array.isArray(armado.partidas) || !Array.isArray(armado.gastos)) {
    return NextResponse.json({ error: "Falta el armado" }, { status: 400 });
  }
  // La llave manda sobre lo que diga el cuerpo: si no coincidieran, se
  // escribiría en una cotización distinta de la que se pidió.
  if (armado.numero !== key.numero || armado.anio !== key.anio) {
    return NextResponse.json({ error: "El armado no es de esta cotización" }, { status: 400 });
  }

  const completo = await getArmado(key.numero, key.anio, armado.version);
  if (!completo) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  // La pantalla esconde; esto es lo que de verdad protege.
  const acceso = accesoAlArmado(completo.cotizacion, session!.user);
  if (!acceso.puedeEditar) return NextResponse.json({ error: acceso.motivo }, { status: 403 });

  try {
    const { actualizadoEn } = await guardarArmado({
      armado,
      actualizadoEn: cuerpo.actualizadoEn ?? null,
      usuario: session!.user.email ?? "",
    });
    return NextResponse.json({ actualizadoEn });
  } catch (err) {
    if (err instanceof ConflictoDeEdicion) {
      return NextResponse.json({ error: err.message, conflicto: true }, { status: 409 });
    }
    // Un monto con más decimales de los que la columna guarda no es un fallo
    // del servidor: es un dato que no cabe, y hay que decir cuál.
    if (err instanceof MontoFueraDeEscala) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[erp/armado PUT]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
