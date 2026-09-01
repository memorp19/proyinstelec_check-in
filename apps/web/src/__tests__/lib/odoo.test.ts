import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { syncToOdooAsync, _resetConfigCache } from "@/src/lib/odoo";

function mockFetch(responses: Array<{ ok: boolean; body: unknown }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      const r = responses[call++ % responses.length];
      return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.body };
    }),
  );
}

/** Captura los values() del insert en la cola de reintentos. */
function fakeDb() {
  const insertados: unknown[] = [];
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: any) => resolve([]);
        return (arg: unknown) => {
          if (prop === "values") insertados.push(arg);
          return chain;
        };
      },
    },
  );
  return { chain, insertados };
}

const SYNC_PARAMS = {
  usuarioId: "user-001",
  email: "carlos@proyinstelec.mx",
  jornadaId: "jornada-abc",
  checkIn: "2026-05-14T09:41:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConfigCache();
  process.env.ODOO_SYNC_ENABLED = "true";
  process.env.ODOO_URL = "https://odoo.test";
  process.env.ODOO_DB = "proyinstelec";
  process.env.ODOO_API_KEY = "api-key-test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.ODOO_SYNC_ENABLED;
  delete process.env.ODOO_URL;
  delete process.env.ODOO_DB;
  delete process.env.ODOO_API_KEY;
});

describe("syncToOdooAsync — guarda", () => {
  it("no hace nada cuando ODOO_SYNC_ENABLED no es 'true'", () => {
    process.env.ODOO_SYNC_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    syncToOdooAsync(SYNC_PARAMS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no lanza aunque la sincronización falle (fire-and-forget)", () => {
    mockFetch([{ ok: false, body: {} }]);
    vi.mocked(getDb).mockReturnValue(fakeDb().chain);
    expect(() => syncToOdooAsync(SYNC_PARAMS)).not.toThrow();
  });
});

describe("syncToOdooAsync — camino feliz", () => {
  it("busca el empleado y crea la asistencia contra la URL configurada", async () => {
    mockFetch([
      { ok: true, body: { result: [42] } }, // search employee
      { ok: true, body: { result: 101 } }, // create attendance
    ]);

    syncToOdooAsync(SYNC_PARAMS);
    await new Promise((r) => setTimeout(r, 50));

    const calls = vi.mocked(fetch).mock.calls as any[];
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("https://odoo.test/web/dataset/call_kw");
    expect(calls[0][1].headers.Authorization).toBe("Bearer api-key-test");
    expect(JSON.parse(calls[0][1].body).params.method).toBe("search");
    expect(JSON.parse(calls[1][1].body).params.method).toBe("create");
  });

  it("escribe el check_out cuando viene en los parámetros", async () => {
    mockFetch([
      { ok: true, body: { result: [42] } },
      { ok: true, body: { result: 101 } },
      { ok: true, body: { result: true } },
    ]);

    syncToOdooAsync({ ...SYNC_PARAMS, checkOut: "2026-05-14T17:41:00.000Z" });
    await new Promise((r) => setTimeout(r, 50));

    const calls = vi.mocked(fetch).mock.calls as any[];
    expect(JSON.parse(calls[2][1].body).params.method).toBe("write");
  });
});

describe("syncToOdooAsync — errores", () => {
  it("encola en odoo_queue después de agotar los reintentos", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    const { chain, insertados } = fakeDb();
    vi.mocked(getDb).mockReturnValue(chain);

    syncToOdooAsync(SYNC_PARAMS);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    expect(insertados).toHaveLength(1);
    expect(insertados[0]).toMatchObject({
      jornadaId: "jornada-abc",
      usuarioId: "user-001",
      estado: "error",
      intento: 3,
    });
  });

  it("falla temprano si falta alguna variable de entorno de Odoo", async () => {
    delete process.env.ODOO_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    syncToOdooAsync(SYNC_PARAMS);
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
