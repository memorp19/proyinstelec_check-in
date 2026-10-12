import { describe, it, expect } from "vitest";
import { importeEnLetra, centenaEnLetra } from "@/src/lib/cotizador";

describe("importeEnLetra · los totales de los PDF", () => {
  // Los dos que vienen con la letra MAL en el PDF. El test usa el total
  // correcto: es justamente el error que una función pura evita.
  it("1,213,491.08 — el total de la 068", () => {
    expect(importeEnLetra(1213491.08)).toBe(
      "UN MILLÓN DOSCIENTOS TRECE MIL CUATROCIENTOS NOVENTA Y UN PESOS 08/100 M.N.",
    );
  });

  it("13,891,798.08 — el total de la 269", () => {
    expect(importeEnLetra(13891798.08)).toBe(
      "TRECE MILLONES OCHOCIENTOS NOVENTA Y UN MIL SETECIENTOS NOVENTA Y OCHO PESOS 08/100 M.N.",
    );
  });

  it("184,647.64 — el total de la 070", () => {
    expect(importeEnLetra(184647.64)).toBe(
      "CIENTO OCHENTA Y CUATRO MIL SEISCIENTOS CUARENTA Y SIETE PESOS 64/100 M.N.",
    );
  });

  it("65,841.60 — el total de la 450", () => {
    expect(importeEnLetra(65841.6)).toBe(
      "SESENTA Y CINCO MIL OCHOCIENTOS CUARENTA Y UN PESOS 60/100 M.N.",
    );
  });
});

describe("importeEnLetra · las formas que se equivocan a mano", () => {
  it("un millón es singular; de dos en adelante, MILLONES", () => {
    expect(importeEnLetra(1000000)).toBe("UN MILLÓN PESOS 00/100 M.N.");
    expect(importeEnLetra(2000000)).toBe("DOS MILLONES PESOS 00/100 M.N.");
  });

  // "UN MIL" no se dice. El millar solo lleva número a partir de dos mil.
  it("mil va solo, sin UN delante", () => {
    expect(importeEnLetra(1000)).toBe("MIL PESOS 00/100 M.N.");
    expect(importeEnLetra(2000)).toBe("DOS MIL PESOS 00/100 M.N.");
    expect(importeEnLetra(1500)).toBe("MIL QUINIENTOS PESOS 00/100 M.N.");
  });

  // Antes de sustantivo es UN, no UNO: "CUARENTA Y UN PESOS".
  it("el uno final se apocopa", () => {
    expect(importeEnLetra(41)).toBe("CUARENTA Y UN PESOS 00/100 M.N.");
    expect(importeEnLetra(101)).toBe("CIENTO UN PESOS 00/100 M.N.");
  });

  it("cien exacto es CIEN; con resto es CIENTO", () => {
    expect(centenaEnLetra(100)).toBe("CIEN");
    expect(centenaEnLetra(105)).toBe("CIENTO CINCO");
    expect(centenaEnLetra(199)).toBe("CIENTO NOVENTA Y NUEVE");
  });

  it("el veintipico va pegado", () => {
    expect(centenaEnLetra(20)).toBe("VEINTE");
    expect(centenaEnLetra(21)).toBe("VEINTIUN");
    expect(centenaEnLetra(25)).toBe("VEINTICINCO");
    expect(centenaEnLetra(30)).toBe("TREINTA");
    expect(centenaEnLetra(31)).toBe("TREINTA Y UN");
  });

  it("del once al quince tienen nombre propio", () => {
    for (const [n, t] of [[11, "ONCE"], [12, "DOCE"], [13, "TRECE"], [14, "CATORCE"], [15, "QUINCE"]] as const) {
      expect(centenaEnLetra(n)).toBe(t);
    }
  });

  it("los acentos van donde van", () => {
    expect(centenaEnLetra(16)).toBe("DIECISÉIS");
    expect(importeEnLetra(1000000)).toContain("MILLÓN");
  });
});

describe("importeEnLetra · los centavos", () => {
  it("siempre dos dígitos sobre cien", () => {
    expect(importeEnLetra(5.05)).toBe("CINCO PESOS 05/100 M.N.");
    expect(importeEnLetra(5.5)).toBe("CINCO PESOS 50/100 M.N.");
    expect(importeEnLetra(5)).toBe("CINCO PESOS 00/100 M.N.");
  });

  // 0.1 + 0.2 no es 0.3 en binario; un centavo de menos haría que la letra
  // contradiga a la cifra impresa justo encima.
  it("el centavo se redondea, no se trunca", () => {
    expect(importeEnLetra(0.1 + 0.2)).toBe("CERO PESOS 30/100 M.N.");
    expect(importeEnLetra(2.675)).toBe("DOS PESOS 68/100 M.N.");
  });

  it("cero es CERO PESOS, no una cadena vacía", () => {
    expect(importeEnLetra(0)).toBe("CERO PESOS 00/100 M.N.");
    expect(importeEnLetra(0.07)).toBe("CERO PESOS 07/100 M.N.");
  });

  it("un importe negativo se dice en positivo: el signo lo pone el contexto", () => {
    expect(importeEnLetra(-125.5)).toBe("CIENTO VEINTICINCO PESOS 50/100 M.N.");
  });
});

describe("importeEnLetra · dólares", () => {
  /**
   * Apps Script cierra los dólares con `M.N.` (`COT_05:276`), que es *moneda
   * nacional*: afirma dos monedas distintas en el mismo renglón. Aquí se
   * corrige.
   */
  it("cierra con USD y no con M.N.", () => {
    expect(importeEnLetra(62975.24, "USD")).toBe(
      "SESENTA Y DOS MIL NOVECIENTOS SETENTA Y CINCO DÓLARES AMERICANOS 24/100 USD",
    );
    expect(importeEnLetra(100, "USD")).not.toContain("M.N.");
  });
});
