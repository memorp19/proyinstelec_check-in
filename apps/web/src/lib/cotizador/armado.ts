/**
 * El armado: la cotización como la edita la pantalla.
 *
 * Entre las filas de la base y la entrada del motor hay una forma intermedia —
 * la que se captura. Trae cosas que al motor no le importan (el id de cada
 * renglón, los bloques del documento, el costo que el catálogo tenía al
 * copiarlo) y le faltan cosas que el motor calcula. Vive aquí, es pura, y de
 * ella salen las otras dos: `entradaDeArmado` para calcular y `filasDeArmado`
 * para guardar.
 *
 * Que el camino a la entrada del motor sea **uno solo** no es casual: dos
 * conversiones distintas de lo mismo se separan en cuanto alguien toca una.
 */
import { bloquesDeDescripcion, descripcionDeBloques, type Bloque } from "./bloques";
import {
  normalizarCondiciones,
  normalizarDocumento,
  type Condiciones,
  type DatosDocumento,
} from "./documento";
import {
  dec,
  ESCALA_MONTO,
  type FilaArmado,
  type FilaConcepto,
  type FilaGasto,
  type FilaPartida,
} from "./persistencia";
import type {
  Concepto,
  EntradaCotizacion,
  Esfuerzo,
  Gasto,
  Moneda,
  Partida,
  RepartoGastos,
  TipoCambio,
} from "./tipos";

// ── La forma que edita la pantalla ────────────────────────────────────────────

export interface ConceptoArmado {
  id: string;
  /** Del catálogo, o vacío si es un concepto escrito a mano. */
  codigo: string;
  /** Lo que se escribió cuando no hay catálogo detrás. */
  descripcion: string;
  cantidad: number;
  unidad: string;
  costo: number | null;
  /** Lo que el catálogo decía al copiarlo. No se edita en la pantalla. */
  costoCatalogo: number | null;
  utilidadPct: number;
  monedaCosto: Moneda | null;
  /** Solo los estudios. Se captura completo o no se captura. */
  esfuerzo: Esfuerzo | null;
}

export interface PartidaArmada {
  id: string;
  orden: number;
  titulo: string;
  /** El contenido del documento, por bloques. Se guarda como texto marcado. */
  bloques: Bloque[];
  cantidad: number;
  unidad: string;
  ajuste: number;
  precioUnitarioFinal: number | null;
  recibeGastosGenerales: boolean;
  gastoManual: number | null;
  formato: "NORMAL" | "NEGRITAS" | "OCULTO";
  notas: string;
  conceptos: ConceptoArmado[];
}

export interface GastoArmado {
  id: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  costo: number;
  costoCatalogo: number | null;
  utilidadPct: number;
  monedaCosto: Moneda | null;
  /** Vacío = general, se reparte. Con valor, va entero a esa partida. */
  destinoPartidaId: string;
}

export interface Armado {
  numero: number;
  anio: number;
  version: number;
  moneda: Moneda;
  monedaGastos: Moneda;
  reparto: RepartoGastos;
  asesoriaPct: number;
  ivaPct: number;
  tipoCambio: TipoCambio | null;
  condiciones: Condiciones;
  documento: DatosDocumento;
  partidas: PartidaArmada[];
  gastos: GastoArmado[];
}

// ── De las filas de la base al armado ─────────────────────────────────────────

const moneda = (v: string | null | undefined): Moneda | null =>
  v === "MXN" || v === "USD" ? v : null;

function esfuerzoDeFila(c: FilaConcepto): Esfuerzo | null {
  const horasPorDia = dec(c.horas_por_dia);
  const diasPorSemana = dec(c.dias_por_semana);
  const ingenieros = dec(c.ingenieros);
  const semanas = dec(c.semanas);
  const tarifaHora = dec(c.tarifa_hora);
  // Completo o nada: el motor los pide todos a propósito, y media captura
  // daría un número que nadie sabría de dónde salió.
  if (
    horasPorDia === undefined || diasPorSemana === undefined || ingenieros === undefined ||
    semanas === undefined || tarifaHora === undefined
  ) {
    return null;
  }
  return {
    horasPorDia, diasPorSemana, ingenieros, semanas, tarifaHora,
    ...(dec(c.nodos) === undefined ? {} : { nodos: dec(c.nodos) }),
    ...(dec(c.base_nodos) === undefined ? {} : { baseNodos: dec(c.base_nodos) }),
  };
}

