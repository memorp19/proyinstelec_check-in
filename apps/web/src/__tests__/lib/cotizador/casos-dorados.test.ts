import { describe, it, expect } from "vitest";
import { calcularCotizacion, importeEnLetra } from "@/src/lib/cotizador";
import type { EntradaCotizacion } from "@/src/lib/cotizador";
import { AJUSTES_068, ENTRADA_068, PDF_068 } from "./casos/068";

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

describe("CASO DORADO · cotización 068 (anclada a su PDF)", () => {
  const r = calcularCotizacion(ENTRADA_068);

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
    expect(r.partidas.map((p) => p.id)).toEqual(PDF_068.partidas.map(([id]) => id));
    for (const [id, unitario, importe] of PDF_068.partidas) {
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
    expect([r.subtotal, r.iva, r.total]).toEqual([PDF_068.subtotal, PDF_068.iva, PDF_068.total]);
  });

  // El renglón que el cliente compara contra la cifra, compuesto desde el
  // resultado y no desde una constante: si el total cambiara, la letra también.
  it("la letra del total sale del propio resultado", () => {
    expect(importeEnLetra(r.total)).toBe(PDF_068.letra);
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
