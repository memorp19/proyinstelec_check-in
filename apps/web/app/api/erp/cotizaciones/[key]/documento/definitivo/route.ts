import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { getVersion, parseCotKey } from "@/src/lib/cotizaciones";
import {
  generarPdfDefinitivo,
  puedeGenerarPdfDefinitivo,
  SinCongelar,
} from "@/src/lib/cotizador-pdf";
import { FaltaConfiguracionDeDocumentos } from "@/src/lib/documentos-google";

/** Unos 10 s con Google: ver `documento/route.ts`. */
export const maxDuration = 60;
/** `googleapis` y el PDF en memoria necesitan Node, no el runtime edge. */
export const runtime = "nodejs";

/**
 * «Generar PDF»: el PDF definitivo de una versión en REVISION, desde lo
 * congelado.
 *
 * Para la versión que llegó a revisión sin PDF —antes de que se generara al
 * mandarla— o con uno de antes del último cambio. Como sale de lo congelado,
 * no cambia nada de lo que se revisó y la aprobación sigue valiendo.
 *
 * Quién y cuándo, en `puedeGenerarPdfDefinitivo`: en REVISION, aprobada o no;
 * nunca desde ENVIADA.
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

  const cotizacion = await getVersion(key.numero, key.anio, version);
  if (!cotizacion) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  const acceso = puedeGenerarPdfDefinitivo(cotizacion, session!.user);
  if (!acceso.puede) return NextResponse.json({ error: acceso.motivo }, { status: acceso.status });

  try {
    const pdf = await generarPdfDefinitivo({ numero: key.numero, anio: key.anio, version });
    return NextResponse.json(pdf);
  } catch (err) {
    const msg = (err as Error).message;
    if (err instanceof SinCongelar) return NextResponse.json({ error: msg }, { status: 409 });
    if (err instanceof FaltaConfiguracionDeDocumentos) {
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    console.error("[erp/cotizaciones documento definitivo POST]", err);
    return NextResponse.json({ error: `No se pudo generar el PDF: ${msg}` }, { status: 502 });
  }
}
