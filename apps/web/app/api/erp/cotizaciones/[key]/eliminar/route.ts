import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso, tienePermiso } from "@/src/lib/permisos";
import { eliminarVersion, getVersion, parseCotKey, puedeEliminarse } from "@/src/lib/cotizaciones";
import { registrarBitacora } from "@/src/lib/bitacora";
import { puedeArmar } from "@/src/lib/cotizador";

/**
 * Elimina una versión de cotización que nunca salió de la empresa.
 *
 * Tres candados, y ninguno sobra: **quién** —la suya, o quien pueda armar
 * todas—, **en qué estado** —solo PROCESO, sin envío, sin OT ni OC— y **la
 * confirmación**, que exige teclear el folio. Lo que se borra no se recupera y
 * el folio no se vuelve a usar.
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let cuerpo: { version?: number; confirmacion?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const version = Number.isInteger(cuerpo.version) && cuerpo.version! >= 0 ? cuerpo.version! : 0;
  const cotizacion = await getVersion(key.numero, key.anio, version);
  if (!cotizacion) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  // Quien la dio de alta, o el gerente de operaciones. Es la misma regla que
  // decide quién la arma: lo que se puede cotizar se puede tirar antes de que
  // salga, y nada más.
  const quien = puedeArmar(cotizacion, session!.user, tienePermiso(session!.user, "cotizaciones.armar.todas"));
  if (!quien.puede) return NextResponse.json({ error: quien.motivo }, { status: 403 });

  const estado = puedeEliminarse(cotizacion);
  if (!estado.puede) return NextResponse.json({ error: estado.motivo }, { status: 422 });

  // Teclear el folio es la confirmación. Un "¿estás seguro?" se contesta que sí
  // sin leerlo; copiar PCOTOP-260-2026 obliga a mirar cuál se está borrando.
  if ((cuerpo.confirmacion ?? "").trim().toUpperCase() !== cotizacion.folio.toUpperCase()) {
    return NextResponse.json(
      { error: `Para eliminarla, escribe su folio exacto: ${cotizacion.folio}` },
      { status: 422 },
    );
  }

  const { eliminada } = await eliminarVersion({ numero: key.numero, anio: key.anio, version });
  if (!eliminada) {
    return NextResponse.json(
      { error: "La cotización cambió de estatus mientras la eliminabas. Vuelve a cargarla." },
      { status: 409 },
    );
  }

  // Lo que se borró queda escrito, con el enlace de su carpeta: es lo único que
  // va a quedar de ella, y Drive no se toca desde aquí.
  await registrarBitacora({
    accion: "COTIZACION_ELIMINADA",
    usuario: session!.user.email ?? "",
    referencia: `${String(key.numero).padStart(3, "0")}-${key.anio}`,
    detalle:
      `${cotizacion.folio} · ${cotizacion.cliente} · ${cotizacion.titulo} · elaboró ${cotizacion.elaboro}` +
      (cotizacion.drive_folder_url ? ` · carpeta: ${cotizacion.drive_folder_url}` : " · sin carpeta en Drive"),
  });

  return NextResponse.json({
    eliminada: true,
    folio: cotizacion.folio,
    carpeta: cotizacion.drive_folder_url ?? null,
  });
}
