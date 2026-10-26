import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { getVersion, getVigente, parseCotKey } from "@/src/lib/cotizaciones";
import { enviarARevision } from "@/src/lib/cotizaciones-flujos";

/**
 * Manda a revisión una cotización que no pasó por el cotizador (las cargadas
 * del control de 2026 no tienen armado que congelar).
 *
 * La versión viaja en el cuerpo: la pantalla sabe cuál está mirando, y dos
 * versiones pueden estar en PROCESO a la vez. Sin cuerpo se resuelve la
 * vigente, pero se resuelve **aquí** y se manda explícita, para que el flujo
 * no vuelva a decidirlo por su cuenta.
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let pedida: number | null = null;
  try {
    const cuerpo = (await req.json()) as { version?: number };
    if (Number.isInteger(cuerpo.version) && cuerpo.version! >= 0) pedida = cuerpo.version!;
  } catch {
    // Sin cuerpo: la vigente.
  }

  const cotizacion =
    pedida === null
      ? await getVigente(key.numero, key.anio)
      : await getVersion(key.numero, key.anio, pedida);
  if (!cotizacion) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  try {
    const { cotizacion: actualizada, avisos } = await enviarARevision({
      numero: key.numero,
      anio: key.anio,
      version: cotizacion.version,
      usuario: session!.user.email ?? "",
    });
    return NextResponse.json({ cotizacion: actualizada, avisos });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Transición no permitida")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error("[erp/revision POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
