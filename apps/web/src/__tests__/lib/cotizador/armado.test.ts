import { describe, it, expect } from "vitest";
import {
  armadoDesdeFilas,
  calcularCotizacion,
  edicionPorEstatus,
  entradaDeArmado,
  filasDeArmado,
  puedeArmar,
  type Armado,
  type FilasArmado,
} from "@/src/lib/cotizador";

// ── Filas como las devuelve Postgres ─────────────────────────────────────────

const armadoFila = (sobre: Partial<FilasArmado["armado"]> = {}): FilasArmado["armado"] => ({
  numero: 450, anio: 2026, version: 0,
  moneda: "MXN", moneda_gastos: "MXN", reparto_gastos: "IGUAL",
  asesoria_pct: "10.000000", iva_pct: "16.000000",
  tipo_cambio: null, tipo_cambio_origen: null, tipo_cambio_motivo: null,
  condiciones: null, documento: null,
  ...sobre,
});

const partidaFila = (sobre: Partial<FilasArmado["partidas"][number]> = {}): FilasArmado["partidas"][number] => ({
  id: "P1", orden: 1, titulo: "Partida", descripcion: null,
  cantidad: "1.000000", unidad: "servicio", ajuste: "0.000000",
  precio_unitario_final: null, recibe_gastos_generales: true, gasto_manual: null,
  formato: "NORMAL", notas: null,
  ...sobre,
});

const conceptoFila = (sobre: Partial<FilasArmado["conceptos"][number]> = {}): FilasArmado["conceptos"][number] => ({
  id: "C1", partida_id: "P1", codigo: "SP001", descripcion_libre: null,
  cantidad: "1.000000", unidad: "servicio", costo: "2000.000000", costo_catalogo: "2000.000000",
  utilidad_pct: "0.000000", moneda_costo: null,
  horas_por_dia: null, dias_por_semana: null, ingenieros: null, semanas: null,
  tarifa_hora: null, nodos: null, base_nodos: null, orden: 1,
  ...sobre,
});

const gastoFila = (sobre: Partial<FilasArmado["gastos"][number]> = {}): FilasArmado["gastos"][number] => ({
  id: "G1", codigo: "COSTO_AYUDANTE", descripcion_libre: null,
  cantidad: "1.000000", costo: "2500.000000", costo_catalogo: "2500.000000",
  utilidad_pct: "0.000000", moneda_costo: null, destino_partida_id: null, orden: 1,
  ...sobre,
});

