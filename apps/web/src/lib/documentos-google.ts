/**
 * Lo único de este módulo que habla con Google.
 *
 * Cinco operaciones, ninguna con lógica de negocio. Está separado para que
 * todo lo demás —qué dice el documento, cómo se arma, en qué orden— se pueda
 * escribir y probar sin red, sin llave de cuenta de servicio y sin tocar un
 * Drive de verdad.
 *
 * La implementación real llega en su propio PR. Mientras tanto vive aquí la
 * interfaz y, en los tests, una falsa que guarda los documentos en memoria y
 * **registra las solicitudes que recibe**, que es lo que de verdad se afirma.
 */
import type { DocumentoDocs, Solicitud } from "./cotizador/docs/tipos";

export interface ArchivoExportado {
  nombre: string;
  contenido: Buffer;
  mimeType: string;
}

export interface Documentos {
  /**
   * Copia la plantilla a la carpeta con ese nombre y devuelve el id de la
   * copia. La plantilla es un **Google Doc**, no el `.docx` que
   * `copiarPlantillasCotizacion` deja en la carpeta para llenar a mano.
   */
  copiarPlantilla(params: {
    plantillaId: string;
    nombre: string;
    carpetaId: string;
  }): Promise<{ id: string }>;

  /** El documento completo, como lo devuelve `documents.get`. */
  leerDocumento(id: string): Promise<DocumentoDocs>;

  /**
   * Aplica las solicitudes **en orden, en un solo `batchUpdate`**.
   *
   * En uno solo y no en varios porque la API las aplica como una unidad: si
   * una falla, no queda un documento a medio llenar con el nombre bueno.
   */
  aplicarCambios(id: string, solicitudes: Solicitud[]): Promise<void>;

  exportarPdf(params: { id: string; nombre: string }): Promise<ArchivoExportado>;

  /**
   * A la papelera, nunca borrar.
   *
   * Lo anterior se aparta **después** de tener lo nuevo (`COT_05:399-401`):
   * si algo falla a medio camino, el documento anterior sigue ahí.
   */
  moverAPapelera(id: string): Promise<void>;
}

/**
 * El error que levanta la implementación real cuando falta configuración.
 *
 * Se distingue de un fallo de red a propósito: sin la variable del entorno no
 * hay nada que reintentar, y quien lo vea en la pantalla necesita saber qué
 * configurar y no que "Google no respondió".
 */
export class FaltaConfiguracionDeDocumentos extends Error {
  constructor(variables: string[]) {
    super(
      `Falta ${variables.join(" y ")} para generar el documento. ` +
        "Mientras no esté configurado, la cotización se arma pero no se puede imprimir.",
    );
    this.name = "FaltaConfiguracionDeDocumentos";
  }
}
