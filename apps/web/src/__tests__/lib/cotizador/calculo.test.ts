import { describe, it, expect } from "vitest";
import { calcularCotizacion, costoPorEsfuerzo, redondear, IVA } from "@/src/lib/cotizador";
import type { EntradaCotizacion, Partida } from "@/src/lib/cotizador";

/** Una partida mínima, para no repetir lo que el caso no está probando. */
const partida = (p: Partial<Partida> & { id: string }): Partida => ({
  orden: 1,
  titulo: "Partida",
  cantidad: 1,
  conceptos: [],
  ...p,
});

const base = (p: Partial<EntradaCotizacion> = {}): EntradaCotizacion => ({
  moneda: "MXN",
  partidas: [],
  ...p,
});

describe("redondear", () => {
  it("deja dos decimales", () => {
    expect(redondear(10.004)).toBe(10);
    expect(redondear(10.005)).toBe(10.01);
    expect(redondear(1 / 3)).toBe(0.33);
  });

  // El binario deja algunos valores un pelo por debajo del medio centavo.
  it("el medio centavo sube, aunque el binario diga lo contrario", () => {
    expect(redondear(2.675)).toBe(2.68);
    expect(redondear(1.005)).toBe(1.01);
  });

  it("los negativos redondean en su propio sentido", () => {
    expect(redondear(-2.675)).toBe(-2.68);
  });

  it("lo que no es número da 0, no NaN", () => {
    expect(redondear(NaN)).toBe(0);
    expect(redondear(Infinity)).toBe(0);
  });
});

// ── Decisión 1 · costo × cantidad × (1 + utilidad%) ──────────────────────────

describe("el importe de un concepto", () => {
  const unConcepto = (c: Record<string, unknown>) =>
    calcularCotizacion(base({ partidas: [partida({ id: "P", conceptos: [c as never] })] })).partidas[0];

  it("sin utilidad es costo × cantidad", () => {
    expect(unConcepto({ codigo: "A", cantidad: 4, costo: 100 }).costoConceptos).toBe(400);
  });

  // Una pala de $100 con 15 % se cotiza en $115.
  it("la utilidad va por concepto y sube el unitario", () => {
    const p = unConcepto({ codigo: "A", cantidad: 4, costo: 100, utilidadPct: 15 });
    expect(p.conceptos[0].costoUnitario).toBe(115);
    expect(p.costoConceptos).toBe(460);
  });

  it("en la misma partida puede haber conceptos con y sin utilidad", () => {
    const p = calcularCotizacion(
      base({
        partidas: [
          partida({
            id: "P",
            conceptos: [
              { codigo: "MATERIAL", cantidad: 1, costo: 100, utilidadPct: 15 },
              { codigo: "MANO_OBRA", cantidad: 1, costo: 100 },
            ],
          }),
        ],
      }),
    ).partidas[0];
    expect(p.conceptos.map((c) => c.importe)).toEqual([115, 100]);
  });

  it("un costo en dólares se convierte con el tipo de cambio", () => {
    const p = unConcepto({ codigo: "A", cantidad: 1, costo: 100, monedaCosto: "USD" });
    expect(p.costoConceptos).toBe(0); // sin tipo de cambio no se inventa

    const q = calcularCotizacion(
      base({
        tipoCambio: { valor: 18, origen: "BANXICO" },
        partidas: [
          partida({ id: "P", conceptos: [{ codigo: "A", cantidad: 1, costo: 100, monedaCosto: "USD" }] }),
        ],
      }),
    ).partidas[0];
    expect(q.costoConceptos).toBe(1800);
  });

  it("avisa del costo 0 sin convertirlo en error", () => {
    const r = calcularCotizacion(base({ partidas: [partida({ id: "P", conceptos: [{ codigo: "A", cantidad: 1, costo: 0 }] })] }));
    expect(r.avisos.some((a) => a.includes("costo 0"))).toBe(true);
    expect(r.subtotal).toBe(0);
  });
});

// ── Decisión 8 · estudios por horas ──────────────────────────────────────────

