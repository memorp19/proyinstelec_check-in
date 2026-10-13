/**
 * El puente entre las filas de la base y la entrada del motor.
 *
 * Las columnas `numeric` vuelven de Postgres como **texto** —el driver no las
 * convierte para no perder precisión—, así que aquí se convierten una sola vez
 * y en un solo lugar. Todo es puro: recibe filas, devuelve objetos. Quien
 * consulta la base es quien llama.
 *
 * Y es de ida y vuelta a propósito: lo que se guarda tiene que volver a
 * producir el mismo resultado. El script `scripts/prueba-068.ts` comprueba
 * justo eso contra un PDF real.
 */
import { detectarDesfases, type ServicioCatalogo } from "./catalogo";
import type {
  Concepto,
  EntradaCotizacion,
  Esfuerzo,
  Gasto,
  Moneda,
  Partida,
  RepartoGastos,
  ResultadoCotizacion,
} from "./tipos";

// ── Lo que devuelve la base ───────────────────────────────────────────────────

/** `numeric` llega como texto; `integer` como número. */
type Dec = string | number | null;

export interface FilaArmado {
  numero: number;
  anio: number;
  version: number;
  moneda: string;
  moneda_gastos: string;
  reparto_gastos: string;
  asesoria_pct: Dec;
  iva_pct: Dec;
  tipo_cambio: Dec;
  tipo_cambio_origen: string | null;
  tipo_cambio_motivo: string | null;
}

export interface FilaPartida {
  id: string;
  orden: number;
  titulo: string | null;
  descripcion: string | null;
  cantidad: Dec;
  unidad: string | null;
  ajuste: Dec;
  precio_unitario_final: Dec;
  recibe_gastos_generales: boolean;
  gasto_manual: Dec;
}

export interface FilaConcepto {
  id: string;
  partida_id: string;
  codigo: string | null;
  descripcion_libre: string | null;
  cantidad: Dec;
  unidad: string | null;
  costo: Dec;
  /** Lo que el catálogo decía al copiar el concepto. Ver `detectarDesfases`. */
  costo_catalogo: Dec;
  utilidad_pct: Dec;
  moneda_costo: string | null;
  horas_por_dia: number | null;
  dias_por_semana: number | null;
  ingenieros: number | null;
  semanas: number | null;
  tarifa_hora: Dec;
  nodos: number | null;
  base_nodos: number | null;
  orden: number;
}

export interface FilaGasto {
  id: string;
  codigo: string | null;
  descripcion_libre: string | null;
  cantidad: Dec;
  costo: Dec;
  costo_catalogo: Dec;
  utilidad_pct: Dec;
  moneda_costo: string | null;
  destino_partida_id: string | null;
  orden: number;
}

// ── Conversión ────────────────────────────────────────────────────────────────

/** `numeric` → número. Null o vacío dan `undefined`, no 0. */
export function dec(v: Dec): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const moneda = (v: string | null | undefined): Moneda | undefined =>
  v === "MXN" || v === "USD" ? v : undefined;

/**
 * Los parámetros de esfuerzo, solo si están **todos**.
 *
 * El motor los pide completos a propósito (ver `Esfuerzo`): media captura daría
 * un número que nadie sabría de dónde salió. Si falta uno, el concepto se trata
 * como fijo y el aviso sale del propio motor.
 */
function esfuerzoDeFila(c: FilaConcepto): Esfuerzo | undefined {
  const horasPorDia = dec(c.horas_por_dia);
  const diasPorSemana = dec(c.dias_por_semana);
  const ingenieros = dec(c.ingenieros);
  const semanas = dec(c.semanas);
  const tarifaHora = dec(c.tarifa_hora);
  if (
    horasPorDia === undefined || diasPorSemana === undefined ||
    ingenieros === undefined || semanas === undefined || tarifaHora === undefined
  ) {
    return undefined;
  }
  return {
    horasPorDia, diasPorSemana, ingenieros, semanas, tarifaHora,
    ...(dec(c.nodos) === undefined ? {} : { nodos: dec(c.nodos) }),
    ...(dec(c.base_nodos) === undefined ? {} : { baseNodos: dec(c.base_nodos) }),
  };
}

export function conceptoDeFila(c: FilaConcepto): Concepto {
  return {
    id: c.id,
    ...(c.codigo ? { codigo: c.codigo } : {}),
    ...(c.descripcion_libre ? { descripcion: c.descripcion_libre } : {}),
    cantidad: dec(c.cantidad) ?? 0,
    ...(c.unidad ? { unidad: c.unidad } : {}),
    ...(dec(c.costo) === undefined ? {} : { costo: dec(c.costo) }),
    ...(dec(c.utilidad_pct) ? { utilidadPct: dec(c.utilidad_pct) } : {}),
    ...(moneda(c.moneda_costo) ? { monedaCosto: moneda(c.moneda_costo) } : {}),
    ...(esfuerzoDeFila(c) ? { esfuerzo: esfuerzoDeFila(c) } : {}),
  };
}