export interface FilasArmado {
  armado: FilaArmado & { condiciones?: unknown; documento?: unknown };
  partidas: Array<FilaPartida & { formato?: string | null; notas?: string | null }>;
  conceptos: FilaConcepto[];
  gastos: FilaGasto[];
}

/**
 * Las filas de una versión, convertidas en lo que edita la pantalla.
 *
 * El orden es el de la columna `orden`, no el que haya devuelto la consulta: el
 * documento depende de él y un `SELECT` sin `ORDER BY` no promete nada.
 */
export function armadoDesdeFilas(filas: FilasArmado): { armado: Armado; avisos: string[] } {
  const a = filas.armado;
  const condiciones = normalizarCondiciones(a.condiciones);
  const documento = normalizarDocumento(a.documento);

  const porPartida = new Map<string, ConceptoArmado[]>();
  for (const c of [...filas.conceptos].sort((x, y) => x.orden - y.orden)) {
    const lista = porPartida.get(c.partida_id) ?? [];
    lista.push({
      id: c.id,
      codigo: c.codigo ?? "",
      descripcion: c.descripcion_libre ?? "",
      cantidad: dec(c.cantidad) ?? 0,
      unidad: c.unidad ?? "",
      costo: dec(c.costo) ?? null,
      costoCatalogo: dec(c.costo_catalogo) ?? null,
      utilidadPct: dec(c.utilidad_pct) ?? 0,
      monedaCosto: moneda(c.moneda_costo),
      esfuerzo: esfuerzoDeFila(c),
    });
    porPartida.set(c.partida_id, lista);
  }

  const partidas: PartidaArmada[] = [...filas.partidas]
    .sort((x, y) => x.orden - y.orden)
    .map((p) => ({
      id: p.id,
      orden: p.orden,
      titulo: p.titulo ?? "",
      bloques: bloquesDeDescripcion(p.descripcion),
      cantidad: dec(p.cantidad) ?? 0,
      unidad: p.unidad ?? "servicio",
      ajuste: dec(p.ajuste) ?? 0,
      precioUnitarioFinal: dec(p.precio_unitario_final) ?? null,
      recibeGastosGenerales: p.recibe_gastos_generales,
      gastoManual: dec(p.gasto_manual) ?? null,
      formato: (p.formato as PartidaArmada["formato"]) ?? "NORMAL",
      notas: p.notas ?? "",
      conceptos: porPartida.get(p.id) ?? [],
    }));

  const tipoCambio = dec(a.tipo_cambio);

  return {
    armado: {
      numero: a.numero,
      anio: a.anio,
      version: a.version,
      moneda: moneda(a.moneda) ?? "MXN",
      monedaGastos: moneda(a.moneda_gastos) ?? moneda(a.moneda) ?? "MXN",
      reparto: (a.reparto_gastos as RepartoGastos) ?? "IGUAL",
      asesoriaPct: dec(a.asesoria_pct) ?? 0,
      ivaPct: dec(a.iva_pct) ?? 16,
      tipoCambio:
        tipoCambio === undefined
          ? null
          : {
              valor: tipoCambio,
              origen: a.tipo_cambio_origen === "PREFERENTE" ? "PREFERENTE" : "BANXICO",
              ...(a.tipo_cambio_motivo ? { motivo: a.tipo_cambio_motivo } : {}),
            },
      condiciones: condiciones.valor,
      documento: documento.valor,
      partidas,
      gastos: [...filas.gastos]
        .sort((x, y) => x.orden - y.orden)
        .map((g) => ({
          id: g.id,
          codigo: g.codigo ?? "",
          descripcion: g.descripcion_libre ?? "",
          cantidad: dec(g.cantidad) ?? 0,
          costo: dec(g.costo) ?? 0,
          costoCatalogo: dec(g.costo_catalogo) ?? null,
          utilidadPct: dec(g.utilidad_pct) ?? 0,
          monedaCosto: moneda(g.moneda_costo),
          destinoPartidaId: g.destino_partida_id ?? "",
        })),
    },
    avisos: [...condiciones.avisos, ...documento.avisos],
  };
}

