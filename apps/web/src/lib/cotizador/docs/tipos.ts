/**
 * El trozo del esquema de la API de Google Docs que este módulo necesita.
 *
 * No es el esquema completo —tiene decenas de campos que no usamos— sino lo
 * justo para recorrer un documento y escribir solicitudes contra él. Está aquí
 * y no en `googleapis` a propósito: así la lógica que arma las solicitudes no
 * importa el cliente de Google, y se puede probar con un documento inventado.
 *
 * Referencia: https://developers.google.com/docs/api/reference/rest/v1/documents
 *
 * ── Los índices, que son lo que hace difícil esto ──
 *
 * Cada elemento del documento vive en un rango `[startIndex, endIndex)` sobre
 * un flujo de caracteres. Una solicitud que inserta o borra **corre todos los
 * índices posteriores**, y la API aplica las solicitudes en orden dentro del
 * mismo `batchUpdate`. Por eso las operaciones estructurales se emiten de
 * atrás hacia adelante: así ningún índice calculado sobre el documento
 * original queda inválido a media lista.
 */

// ── El documento ──────────────────────────────────────────────────────────────

export interface EstiloTexto {
  bold?: boolean;
  italic?: boolean;
  fontSize?: { magnitude: number; unit: string };
  weightedFontFamily?: { fontFamily: string; weight?: number };
  foregroundColor?: { color?: { rgbColor?: { red?: number; green?: number; blue?: number } } };
}

export interface EstiloParrafo {
  namedStyleType?: string;
  alignment?: string;
  indentStart?: { magnitude: number; unit: string };
  indentFirstLine?: { magnitude: number; unit: string };
  spaceAbove?: { magnitude: number; unit: string };
  spaceBelow?: { magnitude: number; unit: string };
}

export interface ElementoDeParrafo {
  startIndex?: number;
  endIndex?: number;
  textRun?: { content: string; textStyle?: EstiloTexto };
  /** Un salto de página, una imagen, etc. No los tocamos, pero ocupan índice. */
  pageBreak?: unknown;
  inlineObjectElement?: unknown;
}

/** La viñeta de un párrafo: de qué lista es y en qué nivel. */
export interface Vineta {
  listId: string;
  nestingLevel?: number;
  textStyle?: EstiloTexto;
}

export interface Parrafo {
  elements?: ElementoDeParrafo[];
  paragraphStyle?: EstiloParrafo;
  bullet?: Vineta;
}

/** Un borde de celda. `width: 0` y color blanco es como se "quita" una línea. */
export interface Borde {
  color?: { color?: { rgbColor?: { red?: number; green?: number; blue?: number } } };
  width?: { magnitude: number; unit: string };
  dashStyle?: string;
}

export interface EstiloCelda {
  borderLeft?: Borde;
  borderRight?: Borde;
  borderTop?: Borde;
  borderBottom?: Borde;
  /** Solo de lectura: cuántas filas y columnas ocupa una celda ya unida. */
  rowSpan?: number;
  columnSpan?: number;
  paddingTop?: { magnitude: number; unit: string };
  paddingBottom?: { magnitude: number; unit: string };
  contentAlignment?: string;
}

export interface CeldaTabla {
  startIndex?: number;
  endIndex?: number;
  content?: ElementoEstructural[];
  tableCellStyle?: EstiloCelda;
}

export interface FilaTabla {
  startIndex?: number;
  endIndex?: number;
  tableCells?: CeldaTabla[];
}

export interface Tabla {
  rows?: number;
  columns?: number;
  tableRows?: FilaTabla[];
}

export interface ElementoEstructural {
  startIndex?: number;
  endIndex?: number;
  paragraph?: Parrafo;
  table?: Tabla;
  sectionBreak?: unknown;
  tableOfContents?: unknown;
}

export interface Segmento {
  content?: ElementoEstructural[];
}

export interface DocumentoDocs {
  documentId?: string;
  title?: string;
  body?: Segmento;
  headers?: Record<string, Segmento>;
  footers?: Record<string, Segmento>;
  /** Las listas del documento, por id. De aquí sale el estilo de una viñeta. */
  lists?: Record<string, { listProperties?: { nestingLevels?: unknown[] } }>;
}

// ── Las solicitudes ───────────────────────────────────────────────────────────

/**
 * Las solicitudes de `batchUpdate` que usamos.
 *
 * Es una unión cerrada y no `unknown` para que una solicitud mal armada no
 * llegue a la red: el compilador la rechaza, y las pruebas pueden afirmar
 * sobre la forma exacta.
 */
export type Solicitud =
  | SolicitudReemplazarTexto
  | SolicitudBorrarRango
  | SolicitudInsertarTexto
  | SolicitudEstiloTexto
  | SolicitudEstiloParrafo
  | SolicitudBorrarFila
  | SolicitudInsertarFila
  | SolicitudVinetas
  | SolicitudQuitarVinetas
  | SolicitudUnirCeldas
  | SolicitudEstiloCelda;

export interface SolicitudReemplazarTexto {
  replaceAllText: {
    containsText: { text: string; matchCase?: boolean };
    replaceText: string;
  };
}

export interface SolicitudBorrarRango {
  deleteContentRange: { range: Rango };
}

export interface SolicitudInsertarTexto {
  insertText: { location: { index: number }; text: string };
}

export interface SolicitudEstiloTexto {
  updateTextStyle: { range: Rango; textStyle: EstiloTexto; fields: string };
}

export interface SolicitudEstiloParrafo {
  updateParagraphStyle: { range: Rango; paragraphStyle: EstiloParrafo; fields: string };
}

export interface SolicitudBorrarFila {
  deleteTableRow: { tableCellLocation: UbicacionCelda };
}

export interface SolicitudInsertarFila {
  insertTableRow: { tableCellLocation: UbicacionCelda; insertBelow: boolean };
}

export interface SolicitudVinetas {
  createParagraphBullets: { range: Rango; bulletPreset: string };
}

/**
 * Quita la viñeta de los párrafos del rango.
 *
 * No cambia el texto, así que no corre ningún índice. Hace falta porque un
 * párrafo nuevo **hereda la viñeta** de aquel en el que se inserta: donde la
 * plantilla tiene una viñeta molde, todo lo que se escriba en esa celda sale
 * con viñeta si no se quita.
 */
export interface SolicitudQuitarVinetas {
  deleteParagraphBullets: { range: Rango };
}

export interface Rango {
  startIndex: number;
  endIndex: number;
  segmentId?: string;
}

export interface SolicitudUnirCeldas {
  mergeTableCells: { tableRange: RangoTabla };
}

export interface SolicitudEstiloCelda {
  updateTableCellStyle: {
    tableRange: RangoTabla;
    tableCellStyle: EstiloCelda;
    fields: string;
  };
}

export interface UbicacionCelda {
  tableStartLocation: { index: number };
  rowIndex: number;
  columnIndex: number;
}

/**
 * Un bloque rectangular de celdas.
 *
 * Habla en **filas y columnas**, no en índices de carácter: por eso unir
 * celdas y pintar bordes se puede emitir al final del lote, cuando los
 * índices de dentro de la tabla ya se movieron. Lo único que tiene que seguir
 * siendo válido es `tableStartLocation`, y eso solo cambia si se borra o se
 * inserta algo **antes** de la tabla.
 */
export interface RangoTabla {
  tableCellLocation: UbicacionCelda;
  rowSpan: number;
  columnSpan: number;
}
