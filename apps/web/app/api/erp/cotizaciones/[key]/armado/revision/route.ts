import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { enviarARevision } from "@/src/lib/cotizaciones-flujos";
import { notaParaRevisor } from "@/src/lib/nota-revision";
import { accesoAlArmado } from "@/src/lib/cotizador-permisos";
import { congelarVersion, getArmado } from "@/src/lib/cotizador-db";
import { generarPdfDefinitivo } from "@/src/lib/cotizador-pdf";
import { faltantesDelDocumento } from "@/src/lib/cotizador/docs/valores";
import { FaltaConfiguracionDeDocumentos } from "@/src/lib/documentos-google";
import { conPuntoFinal } from "@/src/lib/texto";

/** Congelar, generar el PDF (unos 10 s con Google) y mandar: ver `documento/route.ts`. */
export const maxDuration = 60;
/** `googleapis` y el PDF en memoria necesitan Node, no el runtime edge. */
export const runtime = "nodejs";

/**
 * Congela los importes, genera el PDF definitivo y manda la versión a revisión.
 *
 * El orden importa:
 *
 * 1. **Congelar.** Si se mandara a revisión y el congelado fallara, el revisor
 *    estaría viendo una cotización que todavía se recalcula sola.
 * 2. **El PDF**, de lo congelado (`generarPdfDefinitivo`). Toda versión del
 *    cotizador que llega a REVISION trae su PDF: es lo que el revisor aprueba
 *    y lo que se le manda al cliente.
 * 3. **El estatus y el correo al revisor**, que ya lleva el PDF adjunto.
 *
 * Si falla el paso 2, no se llega al 3: un congelado sin cambio de estatus se
 * arregla volviendo a dar al botón.
 *
 * ── Y antes de todo eso, lo que falta ──
 *
 * Lo que saldría como `⟨falta⟩` en el documento no pasa de aquí. La pantalla
 * ya lo dice y deja el botón apagado, pero esta ruta se puede llamar sin la
 * pantalla: la comprobación que vale es esta. Va **antes del congelado** para
 * no dejar una versión congelada de algo que no se mandó.
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let version = 0;
  // La nota para el revisor viaja aquí y no se guarda en la cotización: va al
  // correo y a la bitácora. `enviarARevision` la recorta y la escapa.
  let nota = "";
  try {
    const cuerpo = (await req.json()) as { version?: number; nota?: unknown };
    if (Number.isInteger(cuerpo.version) && cuerpo.version! >= 0) version = cuerpo.version!;
    nota = notaParaRevisor(cuerpo.nota);
  } catch {
    // Sin cuerpo: la v0 y sin nota.
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

  // La misma función que decide qué sale impreso, sin llamar a Google: lo que
  // aquí falta es exactamente lo que el PDF marcaría con ⟨falta⟩. Un renglón
  // apagado a propósito no cuenta.
  const faltantes = faltantesDelDocumento({
    cliente: completo.cotizacion.cliente,
    titulo: completo.cotizacion.titulo,
    folio: completo.cotizacion.folio,
    documento: completo.armado.documento,
    condiciones: completo.armado.condiciones,
  });
  if (faltantes.length > 0) {
    const lista = faltantes.map((f) => `${f.que} (${f.donde})`).join("; ");
    return NextResponse.json(
      {
        error:
          `El documento saldría con ${faltantes.length === 1 ? "un hueco" : "huecos"} a la vista. ` +
          `Falta: ${lista}.`,
        faltantes,
      },
      { status: 422 },
    );
  }

  const usuario = session!.user.email ?? "";
  try {
    const congelado = await congelarVersion({ numero: key.numero, anio: key.anio, version, usuario });

    // El PDF definitivo, de lo que se acaba de congelar. Si Google falla, la
    // versión NO pasa a revisión: el revisor aprobaría sin ver el documento, y
    // después no habría con qué enviarla. Lo congelado se queda y se reescribe
    // al reintentar, como siempre.
    let pdf;
    try {
      pdf = await generarPdfDefinitivo({ numero: key.numero, anio: key.anio, version });
    } catch (err) {
      console.error("[erp/armado revision PDF]", err);
      const motivo = conPuntoFinal((err as Error).message);
      return NextResponse.json(
        {
          error: `No se pudo generar el PDF: ${motivo} La cotización sigue en PROCESO; vuelve a intentar.`,
        },
        { status: err instanceof FaltaConfiguracionDeDocumentos ? 503 : 502 },
      );
    }

    const { cotizacion, avisos } = await enviarARevision({
      numero: key.numero,
      anio: key.anio,
      version,
      usuario,
      nota,
    });

    return NextResponse.json({
      cotizacion,
      total: congelado.resultado.total,
      letra: congelado.letra,
      pdfUrl: pdf.pdfUrl,
      avisos: [...congelado.avisos, ...pdf.avisos, ...avisos],
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
