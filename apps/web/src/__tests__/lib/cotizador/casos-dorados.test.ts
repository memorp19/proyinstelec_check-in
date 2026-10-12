import { describe, it, expect } from "vitest";
import { calcularCotizacion, importeEnLetra } from "@/src/lib/cotizador";
import type { EntradaCotizacion } from "@/src/lib/cotizador";

/**
 * Dos clases de prueba, y conviene no confundirlas.
 *
 * **CASOS DORADOS** — la 068 y la 070. Están ancladas a un PDF que el cliente
 * recibió: cada entrada sale de la celda del Excel que la produjo, y el
 * resultado se compara contra el documento impreso. Si fallan, o el motor está
 * mal o el PDF lo estaba. Las entradas NO se reconstruyen desde los totales: si
 * se hiciera, el test solo demostraría que sabemos copiar un número.
 *
 * **ESCENARIOS** — la 450 y los estudios. No hay PDF detrás: se derivan de las
 * reglas acordadas y existen para fijar una decisión. Si fallan, cambió una
 * regla; puede estar bien, pero tiene que ser a propósito.
 *
 * Los archivos viven fuera del repositorio (`Downloads/casos-dorados/`) porque
 * traen datos de clientes. Aquí quedan únicamente las cifras y la referencia a
 * la celda.
 */

// ══════════════════════════════════════════════════════════════════════════════
// CASOS DORADOS — cada uno contra el PDF que recibió el cliente
// ══════════════════════════════════════════════════════════════════════════════

/**
 * El catálogo de la hoja COSTOS de ESE archivo (columnas ZI → ZK).
 *
 * Importa que sea el de ese archivo y no el catálogo de hoy: los costos
 * cambiaron desde que se cotizó, y es justo el motivo por el que los importes
 * se congelan al enviar.
 */
const CAT: Record<string, number> = {
  SP001: 2000, SP002: 2000, SP003: 2000, SP004: 2000, SP005: 2000,
  SP011: 2000, SP012: 2000, SP013: 3500, SP014: 3500, SP015: 3500,
  SP016: 4000, SP017: 4000, SP018: 2000, SP019: 2000, SP020: 2000,
  SP032: 700, SP033: 700, SP034: 700, SP037: 2000, SP039: 500,
  SP044: 15000, SP045: 3000, SP048: 2000, SP053: 15000, PR017: 5000,
  // Los "COSTO_DISPONIBLE" son renglones libres del catálogo que cada
  // cotización reutiliza para lo que no tiene código propio.
  COSTO_DISPONIBLE_002: 2100,
  COSTO_DISPONIBLE_003: 48040,
  COSTO_DISPONIBLE_004: 15000,
  COSTO_DISPONIBLE_005: 5343.77,
  COSTO_DISPONIBLE_006: 2671.885,
  COSTO_DISPONIBLE_007: 7764,
  COSTO_DISPONIBLE_008: 25000,
  COSTO_PROYINSTELEC: 15000,
  COSTO_AYUDANTE: 2500,
  COSTO_ALIMENTOS: 420,
  COSTO_TRANSPORTE: 3000,
  COSTO_COMBUSTIBLE: 25,
};

/** Un concepto del catálogo: código y cantidad, como la fila del Excel. */
const c = (codigo: string, cantidad: number) => ({ codigo, cantidad, costo: CAT[codigo] });

/**
 * Un concepto con utilidad y precio en dólares.
 *
 * En el Excel es `(LOOKUP(...) * R) * V3 * T3`, donde **V3 = 1.2** es la
 * utilidad (celda V3, rótulo "UTILIDAD") y **T3 = 18** el tipo de cambio
 * (celda T3, rótulo "MXN / USD"). Solo lo llevan las filas cuya fórmula los
 * incluye: no es un factor global.
 */
const cUsd = (codigo: string, cantidad: number) => ({
  ...c(codigo, cantidad),
  utilidadPct: 20,
  monedaCosto: "USD" as const,
});

/** Un concepto con utilidad pero en pesos: la fórmula lleva `*V3` y no `*T3`. */
const cUtil = (codigo: string, cantidad: number) => ({ ...c(codigo, cantidad), utilidadPct: 20 });

/**
 * Los ajustes de la 068, con la celda de la que salen.
 *
 * En el Excel viven dentro de las fórmulas de la columna AD, sumados al final
 * de cada partida. El `+0.5` es distinto: está dentro de `AD53`
 * —`((SUM(V53:V57))*1.05/10)+0.5`—, que es la celda del gasto general, y por
 * eso lo lleva **cada una** de las diez partidas que reciben gastos, no una.
 */