describe("armadoDesdeFilas", () => {
  it("arma la cabecera con lo que trae el renglón", () => {
    const { armado } = armadoDesdeFilas({
      armado: armadoFila({
        moneda: "USD", moneda_gastos: "MXN", reparto_gastos: "PROPORCIONAL",
        asesoria_pct: "7.500000", iva_pct: "8.000000",
        tipo_cambio: "18.500000", tipo_cambio_origen: "PREFERENTE", tipo_cambio_motivo: "Tipo pactado",
      }),
      partidas: [partidaFila()], conceptos: [conceptoFila()], gastos: [],
    });
    expect(armado.moneda).toBe("USD");
    expect(armado.asesoriaPct).toBe(7.5);
    expect(armado.ivaPct).toBe(8);
    expect(armado.tipoCambio).toEqual({ valor: 18.5, origen: "PREFERENTE", motivo: "Tipo pactado" });
  });

  // El documento depende del orden y un SELECT sin ORDER BY no promete nada.
  it("ordena partidas, conceptos y gastos por su columna de orden", () => {
    const { armado } = armadoDesdeFilas({
      armado: armadoFila(),
      partidas: [partidaFila({ id: "B", orden: 2 }), partidaFila({ id: "A", orden: 1 })],
      conceptos: [
        conceptoFila({ id: "c2", partida_id: "A", orden: 2, codigo: "SP002" }),
        conceptoFila({ id: "c1", partida_id: "A", orden: 1, codigo: "SP001" }),
      ],
      gastos: [gastoFila({ id: "g2", orden: 2 }), gastoFila({ id: "g1", orden: 1 })],
    });
    expect(armado.partidas.map((p) => p.id)).toEqual(["A", "B"]);
    expect(armado.partidas[0].conceptos.map((c) => c.codigo)).toEqual(["SP001", "SP002"]);
    expect(armado.gastos.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("la descripción se abre en bloques", () => {
    const { armado } = armadoDesdeFilas({
      armado: armadoFila(),
      partidas: [partidaFila({ descripcion: "## Título\n- Viñeta" })],
      conceptos: [], gastos: [],
    });
    expect(armado.partidas[0].bloques).toEqual([
      { tipo: "subtitulo", texto: "Título" },
      { tipo: "vineta", texto: "Viñeta" },
    ]);
  });

  it("un esfuerzo a medias no se lee a medias", () => {
    const completo = conceptoFila({
      codigo: "AR001", horas_por_dia: 8, dias_por_semana: 5, ingenieros: 2,
      semanas: 10, tarifa_hora: "12.000000",
    });
    const base = { armado: armadoFila(), partidas: [partidaFila()], gastos: [] };
    expect(armadoDesdeFilas({ ...base, conceptos: [completo] }).armado.partidas[0].conceptos[0].esfuerzo)
      .toMatchObject({ horasPorDia: 8, tarifaHora: 12 });
    expect(
      armadoDesdeFilas({ ...base, conceptos: [{ ...completo, tarifa_hora: null }] })
        .armado.partidas[0].conceptos[0].esfuerzo,
    ).toBeNull();
  });

  it("los avisos de los bloques de jsonb salen a la superficie", () => {
    const { avisos } = armadoDesdeFilas({
      armado: armadoFila({ condiciones: "no soy un bloque" }),
      partidas: [], conceptos: [], gastos: [],
    });
    expect(avisos[0]).toContain("no son un bloque");
  });
});

describe("entradaDeArmado", () => {
  const base = armadoDesdeFilas({
    armado: armadoFila(),
    partidas: [partidaFila({ id: "P1" })],
    conceptos: [conceptoFila()],
    gastos: [gastoFila({ destino_partida_id: "P1" })],
  }).armado;

  it("un gasto con destino llega al motor como tal", () => {
    expect(entradaDeArmado(base).gastos![0].destino).toEqual({ partida: "P1" });
  });

  // La columna es NOT NULL con default true: solo viaja la excepción, que es
  // lo que hay que poder ver al revisar la cotización.
  it("recibeGastosGenerales solo viaja cuando es false", () => {
    expect(entradaDeArmado(base).partidas[0].recibeGastosGenerales).toBeUndefined();
    const sin = { ...base, partidas: [{ ...base.partidas[0], recibeGastosGenerales: false }] };
    expect(entradaDeArmado(sin).partidas[0].recibeGastosGenerales).toBe(false);
  });

  it("los nodos por omisión de la configuración entran cuando se pasan", () => {
    expect(entradaDeArmado(base, 10).baseNodosPorOmision).toBe(10);
    expect(entradaDeArmado(base).baseNodosPorOmision).toBeUndefined();
  });
});

describe("filasDeArmado", () => {
  const armado = armadoDesdeFilas({
    armado: armadoFila(),
    partidas: [partidaFila({ id: "P1", descripcion: "## Título" })],
    conceptos: [conceptoFila({ costo: "2671.885000", costo_catalogo: "2671.885000" })],
    gastos: [gastoFila()],
  }).armado;

  /**
   * La prueba de fondo: lo que se guarda tiene que volver a abrirse igual.
   * Si esto se rompe, una cotización pierde algo cada vez que se autoguarda.
   */
  it("la ida y vuelta devuelve el mismo armado", () => {
    const filas = filasDeArmado(armado);
    const vuelta = armadoDesdeFilas({
      armado: armadoFila({
        moneda: filas.armado.moneda,
        moneda_gastos: filas.armado.monedaGastos,
        reparto_gastos: filas.armado.repartoGastos,
        asesoria_pct: filas.armado.asesoriaPct,
        iva_pct: filas.armado.ivaPct,
        tipo_cambio: filas.armado.tipoCambio,
        tipo_cambio_origen: filas.armado.tipoCambioOrigen,
        tipo_cambio_motivo: filas.armado.tipoCambioMotivo,
        condiciones: filas.armado.condiciones,
        documento: filas.armado.documento,
      }),
      partidas: filas.partidas.map((p) => ({
        id: p.id, orden: p.orden, titulo: p.titulo, descripcion: p.descripcion,
        cantidad: p.cantidad, unidad: p.unidad, ajuste: p.ajuste,
        precio_unitario_final: p.precioUnitarioFinal,
        recibe_gastos_generales: p.recibeGastosGenerales,
        gasto_manual: p.gastoManual, formato: p.formato, notas: p.notas,
      })),
      conceptos: filas.conceptos.map((c) => ({
        id: c.id, partida_id: c.partidaId, codigo: c.codigo, descripcion_libre: c.descripcionLibre,
        cantidad: c.cantidad, unidad: c.unidad, costo: c.costo, costo_catalogo: c.costoCatalogo,
        utilidad_pct: c.utilidadPct, moneda_costo: c.monedaCosto,
        horas_por_dia: c.horasPorDia, dias_por_semana: c.diasPorSemana, ingenieros: c.ingenieros,
        semanas: c.semanas, tarifa_hora: c.tarifaHora, nodos: c.nodos, base_nodos: c.baseNodos,
        orden: c.orden,
      })),
      gastos: filas.gastos.map((g) => ({
        id: g.id, codigo: g.codigo, descripcion_libre: g.descripcionLibre,
        cantidad: g.cantidad, costo: g.costo, costo_catalogo: g.costoCatalogo,
        utilidad_pct: g.utilidadPct, moneda_costo: g.monedaCosto,
        destino_partida_id: g.destinoPartidaId, orden: g.orden,
      })),
    }).armado;

    expect(vuelta).toEqual(armado);
  });

  // La escala de la columna es 6: el 2,671.885 de la 068 tiene que sobrevivir.
  it("los montos se escriben con la escala de su columna", () => {
    const filas = filasDeArmado(armado);
    expect(filas.conceptos[0].costo).toBe("2671.885000");
    expect(Number(filas.conceptos[0].costo)).toBe(2671.885);
  });

  /**
   * La pantalla puede mover partidas; el índice único de
   * (numero, anio, version, orden) no perdona un hueco ni un repetido.
   */
  it("renumera el orden al guardar", () => {
    const desordenado: Armado = {
      ...armado,
      partidas: [
        { ...armado.partidas[0], id: "A", orden: 7 },
        { ...armado.partidas[0], id: "B", orden: 7 },
      ],
    };
    expect(filasDeArmado(desordenado).partidas.map((p) => p.orden)).toEqual([1, 2]);
  });

  it("los bloques se guardan como texto con sus marcas", () => {
    expect(filasDeArmado(armado).partidas[0].descripcion).toBe("## Título");
  });
});

// ── El escenario 450, el que se prueba en la app ─────────────────────────────

/**
 * Dos partidas de tres conceptos de 2,000 × 2, gastos de 27,600 repartidos por
 * igual y asesoría de 10 %. Es el caso con el que se revisa la pantalla, y está
 * aquí para que los números del instructivo no dependan de que alguien los
 * vuelva a sacar a mano.
 */
describe("ESCENARIO · la 450 desde el armado", () => {
  const armadoDe = (utilidadP1: number): Armado =>
    armadoDesdeFilas({
      armado: armadoFila(),
      partidas: [partidaFila({ id: "P1", orden: 1 }), partidaFila({ id: "P2", orden: 2 })],
      conceptos: [1, 2, 3].flatMap((i) => [
        conceptoFila({
          id: `a${i}`, partida_id: "P1", orden: i,
          cantidad: "2.000000", costo: "2000.000000",
          utilidad_pct: utilidadP1.toFixed(6),
        }),
        conceptoFila({ id: `b${i}`, partida_id: "P2", orden: i, cantidad: "2.000000", costo: "2000.000000" }),
      ]),
      gastos: [gastoFila({ cantidad: "1.000000", costo: "27600.000000" })],
    }).armado;

  it("sin utilidad, las dos partidas salen iguales", () => {
    const r = calcularCotizacion(entradaDeArmado(armadoDe(0)));
    expect(r.partidas.map((p) => p.importe)).toEqual([28380, 28380]);
    expect(r.total).toBe(65841.6);
  });

  // La utilidad es por concepto: sube la partida 1 y deja la 2 donde estaba.
  it("con 15 % en la primera, solo esa se mueve", () => {
    const r = calcularCotizacion(entradaDeArmado(armadoDe(15)));
    expect(r.partidas.map((p) => p.importe)).toEqual([30360, 28380]);
    expect(r.total).toBe(68138.4);
  });
});

// ── Quién puede editar ───────────────────────────────────────────────────────

describe("edicionPorEstatus", () => {
  it("en proceso se edita", () => {
    expect(edicionPorEstatus("PROCESO").editable).toBe(true);
    expect(edicionPorEstatus("").editable).toBe(true);
  });

  // Los dependientes son una espera, no un cierre.
  it("los dependientes se siguen editando", () => {
    expect(edicionPorEstatus("DEPENDIENTE PROVEEDOR").editable).toBe(true);
    expect(edicionPorEstatus("DEPENDIENTE CLIENTE").editable).toBe(true);
  });

  /**
   * Cambia respecto al ERP viejo: allá una versión en REVISION se desbloqueaba
   * sola si el revisor no contestaba. Aquí los importes ya se congelaron al
   * mandarla, así que tocarla dejaría el congelado contando otra cosa.
   */
  it("en revisión ya no se edita, y dice por qué", () => {
    const r = edicionPorEstatus("REVISION");
    expect(r.editable).toBe(false);
    expect(r.motivo).toContain("congelaron");
  });

  it("enviada o asignada tampoco, y el motivo habla del cliente", () => {
    for (const e of ["ENVIADA", "ASIGNADA", "NO ASIGNADA"]) {
      const r = edicionPorEstatus(e);
      expect([e, r.editable]).toEqual([e, false]);
      expect(r.motivo).toContain("cliente");
    }
  });

  it("no le importan los espacios ni las minúsculas", () => {
    expect(edicionPorEstatus("  proceso  ").editable).toBe(true);
  });
});

describe("puedeArmar", () => {
  const cot = { created_by: "ana@proyinstelec.mx", elaboro: "EAOL" };

  it("quien la dio de alta en el ERP nuevo, por su correo", () => {
    expect(puedeArmar(cot, { email: "ana@proyinstelec.mx" }, false).puede).toBe(true);
    expect(puedeArmar(cot, { email: "ANA@proyinstelec.mx" }, false).puede).toBe(true);
  });

  /**
   * Las cotizaciones importadas de 2026 traen `created_by = "importador"`: ahí
   * el único vínculo con una persona son las iniciales, que es como el ERP
   * viejo identifica a la gente.
   */
  it("quien la elaboró, por sus iniciales", () => {
    const importada = { created_by: "importador", elaboro: "EAOL" };
    expect(puedeArmar(importada, { email: "eduardo@proyinstelec.mx", iniciales: "EAOL" }, false).puede).toBe(true);
    expect(puedeArmar(importada, { email: "eduardo@proyinstelec.mx", iniciales: "eaol" }, false).puede).toBe(true);
  });

  it("alguien más no puede, y el motivo dice qué hacer", () => {
    const r = puedeArmar(cot, { email: "otro@proyinstelec.mx", iniciales: "OTRO" }, false);
    expect(r.puede).toBe(false);
    expect(r.motivo).toContain("EAOL");
    expect(r.motivo).toContain("gerente de operaciones");
  });

  it("con el permiso de armar todas, cualquiera", () => {
    expect(puedeArmar(cot, { email: "gerente@proyinstelec.mx" }, true).puede).toBe(true);
  });

  // Un usuario sin iniciales capturadas no se reconoce por esa vía: es un
  // hueco de datos, y tratarlo como coincidencia abriría cotizaciones ajenas.
  it("sin iniciales no se reconoce por iniciales", () => {
    expect(puedeArmar({ created_by: "x", elaboro: "" }, { email: "y@z.mx", iniciales: "" }, false).puede).toBe(false);
  });

  it("sin usuario, no", () => {
    expect(puedeArmar(cot, null, true).puede).toBe(false);
  });
});
