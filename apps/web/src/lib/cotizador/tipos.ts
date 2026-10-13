/**
 * Lo que entra y sale del motor de cálculo del cotizador.
 *
 * Todo es serializable: la entrada es lo que el usuario captura y la salida es
 * lo que se dibuja en pantalla y, más adelante, lo que se congela al enviar.
 */

export type Moneda = "MXN" | "USD";

/** Cómo se reparten los gastos generales entre las partidas. */
export type RepartoGastos = "IGUAL" | "PROPORCIONAL" | "MANUAL";

/**
 * De dónde salió el tipo de cambio de ESTA versión.
 *
 * `PREFERENTE` exige motivo: usar un tipo distinto del oficial es una decisión
 * comercial —el banco del cliente, un contrato con tipo pactado— y sin el
 * motivo nadie puede revisarla después.
 */
export interface TipoCambio {
  valor: number;
  origen: "BANXICO" | "PREFERENTE";
  motivo?: string;
}

/**
 * Un estudio que se cotiza por esfuerzo, no por precio de lista (familia AR).
 *
 * Los parámetros se piden COMPLETOS. El catálogo propone unos valores, pero el
 * motor no los va a buscar: recibir la propuesta y decidir si se usa es trabajo
 * de quien arma la cotización, y un cálculo que rellena huecos por su cuenta
 * produce números que nadie sabe de dónde salieron.
 */
export interface Esfuerzo {
  horasPorDia: number;
  diasPorSemana: number;
  ingenieros: number;
  semanas: number;
  tarifaHora: number;
  /**
   * Nodos cotizados. Con nodos, el costo del estudio escala contra
   * `baseNodos`; sin ellos, se multiplica por la cantidad del concepto.
   */
  nodos?: number;
  /** Nodos que cubre el costo base. Por omisión, el de la configuración. */
  baseNodos?: number;
}

export interface Concepto {
  id?: string;
  codigo?: string;
  descripcion?: string;
  cantidad: number;
  unidad?: string;
  /** Costo unitario, en `monedaCosto`. */
  costo?: number;
  /**
   * Utilidad en por ciento, POR CONCEPTO.
   *
   * En la práctica solo se usa en materiales: el catálogo de servicios ya trae
   * su margen dentro —por eso la columna se llama "costo de venta"— y un
   * suministro que se compra a un proveedor entra con su costo real.
   */
  utilidadPct?: number;
  /** Si difiere de la moneda de la cotización, se convierte con el tipo de cambio. */
  monedaCosto?: Moneda;
  esfuerzo?: Esfuerzo;
}

export interface Partida {
  id: string;
  orden?: number;
  titulo?: string;
  cantidad: number;
  unidad?: string;
  conceptos: Concepto[];
  /**
   * Ajuste explícito sobre el total de la partida, en la moneda de la
   * cotización. Puede ser negativo.
   *
   * Existe porque en los Excel reales estos ajustes viven escondidos dentro de
   * las fórmulas (`+10`, `+55`, `-0.06`). Sacarlos a un campo propio no cambia
   * el número: cambia que se pueda ver y explicar.
   */
  ajuste?: number;
  /**
   * `false` saca a la partida del reparto de gastos generales.
   *
   * Es el caso de una partida que trae su propio equipo y sus propios
   * viáticos: cargarle además la parte del gasto general la cobraría dos veces.
   */
  recibeGastosGenerales?: boolean;
  /** Lo que le toca con reparto `MANUAL`, en la moneda de los gastos. */
  gastoManual?: number;
}

/** A quién se le carga un gasto. */
export type DestinoGasto = "GENERAL" | { partida: string };

export interface Gasto {
  id?: string;
  codigo?: string;
  descripcion?: string;
  cantidad: number;
  costo: number;
  utilidadPct?: number;
  monedaCosto?: Moneda;
  /**
   * `GENERAL` (por omisión) se reparte entre las partidas que lo reciben.
   * `{ partida }` lo carga entero a esa partida, sin repartir.
   */
  destino?: DestinoGasto;
}

export interface EntradaCotizacion {
  /** La moneda en la que cierra la cotización. Un solo total. */
  moneda: Moneda;
  /** Los gastos llevan la suya: unos viáticos son en pesos aunque se cotice en dólares. */
  monedaGastos?: Moneda;
  tipoCambio?: TipoCambio;
  reparto?: RepartoGastos;
  /** Un solo porcentaje global. Por omisión 0. */
  asesoriaPct?: number;
  /** Nodos que cubre el costo base de un estudio, de la configuración. */
  baseNodosPorOmision?: number;
  partidas: Partida[];
  gastos?: Gasto[];
}

// ── Salida ────────────────────────────────────────────────────────────────────

export interface ConceptoCalculado {
  codigo?: string;
  descripcion?: string;
  cantidad: number;
  unidad?: string;
  /** Costo unitario ya con utilidad y ya convertido a la moneda de la cotización. */
  costoUnitario: number;
  importe: number;
  /** `FIJO`, `ESFUERZO` o `NODOS`. */
  forma: "FIJO" | "ESFUERZO" | "NODOS";
  /** Horas totales, solo en los estudios. */
  horas?: number;
}

export interface GastoCalculado {
  codigo?: string;
  descripcion?: string;
  cantidad: number;
  /** En la moneda de los gastos, antes de convertir. */
  importe: number;
  destino: DestinoGasto;
}

export interface PartidaCalculada {
  id: string;
  orden: number;
  titulo?: string;
  cantidad: number;
  unidad?: string;
  conceptos: ConceptoCalculado[];
  /** Suma de los conceptos. */
  costoConceptos: number;
  /** Lo que le tocó de gastos, ya convertido. */
  gastoAsignado: number;
  /**
   * Conceptos + gastos, sin asesoría. Es el número del panel interno: lo que
   * cuesta hacer la partida.
   */
  costoTotal: number;
  asesoria: number;
  ajuste: number;
  /** `costoTotal + asesoria + ajuste`. */
  total: number;
  /** `total / cantidad`, redondeado. Es lo que ve el cliente. */
  precioUnitario: number;
  /** `precioUnitario × cantidad`. Lo que suma al subtotal. */
  importe: number;
}

export interface ResultadoCotizacion {
  moneda: Moneda;
  partidas: PartidaCalculada[];
  gastos: GastoCalculado[];
  /** Conceptos + gastos de todas las partidas, sin asesoría. Panel interno. */
  costoTotal: number;
  /** Total de los gastos, en la moneda de los gastos. */
  totalGastos: number;
  asesoriaPct: number;
  /** Lo que de verdad se repartió, que puede diferir un centavo del nominal. */
  asesoria: number;
  /** Suma de los importes. Es lo que ve el cliente. */
  subtotal: number;
  iva: number;
  total: number;
  avisos: string[];
}
