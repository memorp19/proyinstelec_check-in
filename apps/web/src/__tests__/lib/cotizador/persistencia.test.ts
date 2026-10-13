import { describe, it, expect } from "vitest";
import {
  calcularCotizacion,
  congelar,
  copiarAVersion,
  dec,
  entradaDesdeFilas,
  importeEnLetra,
  montoDeCongelado,
  type ServicioCatalogo,
  type FilaArmado,
  type FilaConcepto,
  type FilaGasto,
  type FilaPartida,
} from "@/src/lib/cotizador";
import { ENTRADA_068, PDF_068 } from "./casos/068";

/** El armado como lo devuelve Postgres: los `numeric`, en texto. */
const armado = (sobre: Partial<FilaArmado> = {}): FilaArmado => ({
  numero: 9068, anio: 2099, version: 0,
  moneda: "MXN", moneda_gastos: "MXN", reparto_gastos: "IGUAL",
  asesoria_pct: "10.00", iva_pct: "16.00",
  tipo_cambio: null, tipo_cambio_origen: null, tipo_cambio_motivo: null,
  ...sobre,
});

const partida = (sobre: Partial<FilaPartida> = {}): FilaPartida => ({
  id: "P1", orden: 1, titulo: "Partida", descripcion: null,
  cantidad: "1.0000", unidad: "servicio", ajuste: "0.00",
  precio_unitario_final: null, recibe_gastos_generales: true, gasto_manual: null,
  ...sobre,
});

const concepto = (sobre: Partial<FilaConcepto> = {}): FilaConcepto => ({
  id: "C1", partida_id: "P1", codigo: "SP001", descripcion_libre: null,
  cantidad: "1.0000", unidad: null, costo: "2000.00", costo_catalogo: "2000.00",
  utilidad_pct: "0.00",
  moneda_costo: null, horas_por_dia: null, dias_por_semana: null,
  ingenieros: null, semanas: null, tarifa_hora: null, nodos: null,
  base_nodos: null, orden: 1,
  ...sobre,
});

const gasto = (sobre: Partial<FilaGasto> = {}): FilaGasto => ({
  id: "G1", codigo: "COSTO_AYUDANTE", descripcion_libre: null,
  cantidad: "1.0000", costo: "2500.00", costo_catalogo: "2500.00", utilidad_pct: "0.00",
  moneda_costo: null, destino_partida_id: null, orden: 1,
  ...sobre,
});

describe("dec", () => {
  it("convierte el texto que devuelve Postgres", () => {
    expect(dec("1046113.00")).toBe(1046113);
    expect(dec("5343.77")).toBe(5343.77);
    expect(dec(18)).toBe(18);
  });

  // Importa la diferencia: un costo sin capturar no es un costo de cero, y
  // tratarlo como cero cotizaría gratis un concepto que nadie valuó.
  it("lo que no hay queda en undefined, no en cero", () => {
    expect(dec(null)).toBeUndefined();
    expect(dec("")).toBeUndefined();
    expect(dec("lo que sea")).toBeUndefined();
    expect(dec("0")).toBe(0);
  });
});

