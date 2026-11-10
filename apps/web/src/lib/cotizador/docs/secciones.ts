/**
 * Las secciones de prosa de la plantilla: Actividades Generales y Términos.
 *
 * Son párrafos que la plantilla trae **escritos**, no marcadores. Hasta ahora
 * salían tal cual, de modo que lo que alguien escribía en la pantalla para
 * "objeto" y "alcance" no llegaba nunca al documento: el PDF repetía el texto
 * de ejemplo de la plantilla, con su "mantenimiento preventivo" fijo.
 *
 * Se localizan **por el principio de su texto**, nunca por posición: la
 * plantilla se edita a mano y un párrafo de más arriba movería el índice sin
 * que nada fallara.
 */
import type { DatosDocumento } from "../documento";
import { parrafos, type ParrafoUbicado } from "./recorrido";
import { segmentos } from "./recorrido";
import type {
  DocumentoDocs,
  Rango,
  Solicitud,
  SolicitudBorrarRango,
  SolicitudInsertarTexto,
} from "./tipos";

/** Con qué empieza cada párrafo en la plantilla. */
export const INICIO_DE = {
  objeto: "El objeto de la presente",
  alcance: "El alcance principal",
  terminos: "Términos y Condiciones Comerciales",
} as const;

export interface Ajuste {
  solicitudes: Solicitud[];
  avisos: string[];
}

/** El último índice borrable de cada segmento: la API no quita el `\n` final. */
function topeDeSegmento(doc: DocumentoDocs): Map<string, number> {
  const fuera = new Map<string, number>();
  for (const { segmentId, segmento } of segmentos(doc)) {
    const ultimo = (segmento.content ?? []).at(-1);
    if (ultimo?.endIndex !== undefined) fuera.set(segmentId, ultimo.endIndex);
  }
  return fuera;
}

/** Los párrafos del cuerpo que no están dentro de una tabla. */
const prosa = (doc: DocumentoDocs) =>
  parrafos(doc).filter((p) => !p.dentroDeTabla && !p.segmentId);

function buscar(lista: ParrafoUbicado[], inicio: string): ParrafoUbicado | null {
  const coinciden = lista.filter((p) => p.texto.trimStart().startsWith(inicio));
  // Dos párrafos que empiezan igual: no se sabe cuál es, y tocar el que no es
  // sería peor que no tocar ninguno.
  return coinciden.length === 1 ? coinciden[0] : null;
}

const vacio = (p: ParrafoUbicado | undefined) => !!p && !p.texto.trim();

/**
 * Cambia el texto de un párrafo por otro, dejando su `\n` y su estilo.
 *
 * Borrar e insertar en el mismo índice y no `replaceAllText` porque el texto
 * de la plantilla es prosa larga que puede repetirse, y porque así el párrafo
 * conserva su viñeta, su sangría y su lista.
 */
function reemplazarTexto(
  p: ParrafoUbicado,
  texto: string,
  tope: number,
): Array<SolicitudBorrarRango | SolicitudInsertarTexto> {
  const fuera: Array<SolicitudBorrarRango | SolicitudInsertarTexto> = [];
  const endIndex = Math.min(p.endIndex - 1, tope - 1);
  const rango: Rango = { startIndex: p.startIndex, endIndex };
  if (endIndex > p.startIndex) fuera.push({ deleteContentRange: { range: rango } });
  if (texto) fuera.push({ insertText: { location: { index: p.startIndex }, text: texto } });
  return fuera;
}

/**
 * Los dos párrafos de Actividades Generales, con lo que se capturó.
 *
 * El segundo se quita **cuando no hay texto de alcance**, junto con el
 * renglón en blanco que lo sigue — es la regla del legacy, y es de captura,
 * no del título: una cotización sin alcance capturado simplemente no lo
 * imprime.
 */
export function ajustarActividades(doc: DocumentoDocs, documento: DatosDocumento): Ajuste {
  const lista = prosa(doc);
  const tope = topeDeSegmento(doc).get("") ?? 0;
  const avisos: string[] = [];
  const solicitudes: Array<SolicitudBorrarRango | SolicitudInsertarTexto> = [];

  const objeto = buscar(lista, INICIO_DE.objeto);
  const alcance = buscar(lista, INICIO_DE.alcance);

  // El alcance primero: está más abajo, y todo lo que mueve índices se emite
  // de abajo hacia arriba.
  if (!alcance) {
    avisos.push(
      "La plantilla no trae el párrafo del alcance: ese texto no va a salir en el documento.",
    );
  } else if (documento.sinAlcance || !documento.alcance.trim()) {
    const siguiente = lista[lista.indexOf(alcance) + 1];
    const hasta = vacio(siguiente) ? siguiente.endIndex : alcance.endIndex;
    const endIndex = Math.min(hasta, tope - 1);
    if (endIndex > alcance.startIndex) {
      solicitudes.push({
        deleteContentRange: { range: { startIndex: alcance.startIndex, endIndex } },
      });
    }
  } else {
    solicitudes.push(...reemplazarTexto(alcance, documento.alcance.trim(), tope));
  }

  if (!objeto) {
    avisos.push(
      "La plantilla no trae el párrafo del objeto: ese texto no va a salir en el documento.",
    );
  } else if (documento.objeto.trim()) {
    solicitudes.push(...reemplazarTexto(objeto, documento.objeto.trim(), tope));
  }

  return { solicitudes, avisos };
}

/**
 * Los Términos empiezan en hoja nueva.
 *
 * `pageBreakBefore` no existe en `DocumentApp`: el legacy tiene que llamar a
 * la API de Docs después de guardar para ponerlo (`COT_05:1418`). Los tres
 * documentos reales lo traen, sin excepción.
 *
 * Es una solicitud de estilo, así que no mueve índices.
 */
export function saltoAntesDeTerminos(doc: DocumentoDocs): Ajuste {
  const p = buscar(prosa(doc), INICIO_DE.terminos);
  if (!p) {
    return {
      solicitudes: [],
      avisos: [
        'No encontré el renglón "Términos y Condiciones Comerciales": ' +
          "van a salir pegados al cuadro en vez de en hoja nueva.",
      ],
    };
  }
  return {
    solicitudes: [
      {
        updateParagraphStyle: {
          range: { startIndex: p.startIndex, endIndex: p.endIndex },
          paragraphStyle: { pageBreakBefore: true },
          fields: "pageBreakBefore",
        },
      },
    ],
    avisos: [],
  };
}
