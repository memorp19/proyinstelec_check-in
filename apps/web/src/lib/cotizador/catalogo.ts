/**
 * El catálogo de servicios y lo que pasa cuando cambia.
 *
 * La regla de fondo: **el concepto copia su costo al agregarse**. Un cambio de
 * catálogo no mueve una cotización abierta — el precio que se armó es el que se
 * sigue viendo. Actualizarlo es un acto explícito, y devuelve el antes y el
 * después para que quien lo haga vea qué se movió.
 *
 * Es lo contrario de lo que hacía Apps Script, donde los importes se
 * recalculaban al leer y cambiar un costo base movía cotizaciones ya enviadas
 * (`PROCESO_COTIZACIONES.md:156`, su propio pendiente sin resolver).
 *
 * Todo aquí es puro: el catálogo entra como dato.
 */
import type { Moneda } from "./tipos";

export type TipoServicio = "SERVICIO" | "ESTUDIO" | "GASTO";

/** Lo que el cálculo necesita saber de un código del catálogo. */
export interface ServicioCatalogo {
  codigo: string;
  descripcion: string;
  unidad: string;
  costo: number | null;
  moneda: Moneda;
  tipo: TipoServicio;
  activo: boolean;
  /** Parámetros base de un estudio. Propuesta, no imposición. */
  horasPorDia?: number | null;
  diasPorSemana?: number | null;
  ingenieros?: number | null;
  semanas?: number | null;
  tarifaHora?: number | null;
  baseNodos?: number | null;
}

/** Lo mínimo que hay que saber de una línea cotizada para compararla. */
export interface LineaCotizada {
  id: string;
  codigo?: string | null;
  /** El costo que se está usando. */
  costo?: number | null;
  /** Lo que el catálogo decía cuando se copió. */
  costoCatalogo?: number | null;
}

export type MotivoDesfase =
  /** El catálogo se movió por debajo: lo copiado ya no es el precio de lista. */
  | "CATALOGO_CAMBIO"
  /** El código ya no existe o se dio de baja. */
  | "CODIGO_INACTIVO";

export interface Desfase {
  id: string;
  codigo: string;
  motivo: MotivoDesfase;
  /** El costo que la cotización está usando. */
  actual: number | null;
  /** El del catálogo vigente. `null` si el código ya no está. */
  catalogo: number | null;
  /**
   * `true` si alguien había cambiado el costo a mano sobre el del catálogo.
   * Actualizar esa línea **pierde** esa decisión, así que se señala aparte.
   */
  tieneCostoNegociado: boolean;
}

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

/**
 * Las líneas cuyo costo ya no corresponde al catálogo vigente.
 *
 * Compara contra `costoCatalogo` —lo que el catálogo decía al copiar— y no
 * contra `costo`. La diferencia importa: si alguien negoció un precio, `costo`
 * difiere del catálogo **a propósito**, y marcarlo como desfase haría que la
 * actualización masiva le borrara el descuento sin avisar.
 */
export function detectarDesfases(
  lineas: LineaCotizada[],
  catalogo: ServicioCatalogo[],
): Desfase[] {
  const porCodigo = new Map(catalogo.map((c) => [c.codigo.toUpperCase(), c]));
  const fuera: Desfase[] = [];

  for (const l of lineas) {
    const codigo = (l.codigo ?? "").trim().toUpperCase();
    // Un concepto libre no tiene catálogo detrás: su precio es el que se
    // escribió y nunca se desfasa.
    if (!codigo) continue;

    const enCatalogo = porCodigo.get(codigo);
    const copiado = num(l.costoCatalogo);
    const usado = num(l.costo);
    const negociado = copiado !== null && usado !== null && usado !== copiado;

    if (!enCatalogo || !enCatalogo.activo) {
      fuera.push({
        id: l.id,
        codigo,
        motivo: "CODIGO_INACTIVO",
        actual: usado,
        catalogo: enCatalogo ? num(enCatalogo.costo) : null,
        tieneCostoNegociado: negociado,
      });
      continue;
    }

    const vigente = num(enCatalogo.costo);
    // Sin `costoCatalogo` no hay con qué comparar: son líneas de antes de que
    // el modelo guardara esa columna. Se dejan en paz.
    if (copiado === null || vigente === null) continue;
    if (vigente === copiado) continue;

    fuera.push({
      id: l.id,
      codigo,
      motivo: "CATALOGO_CAMBIO",
      actual: usado,
      catalogo: vigente,
      tieneCostoNegociado: negociado,
    });
  }
  return fuera;
}

