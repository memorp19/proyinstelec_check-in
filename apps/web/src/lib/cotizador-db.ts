/**
 * Leer y escribir el armado de una versión de cotización.
 *
 * Toda la lógica vive en `src/lib/cotizador/` y es pura; aquí solo están las
 * consultas. El reparto es a propósito: lo que decide números se prueba sin
 * base, y lo que toca la base se lee de un vistazo.
 *
 * **Sin transacciones interactivas** (el driver HTTP de Neon no las tiene). El
 * guardado usa dos pasos y el primero sirve de candado; está explicado en
 * `guardarArmado`.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  catServicios,
  cotArmado,
  cotConceptos,
  cotGastos,
  cotImportes,
  cotPartidas,
  cotizaciones,
} from "../db/schema";
import {
  armadoDesdeFilas,
  calcularCotizacion,
  completarDocumento,
  lineasDeDireccion,
  telefonoParaDocumento,
  textosSugeridos,
  congelar,
  entradaDeArmado,
  detectarDesfases,
  filasDeArmado,
  importeEnLetra,
  montoDeCongelado,
  type Armado,
  type Desfase,
  type ResultadoCotizacion,
  type ServicioCatalogo,
} from "./cotizador";
import { getConfigErp } from "./config-erp";
import { getVersion, type Cotizacion } from "./cotizaciones";
import { contactoParaCarta } from "./clientes";

// ── Lectura ───────────────────────────────────────────────────────────────────

export interface ArmadoCompleto {
  cotizacion: Cotizacion;
  armado: Armado;
  resultado: ResultadoCotizacion;
  /** Conceptos y gastos cuyo costo ya no es el del catálogo vigente. */
  desfases: Desfase[];
  /** Lo que no se entendió al leer los bloques de jsonb. */
  avisos: string[];
  /**
   * Qué campos del documento llegaron llenos del machote y no de lo guardado.
   * La pantalla lo dice para que nadie confunda una propuesta con un dato que
   * alguien revisó.
   */
  llenadoAutomatico: Array<"contacto" | "textos">;
  /**
   * Si el contacto salió del catálogo de clientes. Es distinto de que se haya
   * llenado algo: sin contacto todavía se puede tomar la dirección de la
   * empresa, y decir "encontrado en el catálogo" entonces sería mentir.
   */
  contactoDelCatalogo: boolean;
  /** El congelado, si esta versión ya pasó a revisión. */
  congelado: { total: string; letra: string; congeladoAt: string } | null;
  /**
   * La marca de tiempo con la que hay que volver para guardar. Es el bloqueo
   * optimista: si cambió, alguien más guardó mientras tanto.
   */
  actualizadoEn: string | null;
}

/** El catálogo vigente, para proponer costos y detectar desfases. */
export async function catalogoVigente(): Promise<ServicioCatalogo[]> {
  const filas = await getDb()
    .select()
    .from(catServicios)
    .orderBy(asc(catServicios.codigo));

  return filas.map((f) => ({
    codigo: f.codigo,
    descripcion: f.descripcion,
    unidad: f.unidad,
    costo: f.costo === null ? null : Number(f.costo),
    moneda: f.moneda,
    tipo: f.tipo,
    activo: f.activo,
    horasPorDia: f.horasPorDia,
    diasPorSemana: f.diasPorSemana,
    ingenieros: f.ingenieros,
    semanas: f.semanas,
    tarifaHora: f.tarifaHora === null ? null : Number(f.tarifaHora),
    baseNodos: f.baseNodos,
  }));
}

/**
 * Lo que se propone para el documento de esta cotización.
 *
 * El contacto sale del catálogo de clientes; los dos párrafos, del título y la
 * razón social. Es el machote del cotizador viejo: llega escrito y se edita
 * encima. Lo que ya tenga texto no se toca (`completarDocumento`).
 */