// ── Del armado a la entrada del motor ─────────────────────────────────────────

function conceptoDeArmado(c: ConceptoArmado): Concepto {
  return {
    id: c.id,
    ...(c.codigo ? { codigo: c.codigo } : {}),
    ...(c.descripcion ? { descripcion: c.descripcion } : {}),
    cantidad: c.cantidad,
    ...(c.unidad ? { unidad: c.unidad } : {}),
    ...(c.costo === null ? {} : { costo: c.costo }),
    ...(c.utilidadPct ? { utilidadPct: c.utilidadPct } : {}),
    ...(c.monedaCosto ? { monedaCosto: c.monedaCosto } : {}),
    ...(c.esfuerzo ? { esfuerzo: c.esfuerzo } : {}),
  };
}

function gastoDeArmado(g: GastoArmado): Gasto {
  return {
    id: g.id,
    ...(g.codigo ? { codigo: g.codigo } : {}),
    ...(g.descripcion ? { descripcion: g.descripcion } : {}),
    cantidad: g.cantidad,
    costo: g.costo,
    ...(g.utilidadPct ? { utilidadPct: g.utilidadPct } : {}),
    ...(g.monedaCosto ? { monedaCosto: g.monedaCosto } : {}),
    ...(g.destinoPartidaId ? { destino: { partida: g.destinoPartidaId } } : {}),
  };
}

function partidaDeArmado(p: PartidaArmada): Partida {
  return {
    id: p.id,
    orden: p.orden,
    ...(p.titulo ? { titulo: p.titulo } : {}),
    cantidad: p.cantidad,
    ...(p.unidad ? { unidad: p.unidad } : {}),
    conceptos: p.conceptos.map(conceptoDeArmado),
    ...(p.ajuste ? { ajuste: p.ajuste } : {}),
    ...(p.precioUnitarioFinal === null ? {} : { precioUnitarioFinal: p.precioUnitarioFinal }),
    // La columna es NOT NULL con default `true`: solo viaja cuando es false,
    // que es la excepción que hay que poder ver.
    ...(p.recibeGastosGenerales ? {} : { recibeGastosGenerales: false }),
    ...(p.gastoManual === null ? {} : { gastoManual: p.gastoManual }),
  };
}

/** Lo que el motor sabe calcular. `baseNodosPorOmision` sale de `config_erp`. */
export function entradaDeArmado(a: Armado, baseNodosPorOmision?: number): EntradaCotizacion {
  return {
    moneda: a.moneda,
    monedaGastos: a.monedaGastos,
    reparto: a.reparto,
    asesoriaPct: a.asesoriaPct,
    ivaPct: a.ivaPct,
    ...(a.tipoCambio ? { tipoCambio: a.tipoCambio } : {}),
    ...(baseNodosPorOmision ? { baseNodosPorOmision } : {}),
    partidas: [...a.partidas].sort((x, y) => x.orden - y.orden).map(partidaDeArmado),
    gastos: a.gastos.map(gastoDeArmado),
  };
}

/**
 * De las filas de la base a la entrada del motor, pasando por el armado.
 *
 * Es **el** camino: la pantalla calcula sobre lo mismo que calcula el
 * congelado, y el día que cambie la conversión cambia para los dos.
 */
export function entradaDesdeFilas(filas: FilasVersion): EntradaCotizacion {
  return entradaDeArmado(armadoDesdeFilas(filas).armado, filas.baseNodosPorOmision);
}

export interface FilasVersion extends FilasArmado {
  /** De `config_erp`, para los estudios que no capturaron su base. */
  baseNodosPorOmision?: number;
}

// ── Del armado a las filas que se escriben ────────────────────────────────────

