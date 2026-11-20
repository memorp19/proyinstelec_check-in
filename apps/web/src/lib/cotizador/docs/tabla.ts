/**
 * La tabla de partidas: filas, totales y cantidad en letra.
 *
 * Es la parte del documento que no se resuelve con marcadores. La plantilla
 * trae un cuadro de ejemplo —encabezado, 22 renglones en blanco y tres de
 * totales con importes inventados— y aquí se convierte en el cuadro de una
 * cotización concreta.
 *
 * ── Los índices, que es lo que hace difícil este archivo ──
 *
 * `batchUpdate` aplica las solicitudes **en orden**, y cada inserción o
 * borrado corre todos los índices posteriores. Como el lote se arma a ciegas
 * —no hay forma de releer el documento a media lista— el orden de emisión es
 * parte del algoritmo y no un detalle de estilo:
 *
 * 1. **Filas** (`deleteTableRow` / `insertTableRow`). Hablan de filas y
 *    columnas, no de caracteres. Se borra de abajo hacia arriba para que los
 *    índices de fila de las que faltan sigan siendo válidos.
 * 2. **Textos** (`insertText`), de la última celda a la primera. Insertar en
 *    una posición no mueve nada que esté **antes**, así que cada inserción se
 *    calcula sobre la tabla todavía en blanco.
 * 3. **Estilos** (`updateTextStyle`, `updateParagraphStyle`). No cambian
 *    longitudes, así que van al final, calculados sobre la tabla ya llena.
 * 4. **Unir celdas y bordes** (`mergeTableCells`, `updateTableCellStyle`).
 *    Hablan de filas y columnas: lo único suyo que es un índice de carácter
 *    es dónde empieza la tabla, y eso no se mueve mientras no se toque nada
 *    anterior a ella.
 *
 * Por eso `solicitudesDelDocumento` pone **primero** lo de la tabla y después
 * lo del bloque del destinatario, que está más arriba en el documento.
 *
 * ── La aritmética ──
 *
 * Un párrafo ocupa `texto.length` índices contando su `\n`. Una celda ocupa
 * uno más (su marca de inicio) que la suma de sus párrafos. Una fila, uno más
 * que la suma de sus celdas. Con eso, una fila en blanco de cinco columnas
 * mide exactamente 11, que es lo que mide en la plantilla real.
 */
import type { Armado } from "../armado";
import { bloquesDeDescripcion, bloquesVisibles, type Bloque } from "../bloques";
import { importeParaDocumento, cantidadConUnidad } from "../presentacion";
import { importeEnLetra } from "../letras";
import type { Moneda, ResultadoCotizacion } from "../tipos";
import { agregar, PARTES, todas, type Parte, type Tramo } from "./lote";
import { tablaDePartidas } from "./recorrido";
import type {
  DocumentoDocs,
  Rango,
  Solicitud,
  SolicitudEstiloCelda,
  SolicitudEstiloFila,
  SolicitudFijarEncabezado,
  SolicitudUnirCeldas,
  UbicacionCelda,
} from "./tipos";

// ── Lo que entra ──────────────────────────────────────────────────────────────

export interface PartidaDeTabla {
  /** El número que sale en la primera columna. */
  numero: number;
  titulo: string;
  formato: "NORMAL" | "NEGRITAS" | "OCULTO";
  bloques: Bloque[];
  cantidad: number;
  unidad: string;
  precioUnitario: number;
  importe: number;
  /**
   * La nota de la partida, que sale en su **propio renglón, sin número**,
   * debajo del concepto y en negritas.
   *
   * Es un renglón y no un párrafo más dentro de la celda porque así sale en
   * los documentos reales: la nota habla de la partida entera —«el cliente
   * proporciona la plataforma», «el software que se usará»— y mezclarla con
   * el alcance la haría parecer una viñeta más de lo que se incluye.
   */
  nota?: string;
}

export interface TotalesDeTabla {
  moneda: Moneda;
  /**
   * El que se imprime, que **ya incluye la asesoría**.
   *
   * En nuestro motor la asesoría va dentro del precio de cada partida
   * (`calculo.ts`, paso 5), así que `ResultadoCotizacion.subtotal` es la base
   * gravable y es justo lo que el documento llama "Subtotal". El ERP viejo la
   * llevaba aparte y la sumaba al imprimir; sumarla aquí la contaría dos
   * veces.
   */
  subtotal: number;
  iva: number;
  total: number;
}