export function gastoDeFila(g: FilaGasto): Gasto {
  return {
    id: g.id,
    ...(g.codigo ? { codigo: g.codigo } : {}),
    ...(g.descripcion_libre ? { descripcion: g.descripcion_libre } : {}),
    cantidad: dec(g.cantidad) ?? 0,
    costo: dec(g.costo) ?? 0,
    ...(dec(g.utilidad_pct) ? { utilidadPct: dec(g.utilidad_pct) } : {}),
    ...(moneda(g.moneda_costo) ? { monedaCosto: moneda(g.moneda_costo) } : {}),
    // Sin destino es general: así lo guarda la columna, con NULL.
    ...(g.destino_partida_id ? { destino: { partida: g.destino_partida_id } } : {}),
  };
}

export function partidaDeFila(p: FilaPartida, conceptos: Concepto[]): Partida {
  return {
    id: p.id,
    orden: p.orden,
    ...(p.titulo ? { titulo: p.titulo } : {}),
    cantidad: dec(p.cantidad) ?? 0,
    ...(p.unidad ? { unidad: p.unidad } : {}),
    conceptos,
    ...(dec(p.ajuste) ? { ajuste: dec(p.ajuste) } : {}),
    ...(dec(p.precio_unitario_final) === undefined
      ? {}
      : { precioUnitarioFinal: dec(p.precio_unitario_final) }),
    // La columna es NOT NULL con default `true`: solo se lleva cuando es false,
    // que es la excepción que hay que poder ver.
    ...(p.recibe_gastos_generales ? {} : { recibeGastosGenerales: false }),
    ...(dec(p.gasto_manual) === undefined ? {} : { gastoManual: dec(p.gasto_manual) }),
  };
}

export interface FilasVersion {
  armado: FilaArmado;
  partidas: FilaPartida[];
  conceptos: FilaConcepto[];
  gastos: FilaGasto[];
  /** De `config_erp`, para los estudios que no capturaron su base. */
  baseNodosPorOmision?: number;
}

/**
 * Las filas de una versión, convertidas en lo que el motor sabe calcular.
 *
 * El orden es el de `orden`, no el que haya devuelto la consulta: el documento
 * depende de él y un `SELECT` sin `ORDER BY` no promete nada.
 */
export function entradaDesdeFilas(filas: FilasVersion): EntradaCotizacion {
  const porPartida = new Map<string, Concepto[]>();
  for (const c of [...filas.conceptos].sort((a, b) => a.orden - b.orden)) {
    const lista = porPartida.get(c.partida_id) ?? [];
    lista.push(conceptoDeFila(c));
    porPartida.set(c.partida_id, lista);
  }

  const partidas = [...filas.partidas]
    .sort((a, b) => a.orden - b.orden)
    .map((p) => partidaDeFila(p, porPartida.get(p.id) ?? []));

  const a = filas.armado;
  const tipoCambio = dec(a.tipo_cambio);

  return {
    moneda: moneda(a.moneda) ?? "MXN",
    monedaGastos: moneda(a.moneda_gastos) ?? moneda(a.moneda) ?? "MXN",
    reparto: (a.reparto_gastos as RepartoGastos) ?? "IGUAL",
    asesoriaPct: dec(a.asesoria_pct) ?? 0,
    ...(dec(a.iva_pct) === undefined ? {} : { ivaPct: dec(a.iva_pct) }),
    ...(tipoCambio === undefined
      ? {}
      : {
          tipoCambio: {
            valor: tipoCambio,
            origen: a.tipo_cambio_origen === "PREFERENTE" ? "PREFERENTE" : "BANXICO",
            ...(a.tipo_cambio_motivo ? { motivo: a.tipo_cambio_motivo } : {}),
          },
        }),
    ...(filas.baseNodosPorOmision ? { baseNodosPorOmision: filas.baseNodosPorOmision } : {}),
    partidas,
    gastos: [...filas.gastos].sort((x, y) => x.orden - y.orden).map(gastoDeFila),
  };
}

// ── La versión siguiente ──────────────────────────────────────────────────────

export interface CopiaVersion {
  partidas: FilaPartida[];
  conceptos: FilaConcepto[];
  gastos: FilaGasto[];
  /** Lo que cambió en el catálogo desde que se armó la versión anterior. */
  avisos: string[];
}

