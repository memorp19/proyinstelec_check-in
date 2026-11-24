/**
 * El PDF definitivo: el que se revisa, se aprueba y se le manda al cliente.
 *
 * Sale **de lo congelado**, nunca de lo vivo:
 *
 * - los importes y el resultado completo, de `cot_importes`;
 * - lo que imprime además de los importes —cliente, título, dirigida a, el
 *   bloque del documento y las direcciones—, de la foto que se tomó al
 *   congelar (`FotoDelDocumento`);
 * - las partidas y las condiciones, del armado, que desde PROCESO ya no se
 *   edita.
 *
 * Se genera en dos momentos, con esta misma función:
 *
 * 1. **Al mandar a revisión**, justo después de congelar. Si Google falla, la
 *    versión no pasa a revisión (`armado/revision/route.ts`).
 * 2. **Con «Generar PDF»**, en REVISION, para la versión que no lo tenga o
 *    que lo tenga de antes de este cambio. Nunca desde ENVIADA: ese PDF es el
 *    que tiene el cliente.
 *
 * «Ver cotización» sigue generando borradores en PROCESO, pero esos no
 * cuentan para enviar ni fijan la fecha.
 */
import type { Cotizacion } from "./cotizaciones";
import {
  getArmado,
  guardarFoto,
  guardarPdfDefinitivo,
  leerCongelado,
  tomarFoto,
} from "./cotizador-db";
import { puedeArmar } from "./cotizador";
import type { UsuarioSesion } from "./cotizador-permisos";
import { generarDocumento } from "./cotizador/docs/generar";
import { documentosDeGoogle, plantillaDeCotizacion } from "./documentos-google";
import { ensureCarpetaCotizacion, subirArchivoErp } from "./drive-erp";
import { tienePermiso } from "./permisos";

/** La versión no tiene nada congelado: no se armó en el ERP, o nunca pasó a revisión. */
export class SinCongelar extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SinCongelar";
  }
}

export interface PdfDefinitivo {
  nombre: string;
  pdfDriveId: string;
  pdfUrl: string;
  fecha: string;
  avisos: string[];
}

/**
 * Genera el PDF definitivo de una versión y lo guarda como el que se envía.
 *
 * Aparta el documento anterior (el borrador, o un definitivo previo) **después**
 * de tener el nuevo, como «Ver cotización»: si algo falla a medio camino, lo
 * que había sigue ahí.
 */
export async function generarPdfDefinitivo(v: {
  numero: number;
  anio: number;
  version: number;
}): Promise<PdfDefinitivo> {
  const [completo, congelado] = await Promise.all([
    getArmado(v.numero, v.anio, v.version),
    leerCongelado(v),
  ]);
  if (!completo) throw new Error("No existe esa versión de la cotización");
  if (!congelado) {
    throw new SinCongelar(
      "Esta versión no tiene nada congelado: el PDF definitivo sale de lo que se congela al " +
        "mandarla a revisión desde el cotizador. Si no se armó en el ERP, su PDF lo hace el Apps Script.",
    );
  }
  if (completo.armado.partidas.length === 0) {
    throw new SinCongelar("La cotización no tiene ninguna partida: no hay documento que generar.");
  }

  const avisos: string[] = [];
  let foto = congelado.foto;
  if (!foto) {
    // Lo congelado antes de que existiera la foto. Se toma ahora, una vez, y
    // desde aquí ya no se mueve.
    foto = await guardarFoto({ ...v, foto: await tomarFoto(completo) });
    avisos.push(
      "Esta versión se congeló antes de que existiera la foto del encabezado: se tomó ahora, " +
        "y desde aquí el PDF sale de ella.",
    );
  }

  // Falla antes de tocar Drive si no hay plantilla configurada.
  const plantillaId = plantillaDeCotizacion();
  const carpeta = await ensureCarpetaCotizacion(v.numero, v.anio);

  const generado = await generarDocumento(
    {
      numero: v.numero,
      anio: v.anio,
      version: v.version,
      cliente: foto.encabezado.cliente,
      titulo: foto.encabezado.titulo,
      armado: completo.armado,
      calculo: congelado.resultado,
      documento: foto.documento,
      condiciones: completo.armado.condiciones,
      direccionContacto: foto.direccionContacto,
      direccionCliente: foto.direccionCliente,
    },
    {
      documentos: documentosDeGoogle(),
      plantillaId,
      carpetaId: carpeta.folderId,
      anteriores: [completo.docDriveId, completo.pdfDriveId],
    },
  );

  const pdf = await subirArchivoErp({
    folderId: carpeta.folderId,
    filename: generado.pdf.nombre,
    mimeType: generado.pdf.mimeType,
    contenido: generado.pdf.contenido,
  });

  await guardarPdfDefinitivo({
    ...v,
    docDriveId: generado.docId,
    pdfDriveId: pdf.driveFileId,
    fecha: generado.fechaEsNueva ? generado.fecha : undefined,
  });

  return {
    nombre: generado.nombre,
    pdfDriveId: pdf.driveFileId,
    pdfUrl: pdf.webViewLink,
    fecha: generado.fecha,
    avisos: [...avisos, ...generado.avisos],
  };
}

/**
 * Si alguien puede usar «Generar PDF» en esta versión, y si no, por qué.
 *
 * - **Solo en REVISION**, aprobada o no. En PROCESO todavía no hay nada
 *   congelado; desde ENVIADA el PDF es el que tiene el cliente.
 * - **Quién:** quien envía (`cotizaciones.enviar`), quien revisa
 *   (`cotizaciones.aprobar`) o quien puede armarla. Generar desde lo congelado
 *   no cambia nada de lo revisado, así que no hace falta más que eso.
 *
 * `status` es el código que debe contestar la ruta.
 */
export function puedeGenerarPdfDefinitivo(
  cotizacion: Pick<Cotizacion, "estatus" | "created_by" | "elaboro">,
  usuario: UsuarioSesion,
): { puede: true } | { puede: false; motivo: string; status: 403 | 409 } {
  const quien =
    tienePermiso(usuario, "cotizaciones.enviar") ||
    tienePermiso(usuario, "cotizaciones.aprobar") ||
    puedeArmar(cotizacion, usuario, tienePermiso(usuario, "cotizaciones.armar.todas")).puede;
  if (!quien) {
    return {
      puede: false,
      status: 403,
      motivo: "Generar el PDF lo puede quien envía, quien revisa o quien arma esta cotización.",
    };
  }

  switch (cotizacion.estatus) {
    case "REVISION":
      return { puede: true };
    case "PROCESO":
      return {
        puede: false,
        status: 409,
        motivo:
          "En PROCESO todavía no hay PDF definitivo: se genera al mandarla a revisión. Para verla, usa «Ver cotización».",
      };
    case "ENVIADA":
    case "ASIGNADA":
    case "NO ASIGNADA":
      return {
        puede: false,
        status: 409,
        motivo: "Ya se envió: su PDF es el que tiene el cliente, y no se regenera.",
      };
    default:
      return { puede: false, status: 409, motivo: `Está en ${cotizacion.estatus}: no se genera PDF.` };
  }
}
