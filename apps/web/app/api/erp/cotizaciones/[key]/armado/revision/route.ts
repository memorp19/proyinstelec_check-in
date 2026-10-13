import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { enviarARevision } from "@/src/lib/cotizaciones-flujos";
import { accesoAlArmado } from "@/src/lib/cotizador-permisos";
import { congelarVersion, getArmado } from "@/src/lib/cotizador-db";

/**
 * Congela los importes y manda la versión a revisión.
 *
 * El orden importa: **primero congelar**. Si se mandara a revisión y el
 * congelado fallara, el revisor estaría viendo una cotización que todavía se
 * recalcula sola — que es justo lo que este cambio viene a quitar. Al revés, un
 * congelado sin cambio de estatus se arregla volviendo a dar al botón.
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let version = 0;
  try {
    const cuerpo = (await req.json()) as { version?: number };
    if (Number.isInteger(cuerpo.version) && cuerpo.version! >= 0) version = cuerpo.version!;
  } catch {
    // Sin cuerpo: la v0.
  }

  const completo = await getArmado(key.numero, key.anio, version);
  if (!completo) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  const acceso = accesoAlArmado(completo.cotizacion, session!.user);
  if (!acceso.puedeEditar) return NextResponse.json({ error: acceso.motivo }, { status: 403 });

  // Mandar a revisión una cotización vacía no es un descuido que valga la pena
  // dejar pasar: el revisor recibiría un documento sin nada que revisar.
  if (completo.armado.partidas.length === 0) {
    return NextResponse.json(
      { error: "La cotización no tiene ninguna partida: no hay qué revisar." },
      { status: 422 },
    );
  }

  const usuario = session!.user.email ?? "";
  try {
    const congelado = await congelarVersion({ numero: key.numero, anio: key.anio, version, usuario });
    const { cotizacion, avisos } = await enviarARevision({ numero: key.numero, anio: key.anio, usuario });

    return NextResponse.json({
      cotizacion,
      total: congelado.resultado.total,
      letra: congelado.letra,
      avisos: [...congelado.avisos, ...avisos],
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Transición no permitida")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error("[erp/armado revision POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
