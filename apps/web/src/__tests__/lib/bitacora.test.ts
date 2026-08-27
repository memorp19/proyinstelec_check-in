import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/dynamo-client", () => ({
  getDocClient: vi.fn(),
}));

import { getDocClient } from "@/src/lib/dynamo-client";
import { registrarBitacora, listarBitacora, existeEvento } from "@/src/lib/bitacora";

describe("registrarBitacora", () => {
  beforeEach(() => vi.clearAllMocks());

  it("escribe el evento con pk por mes y campos completos", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await registrarBitacora({
      accion: "COTIZACION_CREADA",
      usuario: "maria@proyinstelec.mx",
      detalle: "PCOTOP-001-2026",
      referencia: "COT#001-2026",
    });

    const item = mockSend.mock.calls[0][0].input.Item;
    const mesActual = new Date().toISOString().slice(0, 7);
    expect(item.pk).toBe(`BITACORA#${mesActual}`);
    expect(item.sk).toMatch(/^\d{4}-\d{2}-\d{2}T.*#[0-9a-f]{8}$/);
    expect(item.accion).toBe("COTIZACION_CREADA");
    expect(item.usuario).toBe("maria@proyinstelec.mx");
    expect(item.referencia).toBe("COT#001-2026");
  });

  it("nunca lanza aunque DynamoDB falle", async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error("dynamo caído"));
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await expect(
      registrarBitacora({ accion: "X", usuario: "sistema" }),
    ).resolves.toBeUndefined();
  });
});

describe("listarBitacora", () => {
  beforeEach(() => vi.clearAllMocks());

  const eventos = [
    { accion: "CORREO_ENVIADO", referencia: "COT#001-2026", usuario: "a" },
    { accion: "CORREO_ENVIADO", referencia: "COT#002-2026", usuario: "b" },
    { accion: "AVISO_VENCIMIENTO", referencia: "ACT-0007|-3", usuario: "sistema" },
  ];

  it("consulta por mes y filtra por acción y referencia", async () => {
    const mockSend = vi.fn().mockResolvedValue({ Items: eventos });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const porAccion = await listarBitacora("2026-08", { accion: "CORREO_ENVIADO" });
    expect(porAccion).toHaveLength(2);

    const porRef = await listarBitacora("2026-08", { referencia: "ACT-0007|-3" });
    expect(porRef).toHaveLength(1);
    expect(porRef[0].accion).toBe("AVISO_VENCIMIENTO");

    const command = mockSend.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[":pk"]).toBe("BITACORA#2026-08");
  });
});

describe("existeEvento (memoria de avisos)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("true si el aviso ya se registró este mes", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      Items: [{ accion: "AVISO_VENCIMIENTO", referencia: "ACT-0007|-3" }],
    });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    expect(await existeEvento("AVISO_VENCIMIENTO", "ACT-0007|-3")).toBe(true);
  });

  it("false si no hay registro en los meses revisados", async () => {
    const mockSend = vi.fn().mockResolvedValue({ Items: [] });
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    expect(await existeEvento("AVISO_VENCIMIENTO", "ACT-9999|-1")).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(2); // mes actual + anterior
  });
});