export interface FilasParaEscribir {
  armado: {
    moneda: Moneda; monedaGastos: Moneda; repartoGastos: RepartoGastos;
    asesoriaPct: string; ivaPct: string;
    tipoCambio: string | null;
    tipoCambioOrigen: TipoCambio["origen"] | null;
    tipoCambioMotivo: string | null;
    condiciones: Condiciones; documento: DatosDocumento;
  };
  partidas: Array<{
    id: string; numero: number; anio: number; version: number; orden: number;
    titulo: string; descripcion: string; cantidad: string; unidad: string;
    ajuste: string; precioUnitarioFinal: string | null; recibeGastosGenerales: boolean;
    gastoManual: string | null; formato: PartidaArmada["formato"]; notas: string | null;
  }>;
  conceptos: Array<{
    id: string; partidaId: string; numero: number; anio: number; version: number;
    codigo: string | null; descripcionLibre: string | null; cantidad: string; unidad: string | null;
    costo: string | null; costoCatalogo: string | null; utilidadPct: string;
    monedaCosto: Moneda | null;
    horasPorDia: number | null; diasPorSemana: number | null; ingenieros: number | null;
    semanas: number | null; tarifaHora: string | null; nodos: number | null; baseNodos: number | null;
    orden: number;
  }>;
  gastos: Array<{
    id: string; numero: number; anio: number; version: number;
    codigo: string | null; descripcionLibre: string | null; cantidad: string;
    costo: string; costoCatalogo: string | null; utilidadPct: string; monedaCosto: Moneda | null;
    destinoPartidaId: string | null; orden: number;
  }>;
}

/**
 * Los números se escriben como **texto**, con la escala de su columna.
 *
 * Mandarlos como `number` deja que el driver y Postgres decidan la
 * representación; en texto se escribe exactamente lo que se quiso guardar, que
 * es lo que hace falta cuando un costo lleva tres decimales y la cuenta
 * depende de ellos.
 */
const monto = (n: number | null | undefined): string | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : n.toFixed(ESCALA_MONTO);
const montoReq = (n: number): string => (Number.isFinite(n) ? n : 0).toFixed(ESCALA_MONTO);
const entero = (n: number | null | undefined): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Math.trunc(n);

export function filasDeArmado(a: Armado): FilasParaEscribir {
  const clave = { numero: a.numero, anio: a.anio, version: a.version };

  return {
    armado: {
      moneda: a.moneda,
      monedaGastos: a.monedaGastos,
      repartoGastos: a.reparto,
      asesoriaPct: montoReq(a.asesoriaPct),
      ivaPct: montoReq(a.ivaPct),
      tipoCambio: a.tipoCambio ? monto(a.tipoCambio.valor) : null,
      tipoCambioOrigen: a.tipoCambio ? a.tipoCambio.origen : null,
      tipoCambioMotivo: a.tipoCambio?.motivo?.trim() || null,
      condiciones: a.condiciones,
      documento: a.documento,
    },
    partidas: a.partidas.map((p, i) => ({
      ...clave,
      id: p.id,
      // El orden se renumera al guardar: la pantalla puede haber movido
      // partidas, y el índice único de (numero, anio, version, orden) no
      // perdona un hueco ni un repetido.
      orden: i + 1,
      titulo: p.titulo,
      descripcion: descripcionDeBloques(p.bloques),
      cantidad: montoReq(p.cantidad),
      unidad: p.unidad || "servicio",
      ajuste: montoReq(p.ajuste),
      precioUnitarioFinal: monto(p.precioUnitarioFinal),
      recibeGastosGenerales: p.recibeGastosGenerales,
      gastoManual: monto(p.gastoManual),
      formato: p.formato,
      notas: p.notas || null,
    })),
    conceptos: a.partidas.flatMap((p) =>
      p.conceptos.map((c, i) => ({
        ...clave,
        id: c.id,
        partidaId: p.id,
        codigo: c.codigo || null,
        descripcionLibre: c.descripcion || null,
        cantidad: montoReq(c.cantidad),
        unidad: c.unidad || null,
        costo: monto(c.costo),
        costoCatalogo: monto(c.costoCatalogo),
        utilidadPct: montoReq(c.utilidadPct),
        monedaCosto: c.monedaCosto,
        horasPorDia: entero(c.esfuerzo?.horasPorDia),
        diasPorSemana: entero(c.esfuerzo?.diasPorSemana),
        ingenieros: entero(c.esfuerzo?.ingenieros),
        semanas: entero(c.esfuerzo?.semanas),
        tarifaHora: monto(c.esfuerzo?.tarifaHora ?? null),
        nodos: entero(c.esfuerzo?.nodos),
        baseNodos: entero(c.esfuerzo?.baseNodos),
        orden: i + 1,
      })),
    ),
    gastos: a.gastos.map((g, i) => ({
      ...clave,
      id: g.id,
      codigo: g.codigo || null,
      descripcionLibre: g.descripcion || null,
      cantidad: montoReq(g.cantidad),
      costo: montoReq(g.costo),
      costoCatalogo: monto(g.costoCatalogo),
      utilidadPct: montoReq(g.utilidadPct),
      monedaCosto: g.monedaCosto,
      destinoPartidaId: g.destinoPartidaId || null,
      orden: i + 1,
    })),
  };
}

