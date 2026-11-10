/**
 * La implementación falsa de `Documentos`, y un constructor de documentos.
 *
 * Guarda todo en memoria y **registra las solicitudes** que recibe: eso es lo
 * que afirman las pruebas, porque es lo que de verdad decide cómo queda el
 * documento. Que Google las aplique bien es asunto de Google.
 *
 * Todos los datos que se usen con esto son inventados. La plantilla real y
 * las cotizaciones reales no entran al repositorio.
 */
import type {
  DocumentoDocs,
  ElementoEstructural,
  Parrafo,
  Solicitud,
  Tabla,
} from "@/src/lib/cotizador/docs/tipos";
import type { ArchivoExportado, Documentos } from "@/src/lib/documentos-google";

// ── Construir un documento de prueba ──────────────────────────────────────────

/**
 * Un constructor que lleva la cuenta de los índices.
 *
 * Los índices son lo que hace difícil este módulo, así que una prueba que los
 * escriba a mano se equivoca y además no se entiende. Aquí se calculan como
 * los calcula Docs: cada carácter ocupa uno, y un párrafo termina con `\n`.
 */
/** El rojo con el que la plantilla marca lo que hay que llenar. */
const ROJO = { color: { rgbColor: { red: 1, green: 0, blue: 0 } } };

export class ArmaDocumento {
  private indice = 1; // Docs empieza en 1: el 0 no existe.
  private contenido: ElementoEstructural[] = [];
  private encabezado: ElementoEstructural[] | null = null;
  private listas: Record<string, { listProperties?: { nestingLevels?: unknown[] } }> = {};

  /** Un párrafo normal. */
  parrafo(texto: string): this {
    this.contenido.push(this.nuevoParrafo(texto));
    return this;
  }

  /** Un párrafo con viñeta, de la lista que se diga. */
  vineta(texto: string, listId = "lista-1", nivel = 0): this {
    this.listas[listId] = { listProperties: { nestingLevels: [{}] } };
    const el = this.nuevoParrafo(texto);
    el.paragraph!.bullet = { listId, nestingLevel: nivel };
    this.contenido.push(el);
    return this;
  }

  /**
   * Un párrafo en rojo, como los que la plantilla usa para marcar lo que hay
   * que llenar. Es lo que el generador tiene que dejar en negro.
   */
  parrafoRojo(texto: string): this {
    const el = this.nuevoParrafo(texto);
    el.paragraph!.elements![0].textRun!.textStyle = { foregroundColor: ROJO };
    this.contenido.push(el);
    return this;
  }

  /** Una viñeta cuyo **glifo** está en rojo, aunque su texto no lo esté. */
  vinetaRoja(texto: string, listId = "lista-1"): this {
    this.vineta(texto, listId);
    this.contenido.at(-1)!.paragraph!.bullet!.textStyle = { foregroundColor: ROJO };
    return this;
  }

  /**
   * Una tabla. `filas` es una matriz de celdas, y cada celda un texto o una
   * lista de párrafos.
   */
  tabla(filas: Array<Array<string | { vineta: string; listId?: string }>>): this {
    const inicio = this.indice;
    this.indice += 1; // el elemento tabla ocupa uno antes de su primera fila

    const tableRows = filas.map((fila) => {
      const inicioFila = this.indice;
      this.indice += 1;
      const tableCells = fila.map((celda) => {
        const inicioCelda = this.indice;
        this.indice += 1;
        const dentro =
          typeof celda === "string"
            ? [this.nuevoParrafo(celda)]
            : [this.nuevoParrafoConVineta(celda.vineta, celda.listId ?? "lista-tabla")];
        return { startIndex: inicioCelda, endIndex: this.indice, content: dentro };
      });
      return { startIndex: inicioFila, endIndex: this.indice, tableCells };
    });

    const tabla: Tabla = {
      rows: filas.length,
      columns: filas[0]?.length ?? 0,
      tableRows,
    };
    this.contenido.push({ startIndex: inicio, endIndex: this.indice, table: tabla });
    return this;
  }

