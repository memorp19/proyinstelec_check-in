import { describe, it, expect, vi, afterEach } from "vitest";
import { getDeviceInfo } from "@/src/lib/device-info";

function mockNavigator(overrides: Partial<typeof navigator> & { connection?: any } = {}) {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    platform: "iPhone",
    language: "es-MX",
    connection: undefined,
    ...overrides,
  });
  vi.stubGlobal("screen", { width: 390, height: 844 });
}

afterEach(() => vi.unstubAllGlobals());

describe("getDeviceInfo", () => {
  it("returns all required fields", () => {
    mockNavigator();
    const info = getDeviceInfo();
    expect(info.userAgent).toBeTruthy();
    expect(info.platform).toBe("iPhone");
    expect(info.screenWidth).toBe(390);
    expect(info.screenHeight).toBe(844);
    expect(info.language).toBe("es-MX");
  });

  it("includes connectionType when Network Information API is available", () => {
    mockNavigator({ connection: { effectiveType: "4g" } });
    const info = getDeviceInfo();
    expect(info.connectionType).toBe("4g");
  });

  it("connectionType is undefined when Network Information API is absent", () => {
    mockNavigator({ connection: undefined });
    const info = getDeviceInfo();
    expect(info.connectionType).toBeUndefined();
  });

  it("prefers effectiveType over type", () => {
    mockNavigator({ connection: { effectiveType: "3g", type: "cellular" } });
    const info = getDeviceInfo();
    expect(info.connectionType).toBe("3g");
  });

  it("falls back to type when effectiveType is absent", () => {
    mockNavigator({ connection: { type: "wifi" } });
    const info = getDeviceInfo();
    expect(info.connectionType).toBe("wifi");
  });
});
