/**
 * En qué proyectos puede fichar alguien: la regla que comparten `/api/jornada`
 * y la foto del check-in.
 */
import { describe, it, expect } from "vitest";
import { puedeFicharEn } from "@/src/lib/fichaje";

const temporal = { tipo: "temporal", proyectos_asignados: ["p-1"] };

describe("puedeFicharEn", () => {
  it("un temporal, en su proyecto asignado: sí", () => {
    expect(puedeFicharEn(temporal, "p-1", false)).toBe(true);
  });

  it("un temporal, en otro proyecto: no", () => {
    expect(puedeFicharEn(temporal, "p-2", false)).toBe(false);
  });

  it.each(["planta", "admin"])("%s, en cualquier proyecto: sí, como siempre", (tipo) => {
    expect(puedeFicharEn({ tipo, proyectos_asignados: [] }, "p-2", false)).toBe(true);
  });

  it("en desarrollo no se revisa", () => {
    expect(puedeFicharEn(temporal, "dev-proyecto", true)).toBe(true);
  });
});