  /** Un encabezado con sus párrafos. Sus índices son de su propio segmento. */
  conEncabezado(...textos: string[]): this {
    const guardado = this.indice;
    this.indice = 1;
    this.encabezado = textos.map((t) => this.nuevoParrafo(t));
    this.indice = guardado;
    return this;
  }

  construir(): DocumentoDocs {
    const doc: DocumentoDocs = {
      documentId: "doc-plantilla",
      title: "Plantilla de prueba",
      body: { content: this.contenido },
      lists: this.listas,
    };
    if (this.encabezado) doc.headers = { "enc-1": { content: this.encabezado } };
    return doc;
  }

  private nuevoParrafo(texto: string): ElementoEstructural {
    const inicio = this.indice;
    const con = `${texto}\n`;
    const parrafo: Parrafo = {
      elements: [{ startIndex: inicio, endIndex: inicio + con.length, textRun: { content: con } }],
      paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
    };
    this.indice += con.length;
    return { startIndex: inicio, endIndex: this.indice, paragraph: parrafo };
  }

  private nuevoParrafoConVineta(texto: string, listId: string): ElementoEstructural {
    this.listas[listId] = { listProperties: { nestingLevels: [{}] } };
    const el = this.nuevoParrafo(texto);
    el.paragraph!.bullet = { listId, nestingLevel: 0 };
    return el;
  }
}

// ── La implementación falsa ───────────────────────────────────────────────────

export interface LlamadaAplicar {
  id: string;
  solicitudes: Solicitud[];
}

export interface DocumentosFalso extends Documentos {
  /** Siembra el documento que devolverá `leerDocumento` para ese id. */
  sembrar(id: string, doc: DocumentoDocs): void;
  /** Todo lo que se le mandó a `aplicarCambios`, en orden. */
  readonly aplicadas: LlamadaAplicar[];
  readonly copiados: Array<{ plantillaId: string; nombre: string; carpetaId: string; id: string }>;
  readonly exportados: string[];
  readonly papelera: string[];
}

export function documentosFalso(
  plantilla?: DocumentoDocs,
  opciones: { fallaAlAplicar?: Error; fallaAlApartar?: string } = {},
): DocumentosFalso {
  const docs = new Map<string, DocumentoDocs>();
  const aplicadas: LlamadaAplicar[] = [];
  const copiados: DocumentosFalso["copiados"] = [];
  const exportados: string[] = [];
  const papelera: string[] = [];
  let siguiente = 0;

  if (plantilla) docs.set("doc-plantilla", plantilla);

  return {
    aplicadas,
    copiados,
    exportados,
    papelera,

    sembrar(id, doc) {
      docs.set(id, doc);
    },

    async copiarPlantilla({ plantillaId, nombre, carpetaId }) {
      const id = `copia-${++siguiente}`;
      const base = docs.get(plantillaId);
      if (!base) throw new Error(`No hay plantilla sembrada con id ${plantillaId}`);
      // La copia es independiente: si una prueba cambia una, la otra no se mueve.
      docs.set(id, JSON.parse(JSON.stringify(base)) as DocumentoDocs);
      copiados.push({ plantillaId, nombre, carpetaId, id });
      return { id };
    },

    async leerDocumento(id) {
      const doc = docs.get(id);
      if (!doc) throw new Error(`No hay documento con id ${id}`);
      return doc;
    },

    async aplicarCambios(id, solicitudes) {
      if (opciones.fallaAlAplicar) throw opciones.fallaAlAplicar;
      if (!docs.has(id)) throw new Error(`No hay documento con id ${id}`);
      aplicadas.push({ id, solicitudes });
    },

    async exportarPdf({ id, nombre }): Promise<ArchivoExportado> {
      if (!docs.has(id)) throw new Error(`No hay documento con id ${id}`);
      exportados.push(id);
      return {
        nombre: `${nombre}.pdf`,
        contenido: Buffer.from(`pdf de ${id}`),
        mimeType: "application/pdf",
      };
    },

    async moverAPapelera(id) {
      if (opciones.fallaAlApartar === id) {
        throw new Error(`Drive no dejó apartar ${id}`);
      }
      papelera.push(id);
      docs.delete(id);
    },
  };
}
