/**
 * Lector de .xlsx que devuelve el valor CRUDO de cada celda.
 *
 * Existe porque el dato que importa no es el que Excel enseña. Varias órdenes
 * de compra están guardadas como número con formato de fecha: `4501122596` se
 * ve como una fecha de 1920 y cualquier lector que respete el formato la
 * convierte. La OC es una cadena de identificación, no una magnitud ni una
 * fecha, así que aquí nunca se convierte nada: se entrega el valor almacenado
 * y, aparte, si la celda tenía formato de fecha, para poder reportarlo.
 *
 * Sin dependencias nuevas: un .xlsx es un ZIP de XML y `node:zlib` ya trae el
 * inflate que hace falta.
 */
import { inflateRawSync } from "node:zlib";

// ── ZIP ───────────────────────────────────────────────────────────────────────

/**
 * Entradas del ZIP, leídas desde el End of Central Directory hacia atrás.
 *
 * Se recorre el directorio central y no los encabezados locales porque estos
 * últimos pueden declarar tamaño 0 y dejar el dato en un descriptor posterior;
 * el central siempre trae los tamaños definitivos.
 */
function entradasZip(buf: Buffer): Map<string, Buffer> {
  const EOCD = 0x06054b50;
  let eocd = -1;
  // El comentario final puede medir hasta 64 KiB, así que se busca hacia atrás.
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0x10000; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no es un .xlsx válido (no se encontró el índice del ZIP)");

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const fuera = new Map<string, Buffer>();

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const nombreLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentarioLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nombre = buf.toString("utf8", p + 46, p + 46 + nombreLen);

    // Encabezado local: el tamaño de sus campos variables es propio, no el del
    // directorio central, así que hay que releerlo para saber dónde empiezan
    // los bytes comprimidos.
    const lNombre = buf.readUInt16LE(offset + 26);
    const lExtra = buf.readUInt16LE(offset + 28);
    const ini = offset + 30 + lNombre + lExtra;
    const crudo = buf.subarray(ini, ini + comprimido);
    fuera.set(nombre, metodo === 0 ? crudo : inflateRawSync(crudo));

    p += 46 + nombreLen + extraLen + comentarioLen;
  }
  return fuera;
}

// ── XML ───────────────────────────────────────────────────────────────────────

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function desescapar(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (m) => {
    if (ENTIDADES[m]) return ENTIDADES[m];
    const cuerpo = m.slice(2, -1);
    const codigo = cuerpo[0] === "x" || cuerpo[0] === "X"
      ? parseInt(cuerpo.slice(1), 16)
      : parseInt(cuerpo, 10);
    return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : m;
  });
}

