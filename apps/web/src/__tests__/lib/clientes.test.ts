import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/dynamo-client", () => ({
  getDocClient: vi.fn(),
}));

import { getDocClient } from "@/src/lib/dynamo-client";
import {
  normalizarRazonSocial,
  normalizarNombreContacto,
  compararRazones,
  createContacto,
  contactosParaEnvio,
} from "@/src/lib/clientes";

describe("normalizarRazonSocial", () => {
  it("quita sufijos legales y puntuación", () => {
    expect(normalizarRazonSocial("Aceros del Norte, S.A. de C.V.")).toBe("aceros del norte");
    expect(normalizarRazonSocial("ACEROS DEL NORTE SA DE CV")).toBe("aceros del norte");
    expect(normalizarRazonSocial("Constructora Gómez S. de R.L.")).toBe("constructora gomez");
  });

  it("normaliza acentos y espacios", () => {
    expect(normalizarRazonSocial("  Eléctrica   Ramírez  ")).toBe("electrica ramirez");
  });
});

describe("normalizarNombreContacto", () => {
  it("quita títulos personales (LIC./ING./ARQ./...)", () => {
    expect(normalizarNombreContacto("ING. Juan Pérez")).toBe("juan perez");
    expect(normalizarNombreContacto("Lic. María López")).toBe("maria lopez");
    expect(normalizarNombreContacto("C.P. Pedro Díaz")).toBe("pedro diaz");
  });
});

describe("compararRazones", () => {
  it("exacta cuando solo difieren sufijos legales", () => {
    expect(compararRazones("Aceros del Norte S.A. de C.V.", "ACEROS DEL NORTE")).toBe("exacta");
  });

  it("parcial con contains bidireccional", () => {
    expect(compararRazones("Aceros del Norte", "Aceros del Norte Planta 2")).toBe("parcial");
    expect(compararRazones("Aceros del Norte Planta 2", "Aceros del Norte")).toBe("parcial");
  });

  it("ninguna cuando no hay relación", () => {
    expect(compararRazones("Aceros del Norte", "Constructora Gómez")).toBe("ninguna");
  });
});

describe("createContacto — anti-duplicado", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza un contacto con el mismo nombre normalizado en la empresa", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      Items: [{ contacto_id: "1", nombre: "ING. Juan Pérez" }],
    });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await expect(
      createContacto({ clienteId: "abc", nombre: "Juan Perez" }),
    ).rejects.toThrow("ya existe");
  });
});

describe("contactosParaEnvio — sugerencia de contacto", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockDatos() {
    const empresa = {
      pk: "CLIENTE#e1", sk: "#METADATA", cliente_id: "e1",
      razon_social: "Aceros del Norte S.A. de C.V.", razon_normalizada: "aceros del norte",
    };
    const contactos = [
      { pk: "CLIENTE#e1", sk: "CONTACTO#c1", contacto_id: "c1", cliente_id: "e1", nombre: "ING. Juan Pérez", correo: "juan@aceros.mx" },
      { pk: "CLIENTE#e1", sk: "CONTACTO#c2", contacto_id: "c2", cliente_id: "e1", nombre: "María López", correo: "maria@aceros.mx" },
      { pk: "CLIENTE#e1", sk: "CONTACTO#c3", contacto_id: "c3", cliente_id: "e1", nombre: "Sin Correo" },
    ];
    // 1ª llamada: Scan de empresas; 2ª: Query de contactos
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({ Items: [empresa] })
      .mockResolvedValueOnce({ Items: contactos });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);
  }

  it("sugiere el contacto que corresponde a 'Dirigida a' quitando títulos", async () => {
    mockDatos();
    const r = await contactosParaEnvio({
      razonSocial: "ACEROS DEL NORTE",
      dirigidaA: "Ing. Juan Pérez",
    });
    expect(r.empresa?.cliente_id).toBe("e1");
    expect(r.contactos).toHaveLength(2); // solo con correo
    expect(r.sugeridoId).toBe("c1");
  });

  it("match por palabra cuando el nombre no coincide completo", async () => {
    mockDatos();
    const r = await contactosParaEnvio({ razonSocial: "Aceros del Norte", dirigidaA: "Sra. López" });
    expect(r.sugeridoId).toBe("c2");
  });

  it("sin empresa localizada devuelve vacío", async () => {
    const mockSend = vi.fn().mockResolvedValue({ Items: [] });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);
    const r = await contactosParaEnvio({ razonSocial: "Desconocida SA" });
    expect(r.empresa).toBeNull();
    expect(r.sugeridoId).toBeNull();
  });
});