async function machoteDelDocumento(cotizacion: Cotizacion) {
  const { empresa, contacto } = await contactoParaCarta({
    razonSocial: cotizacion.cliente,
    dirigidaA: cotizacion.dirigida_a,
  }).catch(() => ({ empresa: null, contacto: null }));

  const [direccion1, direccion2] = lineasDeDireccion(empresa?.direccion);
  const textos = textosSugeridos(cotizacion.titulo, cotizacion.cliente);

  return {
    /** `true` solo si coincidió un CONTACTO, no si solo se tomó la dirección. */
    encontrado: contacto !== null,
    contacto: contacto
      ? {
          contacto: contacto.nombre,
          direccion1,
          direccion2,
              // Con el formato del documento, como lo hace el ERP viejo:
          // 7751104791 → + (52) 775 110 4791.
          telefono: telefonoParaDocumento(contacto.telefono),
          correo: contacto.correo ?? "",
        }
      : // Sin contacto en el catálogo, la dirección de la empresa todavía sirve.
        { direccion1, direccion2 },
    objeto: textos.objeto,
    alcance: textos.alcance,
  };
}

/** Un armado en blanco, con los valores por omisión de `config_erp`. */
async function armadoNuevo(numero: number, anio: number, version: number): Promise<Armado> {
  const config = await getConfigErp();
  const { CONDICIONES_POR_OMISION, documentoVacio } = await import("./cotizador");
  return {
    numero,
    anio,
    version,
    moneda: "MXN",
    monedaGastos: "MXN",
    reparto: "IGUAL",
    asesoriaPct: config.cotizador.ASESORIA_PCT_DEFAULT,
    ivaPct: 16,
    tipoCambio: null,
    condiciones: { ...CONDICIONES_POR_OMISION },
    documento: documentoVacio(),
    partidas: [],
    gastos: [],
  };
}

/**
 * Todo lo que necesita la pantalla, en una sola llamada.
 *
 * Son seis consultas que siempre se piden juntas; separarlas en seis viajes se
 * nota en una pantalla que además autoguarda.
 */