export interface Actualizacion {
  id: string;
  codigo: string;
  costoAntes: number | null;
  costoDespues: number;
  costoCatalogoAntes: number | null;
  costoCatalogoDespues: number;
}

export interface ResultadoActualizacion {
  /** Lo que se actualizó, con el antes y el después de cada línea. */
  actualizadas: Actualizacion[];
  /** Lo que NO se tocó, y por qué. */
  omitidas: Array<{ id: string; codigo: string; motivo: string }>;
}

/**
 * Lleva las líneas señaladas al costo del catálogo vigente.
 *
 * Es explícito a propósito: recibe los ids que se decidió actualizar, no todos
 * los desfases. Quien lo ejecuta ya vio la lista.
 *
 * **No toca las líneas con costo negociado** salvo que se pida expresamente con
 * `incluirNegociados`: ahí hay una decisión comercial de alguien, y
 * arrastrarla en una actualización masiva la borraría sin que nadie lo note.
 * Tampoco toca los códigos inactivos: si el código ya no está, no hay precio al
 * que llevarlo.
 */
export function actualizarDesdeCatalogo(
  lineas: LineaCotizada[],
  catalogo: ServicioCatalogo[],
  ids: string[],
  opciones: { incluirNegociados?: boolean } = {},
): ResultadoActualizacion {
  const porCodigo = new Map(catalogo.map((c) => [c.codigo.toUpperCase(), c]));
  const elegidas = new Set(ids);
  const desfases = new Map(detectarDesfases(lineas, catalogo).map((d) => [d.id, d]));

  const actualizadas: Actualizacion[] = [];
  const omitidas: ResultadoActualizacion["omitidas"] = [];

  for (const l of lineas) {
    if (!elegidas.has(l.id)) continue;
    const codigo = (l.codigo ?? "").trim().toUpperCase();
    const d = desfases.get(l.id);

    if (!d) {
      omitidas.push({ id: l.id, codigo, motivo: "No está desfasada" });
      continue;
    }
    if (d.motivo === "CODIGO_INACTIVO") {
      omitidas.push({
        id: l.id,
        codigo,
        motivo: "El código ya no está en el catálogo vigente: no hay precio al que llevarla",
      });
      continue;
    }
    if (d.tieneCostoNegociado && !opciones.incluirNegociados) {
      omitidas.push({
        id: l.id,
        codigo,
        motivo: "Tiene un costo negociado; actualizarla lo perdería",
      });
      continue;
    }

    const vigente = num(porCodigo.get(codigo)?.costo);
    if (vigente === null) {
      omitidas.push({ id: l.id, codigo, motivo: "El catálogo no tiene costo para ese código" });
      continue;
    }

    actualizadas.push({
      id: l.id,
      codigo,
      costoAntes: num(l.costo),
      costoDespues: vigente,
      costoCatalogoAntes: num(l.costoCatalogo),
      costoCatalogoDespues: vigente,
    });
  }

  return { actualizadas, omitidas };
}

// ── Alta de un código ─────────────────────────────────────────────────────────

/** La familia sale del prefijo del código: `SP001` → `SP`. */
export function familiaDeCodigo(codigo: string): string {
  const m = /^([A-Z]+)/.exec(codigo.trim().toUpperCase());
  return m ? m[1] : "";
}

/**
 * Qué tipo es un código según su familia.
 *
 * `CO` son los costos del proyecto —viáticos, transporte, ayudantes— que se
 * reparten entre partidas; `AR` son los estudios, que se cotizan por esfuerzo.
 */
export function tipoDeCodigo(codigo: string): TipoServicio {
  const f = familiaDeCodigo(codigo);
  if (f === "CO" || codigo.toUpperCase().startsWith("COSTO")) return "GASTO";
  if (f === "AR") return "ESTUDIO";
  return "SERVICIO";
}
