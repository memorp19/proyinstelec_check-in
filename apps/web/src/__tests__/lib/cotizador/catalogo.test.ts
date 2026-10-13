import { describe, it, expect } from "vitest";
import {
  actualizarDesdeCatalogo,
  calcularCotizacion,
  detectarDesfases,
  familiaDeCodigo,
  tipoDeCodigo,
} from "@/src/lib/cotizador";
import type { LineaCotizada, ServicioCatalogo } from "@/src/lib/cotizador";

const serv = (codigo: string, costo: number | null, activo = true): ServicioCatalogo => ({
  codigo,
  descripcion: codigo,
  unidad: "servicio",
  costo,
  moneda: "MXN",
  tipo: "SERVICIO",
  activo,
});

/** Una línea tal como quedó al copiarse del catálogo. */
const copiada = (id: string, codigo: string, catalogo: number, usado = catalogo): LineaCotizada => ({
  id,
  codigo,
  costo: usado,
  costoCatalogo: catalogo,
});

describe("detectarDesfases", () => {
  it("una línea que sigue al precio del catálogo no está desfasada", () => {
    expect(detectarDesfases([copiada("l1", "SP001", 2000)], [serv("SP001", 2000)])).toEqual([]);
  });

  it("si el catálogo se movió, la señala con el antes y el después", () => {
    const [d] = detectarDesfases([copiada("l1", "SP001", 2000)], [serv("SP001", 2400)]);
    expect(d).toMatchObject({ id: "l1", codigo: "SP001", motivo: "CATALOGO_CAMBIO", actual: 2000, catalogo: 2400 });
  });

  /**
   * La distinción que hace útil tener dos columnas de costo: un precio
   * negociado difiere del catálogo **a propósito**. Si se tratara como
   * desfase, una actualización masiva le borraría el descuento al cliente sin
   * que nadie se enterara.
   */
  it("un costo negociado no es un desfase por sí mismo", () => {
    // Se copió a 2,000 y alguien lo bajó a 1,800. El catálogo no se ha movido.
    expect(detectarDesfases([copiada("l1", "SP001", 2000, 1800)], [serv("SP001", 2000)])).toEqual([]);
  });

  it("pero si además el catálogo se movió, se señala el negociado aparte", () => {
    const [d] = detectarDesfases([copiada("l1", "SP001", 2000, 1800)], [serv("SP001", 2400)]);
    expect(d.motivo).toBe("CATALOGO_CAMBIO");
    expect(d.tieneCostoNegociado).toBe(true);
    expect(d.actual).toBe(1800);
  });

  it("un código que ya no existe o se dio de baja se señala con su propio motivo", () => {
    const fuera = detectarDesfases(
      [copiada("l1", "SP999", 2000), copiada("l2", "SP001", 2000)],
      [serv("SP001", 2000, false)],
    );
    expect(fuera.map((d) => [d.id, d.motivo])).toEqual([
      ["l1", "CODIGO_INACTIVO"],
      ["l2", "CODIGO_INACTIVO"],
    ]);
  });

  // Su precio es el que se escribió: no hay catálogo contra el cual desfasarse.
  it("un concepto libre nunca se desfasa", () => {
    expect(detectarDesfases([{ id: "l1", costo: 500 }], [serv("SP001", 2000)])).toEqual([]);
  });

  // Son líneas de antes de que el modelo guardara esa columna.
  it("sin costo de catálogo copiado no hay con qué comparar", () => {
    expect(detectarDesfases([{ id: "l1", codigo: "SP001", costo: 2000 }], [serv("SP001", 2400)])).toEqual([]);
  });
});

describe("actualizarDesdeCatalogo", () => {
  const catalogo = [serv("SP001", 2400), serv("SP002", 3000)];
  const lineas = [copiada("l1", "SP001", 2000), copiada("l2", "SP002", 2500)];

  it("lleva al precio vigente y devuelve el antes y el después", () => {
    const r = actualizarDesdeCatalogo(lineas, catalogo, ["l1"]);
    expect(r.actualizadas).toEqual([
      { id: "l1", codigo: "SP001", costoAntes: 2000, costoDespues: 2400, costoCatalogoAntes: 2000, costoCatalogoDespues: 2400 },
    ]);
    expect(r.omitidas).toEqual([]);
  });

  // Es explícito: recibe los ids que se decidió actualizar, no todos los
  // desfases. Quien lo ejecuta ya vio la lista.
  it("solo toca lo que se le pide", () => {
    const r = actualizarDesdeCatalogo(lineas, catalogo, ["l2"]);
    expect(r.actualizadas.map((a) => a.id)).toEqual(["l2"]);
  });

  it("no pisa un costo negociado salvo que se pida", () => {
    const conDescuento = [copiada("l1", "SP001", 2000, 1800)];
    const r = actualizarDesdeCatalogo(conDescuento, catalogo, ["l1"]);
    expect(r.actualizadas).toEqual([]);
    expect(r.omitidas[0].motivo).toContain("negociado");

    const forzado = actualizarDesdeCatalogo(conDescuento, catalogo, ["l1"], { incluirNegociados: true });
    expect(forzado.actualizadas[0].costoAntes).toBe(1800);
    expect(forzado.actualizadas[0].costoDespues).toBe(2400);
  });

  it("un código que ya no está no se puede actualizar, y lo dice", () => {
    const r = actualizarDesdeCatalogo([copiada("l1", "SP999", 2000)], catalogo, ["l1"]);
    expect(r.actualizadas).toEqual([]);
    expect(r.omitidas[0].motivo).toContain("ya no está en el catálogo");
  });

  it("una línea que no está desfasada se omite en vez de reescribirse", () => {
    const r = actualizarDesdeCatalogo([copiada("l1", "SP001", 2400)], catalogo, ["l1"]);
    expect(r.actualizadas).toEqual([]);
    expect(r.omitidas[0].motivo).toBe("No está desfasada");
  });
});

