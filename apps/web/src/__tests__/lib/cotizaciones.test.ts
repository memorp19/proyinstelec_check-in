import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/dynamo-client", () => ({
  getDocClient: vi.fn(),
}));

import { getDocClient } from "@/src/lib/dynamo-client";
import {
  parseCotKey,
  cotPk,
  transicionValida,
  createCotizacion,
  crearNuevaVersion,
  cambiarEstatus,
  puedeEnviarseAlCliente,
  buscarCotizaciones,
  type Cotizacion,
} from "@/src/lib/cotizaciones";

const vigenteBase: Partial<Cotizacion> = {
  pk: "COT#001-2026",
  sk: "V#00",
  numero: 1,
  anio: 2026,
  version: 0,
  folio: "PCOTOP-001-2026",
  cliente: "Aceros del Norte",
  titulo: "Subestación_aceros",
  dirigida_a: "Ing. Juan Pérez",
  prioridad: "MEDIA",
  estatus: "PROCESO",
  elaboro: "EAOL",
};

describe("parseCotKey / cotPk", () => {
  it("parsea NNN-AAAA", () => {
    expect(parseCotKey("001-2026")).toEqual({ numero: 1, anio: 2026 });
    expect(parseCotKey("45-2025")).toEqual({ numero: 45, anio: 2025 });
    expect(parseCotKey("abc")).toBeNull();
  });

  it("cotPk siempre con padding a 3", () => {
    expect(cotPk(1, 2026)).toBe("COT#001-2026");
    expect(cotPk(123, 2026)).toBe("COT#123-2026");
  });
});

describe("transicionValida (reglas del legacy)", () => {
  it("flujo feliz: PROCESO → REVISION → ENVIADA → ASIGNADA", () => {
    expect(transicionValida("PROCESO", "REVISION")).toBe(true);
    expect(transicionValida("REVISION", "ENVIADA")).toBe(true);
    expect(transicionValida("ENVIADA", "ASIGNADA")).toBe(true);
  });

  it("corrección: REVISION → PROCESO", () => {
    expect(transicionValida("REVISION", "PROCESO")).toBe(true);
  });

  it("bloqueos: no se salta la revisión ni se revive una cancelada", () => {
    expect(transicionValida("PROCESO", "ENVIADA")).toBe(false);
    expect(transicionValida("PROCESO", "ASIGNADA")).toBe(false);
    expect(transicionValida("CANCELADA", "PROCESO")).toBe(false);
    expect(transicionValida("ASIGNADA", "PROCESO")).toBe(false);
  });
});

describe("createCotizacion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea versión 0 en PROCESO con llaves GSI4 de vigente y condición anti-duplicado", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const c = await createCotizacion({
      numero: 1, anio: 2026, cliente: "Aceros", titulo: "Proyecto_aceros",
      dirigidaA: "Juan", elaboro: "EAOL", createdBy: "maria@proyinstelec.mx",
    });

    expect(c.folio).toBe("PCOTOP-001-2026");
    expect(c.estatus).toBe("PROCESO");
    expect(c.gsi4pk).toBe("COT#2026");
    expect(c.gsi4sk).toBe("PROCESO#001");

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.ConditionExpression).toBe("attribute_not_exists(pk)");
  });
});

describe("crearNuevaVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hereda datos, limpia OC/OT/fechas y quita GSI4 a la versión anterior", async () => {
    const vigente = { ...vigenteBase, estatus: "ENVIADA", orden_compra: "OC-9", fecha_entrega: "2026-08-01", gsi4pk: "COT#2026", gsi4sk: "ENVIADA#001" };
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({ Items: [vigente] }) // getVigente
      .mockResolvedValueOnce({}) // Put nueva versión
      .mockResolvedValueOnce({}); // Update quitar GSI4
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const nueva = await crearNuevaVersion({ numero: 1, anio: 2026, createdBy: "x@x.mx" });

    expect(nueva.version).toBe(1);
    expect(nueva.folio).toBe("PCOTOP-001-2026-1");
    expect(nueva.estatus).toBe("PROCESO");
    expect(nueva.orden_compra).toBeUndefined();
    expect(nueva.fecha_entrega).toBeUndefined();
    expect(nueva.cliente).toBe("Aceros del Norte"); // heredado

    const updateCmd = mockSend.mock.calls[2][0];
    expect(updateCmd.input.UpdateExpression).toContain("REMOVE gsi4pk, gsi4sk");
    expect(updateCmd.input.Key).toEqual({ pk: "COT#001-2026", sk: "V#00" });
  });
});