export interface DatosDeTabla {
  partidas: PartidaDeTabla[];
  /** El renglón sin número de arriba: "Servicio de … / Incluye:". */
  encabezado?: Bloque[];
  totales: TotalesDeTabla;
}

/**
 * Cómo se dibujan las viñetas del concepto.
 *
 * `GUION` escribe el guion como texto, con sangría colgante. Es el respaldo
 * que el propio ERP viejo trae escrito (`COT_05:1096-1101`) para cuando no
 * encuentra un molde, y sale igual que el guion de la plantilla porque la
 * plantilla usa justamente un guion.
 *
 * `LISTA` clonará el molde de la copia de la plantilla. Todavía no: necesita
 * probarse contra un documento de verdad, y este PR no habla con Google.
 */
export type EstiloVinetas = "GUION";

export interface OpcionesDeTabla {
  vinetas?: EstiloVinetas;
}

/**
 * El cuadro de una cotización, a partir del armado y de lo que calculó el
 * motor.
 *
 * Son dos fuentes porque son dos cosas: del armado sale lo que se capturó
 * —título, bloques, formato, unidad— y del cálculo lo que se cobra. Unirlas
 * aquí, en un solo lugar, evita que la vista previa y el PDF saquen el precio
 * de sitios distintos.
 */
export function tablaDeCotizacion(armado: Armado, calculo: ResultadoCotizacion): DatosDeTabla {
  const calculadas = new Map(calculo.partidas.map((p) => [p.id, p]));

  const partidas: PartidaDeTabla[] = armado.partidas.map((p) => {
    const c = calculadas.get(p.id);
    return {
      numero: c?.orden ?? p.orden,
      titulo: p.titulo,
      formato: p.formato,
      bloques: p.bloques,
      cantidad: c?.cantidad ?? p.cantidad,
      unidad: p.unidad,
      precioUnitario: c?.precioUnitario ?? 0,
      importe: c?.importe ?? 0,
      nota: p.notas ?? undefined,
    };
  });

  return {
    partidas,
    encabezado: bloquesDeDescripcion(armado.documento.encabezadoTabla),
    totales: {
      moneda: calculo.moneda,
      // Ya trae la asesoría dentro; ver `TotalesDeTabla.subtotal`.
      subtotal: calculo.subtotal,
      iva: calculo.iva,
      total: calculo.total,
    },
  };
}

// ── Medidas de la plantilla ───────────────────────────────────────────────────

/** Las cinco columnas, en el orden en que están. */
const COLUMNAS = 5;
const COL_NUMERO = 0;
const COL_CONCEPTO = 1;
const COL_CANTIDAD = 2;
const COL_UNITARIO = 3;
const COL_IMPORTE = 4;

/** Los tres renglones de totales: Subtotal, IVA y Total. */
const FILAS_DE_TOTALES = 3;

/** Dónde va la letra: tercera fila, tercera columna. */
const COLUMNA_DE_LA_LETRA = 2;

/** Arial 8 negro, que es lo que trae la tabla hecha a mano. */
const LETRA = "Arial";
const TAMANO = 8;

/** Las sangrías del respaldo de guion, en puntos (`COT_05:1099`). */
const SANGRIA = {
  vineta: { inicio: 36, primera: 22 },
  subvineta: { inicio: 54, primera: 40 },
};

const PT = (magnitude: number) => ({ magnitude, unit: "PT" });

// ── El modelo de la tabla ya llena ────────────────────────────────────────────

/** Un párrafo dentro de una celda, con lo que hay que hacerle después. */
interface ParrafoPlano {
  texto: string;
  negritas?: boolean;
  sangria?: { inicio: number; primera: number };
  alineacion?: "JUSTIFIED" | "CENTER" | "START";
}

type Celda = ParrafoPlano[];
type Fila = Celda[];

const vacia = (): Celda => [{ texto: "" }];

/** El texto que se inserta en una celda: sus párrafos unidos por `\n`. */
const textoDeCelda = (c: Celda): string => c.map((p) => p.texto).join("\n");

