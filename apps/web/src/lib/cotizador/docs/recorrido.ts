/**
 * Recorrer un documento de Google Docs tal como lo devuelve `documents.get`.
 *
 * Todo lo de aquí es de solo lectura y sin red: recibe el JSON y devuelve
 * dónde están las cosas. Es la base sobre la que se arman las solicitudes, y
 * el motivo de que armarlas se pueda probar sin tocar Google.
 *
 * El documento tiene varios **segmentos** —el cuerpo, cada encabezado, cada
 * pie— y los índices son relativos a su segmento. Por eso casi todo lo de
 * aquí devuelve el `segmentId` junto con el rango: una solicitud que no diga
 * de qué segmento habla se aplica al cuerpo, y borraría el renglón equivocado.
 */
import type {
  DocumentoDocs,
  ElementoEstructural,
  Parrafo,
  Segmento,
  Tabla,
} from "./tipos";

/** El cuerpo no tiene id; los encabezados y pies sí. `""` es el cuerpo. */
export type IdSegmento = string;

export interface SegmentoConId {
  segmentId: IdSegmento;
  segmento: Segmento;
}

/** El cuerpo primero y después cada encabezado y cada pie, con su id. */
export function segmentos(doc: DocumentoDocs): SegmentoConId[] {
  const fuera: SegmentoConId[] = [];
  if (doc.body) fuera.push({ segmentId: "", segmento: doc.body });
  for (const [id, seg] of Object.entries(doc.headers ?? {})) {
    fuera.push({ segmentId: id, segmento: seg });
  }
  for (const [id, seg] of Object.entries(doc.footers ?? {})) {
    fuera.push({ segmentId: id, segmento: seg });
  }
  return fuera;
}

// ── Párrafos ──────────────────────────────────────────────────────────────────

export interface ParrafoUbicado {
  parrafo: Parrafo;
  segmentId: IdSegmento;
  startIndex: number;
  endIndex: number;
  /** El texto del párrafo, incluido su `\n` final. */
  texto: string;
  /** Dentro de una celda: la tabla y la celda donde vive. */
  dentroDeTabla?: { tablaStartIndex: number; fila: number; columna: number };
}

/** El texto de un párrafo, concatenando sus `textRun`. */
export function textoDeParrafo(p: Parrafo): string {
  return (p.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
}

/**
 * Todos los párrafos del documento, en orden, **incluidos los de las celdas**.
 *
 * Los de dentro de una tabla vienen marcados con `dentroDeTabla`: hay
 * operaciones —borrar un renglón del bloque del contacto— que no deben tocar
 * nada que esté dentro de la tabla de partidas.
 */
export function parrafos(doc: DocumentoDocs): ParrafoUbicado[] {
  const fuera: ParrafoUbicado[] = [];

  const recorrer = (
    contenido: ElementoEstructural[] | undefined,
    segmentId: IdSegmento,
    dentro?: ParrafoUbicado["dentroDeTabla"],
  ) => {
    for (const el of contenido ?? []) {
      if (el.paragraph) {
        fuera.push({
          parrafo: el.paragraph,
          segmentId,
          startIndex: el.startIndex ?? 0,
          endIndex: el.endIndex ?? 0,
          texto: textoDeParrafo(el.paragraph),
          ...(dentro ? { dentroDeTabla: dentro } : {}),
        });
      }
      if (el.table) {
        const tablaStartIndex = el.startIndex ?? 0;
        (el.table.tableRows ?? []).forEach((fila, f) => {
          (fila.tableCells ?? []).forEach((celda, c) => {
            recorrer(celda.content, segmentId, { tablaStartIndex, fila: f, columna: c });
          });
        });
      }
    }
  };

  for (const { segmentId, segmento } of segmentos(doc)) {
    recorrer(segmento.content, segmentId);
  }
  return fuera;
}

/** Todo el texto del documento, para buscar marcadores sin recorrer dos veces. */
export function textoDelDocumento(doc: DocumentoDocs): string {
  return parrafos(doc)
    .map((p) => p.texto)
    .join("");
}

// ── Tablas ────────────────────────────────────────────────────────────────────

export interface TablaUbicada {
  tabla: Tabla;
  segmentId: IdSegmento;
  /**
   * El índice del **elemento estructural** de la tabla, que es lo que pide
   * `tableStartLocation`. No es el de su primera celda.
   */
  startIndex: number;
  endIndex: number;
}

/** Las tablas de primer nivel de cada segmento, en orden. */
export function tablas(doc: DocumentoDocs): TablaUbicada[] {
  const fuera: TablaUbicada[] = [];
  for (const { segmentId, segmento } of segmentos(doc)) {
    for (const el of segmento.content ?? []) {
      if (el.table) {
        fuera.push({
          tabla: el.table,
          segmentId,
          startIndex: el.startIndex ?? 0,
          endIndex: el.endIndex ?? 0,
        });
      }
    }
  }
  return fuera;
}

/** El texto de una celda, ya recortado. */
export function textoDeCelda(tabla: Tabla, fila: number, columna: number): string {
  const celda = tabla.tableRows?.[fila]?.tableCells?.[columna];
  return (celda?.content ?? [])
    .map((el) => (el.paragraph ? textoDeParrafo(el.paragraph) : ""))
    .join("")
    .trim();
}

/**
 * La tabla de partidas: **la primera cuya celda (0,0) diga `PARTIDA`**.
 *
 * Por contenido y no por posición, que es la regla del legacy
 * (`COT_05:492-499`): la plantilla se edita a mano y una tabla de más arriba
 * movería la posición sin que nadie se entere. El encabezado, en cambio, es
 * lo que no cambia — si alguien lo cambia, el error sale aquí y no en el PDF.
 */
export function tablaDePartidas(doc: DocumentoDocs): TablaUbicada | null {
  for (const t of tablas(doc)) {
    if (!t.tabla.tableRows?.length) continue;
    if (textoDeCelda(t.tabla, 0, 0).toUpperCase() === "PARTIDA") return t;
  }
  return null;
}

// ── Viñetas ───────────────────────────────────────────────────────────────────

/**
 * El párrafo con viñeta que sirve de molde, dentro de una celda de la tabla.
 *
 * El original clona un `ListItem` para heredar el estilo exacto
 * (`prototipoDeVineta_`). La API de Docs **no deja asignar un `listId`
 * existente a un párrafo nuevo**: lo que sí se puede es insertar el texto
 * pegado a un renglón que ya es de esa lista, para que entre en ella, y
 * quitar el molde al final.
 *
 * Por eso lo que hace falta no es el estilo sino **dónde está el molde**.
 */
export function moldeDeVineta(doc: DocumentoDocs): ParrafoUbicado | null {
  const conVineta = parrafos(doc).filter((p) => p.parrafo.bullet?.listId);
  if (conVineta.length === 0) return null;
  // El de dentro de la tabla de partidas manda: es el que trae la letra y el
  // color de la tabla. El de "Documentos Aplicables" viene en rojo.
  return conVineta.find((p) => p.dentroDeTabla) ?? conVineta[0];
}
