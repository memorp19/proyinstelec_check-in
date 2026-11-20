import { describe, it, expect } from "vitest";
import {
  agregar,
  indiceRechazado,
  LoteRechazado,
  PARTES,
  parteEn,
  todas,
  type Tramo,
} from "@/src/lib/cotizador/docs/lote";
import type { Solicitud } from "@/src/lib/cotizador/docs/tipos";

const reemplazo = (text: string): Solicitud => ({
  replaceAllText: { containsText: { text }, replaceText: "x" },
});

describe("indiceRechazado", () => {
  // Así contesta la API de Docs cuando rechaza una solicitud del lote.
  it("saca el número de solicitud del mensaje de Google", () => {
    expect(
      indiceRechazado("Invalid requests[52].pinTableHeaderRows: Unknown name \"pinTableHeaderRows\""),
    ).toBe(52);
    expect(indiceRechazado("Invalid requests[0].insertText: Index 9 must be less than 3")).toBe(0);
  });

  it("si Google no dice cuál, no inventa uno", () => {
    expect(indiceRechazado("Internal error encountered.")).toBeNull();
  });

  it("LoteRechazado lo trae ya leído y conserva el mensaje tal cual", () => {
    const e = new LoteRechazado("Invalid requests[7].mergeTableCells: nope");
    expect(e.indice).toBe(7);
    expect(e.message).toBe("Invalid requests[7].mergeTableCells: nope");
  });
});

describe("los tramos", () => {
  it("junta solicitudes seguidas de la misma parte y no deja tramos vacíos", () => {
    const tramos: Tramo[] = [];
    agregar(tramos, PARTES.tabla, [reemplazo("a")]);
    agregar(tramos, PARTES.tabla, [reemplazo("b")]);
    agregar(tramos, PARTES.bordes, []);
    agregar(tramos, PARTES.totales, [reemplazo("c")]);
    agregar(tramos, PARTES.tabla, [reemplazo("d")]);

    expect(tramos.map((t) => [t.parte, t.solicitudes.length])).toEqual([
      [PARTES.tabla, 2],
      [PARTES.totales, 1],
      [PARTES.tabla, 1],
    ]);
    expect(todas(tramos)).toEqual(["a", "b", "c", "d"].map(reemplazo));
  });

  /** Es lo que convierte el número que da Google en algo que se pueda leer. */
  it("parteEn cuenta a través de los tramos, desde 0", () => {
    const tramos: Tramo[] = [];
    agregar(tramos, PARTES.negro, [reemplazo("a"), reemplazo("b")]);
    agregar(tramos, PARTES.tabla, [reemplazo("c")]);
    agregar(tramos, PARTES.letra, [reemplazo("d")]);

    expect(parteEn(tramos, 0)).toBe(PARTES.negro);
    expect(parteEn(tramos, 1)).toBe(PARTES.negro);
    expect(parteEn(tramos, 2)).toBe(PARTES.tabla);
    expect(parteEn(tramos, 3)).toBe(PARTES.letra);
    expect(parteEn(tramos, 4)).toBeNull();
  });

  it("toda parte de formato dice qué se nota si falta", () => {
    const formato = Object.values(PARTES).filter((p) => p.grupo === "formato");
    expect(formato.length).toBeGreaterThan(0);
    for (const p of formato) expect("siFalta" in p && p.siFalta).toBeTruthy();
  });
});
