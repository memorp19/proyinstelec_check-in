import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { accesoAlArmado } from "@/src/lib/cotizador-permisos";
import { actualizarPrecios, getArmado } from "@/src/lib/cotizador-db";

/**
 * Lleva al costo del catálogo vigente los renglones que se eligieron.
 *
 * Recibe **ids**, no "actualiza todo": quien lo ejecuta ya vio la lista con el
 * antes y el después de cada uno. Actualizar en bloque sin mirar es cómo se le
 * borra a un cliente el descuento que alguien negoció.
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let cuerpo: { version?: number; ids?: unknown };
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const version = Number.isInteger(cuerpo.version) && cuerpo.version! >= 0 ? cuerpo.version! : 0;
  const ids = Array.isArray(cuerpo.ids) ? cuerpo.ids.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "No se eligió ningún renglón" }, { status: 400 });

  const completo = await getArmado(key.numero, key.anio, version);
  if (!completo) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  const acceso = accesoAlArmado(completo.cotizacion, session!.user);
  if (!acceso.puedeEditar) return NextResponse.json({ error: acceso.motivo }, { status: 403 });

  try {
    const { actualizados } = await actualizarPrecios({ numero: key.numero, anio: key.anio, version, ids });
    return NextResponse.json({ actualizados });
  } catch (err) {
    console.error("[erp/armado precios POST]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
