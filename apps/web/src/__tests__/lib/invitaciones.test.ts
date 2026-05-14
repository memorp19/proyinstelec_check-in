import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/dynamo-client", () => ({
  getDocClient: vi.fn(),
}));

import { getDocClient } from "@/src/lib/dynamo-client";
import { validateToken, consumeToken } from "@/src/lib/invitaciones";

const FUTURE_TS = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days from now
const PAST_TS = Math.floor(Date.now() / 1000) - 1;

function makeClient(sendResult: unknown) {
  return { send: vi.fn().mockResolvedValue(sendResult) };
}

describe("validateToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns not_found when token does not exist in DB", async () => {
    vi.mocked(getDocClient).mockReturnValue(makeClient({ Item: undefined }) as any);
    const result = await validateToken("nonexistent-token");
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("returns expired when expiresAt is in the past", async () => {
    vi.mocked(getDocClient).mockReturnValue(
      makeClient({
        Item: { token: "t1", estado: "pendiente", expiresAt: PAST_TS, proyectoId: "p1", creadoPor: "g1", nombreSugerido: "A" },
      }) as any,
    );
    const result = await validateToken("t1");
    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("returns already_used when estado is 'usado'", async () => {
    vi.mocked(getDocClient).mockReturnValue(
      makeClient({
        Item: { token: "t2", estado: "usado", expiresAt: FUTURE_TS, proyectoId: "p1", creadoPor: "g1", nombreSugerido: "B" },
      }) as any,
    );
    const result = await validateToken("t2");
    expect(result).toEqual({ valid: false, reason: "already_used" });
  });

  it("returns valid with invitacion when token is pending and not expired", async () => {
    const inv = {
      token: "valid-token",
      estado: "pendiente",
      expiresAt: FUTURE_TS,
      proyectoId: "proyecto-123",
      creadoPor: "google-sub-admin",
      nombreSugerido: "Juan Pérez",
    };
    vi.mocked(getDocClient).mockReturnValue(makeClient({ Item: inv }) as any);

    const result = await validateToken("valid-token");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.invitacion.proyectoId).toBe("proyecto-123");
    }
  });

  it("expires a token that is at exactly now (boundary)", async () => {
    const nowTs = Math.floor(Date.now() / 1000);
    vi.mocked(getDocClient).mockReturnValue(
      makeClient({
        Item: { token: "t3", estado: "pendiente", expiresAt: nowTs - 1, proyectoId: "p", creadoPor: "g", nombreSugerido: "X" },
      }) as any,
    );
    const result = await validateToken("t3");
    expect(result).toEqual({ valid: false, reason: "expired" });
  });
});

describe("consumeToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends an UpdateCommand with estado=usado and the correct googleSub", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await consumeToken("my-token", "google-sub-123");

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[":usado"]).toBe("usado");
    expect(cmd.input.ExpressionAttributeValues[":sub"]).toBe("google-sub-123");
    // ConditionExpression prevents double-use
    expect(cmd.input.ConditionExpression).toContain("pendiente");
  });

  it("propagates DynamoDB ConditionalCheckFailedException (already used race)", async () => {
    const error = new Error("ConditionalCheckFailedException");
    vi.mocked(getDocClient).mockReturnValue({ send: vi.fn().mockRejectedValue(error) } as any);

    await expect(consumeToken("used-token", "other-sub")).rejects.toThrow(
      "ConditionalCheckFailedException",
    );
  });
});