const AJUSTES_068: Record<string, { monto: number; celda: string; nota: string }> = {
  P1: { monto: 0.5, celda: "AD53", nota: "el +0.5 del reparto de gastos" },
  P2: { monto: 0.44, celda: "AD20", nota: "AD53 más un -0.06 al cierre" },
  P3: { monto: 10.5, celda: "AD36", nota: "AD53 más un +10" },
  P4: { monto: 10.5, celda: "AD40", nota: "AD53 más un +10" },
  P5: { monto: 10.5, celda: "AD43", nota: "AD53 más un +10" },
  P6: { monto: 55.5, celda: "AD46", nota: "AD53 más un +55" },
  TIERRAS: { monto: 0, celda: "AD58", nota: "no suma AD53: no recibe gastos generales" },
  P7: { monto: 10.5, celda: "AD48", nota: "AD53 más un +10" },
  P8: { monto: 0.5, celda: "AD49", nota: "solo el +0.5 de AD53" },
  P9: { monto: 0.5, celda: "AD50", nota: "solo el +0.5 de AD53" },
  P10: { monto: 0.46, celda: "AD51", nota: "AD53 más un -0.04 al cierre" },
};

const entrada068: EntradaCotizacion = {
  moneda: "MXN",
  monedaGastos: "MXN",
  tipoCambio: { valor: 18, origen: "PREFERENTE", motivo: "Tipo pactado con el cliente (celda T3)" },
  reparto: "IGUAL",
  // El "+5%" que el Excel aplica en la columna AD.
  asesoriaPct: 5,
  partidas: [
    // Las filas del Excel van en el comentario.
    //
    // El orden del arreglo es el del PDF, que es el bueno: es lo que vio el
    // cliente. NO coincide con la columna A de la hoja —ahí la de tierras es la
    // 9 y en el documento sale en séptimo lugar—, así que esa columna no es la
    // que ordena el documento y no sirve para reconstruirlo.
    {
      id: "P1", orden: 1, titulo: "Transformadores de potencia", cantidad: 2, unidad: "servicios",
      // Filas 8-19. R8 = 2.
      conceptos: [
        c("SP001", 2), c("SP002", 2), c("SP003", 2), c("SP004", 2), c("SP005", 2),
        c("SP013", 2), c("SP014", 2), c("SP015", 2), c("SP016", 2), c("SP017", 2),
        c("SP011", 2), c("SP012", 2),
      ],
      // AD53 lleva un `+0.5` que se suma a cada partida que recibe gastos.
      ajuste: AJUSTES_068.P1.monto,
    },
    {
      id: "P2", orden: 2, titulo: "Suministro e instalación de boquillas", cantidad: 1, unidad: "piezas",
      // Filas 20-35. Las dos primeras llevan utilidad y tipo de cambio.
      conceptos: [
        cUsd("COSTO_DISPONIBLE_005", 1), cUsd("COSTO_DISPONIBLE_006", 1),
        c("COSTO_DISPONIBLE_008", 1), c("SP053", 1),
        c("SP001", 1), c("SP002", 1), c("SP003", 1), c("SP004", 1), c("SP005", 1),
        c("SP013", 1), c("SP014", 1), c("SP015", 1), c("SP016", 1), c("SP017", 1),
        c("SP011", 1), c("SP012", 1),
      ],
      ajuste: AJUSTES_068.P2.monto, // AD20 cierra con `-0.06`
    },
    {
      id: "P3", orden: 3, titulo: "Interruptores de media tensión", cantidad: 9, unidad: "servicios",
      conceptos: [c("SP018", 9), c("SP019", 9), c("SP020", 9), c("SP048", 2)], // filas 36-39
      ajuste: AJUSTES_068.P3.monto, // AD36 cierra con `+10`
    },
    {
      id: "P4", orden: 4, titulo: "Interruptores de baja tensión", cantidad: 6, unidad: "servicios",
      conceptos: [c("SP018", 6), c("SP019", 6), c("SP045", 6)], // filas 40-42
      ajuste: AJUSTES_068.P4.monto, // AD40
    },
    {
      id: "P5", orden: 5, titulo: "Transformadores de instrumento", cantidad: 57, unidad: "servicios",
      conceptos: [c("SP032", 57), c("SP033", 57), c("SP034", 57)], // filas 43-45
      ajuste: AJUSTES_068.P5.monto, // AD43
    },
    {
      id: "P6", orden: 6, titulo: "Transformadores de instrumento II", cantidad: 33, unidad: "servicios",
      conceptos: [c("SP032", 33), c("SP033", 33)], // filas 46-47
      ajuste: AJUSTES_068.P6.monto, // AD46 cierra con `+55`
    },
    {
      id: "TIERRAS", orden: 7, titulo: "Sistema de tierras", cantidad: 1, unidad: "servicio",
      // Filas 58-60. Sus gastos (61-63) entran como gastos propios, abajo.
      conceptos: [c("SP037", 11), c("SP039", 40), c("COSTO_DISPONIBLE_004", 1)],
      // AD58 es `SUM(V58:V63)*1.05` a secas: NO suma AD53. Esta partida trae su
      // propio equipo y sus propios viáticos, así que cargarle además la parte
      // del gasto general la cobraría dos veces.
      recibeGastosGenerales: false,
      ajuste: AJUSTES_068.TIERRAS.monto,
    },
    {
      id: "P7", orden: 8, titulo: "Exactitud de medidores", cantidad: 7, unidad: "servicios",
      conceptos: [c("PR017", 7)], // fila 48
      ajuste: AJUSTES_068.P7.monto, // AD48
    },
    {
      id: "P8", orden: 9, titulo: "Potencial aplicado a cable de potencia", cantidad: 5, unidad: "juegos",
      conceptos: [c("SP044", 5)], // fila 49
      ajuste: AJUSTES_068.P8.monto, // AD49
    },
    {
      id: "P9", orden: 10, titulo: "Renta de generador portátil", cantidad: 1, unidad: "servicio",
      conceptos: [c("COSTO_DISPONIBLE_002", 1)], // fila 50
      ajuste: AJUSTES_068.P9.monto, // AD50
    },
    {
      id: "P10", orden: 11, titulo: "Equipo de protección personal", cantidad: 1, unidad: "pieza",
      // Filas 51-52: llevan `*V3` (utilidad) pero no `*T3`.
      conceptos: [cUtil("COSTO_DISPONIBLE_003", 1), cUtil("COSTO_DISPONIBLE_007", 1)],
      ajuste: AJUSTES_068.P10.monto, // AD51 cierra con `-0.04`
    },
  ],
  gastos: [
    // Filas 53-57: los generales. El Excel los divide entre 10 (`SUM(V53:V57)/10`),
    // que son las once partidas menos la de tierras.
    { codigo: "COSTO_PROYINSTELEC", cantidad: 1, costo: CAT.COSTO_PROYINSTELEC },
    { codigo: "COSTO_AYUDANTE", cantidad: 35, costo: CAT.COSTO_AYUDANTE },
    { codigo: "COSTO_ALIMENTOS", cantidad: 45, costo: CAT.COSTO_ALIMENTOS },
    { codigo: "COSTO_TRANSPORTE", cantidad: 6, costo: CAT.COSTO_TRANSPORTE },
    { codigo: "COSTO_COMBUSTIBLE", cantidad: 500, costo: CAT.COSTO_COMBUSTIBLE },
    // Filas 61-63: los gastos PROPIOS de la partida de tierras, que en el Excel
    // están dentro de su rango de conceptos y por eso no se reparten.
    { codigo: "COSTO_PROYINSTELEC", cantidad: 1, costo: CAT.COSTO_PROYINSTELEC, destino: { partida: "TIERRAS" } },
    { codigo: "COSTO_ALIMENTOS", cantidad: 10, costo: CAT.COSTO_ALIMENTOS, destino: { partida: "TIERRAS" } },
    { codigo: "COSTO_AYUDANTE", cantidad: 5, costo: CAT.COSTO_AYUDANTE, destino: { partida: "TIERRAS" } },
  ],
};

