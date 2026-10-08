import { describe, it, expect } from "vitest";
import { columnaDe, fechaDeSerial, serialDeFecha, texto, type Celda } from "@/src/lib/excel";

const celda = (valor: string, tipo = "s", conFormatoDeFecha = false): Celda => ({
  valor,
  tipo,
  conFormatoDeFecha,
});

describe("texto", () => {
  it("entrega las cadenas sin espacios de sobra", () => {
    expect(texto(celda("  IGSA  "))).toBe("IGSA");
    expect(texto(undefined)).toBe("");
  });

  it("quita la cola decimal que el XML le pone a los enteros", () => {
    expect(texto(celda("2026.0", "n"))).toBe("2026");
    expect(texto(celda("0.0", "n"))).toBe("0");
  });

  // El caso que apareció al leer los archivos reales: una OC de diez dígitos se
  // almacena como `4.501122596E9`, así que entregar el literal metería esa
  // cadena en la base en vez del número de orden de compra.
  it("convierte la notación científica de las OC largas", () => {
    expect(texto(celda("4.501122596E9", "n"))).toBe("4501122596");
    expect(texto(celda("4.551218979E9", "n"))).toBe("4551218979");
  });

  it("no toca la precisión de los decimales", () => {
    expect(texto(celda("10852.16", "n"))).toBe("10852.16");
    expect(texto(celda("0.5", "n"))).toBe("0.5");
  });

  // Un folio con pinta de número sigue siendo texto: no se reinterpreta.
  it("una cadena no se convierte aunque parezca un número", () => {
    expect(texto(celda("002"))).toBe("002");
    expect(texto(celda("19/5/0226"))).toBe("19/5/0226");
  });

  // El formato es presentación; el valor es el dato. Que Excel enseñe esa OC
  // como una fecha de 1920 no la convierte en una fecha.
  it("el formato de fecha no cambia lo que se entrega", () => {
    expect(texto(celda("4501122596", "n", true))).toBe("4501122596");
  });
});

describe("serialDeFecha", () => {
  it("devuelve el número de una celda numérica", () => {
    expect(serialDeFecha(celda("46119", "n", true))).toBe(46119);
  });

  it("null si la celda es texto, aunque parezca una fecha", () => {
    expect(serialDeFecha(celda("19/5/0226", "s", true))).toBeNull();
    expect(serialDeFecha(undefined)).toBeNull();
  });
});

describe("fechaDeSerial", () => {
  // El origen es 1899-12-30 y no 1900-01-01 por el bisiesto de 1900 que Excel
  // inventó para ser compatible con Lotus.
  it("usa el origen correcto de Excel", () => {
    expect(fechaDeSerial(46119).toISOString().slice(0, 10)).toBe("2026-04-07");
    expect(fechaDeSerial(46027).toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  // Se fija mediodía UTC para que ningún huso corra el día al formatear.
  it("se ancla a mediodía, así que ningún huso cambia el día", () => {
    expect(fechaDeSerial(46119).getUTCHours()).toBe(12);
  });

  it("ignora la parte de hora del serial", () => {
    expect(fechaDeSerial(46119.75).toISOString().slice(0, 10)).toBe("2026-04-07");
  });
});

describe("columnaDe", () => {
  it("separa la letra de columna del número de fila", () => {
    expect(columnaDe("B9")).toBe("B");
    expect(columnaDe("AB123")).toBe("AB");
  });
});
