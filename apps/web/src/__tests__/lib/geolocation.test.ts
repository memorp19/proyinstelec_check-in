import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCurrentPosition } from "@/src/lib/geolocation";

const MOCK_COORDS = {
  latitude: 19.4284,
  longitude: -99.1946,
  accuracy: 8,
};

function mockGeolocation(impl: Partial<Geolocation>) {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: vi.fn(),
      ...impl,
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("getCurrentPosition", () => {
  it("resolves with lat/lng/precision when GPS succeeds", async () => {
    mockGeolocation({
      getCurrentPosition: vi.fn((success) =>
        success({ coords: MOCK_COORDS, timestamp: Date.now() }),
      ),
    });

    const pos = await getCurrentPosition();
    expect(pos.lat).toBeCloseTo(19.4284);
    expect(pos.lng).toBeCloseTo(-99.1946);
    expect(pos.precision).toBe(8);
    expect(pos.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns timestamp as ISO string", async () => {
    const ts = new Date("2026-05-14T10:00:00.000Z").getTime();
    mockGeolocation({
      getCurrentPosition: vi.fn((success) =>
        success({ coords: MOCK_COORDS, timestamp: ts }),
      ),
    });

    const pos = await getCurrentPosition();
    expect(pos.timestamp).toBe("2026-05-14T10:00:00.000Z");
  });

  it("rounds precision to integer metres", async () => {
    mockGeolocation({
      getCurrentPosition: vi.fn((success) =>
        success({ coords: { ...MOCK_COORDS, accuracy: 12.7 }, timestamp: Date.now() }),
      ),
    });

    const pos = await getCurrentPosition();
    expect(pos.precision).toBe(13);
  });

  it("rejects with PERMISSION_DENIED (code 1)", async () => {
    mockGeolocation({
      getCurrentPosition: vi.fn((_, error) =>
        error({ code: 1, message: "User denied Geolocation" }),
      ),
    });

    await expect(getCurrentPosition()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("rejects with TIMEOUT (code 3)", async () => {
    mockGeolocation({
      getCurrentPosition: vi.fn((_, error) =>
        error({ code: 3, message: "Timeout expired" }),
      ),
    });

    await expect(getCurrentPosition()).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects with UNAVAILABLE when geolocation is not in navigator", async () => {
    vi.stubGlobal("navigator", {});

    await expect(getCurrentPosition()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("rejects with UNAVAILABLE for error code 2", async () => {
    mockGeolocation({
      getCurrentPosition: vi.fn((_, error) =>
        error({ code: 2, message: "Position unavailable" }),
      ),
    });

    await expect(getCurrentPosition()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
