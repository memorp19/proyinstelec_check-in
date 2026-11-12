import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { accesoAlArmado } from "@/src/lib/cotizador-permisos";
import { getArmado, guardarIdsDeDocumento } from "@/src/lib/cotizador-db";
import { contactoParaCarta } from "@/src/lib/clientes";
import { ensureCarpetaCotizacion, subirArchivoErp } from "@/src/lib/drive-erp";
import { generarDocumento } from "@/src/lib/cotizador/docs/generar";
import {
  documentosDeGoogle,
  FaltaConfiguracionDeDocumentos,
  plantillaDeCotizacion,
} from "@/src/lib/documentos-google";

/**
 * «Ver cotización»: genera el documento y su PDF en la carpeta de la versión.
 *
 * ── Por qué tarda, y por qué eso importa aquí ──
 *
 * Son cinco viajes a Google —copiar, leer, aplicar el lote, exportar, subir—
 * más el de la carpeta. Medido sobre cotizaciones reales: unos 7 s, y hasta
 * 10 s la primera vez de una cotización, cuando además hay que crear su
 * carpeta. El valor por omisión de Vercel para una función es de 10 s, así
 * que sin `maxDuration` esto se corta justo cuando más trabajo hay.
 *
 * 60 s y no más porque es el techo que el plan Hobby admite con seguridad: la
 * documentación de Vercel ha dado 10, 60 y 300 en distintos momentos, y 60
 * cabe en todas las versiones de esa respuesta. Nos sobra seis veces.
 */
export const maxDuration = 60;
/** `googleapis` y el PDF en memoria necesitan Node, no el runtime edge. */
export const runtime = "nodejs";

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

  // Quién: la arma quien la dio de alta o quien tenga `cotizaciones.armar.todas`.
  // Y en qué estado: una versión congelada ya no se regenera desde aquí —su
  // documento es el que el cliente recibió—.
  const acceso = accesoAlArmado(completo.cotizacion, session!.user);
  if (!acceso.puedeEditar) return NextResponse.json({ error: acceso.motivo }, { status: 403 });

  const { cotizacion, armado, resultado } = completo;
  if (armado.partidas.length === 0) {
    return NextResponse.json(
      { error: "La cotización no tiene ninguna partida: no hay documento que generar." },
      { status: 422 },
    );
  }

  try {
    // Falla antes de tocar Drive si no hay plantilla configurada: crear la
    // carpeta para después no poder llenar nada deja basura y confunde.
    const plantillaId = plantillaDeCotizacion();

    const { empresa, contacto } = await contactoParaCarta({
      razonSocial: cotizacion.cliente,
      dirigidaA: cotizacion.dirigida_a,
    });
    const carpeta = await ensureCarpetaCotizacion(key.numero, key.anio);

    const generado = await generarDocumento(
      {
        numero: key.numero,
        anio: key.anio,
        version,
        cliente: cotizacion.cliente,
        titulo: cotizacion.titulo,
        armado,
        calculo: resultado,
        documento: armado.documento,
        condiciones: armado.condiciones,
        direccionContacto: contacto?.direccion,
        direccionCliente: empresa?.direccion,
      },
      {
        documentos: documentosDeGoogle(),
        plantillaId,
        carpetaId: carpeta.folderId,
        // Lo anterior se aparta **después** de tener lo nuevo: si algo falla a
        // medio camino, el documento que el equipo ya conocía sigue ahí.
        anteriores: [completo.docDriveId, completo.pdfDriveId],
      },
    );

    const pdf = await subirArchivoErp({
      folderId: carpeta.folderId,
      filename: generado.pdf.nombre,
      mimeType: generado.pdf.mimeType,
      contenido: generado.pdf.contenido,
    });

    // Al final y en una sola sentencia. Si esto fallara, los archivos ya
    // existen en Drive y volver a dar al botón los rehace: lo que no se puede
    // es quedarse con ids que apunten a documentos apartados.
    await guardarIdsDeDocumento({
      numero: key.numero,
      anio: key.anio,
      version,
      docDriveId: generado.docId,
      pdfDriveId: pdf.driveFileId,
      fecha: generado.fechaEsNueva ? generado.fecha : undefined,
    });

    return NextResponse.json({
      nombre: generado.nombre,
      docDriveId: generado.docId,
      pdfDriveId: pdf.driveFileId,
      pdfUrl: pdf.webViewLink,
      carpetaUrl: carpeta.folderUrl,
      fecha: generado.fecha,
      avisos: generado.avisos,
    });
  } catch (err) {
    // Sin configuración de Google no hay nada que reintentar, y quien lo vea
    // en la pantalla necesita saber qué configurar y no que "falló Google".
    if (err instanceof FaltaConfiguracionDeDocumentos) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const msg = (err as Error).message;
    if (/DRIVE_SERVICE_ACCOUNT_KEY|GOOGLE_OAUTH_CLIENTE|ERP_COTIZACIONES_FOLDER_ID|token de Google/.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    console.error("[erp/cotizaciones documento POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