/**
 * Los párrafos del concepto de una partida, en el orden en que se leen.
 *
 * El título va primero, en letra normal o en negritas según el formato de la
 * partida; `OCULTO` lo quita y deja solo los bloques. Es la regla del
 * original (`COT_05:1120-1125`).
 */
function conceptoDePartida(p: PartidaDeTabla, opciones: OpcionesDeTabla): Celda {
  const fuera: ParrafoPlano[] = [];

  if (p.formato !== "OCULTO" && p.titulo.trim()) {
    fuera.push({ texto: p.titulo.trim(), negritas: p.formato === "NEGRITAS" });
  }

  for (const b of p.bloques) {
    switch (b.tipo) {
      case "subtitulo":
        fuera.push({ texto: b.texto, negritas: true, alineacion: "JUSTIFIED" });
        break;
      case "parrafo":
      case "texto":
        fuera.push({ texto: b.texto, alineacion: "JUSTIFIED" });
        break;
      case "vineta":
      case "subvineta": {
        // Una viñeta sin texto no sale: en la pantalla es un renglón que
        // alguien dejó a medias, no un renglón en blanco a propósito.
        if (!b.texto.trim()) break;
        const nivel = b.tipo === "vineta" ? "vineta" : "subvineta";
        fuera.push({
          texto: textoDeVineta(b.texto, nivel, opciones),
          sangria: SANGRIA[nivel],
          alineacion: "JUSTIFIED",
        });
        break;
      }
      case "espacio":
        fuera.push({ texto: "" });
        break;
    }
  }

  return fuera.length > 0 ? fuera : vacia();
}

/** El renglón de una viñeta, con su marca. */
function textoDeVineta(
  texto: string,
  nivel: "vineta" | "subvineta",
  _opciones: OpcionesDeTabla,
): string {
  // El respaldo del original: el guion como texto y la sangría colgante hace
  // el resto. Sale igual que la viñeta de la plantilla, que es un guion.
  return `${nivel === "subvineta" ? "      " : ""}-   ${texto.trim()}`;
}

/** Las filas de partidas, con el renglón de encabezado si lo hay. */
function filasDePartidas(d: DatosDeTabla, opciones: OpcionesDeTabla): Fila[] {
  const fuera: Fila[] = [];

  if (d.encabezado && bloquesVisibles(d.encabezado).length > 0) {
    const celda = conceptoDePartida(
      {
        numero: 0,
        titulo: "",
        formato: "OCULTO",
        bloques: d.encabezado,
        cantidad: 0,
        unidad: "",
        precioUnitario: 0,
        importe: 0,
      },
      opciones,
    );
    fuera.push([vacia(), celda, vacia(), vacia(), vacia()]);
  }

  const moneda = d.totales.moneda;
  for (const p of d.partidas) {
    fuera.push([
      [{ texto: String(p.numero), alineacion: "CENTER" }],
      conceptoDePartida(p, opciones),
      [{ texto: cantidadConUnidad(p.cantidad, p.unidad), alineacion: "CENTER" }],
      [{ texto: importeParaDocumento(p.precioUnitario, moneda), alineacion: "CENTER" }],
      [{ texto: importeParaDocumento(p.importe, moneda), alineacion: "CENTER" }],
    ]);

    const nota = (p.nota ?? "").trim();
    if (nota) {
      fuera.push([
        vacia(),
        [{ texto: nota, negritas: true, alineacion: "JUSTIFIED" }],
        vacia(),
        vacia(),
        vacia(),
      ]);
    }
  }

  return fuera;
}

/**
 * Las tres filas de totales.
 *
 * La letra va en la **tercera columna de la tercera fila** y no en la
 * primera: al unir, Docs junta el contenido de las celdas en orden, y ahí es
 * donde queda abajo, a la altura de "Total" (`COT_05:1231-1233`).
 */
function filasDeTotales(t: TotalesDeTabla): Fila[] {
  const renglones: Array<[string, string]> = [
    ["Subtotal:", importeParaDocumento(t.subtotal, t.moneda)],
    ["IVA:", importeParaDocumento(t.iva, t.moneda)],
    ["Total:", importeParaDocumento(t.total, t.moneda)],
  ];
  const letra = importeEnLetra(t.total, t.moneda);

  // Sin negritas, ni en el Total ni en la letra. Los tres documentos reales
  // los traen en letra normal: la jerarquía la hacen el recuadro y la
  // posición, no el grosor.
  return renglones.map(([etiqueta, importe], f) => {
    const fila: Fila = [vacia(), vacia(), vacia(), vacia(), vacia()];
    fila[COL_UNITARIO] = [{ texto: etiqueta, alineacion: "START" }];
    fila[COL_IMPORTE] = [{ texto: importe, alineacion: "CENTER" }];
    if (f === 2) {
      fila[COLUMNA_DE_LA_LETRA] = [{ texto: letra, alineacion: "START" }];
    }
    return fila;
  });
}

