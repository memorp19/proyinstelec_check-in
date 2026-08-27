import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/dynamo-client", () => ({
  getDocClient: vi.fn(),
}));

import { getDocClient } from "@/src/lib/dynamo-client";
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

describe("siguienteNumero", () => {
  beforeEach(() => vi.clearAllMocks());

  it("incrementa atómicamente y devuelve el nuevo valor", async () => {
    const mockSend = vi.fn().mockResolvedValue({ Attributes: { n: 42 } });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const n = await siguienteNumero("cotizacion-2026");
    expect(n).toBe(42);

    const command = mockSend.mock.calls[0][0];
    expect(command.input.Key).toEqual({ pk: "COUNTER#cotizacion-2026", sk: "#N" });
    expect(command.input.UpdateExpression).toContain("ADD n");
  });
});

describe("asegurarContadorMinimo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no falla cuando el contador ya va más adelante", async () => {
    const err = Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
    const mockSend = vi.fn().mockRejectedValue(err);
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await expect(asegurarContadorMinimo("actividad", 10)).resolves.toBeUndefined();
  });

  it("propaga otros errores", async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error("boom"));
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

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