describe("costoPorEsfuerzo", () => {
  it("horas = horas/día × días/semana × ingenieros × semanas", () => {
    expect(costoPorEsfuerzo({ horasPorDia: 8, diasPorSemana: 5, ingenieros: 2, semanas: 10, tarifaHora: 12 })).toEqual({
      horas: 800,
      costo: 9600,
    });
  });

  it("sin ingenieros se asume uno", () => {
    expect(costoPorEsfuerzo({ horasPorDia: 8, diasPorSemana: 5, ingenieros: 0, semanas: 1, tarifaHora: 10 })?.horas).toBe(40);
  });

  // Exige los parámetros: nunca los toma del catálogo por su cuenta.
  it("sin alguno de los cuatro obligatorios devuelve null", () => {
    const p = { horasPorDia: 8, diasPorSemana: 5, ingenieros: 1, semanas: 4, tarifaHora: 500 };
    for (const falta of ["horasPorDia", "diasPorSemana", "semanas", "tarifaHora"] as const) {
      expect(costoPorEsfuerzo({ ...p, [falta]: 0 })).toBeNull();
    }
  });

  it("un estudio incompleto cae a costo fijo y avisa", () => {
    const r = calcularCotizacion(
      base({
        partidas: [
          partida({
            id: "P",
            conceptos: [
              { codigo: "AR", cantidad: 1, costo: 5000, esfuerzo: { horasPorDia: 8, diasPorSemana: 5, ingenieros: 1, semanas: 0, tarifaHora: 500 } },
            ],
          }),
        ],
      }),
    );
    expect(r.partidas[0].costoConceptos).toBe(5000);
    expect(r.avisos.some((a) => a.includes("parámetros de esfuerzo"))).toBe(true);
  });
});

describe("estudios por nodos", () => {
  const conNodos = (nodos: number, baseNodos?: number) =>
    calcularCotizacion(
      base({
        partidas: [
          partida({
            id: "P",
            conceptos: [
              {
                codigo: "AR",
                cantidad: 1,
                esfuerzo: { horasPorDia: 8, diasPorSemana: 5, ingenieros: 2, semanas: 10, tarifaHora: 12, nodos, baseNodos },
              },
            ],
          }),
        ],
      }),
    ).partidas[0];

  // El costo base cubre 10 nodos; 14 nodos cuestan 14/10 de eso.
  it("escala contra la base de nodos", () => {
    expect(conNodos(14).costoConceptos).toBe(13440); // 9,600 / 10 × 14
    expect(conNodos(10).costoConceptos).toBe(9600);
  });

  it("la base de nodos del concepto manda sobre la de la configuración", () => {
    expect(conNodos(14, 20).costoConceptos).toBe(6720); // 9,600 / 20 × 14
  });

  it("la base por omisión se puede configurar", () => {
    const r = calcularCotizacion(
      base({
        baseNodosPorOmision: 20,
        partidas: [
          partida({
            id: "P",
            conceptos: [{ codigo: "AR", cantidad: 1, esfuerzo: { horasPorDia: 8, diasPorSemana: 5, ingenieros: 2, semanas: 10, tarifaHora: 12, nodos: 14 } }],
          }),
        ],
      }),
    );
    expect(r.partidas[0].costoConceptos).toBe(6720);
  });
});

// ── Decisión 2 · los gastos ──────────────────────────────────────────────────

describe("reparto de gastos", () => {
  const conGastos = (reparto: "IGUAL" | "PROPORCIONAL" | "MANUAL", gastoManual?: number[]) =>
    calcularCotizacion(
      base({
        reparto,
        partidas: [
          partida({ id: "A", orden: 1, conceptos: [{ codigo: "x", cantidad: 1, costo: 10000 }], gastoManual: gastoManual?.[0] }),
          partida({ id: "B", orden: 2, conceptos: [{ codigo: "x", cantidad: 1, costo: 30000 }], gastoManual: gastoManual?.[1] }),
        ],
        gastos: [{ codigo: "G", cantidad: 1, costo: 4500 }],
      }),
    );

  it("IGUAL parte entre el número de partidas que reciben", () => {
    expect(conGastos("IGUAL").partidas.map((p) => p.gastoAsignado)).toEqual([2250, 2250]);
  });

  it("PROPORCIONAL sigue al costo de los conceptos", () => {
    expect(conGastos("PROPORCIONAL").partidas.map((p) => p.gastoAsignado)).toEqual([1125, 3375]);
  });

  it("MANUAL toma lo capturado y avisa si no cuadra", () => {
    const r = conGastos("MANUAL", [1000, 2000]);
    expect(r.partidas.map((p) => p.gastoAsignado)).toEqual([1000, 2000]);
    expect(r.avisos.some((a) => a.includes("Faltan 1500.00"))).toBe(true);
  });

  // Sin esto la suma de lo repartido no cuadra con el total y el documento
  // muestra dos números distintos para lo mismo.
  it("la última partida absorbe la diferencia del redondeo", () => {
    const r = calcularCotizacion(
      base({
        reparto: "IGUAL",
        partidas: [1, 2, 3].map((n) => partida({ id: `P${n}`, orden: n, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }] })),
        gastos: [{ codigo: "G", cantidad: 1, costo: 100 }],
      }),
    );
    expect(r.partidas.map((p) => p.gastoAsignado)).toEqual([33.33, 33.33, 33.34]);
    expect(redondear(r.partidas.reduce((s, p) => s + p.gastoAsignado, 0))).toBe(100);
  });

  // El caso de la 068: una partida con su propio equipo y sus propios viáticos.
  it("una partida puede quedar fuera del reparto general", () => {
    const r = calcularCotizacion(
      base({
        reparto: "IGUAL",
        partidas: [
          partida({ id: "A", orden: 1, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }] }),
          partida({ id: "B", orden: 2, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }] }),
          partida({ id: "PROPIA", orden: 3, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }], recibeGastosGenerales: false }),
        ],
        gastos: [
          { codigo: "G", cantidad: 1, costo: 1000 },
          { codigo: "GP", cantidad: 1, costo: 700, destino: { partida: "PROPIA" } },
        ],
      }),
    );
    // Los 1,000 generales se parten entre dos, no entre tres.
    expect(r.partidas.map((p) => p.gastoAsignado)).toEqual([500, 500, 700]);
  });

  it("un gasto dirigido a una partida que no existe se reparte y avisa", () => {
    const r = calcularCotizacion(
      base({
        partidas: [partida({ id: "A", conceptos: [{ codigo: "x", cantidad: 1, costo: 100 }] })],
        gastos: [{ codigo: "G", cantidad: 1, costo: 500, destino: { partida: "FANTASMA" } }],
      }),
    );
    expect(r.partidas[0].gastoAsignado).toBe(500);
    expect(r.avisos.some((a) => a.includes("no existe"))).toBe(true);
  });

  it("avisa del gasto con costo 0", () => {
    const r = calcularCotizacion(
      base({ partidas: [partida({ id: "A", conceptos: [{ codigo: "x", cantidad: 1, costo: 100 }] })], gastos: [{ codigo: "G", cantidad: 1, costo: 0 }] }),
    );
    expect(r.avisos.some((a) => a.includes('gasto "G" tiene costo 0'))).toBe(true);
  });
});