/** Atributo de una etiqueta, con comillas simples o dobles. */
function atributo(etiqueta: string, nombre: string): string | null {
  const m = etiqueta.match(new RegExp(`\\b${nombre}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return m ? desescapar(m[2] ?? m[3] ?? "") : null;
}

/** Texto de todos los <t> de un fragmento, concatenado (texto enriquecido). */
function textoDeT(fragmento: string): string {
  let fuera = "";
  const re = /<t\b[^>]*?(\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragmento)) !== null) {
    if (m[1] !== "/>") fuera += desescapar(m[2] ?? "");
  }
  return fuera;
}

// ── Celdas ────────────────────────────────────────────────────────────────────

export interface Celda {
  /**
   * El valor tal como está almacenado. Para una celda numérica es el número en
   * texto —incluido el serial de una fecha—, nunca una fecha convertida.
   */
  valor: string;
  /** `s` cadena compartida, `n` número, `b` booleano, `e` error, `str` fórmula. */
  tipo: string;
  /**
   * La celda tenía formato de fecha. NO cambia `valor`: solo sirve para
   * reportar que el Excel presenta ese dato como fecha, que es como una OC
   * acaba pareciendo de 1920.
   */
  conFormatoDeFecha: boolean;
}

export type Fila = Record<string, Celda>;

/** Formatos de fecha integrados de Excel; los ids por debajo de 164 son fijos. */
const FORMATOS_FECHA = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57,
]);

/** `AB12` → `AB`. */
export function columnaDe(ref: string): string {
  let fuera = "";
  for (const ch of ref) {
    if (ch >= "A" && ch <= "Z") fuera += ch;
    else break;
  }
  return fuera;
}

export class LibroExcel {
  private constructor(
    private readonly hojasPorNombre: Map<string, string>,
    private readonly archivos: Map<string, Buffer>,
    private readonly compartidas: string[],
    private readonly formatoPorEstilo: number[],
    private readonly codigoPorFormato: Map<number, string>,
  ) {}

  static desdeBuffer(buf: Buffer): LibroExcel {
    const archivos = entradasZip(buf);
    const leer = (ruta: string) => archivos.get(ruta)?.toString("utf8") ?? "";

    // sharedStrings: todas las cadenas del libro, referenciadas por índice.
    const compartidas: string[] = [];
    for (const m of leer("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      compartidas.push(textoDeT(m[1]));
    }

    // styles: qué formato numérico usa cada estilo de celda.
    const styles = leer("xl/styles.xml");
    const codigoPorFormato = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b[^>]*\/>/g)) {
      const id = atributo(m[0], "numFmtId");
      const code = atributo(m[0], "formatCode");
      if (id) codigoPorFormato.set(parseInt(id, 10), code ?? "");
    }
    const formatoPorEstilo: number[] = [];
    const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (cellXfs) {
      for (const m of cellXfs[1].matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
        formatoPorEstilo.push(parseInt(atributo(m[0], "numFmtId") ?? "0", 10));
      }
    }

    // workbook + rels: nombre de hoja → ruta del XML.
    const destinos = new Map<string, string>();
    for (const m of leer("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*\/>/g)) {
      const id = atributo(m[0], "Id");
      const target = atributo(m[0], "Target");
      if (id && target) destinos.set(id, target);
    }
    const hojasPorNombre = new Map<string, string>();
    for (const m of leer("xl/workbook.xml").matchAll(/<sheet\b[^>]*\/>/g)) {
      const nombre = atributo(m[0], "name");
      const rid = atributo(m[0], "r:id") ?? atributo(m[0], "id");
      const destino = rid ? destinos.get(rid) : null;
      if (!nombre || !destino) continue;
      const ruta = destino.startsWith("xl/") ? destino : `xl/${destino.replace(/^\/+/, "")}`;
      hojasPorNombre.set(nombre, ruta);
    }

    return new LibroExcel(hojasPorNombre, archivos, compartidas, formatoPorEstilo, codigoPorFormato);
  }

  get hojas(): string[] {
    return [...this.hojasPorNombre.keys()];
  }

  private esFecha(estilo: string | null): boolean {
    if (estilo === null) return false;
    const xf = parseInt(estilo, 10);
    const id = this.formatoPorEstilo[xf];
    if (id === undefined) return false;
    if (FORMATOS_FECHA.has(id)) return true;
    // Formato personalizado: lleva marcas de fecha/hora fuera de los literales
    // entre corchetes (que son códigos de idioma o de color, no de fecha).
    const codigo = (this.codigoPorFormato.get(id) ?? "").split(";")[0].replace(/\[[^\]]*\]/g, "");
    return /[ymdhs]/i.test(codigo);
  }

  /**
   * Filas de una hoja, en orden, con su número de fila de Excel (base 1) y las
   * celdas indexadas por letra de columna. Las celdas vacías no aparecen.
   */
  filas(hoja: string): Array<{ numero: number; celdas: Fila }> {
    const ruta = this.hojasPorNombre.get(hoja);
    if (!ruta) throw new Error(`La hoja "${hoja}" no existe. Hay: ${this.hojas.join(", ")}`);
    const xml = this.archivos.get(ruta)?.toString("utf8") ?? "";

    const fuera: Array<{ numero: number; celdas: Fila }> = [];
    for (const fila of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const numero = parseInt(atributo(`<row ${fila[1]}>`, "r") ?? "0", 10);
      const celdas: Fila = {};
      for (const c of fila[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const abre = `<c ${c[1]}>`;
        const ref = atributo(abre, "r");
        if (!ref) continue;
        const tipo = atributo(abre, "t") ?? "n";
        const cuerpo = c[2] ?? "";

        let valor: string | null = null;
        if (tipo === "inlineStr") {
          valor = textoDeT(cuerpo);
        } else {
          const v = cuerpo.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
          if (v) {
            valor = desescapar(v[1]);
            if (tipo === "s") valor = this.compartidas[parseInt(valor, 10)] ?? "";
          }
        }
        if (valor === null) continue;

        celdas[columnaDe(ref)] = {
          valor,
          tipo,
          conFormatoDeFecha: this.esFecha(atributo(abre, "s")),
        };
      }
      if (numero > 0 && Object.keys(celdas).length > 0) fuera.push({ numero, celdas });
    }
    return fuera;
  }
}

// ── Utilidades de lectura ─────────────────────────────────────────────────────

/**
 * Texto de una celda, sin convertir nada.
 *
 * Un número entero se entrega en notación decimal plana, porque los números de
 * cotización y las órdenes de compra son identificadores. Importa: el XML
 * guarda las OC largas en notación científica —`4501122596` se almacena como
 * `4.501122596E9`—, así que entregar el valor literal metería esa cadena en la
 * base. Los decimales sí se entregan tal cual, sin tocar la precisión.
 */
export function texto(celda: Celda | undefined): string {
  if (!celda) return "";
  const v = celda.valor.trim();
  if (celda.tipo === "n") {
    const n = Number(v);
    if (Number.isSafeInteger(n)) return String(n);
  }
  return v;
}

/** El serial de Excel de una celda de fecha, o null. No construye fechas. */
export function serialDeFecha(celda: Celda | undefined): number | null {
  if (!celda || celda.tipo !== "n") return null;
  const n = Number(celda.valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Serial de Excel → fecha. Se hace UNA sola vez, al final, y solo con las
 * columnas que de verdad son fechas.
 *
 * El origen es 1899-12-30 y no 1900-01-01 por el bisiesto de 1900 que Excel
 * inventó por compatibilidad con Lotus. Se fija mediodía UTC para que ningún
 * huso corra el día.
 */
export function fechaDeSerial(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30, 12) + Math.trunc(serial) * 86_400_000);
}
