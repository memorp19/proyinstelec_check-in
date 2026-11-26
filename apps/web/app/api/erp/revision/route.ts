import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { buscarCotizaciones, pdfDeLaVersion } from "@/src/lib/cotizaciones";
import { avisoDeEncabezado, avisoSinPdf, cambiosDeEncabezado } from "@/src/lib/cotizador/foto";

/**
 * Bandeja de revisión: cotizaciones en REVISION del año (permiso cotizaciones.aprobar).
 *
 * Cada una trae su PDF definitivo —es lo que se aprueba— y, si lo vivo ya no
 * coincide con lo congelado, el aviso. La bandeja es corta, así que se
 * consulta una por una.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "cotizaciones.aprobar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const anio = parseInt(
    req.nextUrl.searchParams.get("anio") ?? String(new Date().getFullYear()),
    10,
  );

  try {
    const enRevision = await buscarCotizaciones({ anio, estatus: "REVISION" });
    const cotizaciones = await Promise.all(
      enRevision.map(async (c) => {
        const pdf = await pdfDeLaVersion(c);
        return {
          ...c,
          pdf_del_cotizador: pdf.delCotizador,
          pdf_drive_id: pdf.pdfDriveId,
          aviso_pdf:
            pdf.delCotizador && !pdf.pdfDriveId
              ? avisoSinPdf({ delCotizador: true, estatus: c.estatus, folio: c.folio })
              : null,
          aviso_encabezado: pdf.foto ? avisoDeEncabezado(cambiosDeEncabezado(pdf.foto.encabezado, c)) : null,
        };
      }),
    );
    return NextResponse.json({ cotizaciones });
  } catch (err) {
    console.error("[erp/revision GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