describe("entradaDesdeFilas", () => {
  it("arma la entrada con lo que trae el renglón del armado", () => {
    const e = entradaDesdeFilas({
      armado: armado({
        moneda: "USD", moneda_gastos: "MXN", reparto_gastos: "PROPORCIONAL",
        asesoria_pct: "7.50", iva_pct: "8.00",
        tipo_cambio: "18.5000", tipo_cambio_origen: "PREFERENTE", tipo_cambio_motivo: "Tipo pactado",
      }),
      partidas: [partida()],
      conceptos: [concepto()],
      gastos: [],
    });
    expect(e.moneda).toBe("USD");
    expect(e.monedaGastos).toBe("MXN");
    expect(e.reparto).toBe("PROPORCIONAL");
    expect(e.asesoriaPct).toBe(7.5);
    expect(e.ivaPct).toBe(8);
    expect(e.tipoCambio).toEqual({ valor: 18.5, origen: "PREFERENTE", motivo: "Tipo pactado" });
  });

  it("sin tipo de cambio guardado, la entrada no lo lleva", () => {
    const e = entradaDesdeFilas({ armado: armado(), partidas: [partida()], conceptos: [concepto()], gastos: [] });
    expect(e.tipoCambio).toBeUndefined();
  });

  // El documento depende del orden y un SELECT sin ORDER BY no promete nada.
  it("ordena partidas y conceptos por su columna de orden", () => {
    const e = entradaDesdeFilas({
      armado: armado(),
      partidas: [partida({ id: "B", orden: 2 }), partida({ id: "A", orden: 1 })],
      conceptos: [
        concepto({ id: "c2", partida_id: "A", orden: 2, codigo: "SP002" }),
        concepto({ id: "c1", partida_id: "A", orden: 1, codigo: "SP001" }),
      ],
      gastos: [gasto({ id: "g2", orden: 2 }), gasto({ id: "g1", orden: 1 })],
    });
    expect(e.partidas.map((p) => p.id)).toEqual(["A", "B"]);
    expect(e.partidas[0].conceptos.map((c) => c.codigo)).toEqual(["SP001", "SP002"]);
    expect(e.gastos!.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("un gasto sin partida destino es general; con ella, va entero a esa partida", () => {
    const e = entradaDesdeFilas({
      armado: armado(),
      partidas: [partida()],
      conceptos: [concepto()],
      gastos: [gasto({ id: "g1" }), gasto({ id: "g2", destino_partida_id: "P1" })],
    });
    expect(e.gastos![0].destino).toBeUndefined();
    expect(e.gastos![1].destino).toEqual({ partida: "P1" });
  });

  it("la columna de gastos generales solo viaja cuando es la excepción", () => {
    const filas = { armado: armado(), conceptos: [concepto()], gastos: [] };
    expect(entradaDesdeFilas({ ...filas, partidas: [partida()] }).partidas[0].recibeGastosGenerales)
      .toBeUndefined();
    expect(
      entradaDesdeFilas({ ...filas, partidas: [partida({ recibe_gastos_generales: false })] })
        .partidas[0].recibeGastosGenerales,
    ).toBe(false);
  });

  it("el esfuerzo viaja completo o no viaja", () => {
    const base = { armado: armado(), partidas: [partida()], gastos: [] };
    const completo = concepto({
      codigo: "AR001", horas_por_dia: 8, dias_por_semana: 5, ingenieros: 2,
      semanas: 10, tarifa_hora: "12.00", nodos: 14, base_nodos: 10,
    });
    expect(entradaDesdeFilas({ ...base, conceptos: [completo] }).partidas[0].conceptos[0].esfuerzo)
      .toEqual({ horasPorDia: 8, diasPorSemana: 5, ingenieros: 2, semanas: 10, tarifaHora: 12, nodos: 14, baseNodos: 10 });

    // A medias no: el motor pide los parámetros completos justamente para no
    // inventar la mitad de un número.
    const aMedias = concepto({ ...completo, tarifa_hora: null });
    expect(entradaDesdeFilas({ ...base, conceptos: [aMedias] }).partidas[0].conceptos[0].esfuerzo)
      .toBeUndefined();
  });

  it("los nodos base de la configuración entran cuando se pasan", () => {
    const e = entradaDesdeFilas({
      armado: armado(), partidas: [partida()], conceptos: [concepto()], gastos: [],
      baseNodosPorOmision: 10,
    });
    expect(e.baseNodosPorOmision).toBe(10);
  });
});

/**
 * La prueba que de verdad importa: lo que se guarda tiene que volver a producir
 * el mismo PDF. Es la misma que corre `scripts/prueba-068.ts` contra la base;
 * aquí se hace con las filas en memoria, sin conexión.
 */
describe("ida y vuelta de la 068", () => {
  /** La 068, escrita como filas de la base. */
  const filas = {
    armado: armado({
      moneda: "MXN", moneda_gastos: "MXN", reparto_gastos: "IGUAL",
      asesoria_pct: "5.00", iva_pct: "16.00",
      tipo_cambio: "18.0000", tipo_cambio_origen: "PREFERENTE",
      tipo_cambio_motivo: "Tipo pactado con el cliente (celda T3)",
    }),
    partidas: ENTRADA_068.partidas.map((p) =>
      partida({
        id: p.id,
        orden: p.orden!,
        titulo: p.titulo!,
        cantidad: String(p.cantidad),
        unidad: p.unidad ?? null,
        ajuste: (p.ajuste ?? 0).toFixed(2),
        recibe_gastos_generales: p.recibeGastosGenerales !== false,
      }),
    ),
    conceptos: ENTRADA_068.partidas.flatMap((p) =>
      p.conceptos.map((c, i) =>
        concepto({
          id: `${p.id}-${i}`,
          partida_id: p.id,
          codigo: c.codigo!,
          cantidad: String(c.cantidad),
          costo: (c.costo ?? 0).toFixed(4),
          utilidad_pct: (c.utilidadPct ?? 0).toFixed(2),
          moneda_costo: c.monedaCosto ?? null,
          orden: i + 1,
        }),
      ),
    ),
    gastos: (ENTRADA_068.gastos ?? []).map((g, i) =>
      gasto({
        id: `G${i}`,
        codigo: g.codigo!,
        cantidad: String(g.cantidad),
        costo: g.costo.toFixed(2),
        destino_partida_id:
          g.destino && g.destino !== "GENERAL" ? g.destino.partida : null,
        orden: i + 1,
      }),
    ),
  };

  const r = calcularCotizacion(entradaDesdeFilas(filas));

  it("las once partidas salen con el precio unitario del PDF", () => {
    expect(r.partidas.map((p) => p.id)).toEqual(PDF_068.partidas.map(([id]) => id));
    for (const [id, unitario, importe] of PDF_068.partidas) {
      const p = r.partidas.find((x) => x.id === id)!;
      expect([id, p.precioUnitario, p.importe]).toEqual([id, unitario, importe]);
    }
  });

  it("subtotal, IVA y total cuadran al centavo", () => {
    expect([r.subtotal, r.iva, r.total]).toEqual([PDF_068.subtotal, PDF_068.iva, PDF_068.total]);
  });
});

describe("congelar", () => {
  const entrada = ENTRADA_068;
  const resultado = calcularCotizacion(entrada);
  const c = congelar(
    { numero: 9068, anio: 2099, version: 0 },
    entrada,
    resultado,
    importeEnLetra(resultado.total),
    "eduardo@proyinstelec.mx",
  );

  // Los cuatro sueltos se repiten fuera del jsonb para poder consultarlos sin
  // abrirlo; tienen que ser los mismos, no una copia que se pueda desfasar.
  it("los totales sueltos son los del resultado", () => {
    expect([c.subtotal, c.iva, c.total]).toEqual([resultado.subtotal, resultado.iva, resultado.total]);
    expect(c.moneda).toBe("MXN");
    expect(c.letra).toBe(PDF_068.letra);
  });

  /**
   * Se guarda el resultado completo y no solo los totales: el PDF enseña cada
   * partida con su precio unitario, y reimprimirlo recalculando daría otros
   * números en cuanto el catálogo se mueva.
   */
  it("guarda el resultado completo y los parámetros con que se calculó", () => {
    expect(c.resultado.partidas).toHaveLength(11);
    expect(c.parametros.asesoriaPct).toBe(5);
    expect(c.parametros.tipoCambio?.valor).toBe(18);
  });

  it("sobrevive a un viaje por jsonb sin perder un centavo", () => {
    const vuelta = JSON.parse(JSON.stringify(c)) as typeof c;
    expect(vuelta.resultado.subtotal).toBe(PDF_068.subtotal);
    expect(vuelta.resultado.partidas.map((p) => p.precioUnitario))
      .toEqual(PDF_068.partidas.map(([, unitario]) => unitario));
  });
});

// ── La versión siguiente (decisión 7) ────────────────────────────────────────

describe("copiarAVersion", () => {
  const catalogo: ServicioCatalogo[] = [
    { codigo: "SP001", descripcion: "a", unidad: "servicio", costo: 2000, moneda: "MXN", tipo: "SERVICIO", activo: true },
    { codigo: "COSTO_AYUDANTE", descripcion: "b", unidad: "servicio", costo: 2500, moneda: "MXN", tipo: "GASTO", activo: true },
  ];
  const filas = {
    armado: armado(),
    partidas: [partida({ id: "vieja-1" }), partida({ id: "vieja-2", orden: 2 })],
    conceptos: [concepto({ id: "c-1", partida_id: "vieja-1" })],
    gastos: [gasto({ id: "g-1", destino_partida_id: "vieja-2" })],
  };

  let n = 0;
  const copia = copiarAVersion(filas, catalogo, () => `nuevo-${++n}`);

  /**
   * Los ids son la llave de las partidas de ESA versión: conservarlos haría
   * que un gasto de la v1 apuntara a la partida de la v0.
   */
  it("renueva los ids y religa lo que apuntaba a ellos", () => {
    expect(copia.partidas.map((p) => p.id)).toEqual(["nuevo-1", "nuevo-2"]);
    expect(copia.conceptos[0].partida_id).toBe("nuevo-1");
    expect(copia.gastos[0].destino_partida_id).toBe("nuevo-2");
    // Y no se queda ningún id viejo suelto.
    expect(JSON.stringify(copia)).not.toContain("vieja-");
  });

  it("copia los costos tal cual: la versión nueva arranca siendo la anterior", () => {
    expect(copia.conceptos[0].costo).toBe("2000.00");
    expect(copia.gastos[0].costo).toBe("2500.00");
    expect(copia.avisos).toEqual([]);
  });

  it("si el catálogo se movió, lo dice y NO reprecia", () => {
    const movido = catalogo.map((c) => (c.codigo === "SP001" ? { ...c, costo: 2400 } : c));
    const r = copiarAVersion(filas, movido, () => `x-${++n}`);
    expect(r.conceptos[0].costo).toBe("2000.00");
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain("2400");
    expect(r.avisos[0]).toContain("decisión tuya");
  });

  it("un código que ya no está también se avisa", () => {
    const r = copiarAVersion(filas, [catalogo[1]], () => `y-${++n}`);
    expect(r.avisos[0]).toContain("SP001");
    expect(r.avisos[0]).toContain("ya no está");
  });
});

describe("montoDeCongelado", () => {
  const congelado = (moneda: "MXN" | "USD") =>
    congelar(
      { numero: 1, anio: 2026, version: 0 },
      { moneda, partidas: [] },
      { ...calcularCotizacion({ moneda, partidas: [] }), total: 1000 },
      "MIL PESOS 00/100 M.N.",
      "quien sea",
    );

  // Dos columnas independientes: sumarlas exigiría inventar un tipo de cambio.
  it("llena la columna de su moneda y deja la otra en null", () => {
    expect(montoDeCongelado(congelado("MXN"))).toEqual({ montoMxn: 1000, montoUsd: null, origenMonto: "COTIZADOR" });
    expect(montoDeCongelado(congelado("USD"))).toEqual({ montoMxn: null, montoUsd: 1000, origenMonto: "COTIZADOR" });
  });
});