// ── La aritmética de índices ──────────────────────────────────────────────────

/** Lo que mide una fila en blanco de cinco columnas. La plantilla da 11. */
const LARGO_FILA_VACIA = 1 + COLUMNAS * 2;

/** Lo que mide una fila ya llena. */
function largoDeFila(fila: Fila): number {
  return fila.reduce((s, celda) => s + 2 + textoDeCelda(celda).length, 1);
}

/**
 * Dónde empieza el párrafo de una celda, dada la posición de su fila.
 *
 * `fila + 1` salta la marca de la fila; cada celda anterior ocupa su marca
 * más su contenido; `+ 1` más salta la marca de esta celda.
 */
function inicioDeCelda(inicioFila: number, fila: Fila, columna: number): number {
  let i = inicioFila + 1;
  for (let c = 0; c < columna; c++) i += 2 + textoDeCelda(fila[c]).length;
  return i + 1;
}

/** Lo mismo cuando la tabla todavía está en blanco: todas las celdas miden 1. */
const inicioDeCeldaVacia = (inicioFila: number, columna: number): number =>
  inicioFila + 2 + columna * 2;

// ── El armado ─────────────────────────────────────────────────────────────────

export interface TablaArmada {
  /** Todas, en el orden en que van al lote. */
  solicitudes: Solicitud[];
  /**
   * Las mismas, en el mismo orden, con la parte a la que pertenece cada una:
   * la tabla, los totales, la letra o alguno de sus formatos. Ver `lote.ts`.
   */
  tramos: Tramo[];
  avisos: string[];
  /** Cuántas filas quedó midiendo la tabla, encabezado incluido. */
  filas: number;
}

/**
 * Las solicitudes que convierten el cuadro de ejemplo en el de la cotización.
 *
 * Pura: recibe el JSON de la plantilla y los datos, y devuelve la lista. No
 * toca Google.
 */
