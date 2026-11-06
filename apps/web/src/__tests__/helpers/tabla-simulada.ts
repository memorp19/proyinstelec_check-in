/**
 * Una tabla de Docs simulada, para comprobar la aritmética de índices.
 *
 * `tabla.ts` arma las solicitudes **a ciegas**: calcula en qué índice va a
 * caer cada cosa después de que las anteriores se apliquen, sin poder releer
 * el documento. Si esa cuenta está mal, el lote no falla — escribe en el
 * lugar equivocado, y eso sale en el PDF del cliente.
 *
 * Afirmar sobre la lista de solicitudes no atrapa ese error: la lista puede
 * verse razonable y tener los índices corridos. Por eso aquí se **aplican**,
 * con las mismas reglas que la API, y se mira cómo queda la tabla.
 *
 * El modelo de índices es el de Docs: cada carácter ocupa uno, un párrafo
 * termina con `\n`, y una celda y una fila ocupan uno de más por su marca de
 * inicio.
 */
import type {
  DocumentoDocs,
  ElementoEstructural,
  Solicitud,
} from "@/src/lib/cotizador/docs/tipos";

/** Una celda es su lista de párrafos, sin el `\n` final de cada uno. */
type Celda = string[];
type Fila = Celda[];

const largoCelda = (c: Celda): number => 1 + c.reduce((s, p) => s + p.length + 1, 0);
const largoFila = (f: Fila): number => 1 + f.reduce((s, c) => s + largoCelda(c), 0);

export class TablaSimulada {
  readonly inicio: number;
  filas: Fila[];
  /** Las solicitudes que no son de tabla, en el orden en que llegaron. */
  readonly otras: Solicitud[] = [];

  constructor(inicio: number, filas: Fila[]) {
    this.inicio = inicio;
    this.filas = filas.map((f) => f.map((c) => [...c]));
  }

  /** Una tabla como la de la plantilla: encabezado, N en blanco y 3 de totales. */
  static comoLaPlantilla(inicio = 3043, enBlanco = 22): TablaSimulada {
    const vacia = (): Fila => [[""], [""], [""], [""], [""]];
    const filas: Fila[] = [
      [["Partida"], ["Concepto"], ["Cantidad"], ["Precio unitario"], ["Costo"]],
      ...Array.from({ length: enBlanco }, vacia),
      [[""], [""], [""], ["Subtotal:"], ["$ 45,000.00 MXN"]],
      [[""], [""], [""], ["IVA:"], ["$   7,200.00 MXN"]],
      [["         CINCUENTA Y DOS MIL DOSCIENTOS PESOS 00/100 M.N."], [""], [""], ["Total:"], ["$ 52,200.00 MXN"]],
    ];
    return new TablaSimulada(inicio, filas);
  }

  /** Dónde empieza una fila, en índices del documento. */
  inicioDeFila(r: number): number {
    let i = this.inicio + 1;
    for (let j = 0; j < r; j++) i += largoFila(this.filas[j]);
    return i;
  }

  /** Dónde empieza el contenido de una celda (su primer párrafo). */
  inicioDeCelda(r: number, c: number): number {
    let i = this.inicioDeFila(r) + 1;
    for (let j = 0; j < c; j++) i += largoCelda(this.filas[r][j]);
    return i + 1;
  }

  /** El texto de una celda, con sus saltos de línea entre párrafos. */
  texto(r: number, c: number): string {
    return this.filas[r][c].join("\n");
  }

  get numeroDeFilas(): number {
    return this.filas.length;
  }

