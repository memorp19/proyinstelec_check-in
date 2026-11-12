/**
 * «Ver cotización»: generar el documento y su PDF.
 *
 * Escrito **contra la interfaz** `Documentos`, no contra Google: así el flujo
 * entero —qué se copia, en qué orden, qué se guarda, qué se aparta— se puede
 * probar sin red y sin llave de cuenta de servicio.
 *
 * ── El orden, que es lo que importa ──
 *
 * 1. Copiar la plantilla a la carpeta, con el nombre bueno.
 * 2. Leerla, armar todas las solicitudes y aplicarlas **en un solo lote**.
 * 3. Exportar el PDF.
 * 4. Guardar `doc_drive_id` y `pdf_drive_id`.
 * 5. **Al final**, apartar los anteriores.
 *
 * Lo anterior se aparta después de tener lo nuevo (`COT_05:399-401`): si algo
 * falla a medio camino, el documento que el equipo ya conocía sigue ahí. Y la
 * copia a medio llenar no se queda con el nombre bueno — se va a la papelera.
 */
import type { Documentos } from "../../documentos-google";
import type { Armado } from "../armado";
import type { Condiciones, DatosDocumento } from "../documento";
import { normasElegidas } from "../normas";
import type { ResultadoCotizacion } from "../tipos";
import type { Solicitud } from "./tipos";
import { nombreDelDocumento } from "./nombre";
import { solicitudesDeNegro } from "./colores";
import { sustituciones, type Marcador } from "./marcadores";
import { quitarNormas } from "./normas-plantilla";
import { ocultarRenglones } from "./ocultar";
import { ajustarActividades, saltoAntesDeTerminos } from "./secciones";
import { solicitudesDeTabla, tablaDeCotizacion } from "./tabla";
import { fechaFija, valoresDeMarcadores } from "./valores";

export interface DatosDeGeneracion {
  numero: number;
  anio: number;
  version: number;
  cliente: string;
  titulo: string;
  armado: Armado;
  /** Lo que cobró el motor. De aquí salen los importes del cuadro. */
  calculo: ResultadoCotizacion;
  documento: DatosDocumento;
  condiciones: Condiciones;
  /** La del contacto; si no tiene, la del cliente. Ver `valoresDeMarcadores`. */
  direccionContacto?: string | null;
  direccionCliente?: string | null;
}

export interface Entorno {
  documentos: Documentos;
  plantillaId: string;
  carpetaId: string;
  /** Los ids que hay que apartar cuando lo nuevo ya existe. */
  anteriores?: Array<string | null | undefined>;
  /** Inyectable para fijar la fecha en las pruebas. */
  hoy?: () => Date;
}

export interface DocumentoGenerado {
  docId: string;
  pdf: { nombre: string; contenido: Buffer; mimeType: string };
  nombre: string;
  /** La fecha con la que salió, para guardarla si era la primera vez. */
  fecha: string;
  fechaEsNueva: boolean;
  /** Huecos y marcadores faltantes, todo junto para la vista previa. */
  avisos: string[];
  /** Cuántas solicitudes se mandaron. Sirve para afirmarlo en una prueba. */
  solicitudes: number;
}

/**
 * Las solicitudes del documento, sin tocar nada.
 *
 * Separada de `generarDocumento` a propósito: es la parte que decide cómo
 * queda el documento, y es pura. Recibe el JSON de la plantilla y los datos;
 * devuelve la lista y los avisos.
 *
 * ── El orden del lote ──
 *
 * `batchUpdate` aplica en orden y cada inserción o borrado corre los índices
 * posteriores. Como todo se calcula sobre el JSON original, lo que cambia
 * longitudes se emite **de abajo hacia arriba del documento**:
 *
 * 1. El **color** y el **salto de página**, que no mueven ni un índice pero
 *    sí necesitan que los del original sigan siendo válidos. Por eso van
 *    primero: después del primer borrado ya no lo serían. Y como el negro se
 *    aplica antes que las inserciones, lo que se inserte luego lo hereda de
 *    lo que tiene al lado, que para entonces ya es negro.
 * 2. La **tabla de partidas**, que está al final (índice ~3000).
 * 3. Las **normas**: se quitan las que no se eligieron y se reescriben las
 *    que se quedan (~2000).
 * 4. Los **párrafos de Actividades Generales** (~1800).
 * 5. Los **renglones del destinatario** que no salen (~300).
 * 6. Las **sustituciones**, que no usan índices: `replaceAllText` compara
 *    texto. Van al final porque cambian longitudes en todo el documento.
 *
 * Al revés, el primer borrado invalidaría todos los índices de abajo.
 */