// ── Quién puede editar ────────────────────────────────────────────────────────

/**
 * Si el estatus deja editar la versión.
 *
 * Es la regla del ERP viejo (`COT_04:738`), con un cambio: los importes se
 * congelan al mandar a revisión, así que una versión en `REVISION` ya no se
 * toca aunque el revisor no haya contestado.
 */
export function edicionPorEstatus(estatus: string): { editable: boolean; motivo: string } {
  const e = String(estatus ?? "").trim().toUpperCase();

  if (e === "PROCESO" || e === "") return { editable: true, motivo: "" };

  if (e === "REVISION") {
    return {
      editable: false,
      motivo:
        "Está esperando al revisor y sus importes ya se congelaron. Si pide una " +
        "corrección vuelve a PROCESO y se desbloquea sola.",
    };
  }
  if (e === "ENVIADA" || e === "ASIGNADA" || e === "NO ASIGNADA") {
    return {
      editable: false,
      motivo:
        "El cliente ya tiene esta cotización. Cambiarla aquí dejaría dos versiones " +
        "de lo mismo: la que él recibió y la del sistema. Para cambios, versión nueva.",
    };
  }
  if (e === "CANCELADA") {
    return { editable: false, motivo: "La cotización está cancelada." };
  }
  // Los dependientes son una espera, no un cierre: se siguen editando.
  return { editable: true, motivo: "" };
}

export interface QuienEdita {
  email?: string | null;
  iniciales?: string | null;
  rol?: string;
  es_super_admin?: boolean;
  permisos?: string[];
}

/**
 * Si **esta persona** puede armar **esta cotización**.
 *
 * La arma quien la dio de alta; el gerente de operaciones puede entrar a
 * cualquiera. Y se reconoce a quien la dio de alta por dos caminos, porque hay
 * dos clases de cotización en la base:
 *
 * - `created_by` guarda el correo de quien la creó **en el ERP nuevo**.
 * - `elaboro` guarda las **iniciales**, que es como el ERP viejo identifica
 *   personas y lo único que trajeron las cotizaciones importadas de 2026
 *   (ahí `created_by` dice "importador"). `users.iniciales` tiene índice
 *   único, así que la correspondencia es de uno a uno.
 *
 * Si alguien no tiene iniciales capturadas no se le reconoce por esa vía; es
 * un hueco de datos y la pantalla lo dice en vez de dejarlo pasar.
 */
export function puedeArmar(
  cotizacion: { created_by?: string | null; elaboro?: string | null },
  usuario: QuienEdita | null | undefined,
  tieneTodas: boolean,
): { puede: boolean; motivo: string } {
  if (!usuario) return { puede: false, motivo: "No autorizado" };
  if (tieneTodas) return { puede: true, motivo: "" };

  const correo = (usuario.email ?? "").trim().toLowerCase();
  if (correo && (cotizacion.created_by ?? "").trim().toLowerCase() === correo) {
    return { puede: true, motivo: "" };
  }

  const iniciales = (usuario.iniciales ?? "").trim().toUpperCase();
  if (iniciales && (cotizacion.elaboro ?? "").trim().toUpperCase() === iniciales) {
    return { puede: true, motivo: "" };
  }

  return {
    puede: false,
    motivo:
      `Esta cotización la elaboró ${cotizacion.elaboro || "alguien más"}. ` +
      "Puedes consultarla; para armarla, pídeselo o que te la reasigne el gerente de operaciones.",
  };
}
