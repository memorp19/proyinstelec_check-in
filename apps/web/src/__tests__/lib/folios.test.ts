import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso } from "../helpers/db-falso";
import {
  siguienteNumero,
  asegurarContadorMinimo,
  folioCotizacion,
  folioOT,
  folioActividad,
  folioServicio,
  folioPendiente,
  parseFolioCotizacion,
  parseFolioOT,
} from "@/src/lib/folios";

function usarDb(resultados: unknown[] = []) {
  const falso = dbFalso(resultados);
  vi.mocked(getDb).mockImplementation(falso.getDb as never);
  return falso;
}

describe("siguienteNumero", () => {
  beforeEach(() => vi.clearAllMocks());

  it("incrementa atómicamente en una sola sentencia y devuelve el nuevo valor", async () => {
    const db = usarDb([[{ n: 42 }]]);

    expect(await siguienteNumero("cotizacion-2026")).toBe(42);

    // INSERT ... ON CONFLICT DO UPDATE ... RETURNING n
    expect(db.metodos()).toEqual(["insert", "values", "onConflictDoUpdate", "returning"]);
    const valores = db.llamadas[1].args[0] as { tipo: string; n: number };
    expect(valores).toEqual({ tipo: "cotizacion-2026", n: 1 });
  });
});

describe("asegurarContadorMinimo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("solo sube: el ON CONFLICT lleva condición sobre el valor actual", async () => {
    const db = usarDb([[]]);

    await expect(asegurarContadorMinimo("actividad", 10)).resolves.toBeUndefined();

    const conflicto = db.llamadas.find((l) => l.metodo === "onConflictDoUpdate")!
      .args[0] as { set: { n: number }; setWhere?: unknown };
    expect(conflicto.set.n).toBe(10);
    expect(conflicto.setWhere).toBeDefined();
  });

  it("propaga errores de la base", async () => {
    usarDb([{ error: new Error("boom") }]);
    await expect(asegurarContadorMinimo("actividad", 10)).rejects.toThrow("boom");
  });
});

describe("formato de folios (convenciones del legacy)", () => {
  it("folioCotizacion con y sin versión", () => {
    expect(folioCotizacion(1, 2026)).toBe("PCOTOP-001-2026");
    expect(folioCotizacion(1, 2026, 0)).toBe("PCOTOP-001-2026");
    expect(folioCotizacion(45, 2026, 2)).toBe("PCOTOP-045-2026-2");
  });

  it("folioOT: OT + 3 dígitos + año 2 dígitos + versión", () => {
    expect(folioOT(1, 2026, 0)).toBe("OT001260");
    expect(folioOT(123, 2025, 1)).toBe("OT123251");
  });

  it("folios secuenciales", () => {
    expect(folioActividad(7)).toBe("ACT-0007");
    expect(folioServicio(3)).toBe("SRV-003");
    expect(folioPendiente(12)).toBe("PD-012");
  });
});

describe("parseFolioCotizacion", () => {
  it("acepta folio completo, parcial y número suelto", () => {
    expect(parseFolioCotizacion("PCOTOP-001-2026-2")).toEqual({ numero: 1, anio: 2026, version: 2 });
    expect(parseFolioCotizacion("pcotop-045-2026")).toEqual({ numero: 45, anio: 2026, version: undefined });
    expect(parseFolioCotizacion("001-2026")).toEqual({ numero: 1, anio: 2026, version: undefined });
    expect(parseFolioCotizacion("45")).toEqual({ numero: 45, anio: undefined, version: undefined });
  });

  it("rechaza texto inválido", () => {
    expect(parseFolioCotizacion("OT001260")).toBeNull();
    expect(parseFolioCotizacion("hola")).toBeNull();
  });
});

describe("parseFolioOT", () => {
  it("descompone el folio", () => {
    expect(parseFolioOT("OT001260")).toEqual({ numero: 1, anio: 2026, version: 0 });
    expect(parseFolioOT("ot123251")).toEqual({ numero: 123, anio: 2025, version: 1 });
  });

  it("rechaza folios malformados", () => {
    expect(parseFolioOT("OT12")).toBeNull();
    expect(parseFolioOT("PCOTOP-001-2026")).toBeNull();
  });
});