describe("familia y tipo del código", () => {
  it("la familia es el prefijo de letras", () => {
    expect(familiaDeCodigo("SP001")).toBe("SP");
    expect(familiaDeCodigo("ar003")).toBe("AR");
    expect(familiaDeCodigo("COSTO_AYUDANTE")).toBe("COSTO");
  });

  it("AR es estudio, CO y COSTO_ son gasto, el resto servicio", () => {
    expect(tipoDeCodigo("AR001")).toBe("ESTUDIO");
    expect(tipoDeCodigo("CO014")).toBe("GASTO");
    expect(tipoDeCodigo("COSTO_AYUDANTE")).toBe("GASTO");
    expect(tipoDeCodigo("SP001")).toBe("SERVICIO");
    expect(tipoDeCodigo("BT007")).toBe("SERVICIO");
  });
});

// ── Decisión 4 · el precio unitario final ────────────────────────────────────

describe("precio unitario final", () => {
  const conPrecio = (precioUnitarioFinal?: number, cantidad = 1, costo = 1000) =>
    calcularCotizacion({
      moneda: "MXN",
      asesoriaPct: 10,
      partidas: [
        {
          id: "P",
          orden: 1,
          titulo: "Partida",
          cantidad,
          conceptos: [{ codigo: "x", cantidad: 1, costo }],
          precioUnitarioFinal,
        },
      ],
    });

  it("sin precio final, el ajuste es el capturado", () => {
    const r = conPrecio();
    expect(r.partidas[0].total).toBe(1100);
    expect(r.partidas[0].ajusteDerivado).toBe(false);
  });

  // El ajuste se deriva en vez de capturarse: la diferencia contra el cálculo
  // queda a la vista en lugar de aparecer un precio sin explicación.
  it("con precio final, el ajuste se deriva y se ve", () => {
    const r = conPrecio(1200);
    const p = r.partidas[0];
    expect(p.precioUnitario).toBe(1200);
    expect(p.ajuste).toBe(100); // 1,200 − 1,100 calculado
    expect(p.ajusteDerivado).toBe(true);
  });

  it("el precio final manda sobre el ajuste que se hubiera capturado", () => {
    const r = calcularCotizacion({
      moneda: "MXN",
      asesoriaPct: 10,
      partidas: [
        { id: "P", orden: 1, titulo: "P", cantidad: 1, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }], ajuste: 999, precioUnitarioFinal: 1200 },
      ],
    });
    expect(r.partidas[0].ajuste).toBe(100);
    expect(r.partidas[0].total).toBe(1200);
  });

  it("con cantidad, el objetivo es precio × cantidad", () => {
    const r = conPrecio(500, 3, 1000);
    // calculado = 1,100 · objetivo = 1,500 · ajuste = 400
    expect(r.partidas[0].ajuste).toBe(400);
    expect(r.partidas[0].importe).toBe(1500);
  });

  it("un precio final a la baja da un ajuste negativo", () => {
    const r = conPrecio(900);
    expect(r.partidas[0].ajuste).toBe(-200);
    expect(r.partidas[0].total).toBe(900);
  });

  // Puede ser una decisión —entrar con un cliente, cerrar un paquete— pero
  // tiene que ser una decisión y no un descuido.
  it("vender por debajo del costo avisa, con el faltante", () => {
    const r = calcularCotizacion({
      moneda: "MXN",
      partidas: [
        { id: "P", orden: 1, titulo: "P", cantidad: 1, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }], precioUnitarioFinal: 800 },
      ],
      gastos: [{ codigo: "G", cantidad: 1, costo: 200 }],
    });
    expect(r.partidas[0].costoTotal).toBe(1200);
    expect(r.avisos.some((a) => a.includes("venta con pérdida de 400.00"))).toBe(true);
  });

  it("vender justo al costo todavía no es pérdida", () => {
    const r = calcularCotizacion({
      moneda: "MXN",
      partidas: [
        { id: "P", orden: 1, titulo: "P", cantidad: 1, conceptos: [{ codigo: "x", cantidad: 1, costo: 1000 }], precioUnitarioFinal: 1000 },
      ],
    });
    expect(r.avisos.some((a) => a.includes("pérdida"))).toBe(false);
  });

  it("con cantidad 0 el precio final se ignora, sin reventar", () => {
    const r = conPrecio(500, 0);
    expect(r.partidas[0].precioUnitario).toBe(0);
    expect(r.partidas[0].ajusteDerivado).toBe(false);
  });
});