describe("CASO DORADO · cotización 068 (anclada a su PDF)", () => {
  const r = calcularCotizacion(entrada068);

  it("los gastos generales se reparten entre las diez partidas que los reciben", () => {
    // SUM(V53:V57) = 151,900 · Z53 = 151,900/10 = 15,190
    expect(r.totalGastos).toBe(151900 + 31700);
    const general = r.partidas.find((p) => p.id === "P1")!;
    expect(general.gastoAsignado).toBe(15190);
    // La de tierras no recibe nada del general: solo lo suyo.
    expect(r.partidas.find((p) => p.id === "TIERRAS")!.gastoAsignado).toBe(31700);
  });

  it("la partida en dólares convierte con el tipo de cambio de la versión", () => {
    const p2 = r.partidas.find((p) => p.id === "P2")!;
    // 5,343.77 × 1.2 × 18
    expect(p2.conceptos[0].importe).toBe(115425.43);
    // 2,671.885 × 1.2 × 18
    expect(p2.conceptos[1].importe).toBe(57712.72);
  });

  it("las once partidas dan el precio unitario y el importe del PDF", () => {
    const esperado: Array<[string, number, number]> = [
      // [id, precio unitario, importe]
      ["P1", 42100, 84200],
      ["P2", 273870, 273870],
      ["P3", 8540, 76860],
      ["P4", 10010, 60060],
      ["P5", 2485, 141645],
      ["P6", 1955, 64515],
      ["TIERRAS", 93135, 93135],
      ["P7", 7530, 52710],
      ["P8", 18940, 94700],
      ["P9", 18155, 18155],
      ["P10", 86263, 86263],
    ];

    expect(r.partidas.map((p) => p.id)).toEqual(esperado.map(([id]) => id));
    for (const [id, unitario, importe] of esperado) {
      const p = r.partidas.find((x) => x.id === id)!;
      expect([id, p.precioUnitario, p.importe]).toEqual([id, unitario, importe]);
    }
  });

  // Los ajustes salen de las fórmulas, no de cuadrar el resultado. Fijarlos
  // aparte impide que alguien "arregle" un desajuste moviéndolos.
  it("cada ajuste es el de su celda del Excel", () => {
    for (const p of r.partidas) {
      const esperado = AJUSTES_068[p.id];
      expect([p.id, p.ajuste]).toEqual([p.id, esperado.monto]);
    }
    // Diez partidas llevan el +0.5 de AD53; la de tierras no.
    const conMedio = r.partidas.filter((p) => AJUSTES_068[p.id].celda !== "AD58");
    expect(conMedio).toHaveLength(10);
  });

  it("subtotal, IVA y total cuadran al centavo con el PDF", () => {
    expect(r.subtotal).toBe(1046113.0);
    expect(r.iva).toBe(167378.08);
    expect(r.total).toBe(1213491.08);
  });

  // El renglón que el cliente compara contra la cifra, compuesto desde el
  // resultado y no desde una constante: si el total cambiara, la letra también.
  it("la letra del total sale del propio resultado", () => {
    expect(importeEnLetra(r.total)).toBe(
      "UN MILLÓN DOSCIENTOS TRECE MIL CUATROCIENTOS NOVENTA Y UN PESOS 08/100 M.N.",
    );
  });

  // El subtotal es la suma de lo que el cliente ve, no el costo interno: si
  // multiplica cada unitario por su cantidad y suma, le tiene que dar esto.
  it("el subtotal es exactamente la suma de unitario × cantidad", () => {
    const aMano = r.partidas.reduce((s, p) => s + p.precioUnitario * p.cantidad, 0);
    expect(Math.round(aMano * 100) / 100).toBe(r.subtotal);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B · Cotización 070 — tres partidas, asesoría 10 %, un ajuste de 20 centavos
// ══════════════════════════════════════════════════════════════════════════════

/**
 * El único ajuste de la 070, que en el Excel vive dentro de la fórmula de la
 * primera partida.
 */
const AJUSTE_070 = { monto: 0.2, celda: "partida 1", nota: "veinte centavos al cierre" };

describe("CASO DORADO · cotización 070 (anclada a su PDF)", () => {
  const r = calcularCotizacion({
    moneda: "MXN",
    asesoriaPct: 10,
    partidas: [
      {
        id: "B1", orden: 1, titulo: "Partida 1", cantidad: 1,
        conceptos: [{ codigo: "X1", cantidad: 1, costo: 75028 }],
        // En el Excel este ajuste vive dentro de la fórmula; aquí es explícito.
        ajuste: AJUSTE_070.monto,
      },
      { id: "B2", orden: 2, titulo: "Partida 2", cantidad: 1, conceptos: [{ codigo: "X2", cantidad: 1, costo: 48430 }] },
      { id: "B3", orden: 3, titulo: "Partida 3", cantidad: 1, conceptos: [{ codigo: "X3", cantidad: 1, costo: 21250 }] },
    ],
  });

  it("las tres partidas dan los importes del PDF", () => {
    expect(r.partidas.map((p) => p.importe)).toEqual([82531, 53273, 23375]);
  });

  it("el ajuste es el de su celda, y solo lo lleva la primera partida", () => {
    expect(r.partidas.map((p) => p.ajuste)).toEqual([AJUSTE_070.monto, 0, 0]);
  });

  // El Excel daba un centavo de diferencia aquí: sumaba los totales internos en
  // vez de los importes que ve el cliente.
  it("subtotal, IVA y total cuadran al centavo", () => {
    expect(r.subtotal).toBe(159179.0);
    expect(r.iva).toBe(25468.64);
    expect(r.total).toBe(184647.64);
  });

  it("la letra del total sale del propio resultado", () => {
    expect(importeEnLetra(r.total)).toBe(
      "CIENTO OCHENTA Y CUATRO MIL SEISCIENTOS CUARENTA Y SIETE PESOS 64/100 M.N.",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIOS — derivados de las reglas, sin PDF detrás
// ══════════════════════════════════════════════════════════════════════════════

/** Dos partidas iguales, tres conceptos de 2,000 × 2, y 27,600 de gastos. */
const entrada450 = (utilidadP1: number): EntradaCotizacion => ({
  moneda: "MXN",
  reparto: "IGUAL",
  asesoriaPct: 10,
  partidas: [1, 2].map((n) => ({
    id: `C${n}`,
    orden: n,
    titulo: `Partida ${n}`,
    cantidad: 1,
    conceptos: [1, 2, 3].map((i) => ({
      codigo: `S${i}`,
      cantidad: 2,
      costo: 2000,
      utilidadPct: n === 1 ? utilidadP1 : 0,
    })),
  })),
  gastos: [{ codigo: "G1", cantidad: 1, costo: 27600 }],
});

describe("ESCENARIO · cotización 450, el reparto de la asesoría", () => {
  it("sin utilidad, las dos partidas salen iguales", () => {
    const r = calcularCotizacion(entrada450(0));
    expect(r.partidas.map((p) => p.importe)).toEqual([28380, 28380]);
    expect(r.total).toBe(65841.6);
  });

  /**
   * Con utilidad solo en la primera, la asesoría deja de ser la mitad para cada
   * una y sigue al costo.
   *
   * **Aquí es donde nos separamos de Apps Script a propósito.** Su
   * `calcularCotizacion` (COT_03:684-688) reparte la asesoría POR PARTES
   * IGUALES cuando el reparto de gastos es IGUAL o MANUAL, y da 30,270 / 28,470:
   * la partida barata subsidia a la cara. La práctica manual en los Excel es
   * poner el mismo porcentaje a cada partida, que es un reparto proporcional al
   * costo — y eso da 30,360 / 28,380.
   */
  it("con 15 % de utilidad en la primera, la asesoría sigue al costo", () => {
    const r = calcularCotizacion(entrada450(15));
    expect(r.partidas.map((p) => p.importe)).toEqual([30360, 28380]);
    expect(r.total).toBe(68138.4);

    // Lo que daría la regla vieja, para que la diferencia quede escrita:
    expect(r.partidas.map((p) => p.importe)).not.toEqual([30270, 28470]);
  });
});

describe("ESCENARIO · estudios por horas, con los parámetros del Excel", () => {
  const estudio = (p: {
    horasPorDia: number; diasPorSemana: number; ingenieros: number; semanas: number; tarifaHora: number;
  }) =>
    calcularCotizacion({
      moneda: "MXN",
      partidas: [
        { id: "E", orden: 1, titulo: "Estudio", cantidad: 1, conceptos: [{ codigo: "AR", cantidad: 1, esfuerzo: p }] },
      ],
    }).partidas[0];

  // Bloque YZ4:ZB10 de la hoja COSTOS: 8 h/día × 5 días = 40 h/semana;
  // × 2 ingenieros = 80; × 10 semanas = 800 h; × $12/h = 9,600.
  it("AR001 — 8 h × 5 d × 2 ing × 10 sem × $12", () => {
    const p = estudio({ horasPorDia: 8, diasPorSemana: 5, ingenieros: 2, semanas: 10, tarifaHora: 12 });
    expect(p.conceptos[0].horas).toBe(800);
    expect(p.costoConceptos).toBe(9600);
  });

  it("AR002 — 8 h × 5 d × 1 ing × 4 sem × $500", () => {
    const p = estudio({ horasPorDia: 8, diasPorSemana: 5, ingenieros: 1, semanas: 4, tarifaHora: 500 });
    expect(p.conceptos[0].horas).toBe(160);
    expect(p.costoConceptos).toBe(80000);
  });
});