export function solicitudesDeTabla(
  doc: DocumentoDocs,
  datos: DatosDeTabla,
  opciones: OpcionesDeTabla = {},
): TablaArmada {
  const ubicada = tablaDePartidas(doc);
  if (!ubicada) {
    return {
      solicitudes: [],
      tramos: [],
      avisos: [
        "La plantilla no trae la tabla de partidas (ninguna tabla empieza con " +
          "«Partida»): el documento va a salir sin el cuadro.",
      ],
      filas: 0,
    };
  }

  const avisos: string[] = [];
  const cuerpo = [...filasDePartidas(datos, opciones), ...filasDeTotales(datos.totales)];
  const filasEnPlantilla = ubicada.tabla.tableRows?.length ?? 0;

  if (filasEnPlantilla < 2) {
    return {
      solicitudes: [],
      tramos: [],
      avisos: [
        "La tabla de partidas de la plantilla no trae un renglón de ejemplo debajo " +
          "del encabezado: sin él no hay de dónde copiar el formato.",
      ],
      filas: filasEnPlantilla,
    };
  }

  const tramos: Tramo[] = [];
  const poner = (parte: Parte, ...s: Solicitud[]) => agregar(tramos, parte, s);
  const tabla = { index: ubicada.startIndex };
  const celda = (rowIndex: number, columnIndex: number): UbicacionCelda => ({
    tableStartLocation: tabla,
    rowIndex,
    columnIndex,
  });

  // De qué parte es cada celda, para nombrarla si Google la rechaza. `k` es
  // el renglón dentro de `cuerpo`, desde 0.
  const primerTotal = cuerpo.length - FILAS_DE_TOTALES;
  const parteDeCelda = (k: number, c: number): Parte =>
    k < primerTotal
      ? PARTES.tabla
      : k === cuerpo.length - 1 && c === COLUMNA_DE_LA_LETRA
        ? PARTES.letra
        : PARTES.totales;

  // ── 1. Las filas ────────────────────────────────────────────────────────────
  // Se conserva la 1, que es el molde: trae los bordes, los anchos y la letra
  // del cuadro hecho a mano. Las demás se borran y se vuelven a crear como
  // copias suyas, igual que el original (`COT_05:962-966`).
  for (let f = filasEnPlantilla - 1; f >= 2; f--) {
    poner(PARTES.tabla, { deleteTableRow: { tableCellLocation: celda(f, 0) } });
  }
  for (let i = 0; i < cuerpo.length - 1; i++) {
    poner(PARTES.tabla, { insertTableRow: { tableCellLocation: celda(1, 0), insertBelow: true } });
  }

  // ── 2. Los textos, de la última celda a la primera ──────────────────────────
  // Sobre la tabla todavía en blanco: insertar no mueve lo que está antes.
  const inicioDeFilaVacia = (k: number): number =>
    ubicada.tabla.tableRows![1].startIndex! + (k - 1) * LARGO_FILA_VACIA;

  for (let k = cuerpo.length; k >= 1; k--) {
    const fila = cuerpo[k - 1];
    for (let c = COLUMNAS - 1; c >= 0; c--) {
      const texto = textoDeCelda(fila[c]);
      if (!texto) continue;
      poner(parteDeCelda(k - 1, c), {
        insertText: { location: { index: inicioDeCeldaVacia(inicioDeFilaVacia(k), c) }, text: texto },
      });
    }
  }

  // ── 3. Los estilos, sobre la tabla ya llena ─────────────────────────────────
  const inicioFinal: number[] = [];
  let cursor = ubicada.tabla.tableRows![1].startIndex!;
  for (const fila of cuerpo) {
    inicioFinal.push(cursor);
    cursor += largoDeFila(fila);
  }

  // Sin viñetas en todo el cuerpo de la tabla.
  //
  // La copia de la plantilla para el ERP trae una viñeta molde en la celda
  // Concepto del renglón 1, y un párrafo nuevo **hereda la viñeta** de aquel
  // en el que se inserta: sin esto, el título de la primera partida saldría
  // con viñeta y sus viñetas saldrían con dos guiones. No cambia longitudes,
  // así que va con los estilos.
  poner(PARTES.tabla, {
    deleteParagraphBullets: {
      range: { startIndex: ubicada.tabla.tableRows![1].startIndex!, endIndex: cursor },
    },
  });

  // Arial 8 negro en todo el cuerpo de la tabla, marcas de párrafo incluidas:
  // es lo que le da color y tamaño al guion de las viñetas (`COT_05:1657`).
  //
  // Es contenido y no formato, aunque sea un estilo: sin él la tabla sale con
  // la letra y el tamaño del molde, y lo que se insertó, en rojo.
  poner(PARTES.tabla, {
    updateTextStyle: {
      range: { startIndex: ubicada.tabla.tableRows![1].startIndex!, endIndex: cursor },
      textStyle: {
        weightedFontFamily: { fontFamily: LETRA },
        fontSize: PT(TAMANO),
        foregroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
        bold: false,
      },
      fields: "weightedFontFamily,fontSize,foregroundColor,bold",
    },
  });

  cuerpo.forEach((fila, k) => {
    fila.forEach((celdaPlana, c) => {
      const parte = parteDeCelda(k, c);
      let i = inicioDeCelda(inicioFinal[k], fila, c);
      for (const p of celdaPlana) {
        const rango: Rango = { startIndex: i, endIndex: i + p.texto.length + 1 };
        if (p.alineacion || p.sangria) {
          poner(parte, {
            updateParagraphStyle: {
              range: rango,
              paragraphStyle: {
                ...(p.alineacion ? { alignment: p.alineacion } : {}),
                indentStart: PT(p.sangria?.inicio ?? 0),
                indentFirstLine: PT(p.sangria?.primera ?? 0),
                spaceAbove: PT(0),
                spaceBelow: PT(0),
              },
              fields: `${p.alineacion ? "alignment," : ""}indentStart,indentFirstLine,spaceAbove,spaceBelow`,
            },
          });
        }
        // Las negritas van después del barrido de arriba, que las apaga todas.
        if (p.negritas && p.texto) {
          poner(parte, {
            updateTextStyle: {
              range: { startIndex: i, endIndex: i + p.texto.length },
              textStyle: { bold: true },
              fields: "bold",
            },
          });
        }
        i += p.texto.length + 1;
      }
    });
  });

  // De aquí abajo todo es formato: si Google lo rechaza, el documento sale sin
  // esto y con un aviso (`lote.ts`). Ninguna de estas solicitudes mueve
  // índices, así que quitarlas no descuadra lo de arriba.

  // ── 4. Encabezado que se repite y filas que no se parten ────────────────────
  for (const s of filasDeLaTabla(tabla.index)) {
    poner("pinTableHeaderRows" in s ? PARTES.encabezadoFijo : PARTES.filasEnteras, s);
  }

  // ── 5. Quitar las líneas de más y unir la celda de la letra ─────────────────
  // Unir se queda al final del todo: después de unir, las columnas de esas
  // filas ya no son las mismas.
  poner(PARTES.bordes, ...lineasDeLaTabla(tabla.index, primerTotal));
  poner(PARTES.celdaUnida, ...celdaDeLaLetra(tabla.index, primerTotal));

  if (datos.partidas.length === 0) {
    avisos.push("La cotización no tiene partidas: el cuadro sale solo con los totales.");
  }

  return { solicitudes: todas(tramos), tramos, avisos, filas: cuerpo.length + 1 };
}