export async function getArmado(
  numero: number,
  anio: number,
  version: number,
): Promise<ArmadoCompleto | null> {
  const cotizacion = await getVersion(numero, anio, version);
  if (!cotizacion) return null;

  const db = getDb();
  const clave = (t: typeof cotPartidas | typeof cotConceptos | typeof cotGastos) =>
    and(eq(t.numero, numero), eq(t.anio, anio), eq(t.version, version));

  const [encabezado] = await db
    .select()
    .from(cotArmado)
    .where(and(eq(cotArmado.numero, numero), eq(cotArmado.anio, anio), eq(cotArmado.version, version)))
    .limit(1);

  const config = await getConfigErp();

  if (!encabezado) {
    const armado = await armadoNuevo(numero, anio, version);
    const machote = await machoteDelDocumento(cotizacion);
    const { valor, llenados } = completarDocumento(armado.documento, machote);
    armado.documento = valor;

    const resultado = calcularCotizacion(
      entradaDeArmado(armado, config.cotizador.BASE_NODOS_ESTUDIO),
    );
    return {
      cotizacion,
      armado,
      resultado,
      desfases: [],
      avisos: [],
      llenadoAutomatico: llenados,
      contactoDelCatalogo: machote.encontrado,
      congelado: null,
      actualizadoEn: null,
    };
  }

  const [partidas, conceptos, gastos, congeladoFila] = await Promise.all([
    db.select().from(cotPartidas).where(clave(cotPartidas)),
    db.select().from(cotConceptos).where(clave(cotConceptos)),
    db.select().from(cotGastos).where(clave(cotGastos)),
    db
      .select()
      .from(cotImportes)
      .where(and(eq(cotImportes.numero, numero), eq(cotImportes.anio, anio), eq(cotImportes.version, version)))
      .limit(1),
  ]);

  const { armado, avisos } = armadoDesdeFilas({
    armado: {
      numero: encabezado.numero,
      anio: encabezado.anio,
      version: encabezado.version,
      moneda: encabezado.moneda,
      moneda_gastos: encabezado.monedaGastos,
      reparto_gastos: encabezado.repartoGastos,
      asesoria_pct: encabezado.asesoriaPct,
      iva_pct: encabezado.ivaPct,
      tipo_cambio: encabezado.tipoCambio,
      tipo_cambio_origen: encabezado.tipoCambioOrigen,
      tipo_cambio_motivo: encabezado.tipoCambioMotivo,
      condiciones: encabezado.condiciones,
      documento: encabezado.documento,
    },
    partidas: partidas.map((p) => ({
      id: p.id,
      orden: p.orden,
      titulo: p.titulo,
      descripcion: p.descripcion,
      cantidad: p.cantidad,
      unidad: p.unidad,
      ajuste: p.ajuste,
      precio_unitario_final: p.precioUnitarioFinal,
      recibe_gastos_generales: p.recibeGastosGenerales,
      gasto_manual: p.gastoManual,
      formato: p.formato,
      notas: p.notas,
    })),
    conceptos: conceptos.map((c) => ({
      id: c.id,
      partida_id: c.partidaId,
      codigo: c.codigo,
      descripcion_libre: c.descripcionLibre,
      cantidad: c.cantidad,
      unidad: c.unidad,
      costo: c.costo,
      costo_catalogo: c.costoCatalogo,
      utilidad_pct: c.utilidadPct,
      moneda_costo: c.monedaCosto,
      horas_por_dia: c.horasPorDia,
      dias_por_semana: c.diasPorSemana,
      ingenieros: c.ingenieros,
      semanas: c.semanas,
      tarifa_hora: c.tarifaHora,
      nodos: c.nodos,
      base_nodos: c.baseNodos,
      orden: c.orden,
    })),
    gastos: gastos.map((g) => ({
      id: g.id,
      codigo: g.codigo,
      descripcion_libre: g.descripcionLibre,
      cantidad: g.cantidad,
      costo: g.costo,
      costo_catalogo: g.costoCatalogo,
      utilidad_pct: g.utilidadPct,
      moneda_costo: g.monedaCosto,
      destino_partida_id: g.destinoPartidaId,
      orden: g.orden,
    })),
  });

  // El machote solo entra donde quedó vacío; lo escrito no se pisa.
  const machote = await machoteDelDocumento(cotizacion);
  const { valor, llenados } = completarDocumento(armado.documento, machote);
  armado.documento = valor;

  const resultado = calcularCotizacion(entradaDeArmado(armado, config.cotizador.BASE_NODOS_ESTUDIO));

  // Los desfases se calculan contra el catálogo de HOY: es la pregunta que la
  // pantalla contesta con el aviso de "el catálogo cambió".
  const catalogo = await catalogoVigente();
  const lineas = [
    ...armado.partidas.flatMap((p) =>
      p.conceptos.map((c) => ({ id: c.id, codigo: c.codigo, costo: c.costo, costoCatalogo: c.costoCatalogo })),
    ),
    ...armado.gastos.map((g) => ({
      id: g.id, codigo: g.codigo, costo: g.costo, costoCatalogo: g.costoCatalogo,
    })),
  ];

  const congeladoRow = congeladoFila[0];
  return {
    cotizacion,
    armado,
    resultado,
    desfases: detectarDesfases(lineas, catalogo),
    avisos,
    llenadoAutomatico: llenados,
    contactoDelCatalogo: machote.encontrado,
    congelado: congeladoRow
      ? {
          total: congeladoRow.total,
          letra: congeladoRow.letra,
          congeladoAt: congeladoRow.congeladoAt.toISOString(),
        }
      : null,
    actualizadoEn: encabezado.updatedAt.toISOString(),
  };
}

// ── Escritura ─────────────────────────────────────────────────────────────────

export class ConflictoDeEdicion extends Error {
  constructor() {
    super("Alguien más guardó esta cotización mientras la editabas.");
    this.name = "ConflictoDeEdicion";
  }
}

