import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { getVersion, getVigente, parseCotKey, seArmoEnElCotizador } from "@/src/lib/cotizaciones";
import { enviarARevision } from "@/src/lib/cotizaciones-flujos";
import { folioCotizacion } from "@/src/lib/folios";
import { notaParaRevisor } from "@/src/lib/nota-revision";

/**
 * Manda a revisión una cotización que no pasó por el cotizador (las cargadas
 * del control de 2026 no tienen armado que congelar).
 *
 * **Solo esas.** Una armada en el cotizador pasa por `armado/revision`, que
 * congela los importes y genera el PDF definitivo. Por aquí llegaría a
 * REVISION sin nada de eso: con el PDF de antes de una corrección —el que el
 * revisor rechazó— o con ninguno, y el envío mandaría ese. La pantalla nunca
 * la manda por aquí; la ruta lo rechaza igual, con 409, porque es el estado de
 * la versión el que no lo permite.
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
  // La nota para el revisor: al correo y a la bitácora, nunca a la cotización.
  let nota = "";
  try {
    const cuerpo = (await req.json()) as { version?: number; nota?: unknown };
    if (Number.isInteger(cuerpo.version) && cuerpo.version! >= 0) pedida = cuerpo.version!;
    nota = notaParaRevisor(cuerpo.nota);
  } catch {
    // Sin cuerpo: la vigente y sin nota.
  }

  const cotizacion =
    pedida === null
      ? await getVigente(key.numero, key.anio)
      : await getVersion(key.numero, key.anio, pedida);
  if (!cotizacion) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  // Sobre la versión ya resuelta, que es la que se va a mover.
  if (await seArmoEnElCotizador(cotizacion)) {
    const folio = folioCotizacion(cotizacion.numero, cotizacion.anio, cotizacion.version);
    return NextResponse.json(
      {
        error:
          `La ${folio} se armó en el cotizador: mándala a revisión desde su «Vista previa», ` +
          "que congela los importes y genera el PDF definitivo. Esta ruta es solo para las " +
          "importadas, que no tienen armado.",
      },
      { status: 409 },
    );
  }

  try {
    const { cotizacion: actualizada, avisos } = await enviarARevision({
      numero: key.numero,
      anio: key.anio,
      version: cotizacion.version,
      usuario: session!.user.email ?? "",
      nota,
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
