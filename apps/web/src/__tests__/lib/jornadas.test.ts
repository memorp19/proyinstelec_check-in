import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/dynamo-client", () => ({ getDocClient: vi.fn() }));
vi.mock("uuid", () => ({ v4: () => "fixed-uuid-1234" }));

import { getDocClient } from "@/src/lib/dynamo-client";
import { createJornada, closeJornada, getJornada, getOpenJornada } from "@/src/lib/jornadas";

const DEVICE_INFO = {
  userAgent: "test-agent",
  platform: "test",
  screenWidth: 390,
  screenHeight: 844,
  language: "es-MX",
};

const CHECK_IN = {
  timestamp: "2026-05-14T09:41:00.000Z",
  lat: 19.4284,
  lng: -99.1946,
  precision: 8,
  deviceInfo: DEVICE_INFO,
};

function makeClient(sendResult: unknown) {
  return { send: vi.fn().mockResolvedValue(sendResult) };
}

beforeEach(() => vi.clearAllMocks());

describe("createJornada", () => {
  it("puts an item with correct pk/sk and GSI keys", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const jornada = await createJornada({
      usuarioId: "user-001",
      proyectoId: "proyecto-001",
      tipo: "planta",
      checkIn: CHECK_IN,
    });

    expect(jornada.id).toBe("fixed-uuid-1234");
    expect(jornada.pk).toBe("JORNADA#fixed-uuid-1234");
    expect(jornada.sk).toBe("#METADATA");
    expect(jornada.gsi1pk).toBe("proyecto-001");
    expect(jornada.gsi2pk).toBe("user-001");
    expect(jornada.estado).toBe("abierta");

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe("proyinstelec-main");
    expect(cmd.input.Item.pk).toBe("JORNADA#fixed-uuid-1234");
  });
});

describe("closeJornada", () => {
  it("calculates duracionMinutos correctly", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const checkOut = {
      timestamp: "2026-05-14T17:41:00.000Z", // 8 hours after check-in
      lat: 19.4284,
      lng: -99.1946,
      precision: 10,
      deviceInfo: DEVICE_INFO,
    };

    const minutos = await closeJornada("fixed-uuid-1234", checkOut, CHECK_IN.timestamp);
    expect(minutos).toBe(480); // 8 * 60
  });

  it("sends UpdateCommand with ConditionExpression to prevent double close", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await closeJornada(
      "j-id",
      { ...{ timestamp: "2026-05-14T17:00:00.000Z", lat: 0, lng: 0, precision: 5, deviceInfo: DEVICE_INFO } },
      CHECK_IN.timestamp,
    );

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.ConditionExpression).toContain("abierta");
    expect(cmd.input.ExpressionAttributeValues[":e"]).toBe("cerrada");
  });
});

describe("getJornada", () => {
  it("returns the jornada when found", async () => {
    const mockItem = { id: "j1", estado: "abierta" };
    vi.mocked(getDocClient).mockReturnValue(makeClient({ Item: mockItem }) as any);

    const result = await getJornada("j1");
    expect(result?.id).toBe("j1");
  });

  it("returns null when not found", async () => {
    vi.mocked(getDocClient).mockReturnValue(makeClient({ Item: undefined }) as any);
    expect(await getJornada("ghost")).toBeNull();
  });
});

describe("getOpenJornada", () => {
  it("returns the first open jornada", async () => {
    const mockJornada = { id: "open-j", estado: "abierta" };
    vi.mocked(getDocClient).mockReturnValue(makeClient({ Items: [mockJornada] }) as any);

    const result = await getOpenJornada("user-001");
    expect(result?.estado).toBe("abierta");
  });

  it("returns null when no open jornada today", async () => {
    vi.mocked(getDocClient).mockReturnValue(makeClient({ Items: [] }) as any);
    expect(await getOpenJornada("user-001")).toBeNull();
  });
});