/**
 * Guarda el armado completo de una versión.
 *
 * **Dos pasos, y el primero es el candado.** El driver HTTP de Neon no tiene
 * transacciones interactivas, así que no se puede "mirar y luego decidir"
 * dentro de una. Lo que sí se puede es reclamar la versión con **una sola
 * sentencia**: un `UPDATE … WHERE updated_at = <el que traía la pantalla>`.
 * Si no actualiza ningún renglón, alguien más guardó mientras tanto y aquí se
 * acaba — sin haber tocado una sola partida.
 *
 * Reclamada la versión, el resto va en un lote atómico. Dos personas no pueden
 * reclamarla a la vez: el `UPDATE` es atómico y la segunda no encuentra su
 * `updated_at`.
 */
export async function guardarArmado(params: {
  armado: Armado;
  /** Lo que la pantalla leyó. `null` si la versión todavía no existía. */
  actualizadoEn: string | null;
  usuario: string;
}): Promise<{ actualizadoEn: string }> {
  const db = getDb();
  const { armado, actualizadoEn } = params;
  const { numero, anio, version } = armado;
  const filas = filasDeArmado(armado);
  const ahora = new Date();

  const cabecera = { ...filas.armado, updatedAt: ahora };

  let reclamada: Array<{ updatedAt: Date }>;
  if (actualizadoEn === null) {
    // Primera vez. `DO NOTHING` convierte la carrera en "no devolvió renglón",
    // que es el mismo conflicto que el del UPDATE.
    reclamada = await db
      .insert(cotArmado)
      .values({ numero, anio, version, ...cabecera, createdBy: params.usuario })
      .onConflictDoNothing()
      .returning({ updatedAt: cotArmado.updatedAt });
  } else {
    reclamada = await db
      .update(cotArmado)
      .set(cabecera)
      .where(
        and(
          eq(cotArmado.numero, numero),
          eq(cotArmado.anio, anio),
          eq(cotArmado.version, version),
          eq(cotArmado.updatedAt, new Date(actualizadoEn)),
        ),
      )
      .returning({ updatedAt: cotArmado.updatedAt });
  }

  if (reclamada.length === 0) throw new ConflictoDeEdicion();

  // Reclamada la versión, lo de abajo se reemplaza entero en un solo lote.
  // Se borra en orden —gastos, conceptos, partidas— aunque haya cascada: el
  // orden explícito dice qué cuelga de qué sin tener que ir al esquema.
  const clave = (t: typeof cotPartidas | typeof cotConceptos | typeof cotGastos) =>
    and(eq(t.numero, numero), eq(t.anio, anio), eq(t.version, version));

  const borrados = [
    db.delete(cotGastos).where(clave(cotGastos)),
    db.delete(cotConceptos).where(clave(cotConceptos)),
    db.delete(cotPartidas).where(clave(cotPartidas)),
  ] as const;

  const inserciones = [
    ...(filas.partidas.length ? [db.insert(cotPartidas).values(filas.partidas)] : []),
    ...(filas.conceptos.length ? [db.insert(cotConceptos).values(filas.conceptos)] : []),
    ...(filas.gastos.length ? [db.insert(cotGastos).values(filas.gastos)] : []),
  ];

  await db.batch([borrados[0], borrados[1], borrados[2], ...inserciones]);

  return { actualizadoEn: reclamada[0].updatedAt.toISOString() };
}

/**
 * Congela los importes de una versión.
 *
 * Se calcula con el motor, se guarda el resultado completo y se copia el total
 * a la cotización diciendo que vino del cotizador. A partir de aquí la versión
 * no se edita: para cambiar algo se hace una versión nueva.
 */
