import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { validateToken, consumeToken, crearInvitacion } from "@/src/lib/invitaciones";

/**
 * Encadenado falso de Drizzle: cualquier método devuelve el mismo objeto y el
 * `await` final entrega el siguiente resultado de la cola.
 */
function fakeDb(resultados: unknown[][]) {
  const cola = [...resultados];
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          const filas = cola.shift() ?? [];
          return (resolve: (v: unknown) => void) => resolve(filas);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

const EN_UNA_SEMANA = new Date(Date.now() + 7 * 86_400_000);
const AYER = new Date(Date.now() - 86_400_000);

function fila(over: Record<string, unknown> = {}) {
  return {
    token: "t1",
    proyectoId: "proyecto-123",
    creadoPor: "admin-001",
    nombreSugerido: "Juan Pérez",
    estado: "pendiente",
    expiresAt: EN_UNA_SEMANA,
    usadaPor: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("validateToken", () => {
  it("devuelve not_found cuando el token no existe", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[]]));
    expect(await validateToken("fantasma")).toEqual({ valid: false, reason: "not_found" });
  });

  it("devuelve expired cuando expiresAt ya pasó", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[fila({ expiresAt: AYER })]]));
    expect(await validateToken("t1")).toEqual({ valid: false, reason: "expired" });
  });

  it("un token vencido es expired aunque siga pendiente y sin usar", async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([[fila({ expiresAt: new Date(Date.now() - 1000), estado: "pendiente" })]]),
    );
    expect(await validateToken("t1")).toEqual({ valid: false, reason: "expired" });
  });

  it("devuelve already_used cuando el estado es 'usado'", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[fila({ estado: "usado" })]]));
    expect(await validateToken("t2")).toEqual({ valid: false, reason: "already_used" });
  });

  it("devuelve la invitación cuando está pendiente y vigente", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[fila()]]));
    const result = await validateToken("t1");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.invitacion.proyectoId).toBe("proyecto-123");
      expect(result.invitacion.nombreSugerido).toBe("Juan Pérez");
    }
  });

  it("normaliza nombreSugerido nulo a undefined", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[fila({ nombreSugerido: null })]]));
    const result = await validateToken("t1");
    expect(result.valid && result.invitacion.nombreSugerido).toBeUndefined();
  });
});

describe("consumeToken", () => {
  it("marca el token como usado cuando seguía pendiente", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[{ token: "t1" }]]));
    await expect(consumeToken("t1", "usuario-001")).resolves.toBeUndefined();
  });

  it("lanza cuando el UPDATE no alcanzó fila pendiente (doble uso)", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[]]));
    await expect(consumeToken("t1", "otro-usuario")).rejects.toThrow(/ya fue utilizada/);
  });
});

describe("crearInvitacion", () => {
  it("genera un token uuid y calcula la vigencia en días", async () => {
    let insertado: any = null;
    const chain: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (resolve: any) => resolve([insertado]);
          return (arg: unknown) => {
            if (prop === "values") {
              insertado = { usadaPor: null, estado: "pendiente", ...(arg as object) };
            }
            return chain;
          };
        },
      },
    );
    vi.mocked(getDb).mockReturnValue(chain);

    const antes = Date.now();
    const inv = await crearInvitacion({
      proyectoId: "p1",
      creadoPor: "admin-001",
      nombreSugerido: "Ana",
      diasVigencia: 3,
    });

    expect(inv.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    const dias = (inv.expiresAt.getTime() - antes) / 86_400_000;
    expect(dias).toBeGreaterThan(2.99);
    expect(dias).toBeLessThan(3.01);
    expect(inv.estado).toBe("pendiente");
  });
});
