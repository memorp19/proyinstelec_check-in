/**
 * Cómo se llama el archivo y dónde vive.
 *
 * **`<folio> <titulo>`, con espacio, siempre.** Es lo que ya produce
 * `copiarPlantillasCotizacion` y lo que `esPdfConTitulo` espera al buscar el
 * PDF para enviarlo al cliente. **No se reproduce la convención de Apps
 * Script**, que usa `_` para la v0 y espacio para el resto: esa inconsistencia
 * es justo la que obliga a buscar el PDF de dos maneras.
 *
 * La carpeta es la de la cotización, `{raíz}/{año}/{NNN-AAAA}`, que resuelve
 * `ensureCarpetaCotizacion`. Aquí no se toca Drive: solo se dice cómo se
 * llama.
 */
import { folioCotizacion } from "../../folios";
import { tituloParaDocumento } from "../normas";

/**
 * El nombre del archivo de una versión.
 *
 * El folio sale de `(numero, anio, version)` y no de la columna `folio`: la
 * columna guarda lo que se cargó, y la recarga de 2026 metió 75 con "-v1".
 * Nombrar un archivo con eso le enseñaría al equipo una convención muerta.
 *
 * El título pasa por `tituloParaDocumento`, que convierte `_` en ` - ` y le
 * pega la razón social cuando el título no la trae: es lo que el cliente lee,
 * y es el mismo que va dentro del documento. Que el archivo y la portada
 * digan lo mismo no es cosmético — por el nombre se busca el PDF.
 */
export function nombreDelDocumento(params: {
  numero: number;
  anio: number;
  version: number;
  titulo: string | null | undefined;
  /** La razón social, que va al final del título cuando éste no la trae. */
  cliente?: string | null;
}): string {
  const folio = folioCotizacion(params.numero, params.anio, params.version);
  const titulo = tituloParaDocumento(params.titulo, params.cliente);
  return `${folio} ${titulo}`.trim();
}

/**
 * Si un archivo de la carpeta es una versión anterior de este documento.
 *
 * Se usa para apartar lo viejo **después** de tener lo nuevo. La comparación
 * es por nombre exacto o por nombre con extensión, no por prefijo: el folio de
 * la v0 es prefijo del de todas sus versiones, y un prefijo a secas apartaría
 * el documento de otra versión de la misma cotización.
 */
export function esVersionAnterior(nombreArchivo: string, nombreEsperado: string): boolean {
  const a = nombreArchivo.trim().toUpperCase();
  const b = nombreEsperado.trim().toUpperCase();
  if (!b) return false;
  return a === b || a === `${b}.PDF` || a === `${b}.DOCX`;
}
