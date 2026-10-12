import { describe, it, expect } from "vitest";
import { importeEnLetra, centenaEnLetra } from "@/src/lib/cotizador";

/**
 * Los doce totales de los PDF de 2026, verificados contra el documento.
 *
 * Dos vienen con la letra MAL impresa y el test espera la forma correcta: es
 * justo el error que una función pura evita.
 *   · la 269 y la 068 traen el importe equivocado;
 *   · la 250 dice "VEINTE Y UN" donde se dice "VEINTIÚN".
 */
const TOTALES: Array<[string, number, string]> = [
  ["068", 1213491.08, "UN MILLÓN DOSCIENTOS TRECE MIL CUATROCIENTOS NOVENTA Y UN PESOS 08/100 M.N."],
  ["165", 58940.76, "CINCUENTA Y OCHO MIL NOVECIENTOS CUARENTA PESOS 76/100 M.N."],
  ["189", 54213.76, "CINCUENTA Y CUATRO MIL DOSCIENTOS TRECE PESOS 76/100 M.N."],
  ["228", 87754.0, "OCHENTA Y SIETE MIL SETECIENTOS CINCUENTA Y CUATRO PESOS 00/100 M.N."],
  ["239", 447652.12, "CUATROCIENTOS CUARENTA Y SIETE MIL SEISCIENTOS CINCUENTA Y DOS PESOS 12/100 M.N."],
  ["250", 1439021.76, "UN MILLÓN CUATROCIENTOS TREINTA Y NUEVE MIL VEINTIÚN PESOS 76/100 M.N."],
  ["254", 25098.92, "VEINTICINCO MIL NOVENTA Y OCHO PESOS 92/100 M.N."],
  ["256", 418075.6, "CUATROCIENTOS DIECIOCHO MIL SETENTA Y CINCO PESOS 60/100 M.N."],
  ["259", 887633.16, "OCHOCIENTOS OCHENTA Y SIETE MIL SEISCIENTOS TREINTA Y TRES PESOS 16/100 M.N."],
  ["262", 173424.64, "CIENTO SETENTA Y TRES MIL CUATROCIENTOS VEINTICUATRO PESOS 64/100 M.N."],
  ["269", 13891798.08, "TRECE MILLONES OCHOCIENTOS NOVENTA Y UN MIL SETECIENTOS NOVENTA Y OCHO PESOS 08/100 M.N."],
];

describe("importeEnLetra · los doce totales de los PDF", () => {
  it.each(TOTALES)("%s — %d", (_folio, monto, letra) => {
    expect(importeEnLetra(monto)).toBe(letra);
  });
});

describe("importeEnLetra · los totales calculados", () => {
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

  // El PDF de la 250 dice "VEINTE Y UN": ni se separa ni pierde el acento.
  it("veintiún lleva acento, y también cuando cuenta millares", () => {
    expect(importeEnLetra(21)).toBe("VEINTIÚN PESOS 00/100 M.N.");
    expect(importeEnLetra(21000)).toBe("VEINTIÚN MIL PESOS 00/100 M.N.");
    expect(importeEnLetra(21021)).toBe("VEINTIÚN MIL VEINTIÚN PESOS 00/100 M.N.");
  });

  it("los demás veintipico que llevan acento", () => {
    expect(centenaEnLetra(22)).toBe("VEINTIDÓS");
    expect(centenaEnLetra(23)).toBe("VEINTITRÉS");
    expect(centenaEnLetra(26)).toBe("VEINTISÉIS");
    // Y los que no lo llevan
    expect(centenaEnLetra(24)).toBe("VEINTICUATRO");
    expect(centenaEnLetra(27)).toBe("VEINTISIETE");
  });

  it("cien exacto es CIEN; con resto es CIENTO", () => {
    expect(centenaEnLetra(100)).toBe("CIEN");
    expect(centenaEnLetra(105)).toBe("CIENTO CINCO");
    expect(centenaEnLetra(199)).toBe("CIENTO NOVENTA Y NUEVE");
  });

  it("el veintipico va pegado", () => {
    expect(centenaEnLetra(20)).toBe("VEINTE");
    expect(centenaEnLetra(21)).toBe("VEINTIÚN");
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
      "SESENTA Y DOS MIL NOVECIENTOS SETENTA Y CINCO DÓLARES 24/100 USD",
    );
    expect(importeEnLetra(1250.5, "USD")).toBe("MIL DOSCIENTOS CINCUENTA DÓLARES 50/100 USD");
    expect(importeEnLetra(100, "USD")).not.toContain("M.N.");
  });
});