export function solicitudesDelDocumento(
  plantilla: Parameters<typeof sustituciones>[0],
  d: DatosDeGeneracion,
  fecha: string,
): { solicitudes: Solicitud[]; avisos: string[] } {
  const { valores, ocultos, avisos } = valoresDeMarcadores({
    cliente: d.cliente,
    folio: nombreDelDocumento(d).split(" ")[0],
    fecha,
    titulo: d.titulo,
    documento: d.documento,
    condiciones: d.condiciones,
    direccionContacto: d.direccionContacto,
    direccionCliente: d.direccionCliente,
  });

  const negro = solicitudesDeNegro(plantilla);
  const salto = saltoAntesDeTerminos(plantilla);

  const cuadro = solicitudesDeTabla(plantilla, tablaDeCotizacion(d.armado, d.calculo));

  const elegidas = normasElegidas(d.documento.normas, d.titulo).map((n) => n.id);
  const normas = quitarNormas(plantilla, elegidas);

  const actividades = ajustarActividades(plantilla, d.documento);

  // Quitar antes de sustituir: el renglón se localiza por su marcador, y una
  // vez sustituido ya no hay por dónde agarrarlo.
  const quitados = ocultarRenglones(plantilla, ocultos);
  const puestos = sustituciones(plantilla, valores as Record<Marcador, string>);

  const deFaltantes = puestos.faltantes.map(
    (m) => `La plantilla no trae el marcador {{${m}}}: ese dato no va a salir en el documento.`,
  );

  return {
    solicitudes: [
      ...negro,
      ...salto.solicitudes,
      ...cuadro.solicitudes,
      ...normas.solicitudes,
      ...actividades.solicitudes,
      ...quitados.solicitudes,
      ...puestos.solicitudes,
    ],
    avisos: [
      ...avisos,
      ...salto.avisos,
      ...cuadro.avisos,
      ...normas.avisos,
      ...actividades.avisos,
      ...deFaltantes,
    ],
  };
}

/**
 * Genera el documento y el PDF.
 *
 * No escribe en la base: devuelve los ids y la fecha para que quien llame los
 * guarde. Así esta función no necesita base para probarse, y quien la llama
 * decide qué hacer si el guardado falla.
 */
export async function generarDocumento(
  d: DatosDeGeneracion,
  e: Entorno,
): Promise<DocumentoGenerado> {
  if (d.armado.partidas.length === 0) {
    throw new Error("La cotización no tiene partidas: no hay documento que generar.");
  }

  const { fecha, esNueva } = fechaFija(d.documento.fecha, e.hoy);
  const nombre = nombreDelDocumento(d);

  const { id: docId } = await e.documentos.copiarPlantilla({
    plantillaId: e.plantillaId,
    nombre,
    carpetaId: e.carpetaId,
  });

  let pdf: DocumentoGenerado["pdf"];
  let armadas: { solicitudes: Solicitud[]; avisos: string[] };
  try {
    const plantilla = await e.documentos.leerDocumento(docId);
    armadas = solicitudesDelDocumento(plantilla, d, fecha);
    if (armadas.solicitudes.length > 0) {
      await e.documentos.aplicarCambios(docId, armadas.solicitudes);
    }
    pdf = await e.documentos.exportarPdf({ id: docId, nombre });
  } catch (err) {
    // La copia a medio llenar no se queda con el nombre bueno: la siguiente
    // corrida crearía una segunda y nadie sabría cuál es la buena.
    try {
      await e.documentos.moverAPapelera(docId);
    } catch {
      // Si ni eso se puede, el error que importa es el de arriba.
    }
    throw err;
  }

  // Hasta aquí no se tocó nada de lo anterior. Ahora que lo nuevo existe, se
  // aparta lo viejo; si falla, el documento nuevo ya está y se puede seguir.
  for (const id of e.anteriores ?? []) {
    if (!id || id === docId) continue;
    try {
      await e.documentos.moverAPapelera(id);
    } catch {
      armadas.avisos.push("No se pudo mandar a la papelera el documento anterior.");
    }
  }

  return {
    docId,
    pdf,
    nombre,
    fecha,
    fechaEsNueva: esNueva,
    avisos: armadas.avisos,
    solicitudes: armadas.solicitudes.length,
  };
}