describe("cambiarEstatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza transiciones inválidas", async () => {
    const mockSend = vi.fn().mockResolvedValueOnce({ Items: [vigenteBase] });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await expect(cambiarEstatus(1, 2026, "ASIGNADA")).rejects.toThrow("Transición no permitida");
  });

  it("al reentrar a REVISION borra la aprobación previa de esa versión", async () => {
    const enRevisionAntes = { ...vigenteBase, estatus: "PROCESO" };
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({ Items: [enRevisionAntes] }) // getVigente
      .mockResolvedValueOnce({}) // Update estatus
      .mockResolvedValueOnce({}); // Delete aprobación
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await cambiarEstatus(1, 2026, "REVISION");

    const deleteCmd = mockSend.mock.calls[2][0];
    expect(deleteCmd.input.Key.sk).toBe("APROBACION#V#00");
  });

  it("actualiza GSI4 con el estatus nuevo", async () => {
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({ Items: [{ ...vigenteBase, estatus: "ENVIADA" }] })
      .mockResolvedValueOnce({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await cambiarEstatus(1, 2026, "ASIGNADA");
    const updateCmd = mockSend.mock.calls[1][0];
    expect(updateCmd.input.ExpressionAttributeValues[":g4s"]).toBe("ASIGNADA#001");
  });
});

describe("puedeEnviarseAlCliente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PROCESO → bloqueado", async () => {
    const mockSend = vi.fn().mockResolvedValueOnce({ Items: [vigenteBase] });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);
    const r = await puedeEnviarseAlCliente(1, 2026);
    expect(r.puede).toBe(false);
  });

  it("REVISION sin aprobación → bloqueado con motivo", async () => {
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({ Items: [{ ...vigenteBase, estatus: "REVISION" }] })
      .mockResolvedValueOnce({ Item: undefined }); // tieneAprobacion
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);
    const r = await puedeEnviarseAlCliente(1, 2026);
    expect(r.puede).toBe(false);
    expect(r.motivo).toContain("aprobación");
  });

  it("REVISION aprobada → permitido; ENVIADA → permitido (reenvío)", async () => {
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({ Items: [{ ...vigenteBase, estatus: "REVISION" }] })
      .mockResolvedValueOnce({ Item: { aprobado_por: "rev@x.mx" } });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);
    expect((await puedeEnviarseAlCliente(1, 2026)).puede).toBe(true);

    const mockSend2 = vi.fn().mockResolvedValueOnce({ Items: [{ ...vigenteBase, estatus: "ENVIADA" }] });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend2 } as any);
    expect((await puedeEnviarseAlCliente(1, 2026)).puede).toBe(true);
  });
});

describe("buscarCotizaciones", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aplica los filtros del legacy sobre las vigentes del año", async () => {
    const vigentes = [
      { ...vigenteBase, numero: 1, cliente: "Aceros del Norte", estatus: "PROCESO", elaboro: "EAOL", fecha_entrega: "2026-08-15" },
      { ...vigenteBase, numero: 2, pk: "COT#002-2026", cliente: "Constructora Gómez", estatus: "ENVIADA", elaboro: "MNAA", folio_ot: "OT002260", fecha_entrega: "2026-09-01" },
    ];
    const mockSend = vi
      .fn()
      // Query GSI4 (una página)
      .mockResolvedValueOnce({ Items: vigentes })
      // tieneAprobacion por cada resultado filtrado
      .mockResolvedValue({ Item: undefined });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const r = await buscarCotizaciones({ anio: 2026, empresa: "gómez" });
    expect(r).toHaveLength(1);
    expect(r[0].numero).toBe(2);
    expect(r[0].aprobada).toBe(false);
  });

  it("filtra por mes de entrega y estatus", async () => {
    const vigentes = [
      { ...vigenteBase, numero: 1, estatus: "PROCESO", fecha_entrega: "2026-08-15" },
      { ...vigenteBase, numero: 2, pk: "COT#002-2026", estatus: "PROCESO", fecha_entrega: "2026-09-01" },
    ];
    const mockSend = vi.fn().mockResolvedValueOnce({ Items: vigentes }).mockResolvedValue({ Item: undefined });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const r = await buscarCotizaciones({ anio: 2026, estatus: "PROCESO", mesEntrega: 9 });
    expect(r).toHaveLength(1);
    expect(r[0].numero).toBe(2);
  });
});