  /**
   * El documento tal como lo devolvería `documents.get`.
   *
   * Delante de la tabla va un párrafo de relleno del largo que haga falta
   * para que la tabla empiece justo en `inicio`: así la prueba puede usar el
   * índice real de la plantilla y no uno de juguete.
   */
  comoDocumento(): DocumentoDocs {
    const contenido: ElementoEstructural[] = [];
    if (this.inicio > 1) {
      const relleno = "·".repeat(this.inicio - 2) + "\n";
      contenido.push({
        startIndex: 1,
        endIndex: 1 + relleno.length,
        paragraph: {
          elements: [{ startIndex: 1, endIndex: 1 + relleno.length, textRun: { content: relleno } }],
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
        },
      });
    }

    const tableRows = this.filas.map((fila, r) => ({
      startIndex: this.inicioDeFila(r),
      endIndex: this.inicioDeFila(r) + largoFila(fila),
      tableCells: fila.map((celda, c) => {
        const inicioContenido = this.inicioDeCelda(r, c);
        let i = inicioContenido;
        const content: ElementoEstructural[] = celda.map((p) => {
          const con = `${p}\n`;
          const el: ElementoEstructural = {
            startIndex: i,
            endIndex: i + con.length,
            paragraph: {
              elements: [{ startIndex: i, endIndex: i + con.length, textRun: { content: con } }],
              paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
            },
          };
          i += con.length;
          return el;
        });
        return { startIndex: inicioContenido - 1, endIndex: i, content };
      }),
    }));

    contenido.push({
      startIndex: this.inicio,
      endIndex: this.inicio + 1 + this.filas.reduce((s, f) => s + largoFila(f), 0),
      table: { rows: this.filas.length, columns: this.filas[0].length, tableRows },
    });

    return { documentId: "doc-plantilla", title: "Plantilla simulada", body: { content: contenido } };
  }

  /**
   * Aplica las solicitudes **en orden**, como `batchUpdate`.
   *
   * Lanza en cuanto una apunta fuera de la tabla o a un índice que no cae en
   * ninguna celda: eso es justo el error que se quiere atrapar.
   */
  aplicar(solicitudes: Solicitud[]): void {
    for (const s of solicitudes) {
      if ("deleteTableRow" in s) {
        const { rowIndex, tableStartLocation } = s.deleteTableRow.tableCellLocation;
        this.exigirTabla(tableStartLocation.index, "deleteTableRow");
        if (rowIndex < 0 || rowIndex >= this.filas.length) {
          throw new Error(`deleteTableRow apunta a la fila ${rowIndex} y hay ${this.filas.length}.`);
        }
        this.filas.splice(rowIndex, 1);
        continue;
      }

      if ("insertTableRow" in s) {
        const { tableCellLocation, insertBelow } = s.insertTableRow;
        this.exigirTabla(tableCellLocation.tableStartLocation.index, "insertTableRow");
        const ref = tableCellLocation.rowIndex;
        if (ref < 0 || ref >= this.filas.length) {
          throw new Error(`insertTableRow apunta a la fila ${ref} y hay ${this.filas.length}.`);
        }
        const columnas = this.filas[ref].length;
        const nueva: Fila = Array.from({ length: columnas }, () => [""]);
        this.filas.splice(insertBelow ? ref + 1 : ref, 0, nueva);
        continue;
      }

      if ("insertText" in s) {
        this.insertar(s.insertText.location.index, s.insertText.text);
        continue;
      }

      // Lo demás no cambia longitudes ni filas; se guarda para afirmarlo aparte.
      this.otras.push(s);
    }
  }

  private exigirTabla(index: number, quien: string): void {
    if (index !== this.inicio) {
      throw new Error(`${quien} dice que la tabla empieza en ${index} y empieza en ${this.inicio}.`);
    }
  }

  /** Inserta texto en el índice dado, buscando en qué celda cae. */
  private insertar(index: number, texto: string): void {
    for (let r = 0; r < this.filas.length; r++) {
      for (let c = 0; c < this.filas[r].length; c++) {
        const inicio = this.inicioDeCelda(r, c);
        const contenido = this.filas[r][c].map((p) => `${p}\n`).join("");
        // El último índice válido es el de antes del `\n` final: la API no
        // deja escribir después de la marca de fin de la celda.
        if (index < inicio || index > inicio + contenido.length - 1) continue;
        const desplazamiento = index - inicio;
        const nuevo =
          contenido.slice(0, desplazamiento) + texto + contenido.slice(desplazamiento);
        this.filas[r][c] = nuevo.split("\n").slice(0, -1);
        return;
      }
    }
    throw new Error(`insertText en ${index} no cae dentro de ninguna celda de la tabla.`);
  }
}