// ── Bordes y celdas unidas ────────────────────────────────────────────────────

/** Una línea que no se ve: ancho cero y blanca (`COT_05:1619-1620`). */
const SIN_LINEA = {
  width: PT(0),
  dashStyle: "SOLID",
  color: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } },
};

/**
 * Los bordes del cuadro, traducidos de `ajustarBordesConDocsApi_`.
 *
 * Tres cosas, y cada una tiene su motivo en el cuadro hecho a mano:
 *
 * - **Sin línea entre una partida y otra**: el cuadro se lee como un bloque.
 * - **Sin líneas verticales dentro de las partidas**: solo el contorno. El
 *   encabezado sí conserva las suyas.
 * - **Los totales**: las tres primeras columnas de las tres filas se unen en
 *   una sola celda sin recuadro, que es donde va la cantidad en letra.
 *
 * `filasDePartidas` es cuántas filas de partidas quedaron; los totales son
 * las tres siguientes.
 */
export function bordesDeLaTabla(
  inicioTabla: number,
  filasDePartidas: number,
): Array<SolicitudUnirCeldas | SolicitudEstiloCelda> {
  return [
    ...lineasDeLaTabla(inicioTabla, filasDePartidas),
    ...celdaDeLaLetra(inicioTabla, filasDePartidas),
  ];
}

/** Un bloque de celdas de la tabla que empieza en `inicioTabla`. */
const rangoDe =
  (inicioTabla: number) => (fila: number, columna: number, filas: number, columnas: number) => ({
    tableCellLocation: { tableStartLocation: { index: inicioTabla }, rowIndex: fila, columnIndex: columna },
    rowSpan: filas,
    columnSpan: columnas,
  });

/** La primera fila de partidas es la 1; la 0 es el encabezado. */
const PRIMERA_PARTIDA = 1;

/** Las dos primeras cosas de `bordesDeLaTabla`: las líneas que se quitan. */
function lineasDeLaTabla(inicioTabla: number, filasDePartidas: number): SolicitudEstiloCelda[] {
  const fuera: SolicitudEstiloCelda[] = [];
  const rango = rangoDe(inicioTabla);
  const primera = PRIMERA_PARTIDA;

  if (filasDePartidas > 1) {
    fuera.push({
      updateTableCellStyle: {
        tableRange: rango(primera, 0, filasDePartidas - 1, COLUMNAS),
        tableCellStyle: { borderBottom: SIN_LINEA },
        fields: "borderBottom",
      },
    });
    fuera.push({
      updateTableCellStyle: {
        tableRange: rango(primera + 1, 0, filasDePartidas - 1, COLUMNAS),
        tableCellStyle: { borderTop: SIN_LINEA },
        fields: "borderTop",
      },
    });
  }

  if (filasDePartidas > 0) {
    fuera.push({
      updateTableCellStyle: {
        tableRange: rango(primera, 1, filasDePartidas, COLUMNAS - 1),
        tableCellStyle: { borderLeft: SIN_LINEA },
        fields: "borderLeft",
      },
    });
    fuera.push({
      updateTableCellStyle: {
        tableRange: rango(primera, 0, filasDePartidas, COLUMNAS - 1),
        tableCellStyle: { borderRight: SIN_LINEA },
        fields: "borderRight",
      },
    });
  }

  return fuera;
}