// ── Decisión 7 · los gastos se reparten ANTES de convertirse ─────────────────

describe("gastos en otra moneda", () => {
  it("se reparten en su moneda y después se convierten", () => {
    const r = calcularCotizacion(
      base({
        moneda: "MXN",
        monedaGastos: "USD",
        tipoCambio: { valor: 18, origen: "BANXICO" },
        reparto: "IGUAL",
        partidas: [
          partida({ id: "A", orden: 1, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }] }),
          partida({ id: "B", orden: 2, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }] }),
        ],
        gastos: [{ codigo: "G", cantidad: 1, costo: 200 }],
      }),
    );
    // US$200 entre dos = US$100 cada una, × 18 = $1,800
    expect(r.partidas.map((p) => p.gastoAsignado)).toEqual([1800, 1800]);
  });

  // Replica la regla de Apps Script: sin tipo de cambio no se inventa uno.
  it("sin tipo de cambio no reparte nada y avisa", () => {
    const r = calcularCotizacion(
      base({
        moneda: "MXN",
        monedaGastos: "USD",
        partidas: [partida({ id: "A", conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }] })],
        gastos: [{ codigo: "G", cantidad: 1, costo: 200 }],
      }),
    );
    expect(r.partidas[0].gastoAsignado).toBe(0);
    expect(r.avisos.some((a) => a.includes("Sin tipo de cambio"))).toBe(true);
  });

  it("el tipo de cambio preferente sin motivo se avisa", () => {
    const r = calcularCotizacion(
      base({ tipoCambio: { valor: 18, origen: "PREFERENTE" }, partidas: [partida({ id: "A", conceptos: [{ codigo: "x", cantidad: 1, costo: 1 }] })] }),
    );
    expect(r.avisos.some((a) => a.includes("preferente no trae motivo"))).toBe(true);
  });

  it("con motivo no dice nada", () => {
    const r = calcularCotizacion(
      base({
        tipoCambio: { valor: 18, origen: "PREFERENTE", motivo: "Tipo pactado en contrato" },
        partidas: [partida({ id: "A", conceptos: [{ codigo: "x", cantidad: 1, costo: 1 }] })],
      }),
    );
    expect(r.avisos.some((a) => a.includes("preferente"))).toBe(false);
  });
});

// ── Decisión 3 · la asesoría ─────────────────────────────────────────────────