/**
 * Copia una versión en la siguiente, **con sus costos tal cual**.
 *
 * No se reprecia nada: la versión nueva arranca siendo la anterior, y si el
 * catálogo se movió se avisa para que alguien decida. Actualizar es un acto
 * explícito (`actualizarDesdeCatalogo`), no un efecto de abrir una versión.
 *
 * Los ids se renuevan porque son la llave de las partidas y de los conceptos de
 * ESA versión; conservarlos haría que un gasto de la v1 apuntara a la partida
 * de la v0.
 */
export function copiarAVersion(
  filas: FilasVersion,
  catalogo: ServicioCatalogo[],
  nuevoId: () => string,
): CopiaVersion {
  const idNuevo = new Map(filas.partidas.map((p) => [p.id, nuevoId()]));

  const partidas = filas.partidas.map((p) => ({ ...p, id: idNuevo.get(p.id)! }));
  const conceptos = filas.conceptos.map((c) => ({
    ...c,
    id: nuevoId(),
    partida_id: idNuevo.get(c.partida_id) ?? c.partida_id,
  }));
  const gastos = filas.gastos.map((g) => ({
    ...g,
    id: nuevoId(),
    destino_partida_id: g.destino_partida_id
      ? idNuevo.get(g.destino_partida_id) ?? g.destino_partida_id
      : null,
  }));

  // Se comparan las líneas COPIADAS: así el aviso trae el id nuevo y quien lo
  // lea puede ir directo a la línea de la versión que está armando.
  const lineas = [
    ...conceptos.map((c) => ({ id: c.id, codigo: c.codigo, costo: dec(c.costo), costoCatalogo: dec(c.costo_catalogo) })),
    ...gastos.map((g) => ({ id: g.id, codigo: g.codigo, costo: dec(g.costo), costoCatalogo: dec(g.costo_catalogo) })),
  ];
  const desfases = detectarDesfases(lineas, catalogo);

  const avisos = desfases.map((d) =>
    d.motivo === "CODIGO_INACTIVO"
      ? `${d.codigo} ya no está en el catálogo vigente. Se copió su costo de la versión anterior.`
      : `${d.codigo} costaba ${d.actual ?? "—"} y el catálogo vigente dice ${d.catalogo ?? "—"}. ` +
        "Se copió el costo anterior: actualizarlo es una decisión tuya.",
  );

  return { partidas, conceptos, gastos, avisos };
}

// ── El congelado ──────────────────────────────────────────────────────────────

export interface Congelado {
  numero: number;
  anio: number;
  version: number;
  congeladoPor: string;
  /** El resultado completo, tal cual. Es lo que se reimprime. */
  resultado: ResultadoCotizacion;
  /** La entrada con la que se calculó, para poder rehacerlo y comparar. */
  parametros: EntradaCotizacion;
  moneda: Moneda;
  subtotal: number;
  iva: number;
  total: number;
  letra: string;
}

/**
 * Lo que se guarda al mandar una cotización a revisión.
 *
 * Se guarda el resultado **completo** y no solo los totales: el PDF que el
 * cliente recibió enseña cada partida con su precio unitario, y reimprimirlo
 * recalculando daría otros números en cuanto el catálogo se mueva. Los cuatro
 * campos sueltos —moneda, subtotal, IVA, total— se repiten fuera del jsonb
 * para poder consultarlos sin abrirlo.
 */
export function congelar(
  version: { numero: number; anio: number; version: number },
  entrada: EntradaCotizacion,
  resultado: ResultadoCotizacion,
  letra: string,
  por: string,
): Congelado {
  return {
    ...version,
    congeladoPor: por,
    resultado,
    parametros: entrada,
    moneda: resultado.moneda,
    subtotal: resultado.subtotal,
    iva: resultado.iva,
    total: resultado.total,
    letra,
  };
}

/**
 * El monto que se copia a `cotizaciones`, según la moneda del congelado.
 *
 * Son dos columnas independientes y no un par (monto, moneda): una cotización
 * puede llevar partidas en pesos y en dólares, y sumarlas exigiría inventar un
 * tipo de cambio. El `origen` queda dicho para las históricas, que nunca
 * pasaron por el cotizador.
 */
export function montoDeCongelado(c: Congelado): {
  montoMxn: number | null;
  montoUsd: number | null;
  origenMonto: "COTIZADOR";
} {
  return {
    montoMxn: c.moneda === "MXN" ? c.total : null,
    montoUsd: c.moneda === "USD" ? c.total : null,
    origenMonto: "COTIZADOR",
  };
}
