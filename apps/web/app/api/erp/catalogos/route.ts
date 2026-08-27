import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { getConfigErp } from "@/src/lib/config-erp";
import { listUsers } from "@/src/lib/users";
import { ESTATUS_COTIZACION, PRIORIDADES } from "@/src/lib/cotizaciones";

/**
 * Catálogos para los formularios del ERP: áreas de OT, responsables
 * (usuarios con iniciales — requisito para el cruce con el control operativo),
 * elaboradores, estatus y prioridades.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  try {
    const [config, usuarios] = await Promise.all([getConfigErp(), listUsers()]);
    const conIniciales = usuarios
      .filter((u) => u.iniciales)
      .map((u) => ({ email: u.email, nombre: u.nombre, iniciales: u.iniciales!, gerencia: u.gerencia }));
    const sinIniciales = usuarios
      .filter((u) => !u.iniciales && u.rol !== "cliente")
      .map((u) => ({ email: u.email, nombre: u.nombre }));

    return NextResponse.json({
      areas: config.areas_ot,
      responsables: conIniciales,
      responsablesSinIniciales: sinIniciales, // se muestran deshabilitados con nota (legacy)
      estatus: ESTATUS_COTIZACION,
      prioridades: PRIORIDADES,
    });
  } catch (err) {
    console.error("[erp/catalogos GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
