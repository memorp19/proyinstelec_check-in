/**
 * Dónde está cada norma dentro de la plantilla.
 *
 * Las 23 normas **ya vienen impresas** en la plantilla, como viñetas bajo
 * "Documentos Aplicables y/o Referencias". Generar el documento no es
 * insertarlas: es **quitar las que no apliquen**. Por eso hace falta saber
 * qué párrafo es cuál.
 *
 * ── Por qué una tabla explícita y no la posición ──
 *
 * Por posición sería más corto y es exactamente lo que no queremos: el día
 * que alguien agregue una norma a la plantilla —o quite una— todas las de
 * abajo se correrían una, el documento saldría con las normas equivocadas y
 * nada fallaría. Anclar por texto hace que ese cambio se note: la norma
 * movida deja de encontrarse y sale un aviso.
 *
 * ── Y por qué el prefijo no es el `id` ni `Norma.texto` ──
 *
 * Por el `id` no funciona: ocho de las veintitrés no empiezan con el suyo
 * —`IEEE-242` se imprime como "IEEE – Recommended Practice…", `GEN-MANUAL`
 * como "Manual de operación…"—.
 *
 * Por `Norma.texto` falla una: el catálogo guarda el texto **corregido**
 * (`IEEE C57.12.90`, con su comilla cerrada) y la plantilla el original, con
 * el dedazo `IEEC`. El prefijo de aquí es lo que **de verdad dice la
 * plantilla**, carácter por carácter; corregirlo rompería la búsqueda.
 */
import { NORMAS } from "../normas";
import { parrafos, segmentos, type ParrafoUbicado } from "./recorrido";
import type { DocumentoDocs, Rango, SolicitudBorrarRango } from "./tipos";

/**
 * `id` del catálogo → con qué empieza ese renglón **en la plantilla**.
 *
 * El prefijo es lo más corto que distingue a esa norma de las otras
 * veintidós; la prueba lo verifica. Las rayas largas son `–` (U+2013), que es
 * lo que trae la plantilla: con un guion normal no encontraría nada.
 */
export const PREFIJO_EN_PLANTILLA: Readonly<Record<string, string>> = {
  "CFE-SOM-3531": "CFE-SOM-3531",
  "CFE-SOM-3532": "CFE-SOM-3532",
  "NOM-001-SEDE-2012": "NOM-001-SEDE-2012",
  "NOM-002-SEDE-2012": "NOM-002-SEDE-2012",
  "NOM-022-STPS-2015": "NOM-022-STPS-2015",
  "NOM-029-STPS-2011": "NOM-029-STPS-2011",
  "NMX-J-109-ANCE": "NMX-J-109-ANCE",
  "NMX-J-116-ANCE": "NMX-J-116-ANCE",
  "NMX-J-123-ANCE": "NMX-J-123-ANCE",
  "NMX-J-142-ANCE": "NMX-J-142-ANCE",
  "NMX-J-169-ANCE": "NMX-J-169-ANCE",
  "NMX-J-215-ANCE": "NMX-J-215-ANCE",
  "NMX-J-351-ANCE": "NMX-J-351-ANCE",
  "NMX-J-294-ANCE": "NMX-J-294-ANCE",
  "NMX-J-565/4-ANCE": "NMX-J-565/4-ANCE",
  // La plantilla dice "IEEC". Es un dedazo suyo, y es lo que hay que buscar.
  "IEEE-C57.12.90": "IEEC C57.12.90-1999",
  "IEEE-RED-BOOK": "IEEE Red Book",
  // Se distingue de la Red Book por la raya: "IEEE – …" contra "IEEE Red …".
  "IEEE-242": "IEEE – Recommended Practice for Protection",
  "NETA-MTS-2011": "ANSI NETA MTS-2011",
  "GEN-DIAGRAMAS": "Diagramas esquemáticos del fabricante",
  "GEN-MANUAL": "Manual de operación de equipo de medición",
  "GEN-INSTRUCTIVOS": "Instructivos del fabricante",
  "GEN-ESPECIFICACIONES": "Especificaciones técnicas del cliente",
};

export interface NormasUbicadas {
  /** El párrafo de cada norma que se encontró una sola vez. */
  encontradas: Map<string, ParrafoUbicado>;
  /** Las que no aparecen en la plantilla. */
  faltantes: string[];
  /** Las que aparecen más de una vez: no se sabe cuál quitar. */
  repetidas: string[];
  avisos: string[];
}