describe("asesoría", () => {
  const conAsesoria = (pct: number, costos: number[], reparto: "IGUAL" | "PROPORCIONAL" = "IGUAL") =>
    calcularCotizacion(
      base({
        reparto,
        asesoriaPct: pct,
        partidas: costos.map((costo, i) => partida({ id: `P${i}`, orden: i + 1, conceptos: [{ codigo: "x", cantidad: 1, costo }] })),
      }),
    );

  it("por omisión es 0 y no toca nada", () => {
    const r = conAsesoria(0, [1000, 3000]);
    expect(r.asesoria).toBe(0);
    expect(r.subtotal).toBe(4000);
  });

  // Siempre proporcional al costo, sin importar cómo se repartieron los gastos.
  it("sigue al costo de cada partida, no al número de partidas", () => {
    const r = conAsesoria(10, [1000, 3000]);
    expect(r.partidas.map((p) => p.asesoria)).toEqual([100, 300]);
  });

  it("el modo de gastos no cambia cómo se reparte la asesoría", () => {
    const igual = conAsesoria(10, [1000, 3000], "IGUAL");
    const prop = conAsesoria(10, [1000, 3000], "PROPORCIONAL");
    expect(igual.partidas.map((p) => p.asesoria)).toEqual(prop.partidas.map((p) => p.asesoria));
  });

  it("va dentro del precio unitario, no como renglón aparte", () => {
    const r = conAsesoria(10, [1000]);
    expect(r.partidas[0].precioUnitario).toBe(1100);
    // No hay ninguna partida ni concepto llamado "asesoría"
    expect(r.partidas).toHaveLength(1);
  });

  it("un porcentaje mayor a 100 se respeta, pero se avisa", () => {
    const r = conAsesoria(150, [1000]);
    expect(r.partidas[0].total).toBe(2500);
    expect(r.avisos.some((a) => a.includes("parece demasiado"))).toBe(true);
  });
});

// ── Decisiones 5 y 6 · redondeo, subtotal, IVA ───────────────────────────────

describe("el cierre de la cotización", () => {
  it("el importe se recompone desde el unitario redondeado", () => {
    // 1,000 / 3 = 333.333… → unitario 333.33 → importe 999.99, no 1,000
    const r = calcularCotizacion(
      base({ partidas: [partida({ id: "P", cantidad: 3, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }] })] }),
    );
    expect(r.partidas[0].precioUnitario).toBe(333.33);
    expect(r.partidas[0].importe).toBe(999.99);
    expect(r.subtotal).toBe(999.99);
  });

  it("el IVA es el 16 % del subtotal y el total es su suma", () => {
    const r = calcularCotizacion(base({ partidas: [partida({ id: "P", conceptos: [{ codigo: "x", cantidad: 1, costo: 159179 }] })] }));
    expect(IVA).toBe(0.16);
    expect(r.iva).toBe(redondear(159179 * 0.16));
    expect(r.total).toBe(redondear(r.subtotal + r.iva));
  });

  it("una partida con cantidad 0 no revienta", () => {
    const r = calcularCotizacion(base({ partidas: [partida({ id: "P", cantidad: 0, conceptos: [{ codigo: "x", cantidad: 1, costo: 100 }] })] }));
    expect(r.partidas[0].precioUnitario).toBe(0);
    expect(r.partidas[0].importe).toBe(0);
  });

  it("sin partidas da ceros y no falla", () => {
    const r = calcularCotizacion(base());
    expect([r.subtotal, r.iva, r.total]).toEqual([0, 0, 0]);
  });
});

// ── Decisiones 4 y 10 · ajustes y nombres ────────────────────────────────────

describe("ajuste por partida", () => {
  it("es un monto explícito que se suma al final", () => {
    const r = calcularCotizacion(
      base({ asesoriaPct: 10, partidas: [partida({ id: "P", conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }], ajuste: 0.5 })] }),
    );
    expect(r.partidas[0].total).toBe(1100.5);
  });

  it("puede ser negativo", () => {
    const r = calcularCotizacion(base({ partidas: [partida({ id: "P", conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }], ajuste: -0.06 })] }));
    expect(r.partidas[0].total).toBe(999.94);
  });
});

describe("costo total y subtotal son cosas distintas", () => {
  // `costoTotal` es el panel interno: lo que cuesta hacerla, sin asesoría.
  // `subtotal` es lo que ve el cliente.
  it("el costo total no lleva asesoría y el subtotal sí", () => {
    const r = calcularCotizacion(
      base({
        asesoriaPct: 10,
        partidas: [partida({ id: "P", conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }] })],
        gastos: [{ codigo: "G", cantidad: 1, costo: 500 }],
      }),
    );
    expect(r.costoTotal).toBe(1500);
    expect(r.subtotal).toBe(1650);
  });
});

describe("avisos de captura", () => {
  it("una partida sin título o sin conceptos se avisa, pero calcula", () => {
    const r = calcularCotizacion(base({ partidas: [{ id: "P", orden: 1, cantidad: 1, conceptos: [] }] }));
    expect(r.avisos.some((a) => a.includes("no tiene conceptos"))).toBe(true);
    expect(r.avisos.some((a) => a.includes("no tiene título"))).toBe(true);
    expect(r.subtotal).toBe(0);
  });
});
