import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tipoDeCambioFix } from "@/src/lib/banxico";

/** La respuesta del SIE, con la forma que de verdad manda. */
const respuestaFix = (dato: string, fecha = "13/10/2026") => ({
  ok: true,
  status: 200,
  json: async () => ({ bmx: { series: [{ idSerie: "SF43718", datos: [{ fecha, dato }] }] } }),
});

const fetchFalso = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchFalso);
  vi.stubEnv("BANXICO_TOKEN", "un-token");
  fetchFalso.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("tipoDeCambioFix", () => {
  it("devuelve el valor y la fecha, en ISO", async () => {
    fetchFalso.mockResolvedValue(respuestaFix("18.4567"));
    expect(await tipoDeCambioFix()).toEqual({ ok: true, valor: 18.4567, fecha: "2026-10-13" });
  });

  it("pide la serie del FIX con el token", async () => {
    fetchFalso.mockResolvedValue(respuestaFix("18"));
    await tipoDeCambioFix();
    const url = String(fetchFalso.mock.calls[0][0]);
    expect(url).toContain("SF43718");
    expect(url).toContain("oportuno");
    expect(url).toContain("token=un-token");
  });

  /**
   * Las cuatro maneras de fallar dan lo mismo: `ok: false` y un motivo que se
   * puede leer. Una cotización no se detiene porque un servicio externo esté
   * caído, así que ninguna de estas lanza.
   */
  it("sin token lo dice, sin llamar a nadie", async () => {
    vi.stubEnv("BANXICO_TOKEN", "");
    const r = await tipoDeCambioFix();
    expect(r.ok).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
    if (!r.ok) expect(r.motivo).toContain("BANXICO_TOKEN");
  });

  it("un token vencido se nombra como lo que es", async () => {
    fetchFalso.mockResolvedValue({ ok: false, status: 401 });
    const r = await tipoDeCambioFix();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("token no es válido");
  });

  it("si no se puede conectar, lo dice y ofrece capturarlo", async () => {
    fetchFalso.mockRejectedValue(new Error("network"));
    const r = await tipoDeCambioFix();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("a mano");
  });

  it("si tarda demasiado, lo dice", async () => {
    const err = new Error("timeout");
    err.name = "TimeoutError";
    fetchFalso.mockRejectedValue(err);
    const r = await tipoDeCambioFix();
    if (!r.ok) expect(r.motivo).toContain("tardó demasiado");
  });

  it("una respuesta sin dato no se toma por cero", async () => {
    fetchFalso.mockResolvedValue({ ok: true, status: 200, json: async () => ({ bmx: { series: [{ datos: [] }] } }) });
    const r = await tipoDeCambioFix();
    expect(r.ok).toBe(false);
  });

  it("un cuerpo que no es JSON tampoco revienta", async () => {
    fetchFalso.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("no es json");
      },
    });
    expect((await tipoDeCambioFix()).ok).toBe(false);
  });

  // Un FIX de cero o negativo no es un dato raro: es un dato malo.
  it("un valor imposible se rechaza", async () => {
    fetchFalso.mockResolvedValue(respuestaFix("0"));
    expect((await tipoDeCambioFix()).ok).toBe(false);
  });

  it("una fecha con otra forma se deja tal cual en vez de inventarla", async () => {
    fetchFalso.mockResolvedValue(respuestaFix("18.5", "2026-10-13"));
    const r = await tipoDeCambioFix();
    if (r.ok) expect(r.fecha).toBe("2026-10-13");
  });
});