/**
 * La tercera de `bordesDeLaTabla`: la celda de la letra, unida y sin recuadro.
 *
 * Va al final: después de unir, las columnas de esas filas ya no son las
 * mismas y cualquier otro rango sobre ellas apuntaría a otra cosa.
 */
function celdaDeLaLetra(
  inicioTabla: number,
  filasDePartidas: number,
): Array<SolicitudUnirCeldas | SolicitudEstiloCelda> {
  const rango = rangoDe(inicioTabla);
  const finPartidas = PRIMERA_PARTIDA + filasDePartidas; // primera fila que ya no es partida

  const fuera: Array<SolicitudUnirCeldas | SolicitudEstiloCelda> = [];
  fuera.push({
    mergeTableCells: { tableRange: rango(finPartidas, 0, FILAS_DE_TOTALES, 3) },
  });
  fuera.push({
    updateTableCellStyle: {
      tableRange: rango(finPartidas, 0, FILAS_DE_TOTALES, 3),
      // Abajo, no en medio: así la letra queda a la altura del renglón del
      // Total y no flotando entre Subtotal e IVA, que es como sale en los
      // documentos reales.
      tableCellStyle: {
        borderLeft: SIN_LINEA,
        borderBottom: SIN_LINEA,
        contentAlignment: "BOTTOM",
      },
      fields: "borderLeft,borderBottom,contentAlignment",
    },
  });

  return fuera;
}

/**
 * Que la tabla se siga leyendo cuando pasa de hoja.
 *
 * Dos cosas, y ninguna habla de índices de carácter: las dos se refieren a la
 * tabla por su `tableStartLocation` y a sus filas por número.
 *
 * 1. `preventOverflow` en todas las filas: una partida con quince viñetas
 *    salta entera a la hoja siguiente en vez de cortarse por la mitad.
 * 2. `pinTableHeaderRows` sobre la fila 0: el encabezado —PARTIDA, CONCEPTO,
 *    CANTIDAD…— se repite arriba de cada hoja en la que la tabla siga.
 *
 * ── Por qué el encabezado estaba sin hacer ──
 *
 * Se intentó como `tableHeader` **dentro de `updateTableRowStyle`**, y la API
 * contesta `Unallowed field: tableHeader` y tumba el lote entero. De ahí la
 * conclusión equivocada de que no se podía y había que marcarlo a mano en la
 * plantilla.
 *
 * Sí se puede: es una **solicitud aparte**. Así lo hace el ERP viejo desde el
 * 3 de noviembre de 2026 (`COT_05_Documento.gs:1581`,
 * `ajustesFinalesConDocsApi_`), que por el mismo motivo tiene que bajar de
 * `DocumentApp` a la API de Docs.
 *
 * ── Si la API los rechaza ──
 *
 * Allá los dos ajustes van en **dos llamadas distintas** y el error del
 * fijado se traga: si falla, el documento sale sin encabezado repetido y
 * nadie se entera. Aquí van en el lote del documento, marcados como
 * **formato** (`lote.ts`): si Google rechaza el lote, se reintenta sin el
 * formato y el documento sale con un aviso que dice qué le falta. Ni se
 * pierde la cotización por un detalle, ni sale incompleta sin decirlo.
 */
export function filasDeLaTabla(
  inicioTabla: number,
): Array<SolicitudEstiloFila | SolicitudFijarEncabezado> {
  const tableStartLocation = { index: inicioTabla };
  return [
    {
      // Sin `rowIndices` se aplica a todas las filas.
      updateTableRowStyle: {
        tableStartLocation,
        tableRowStyle: { preventOverflow: true },
        fields: "preventOverflow",
      },
    },
    {
      // La 0 es el encabezado; la 1 es el molde que se clona.
      pinTableHeaderRows: { tableStartLocation, pinnedHeaderRowsCount: 1 },
    },
  ];
}