/**
 * Localiza las 23 normas en el documento.
 *
 * Nunca lanza. Una norma que no aparece —o que aparece dos veces— es un aviso
 * para la vista previa, no un error: la cotización se tiene que poder generar
 * aunque alguien haya editado la plantilla.
 */
export function normasEnPlantilla(doc: DocumentoDocs): NormasUbicadas {
  // Solo las viñetas: el título "Documentos Aplicables…" y los párrafos de
  // prosa no son normas aunque alguno empiece parecido.
  const candidatos = parrafos(doc).filter((p) => p.parrafo.bullet?.listId && !p.dentroDeTabla);

  const encontradas = new Map<string, ParrafoUbicado>();
  const faltantes: string[] = [];
  const repetidas: string[] = [];

  for (const { id } of NORMAS) {
    const prefijo = PREFIJO_EN_PLANTILLA[id];
    if (!prefijo) {
      faltantes.push(id);
      continue;
    }
    const coinciden = candidatos.filter((p) => p.texto.trimStart().startsWith(prefijo));
    if (coinciden.length === 0) faltantes.push(id);
    else if (coinciden.length > 1) repetidas.push(id);
    else encontradas.set(id, coinciden[0]);
  }

  const avisos: string[] = [];
  if (faltantes.length > 0) {
    avisos.push(
      `La plantilla no trae ${faltantes.length} de las normas del catálogo ` +
        `(${faltantes.join(", ")}): esas no se pueden quitar del documento.`,
    );
  }
  if (repetidas.length > 0) {
    avisos.push(
      `En la plantilla hay más de un renglón para ${repetidas.join(", ")}. ` +
        "No se tocaron: no se sabe cuál es el bueno.",
    );
  }

  return { encontradas, faltantes, repetidas, avisos };
}

/** El último índice borrable de cada segmento; la API no deja quitar el `\n` final. */
function finDeSegmento(doc: DocumentoDocs): Map<string, number> {
  const fuera = new Map<string, number>();
  for (const { segmentId, segmento } of segmentos(doc)) {
    const ultimo = (segmento.content ?? []).at(-1);
    if (ultimo?.endIndex !== undefined) fuera.set(segmentId, ultimo.endIndex);
  }
  return fuera;
}

export interface NormasQuitadas {
  solicitudes: SolicitudBorrarRango[];
  avisos: string[];
}

/**
 * Quita de la plantilla las normas que no se eligieron.
 *
 * `elegidas` son los ids que sí salen (lo que devuelve `normasElegidas`). Lo
 * que no esté ahí se borra, párrafo completo.
 *
 * De atrás hacia adelante, por lo de siempre: `deleteContentRange` corre los
 * índices posteriores y la API aplica en orden.
 */
export function quitarNormas(doc: DocumentoDocs, elegidas: string[]): NormasQuitadas {
  const ubicadas = normasEnPlantilla(doc);
  const sobran = new Set(elegidas);
  const fin = finDeSegmento(doc);
  const rangos: Rango[] = [];

  for (const [id, p] of ubicadas.encontradas) {
    if (sobran.has(id)) continue;
    const tope = fin.get(p.segmentId) ?? p.endIndex;
    const endIndex = Math.min(p.endIndex, tope - 1);
    if (endIndex <= p.startIndex) continue;
    rangos.push({
      startIndex: p.startIndex,
      endIndex,
      ...(p.segmentId ? { segmentId: p.segmentId } : {}),
    });
  }

  rangos.sort((a, b) => b.startIndex - a.startIndex);

  // Una norma elegida que la plantilla no trae sí merece aviso aparte: el
  // cliente no la va a ver aunque alguien la haya palomeado.
  const avisos = [...ubicadas.avisos];
  const elegidasQueFaltan = elegidas.filter((id) => ubicadas.faltantes.includes(id));
  if (elegidasQueFaltan.length > 0) {
    avisos.push(
      `Se eligieron normas que la plantilla no imprime (${elegidasQueFaltan.join(", ")}): ` +
        "no van a salir en el documento.",
    );
  }

  return { solicitudes: rangos.map((range) => ({ deleteContentRange: { range } })), avisos };
}