export async function congelarVersion(params: {
  numero: number;
  anio: number;
  version: number;
  usuario: string;
}): Promise<{ resultado: ResultadoCotizacion; letra: string; avisos: string[] }> {
  const completo = await getArmado(params.numero, params.anio, params.version);
  if (!completo) throw new Error("No existe esa versión de la cotización");

  const config = await getConfigErp();
  const entrada = entradaDeArmado(completo.armado, config.cotizador.BASE_NODOS_ESTUDIO);
  const resultado = calcularCotizacion(entrada);
  const letra = importeEnLetra(resultado.total, resultado.moneda);

  const c = congelar(
    { numero: params.numero, anio: params.anio, version: params.version },
    entrada,
    resultado,
    letra,
    params.usuario,
  );
  const monto = montoDeCongelado(c);

  const db = getDb();
  await db
    .insert(cotImportes)
    .values({
      numero: c.numero,
      anio: c.anio,
      version: c.version,
      congeladoPor: c.congeladoPor,
      resultado: c.resultado,
      parametros: c.parametros,
      moneda: c.moneda,
      subtotal: String(c.subtotal),
      iva: String(c.iva),
      total: String(c.total),
      letra: c.letra,
    })
    .onConflictDoUpdate({
      target: [cotImportes.numero, cotImportes.anio, cotImportes.version],
      set: {
        congeladoAt: new Date(),
        congeladoPor: c.congeladoPor,
        resultado: c.resultado,
        parametros: c.parametros,
        moneda: c.moneda,
        subtotal: String(c.subtotal),
        iva: String(c.iva),
        total: String(c.total),
        letra: c.letra,
      },
    });

  await db
    .update(cotizaciones)
    .set({
      montoMxn: monto.montoMxn === null ? null : String(monto.montoMxn),
      montoUsd: monto.montoUsd === null ? null : String(monto.montoUsd),
      origenMonto: monto.origenMonto,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(cotizaciones.numero, params.numero),
        eq(cotizaciones.anio, params.anio),
        eq(cotizaciones.version, params.version),
      ),
    );

  return { resultado, letra, avisos: resultado.avisos };
}

/**
 * Lleva al costo del catálogo vigente los conceptos y gastos que se elijan.
 *
 * Escribe solo esos renglones —no reescribe el armado— para no pisar lo que la
 * pantalla tenga sin guardar en otro campo.
 */
export async function actualizarPrecios(params: {
  numero: number;
  anio: number;
  version: number;
  ids: string[];
}): Promise<{ actualizados: number }> {
  if (params.ids.length === 0) return { actualizados: 0 };

  const db = getDb();
  const catalogo = new Map((await catalogoVigente()).map((s) => [s.codigo, s]));
  const clave = (t: typeof cotConceptos | typeof cotGastos) =>
    and(eq(t.numero, params.numero), eq(t.anio, params.anio), eq(t.version, params.version));

  const [conceptos, gastos] = await Promise.all([
    db.select().from(cotConceptos).where(and(clave(cotConceptos), inArray(cotConceptos.id, params.ids))),
    db.select().from(cotGastos).where(and(clave(cotGastos), inArray(cotGastos.id, params.ids))),
  ]);

  const cambios = [
    ...conceptos.flatMap((c) => {
      const costo = c.codigo ? catalogo.get(c.codigo)?.costo : undefined;
      if (costo === undefined || costo === null) return [];
      return [
        db
          .update(cotConceptos)
          .set({ costo: String(costo), costoCatalogo: String(costo) })
          .where(eq(cotConceptos.id, c.id)),
      ];
    }),
    ...gastos.flatMap((g) => {
      const costo = g.codigo ? catalogo.get(g.codigo)?.costo : undefined;
      if (costo === undefined || costo === null) return [];
      return [
        db
          .update(cotGastos)
          .set({ costo: String(costo), costoCatalogo: String(costo) })
          .where(eq(cotGastos.id, g.id)),
      ];
    }),
  ];

  if (cambios.length === 0) return { actualizados: 0 };
  await db.batch([cambios[0], ...cambios.slice(1)]);
  return { actualizados: cambios.length };
}
