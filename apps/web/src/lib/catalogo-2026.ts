/**
 * Lectura del catálogo de servicios desde el formato de cotización 2026
 * (`PFAD-024-2026`), hoja `COSTOS`.
 *
 * El Excel guarda el catálogo en un rincón alejado de lo que se imprime:
 * `ZI` código, `ZJ` descripción, `ZK` costo. A su izquierda, en `YZ:ZF`, hay
 * bloques de 10 renglones con el desglose de cada estudio —horas, días,
 * ingenieros, semanas, tarifa— de donde sale el costo de la familia `AR`.
 *
 * Aquí no se escribe nada ni se toca la base: solo se convierte el Excel en
 * filas, para que las reglas se puedan probar sin archivo y sin conexión.
 */
import { texto, type Fila } from "./excel";

// ── El catálogo (ZI:ZK) ───────────────────────────────────────────────────────

export interface FilaCatalogo {
  fila: number;
  codigo: string;
  descripcion: string;
  /** `null` si la celda viene vacía o no es un número. */
  costo: number | null;
}

/** Por qué un renglón del Excel no es un servicio del catálogo. */
export type MotivoDescarte =
  /** El renglón separador del principio de la columna (`---`). */
  | "SEPARADOR"
  /** Un hueco del formato: descripción "Disponible" o vacía. */
  | "HUECO";

export interface Descarte {
  fila: number;
  codigo: string;
  motivo: MotivoDescarte;
}

const numero = (v: string): number | null => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * Un renglón de `ZI:ZK` convertido en servicio, o el motivo por el que no lo es.
 *
 * El formato trae el catálogo **preasignado**: 176 códigos de los que solo 87
 * tienen servicio. Los demás son huecos reservados —`BT001` a `BT030` enteros,
 * `SP054` en adelante— marcados con la descripción "Disponible" o sin
 * descripción. Cargarlos llenaría el catálogo de códigos que no significan
 * nada y que alguien acabaría eligiendo en una cotización.
 */
export function leerFilaCatalogo(fila: number, celdas: Fila): FilaCatalogo | Descarte | null {
  const codigo = texto(celdas.ZI).trim();
  const descripcion = texto(celdas.ZJ).trim();

  // Sin código la fila no pertenece al catálogo: la hoja tiene cientos de
  // renglones con otras cosas. No es un descarte, es que no viene al caso.
  if (!codigo) return null;
  if (codigo === "---") return { fila, codigo, motivo: "SEPARADOR" };
  if (!descripcion || /^disponible$/i.test(descripcion) || /disponible/i.test(codigo)) {
    return { fila, codigo, motivo: "HUECO" };
  }

  return { fila, codigo, descripcion, costo: numero(texto(celdas.ZK)) };
}

export const esDescarte = (r: FilaCatalogo | Descarte): r is Descarte => "motivo" in r;

// ── Los bloques de estudio (YZ:ZF) ────────────────────────────────────────────

export interface ParamsEstudio {
  codigo: string;
  horasPorDia: number;
  diasPorSemana: number;
  ingenieros: number;
  semanas: number;
  tarifaHora: number;
}

/**
 * Dónde empieza el primer bloque y cada cuántos renglones se repite.
 *
 * Son dos columnas de bloques —`YZ` y `ZD`— de diez renglones cada uno. Dentro
 * del bloque que arranca en `r`: el código en `r`, horas y días en `r+2`,
 * ingenieros en `r+4`, semanas en `r+6` y la tarifa por hora en `r+8`. Los
 * renglones nones son las etiquetas (`HORAS`, `NO. INGS`, `$ HR/H`).
 */
const PRIMER_BLOQUE = 2;
const ALTO_BLOQUE = 10;
const COLUMNAS: Array<{ codigo: string; valores: string }> = [
  { codigo: "YZ", valores: "ZA" },
  { codigo: "ZD", valores: "ZE" },
];

function leerBloque(
  porFila: Map<number, Fila>,
  r: number,
  col: { codigo: string; valores: string },
): ParamsEstudio | null {
  const cab = porFila.get(r);
  const codigo = texto(cab?.[col.codigo]).trim().toUpperCase();
  // Solo un código con forma de servicio abre un bloque: así un renglón de
  // etiquetas desalineado no se cuela como estudio.
  if (!/^[A-Z]{2}\d{3}$/.test(codigo)) return null;

  const v = (dr: number, c: string) => numero(texto(porFila.get(r + dr)?.[c]));
  const horasPorDia = v(2, col.codigo);
  const diasPorSemana = v(2, col.valores);
  const ingenieros = v(4, col.valores);
  const semanas = v(6, col.valores);
  const tarifaHora = v(8, col.valores);

  if (
    horasPorDia === null || diasPorSemana === null || ingenieros === null ||
    semanas === null || tarifaHora === null
  ) {
    return null;
  }
  return { codigo, horasPorDia, diasPorSemana, ingenieros, semanas, tarifaHora };
}

/** Todos los bloques de estudio de la hoja, por código. */
export function leerBloquesEstudio(filas: Array<{ numero: number; celdas: Fila }>): Map<string, ParamsEstudio> {
  const porFila = new Map(filas.map((f) => [f.numero, f.celdas]));
  const ultima = filas.reduce((max, f) => Math.max(max, f.numero), 0);
  const fuera = new Map<string, ParamsEstudio>();

  for (let r = PRIMER_BLOQUE; r + ALTO_BLOQUE - 2 <= ultima; r += ALTO_BLOQUE) {
    for (const col of COLUMNAS) {
      const bloque = leerBloque(porFila, r, col);
      // El primero gana: si un código aparece dos veces, se queda el de arriba
      // y la diferencia se reporta, no se resuelve en silencio.
      if (bloque && !fuera.has(bloque.codigo)) fuera.set(bloque.codigo, bloque);
    }
  }
  return fuera;
}

/**
 * El costo que produce un bloque de estudio.
 *
 * Es la misma cadena del Excel: horas al día × días a la semana × ingenieros ×
 * semanas × tarifa. Sirve para comprobar que el bloque leído corresponde al
 * costo de `ZK`; si no cuadran, uno de los dos está mal y hay que mirarlo.
 */
export function costoDeEstudio(p: ParamsEstudio): number {
  return p.horasPorDia * p.diasPorSemana * p.ingenieros * p.semanas * p.tarifaHora;
}

// ── Resumen ───────────────────────────────────────────────────────────────────

/** La familia es el prefijo de letras; los gastos llevan todos el mismo. */
export function familiaDeFila(codigo: string): string {
  const c = codigo.trim().toUpperCase();
  if (c.startsWith("COSTO")) return "COSTO";
  const m = /^([A-Z]+)/.exec(c);
  return m ? m[1] : "";
}

export interface ResumenFamilia {
  familia: string;
  total: number;
  /** Códigos cargados con costo 0 o sin costo: se cotizarían en cero. */
  sinCosto: string[];
}

export function resumirPorFamilia(filas: FilaCatalogo[]): ResumenFamilia[] {
  const por = new Map<string, ResumenFamilia>();
  for (const f of filas) {
    const familia = familiaDeFila(f.codigo);
    const e = por.get(familia) ?? { familia, total: 0, sinCosto: [] };
    e.total++;
    if (!f.costo) e.sinCosto.push(f.codigo);
    por.set(familia, e);
  }
  return [...por.values()].sort((a, b) => a.familia.localeCompare(b.familia));
}
