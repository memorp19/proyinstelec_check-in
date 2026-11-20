/**
 * La implementación real de `Documentos`, en lo único que decide algo: qué
 * error sale de `aplicarCambios`.
 *
 * Un 400 es Google diciendo que una solicitud no vale, y sale como
 * `LoteRechazado` para que el generador reintente sin el formato. Cualquier
 * otro fallo —red, permisos, cuota— sale tal cual: no dice nada del formato.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { batchUpdate } = vi.hoisted(() => ({ batchUpdate: vi.fn() }));

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(), OAuth2: vi.fn() },
    docs: vi.fn(() => ({ documents: { batchUpdate } })),
    drive: vi.fn(() => ({})),
  },
}));
vi.mock("@/src/lib/google-auth", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/google-auth")>()),
  autenticar: vi.fn(async () => ({})),
}));

import { documentosDeGoogle } from "@/src/lib/documentos-google";
import { LoteRechazado } from "@/src/lib/cotizador/docs/lote";

/** Con la forma del error de `googleapis`: el estado en `response` y en `status`. */
const errorDeGoogle = (status: number | undefined, mensaje: string) =>
  Object.assign(new Error(mensaje), {
    ...(status ? { status, code: status, response: { status } } : {}),
  });

beforeEach(() => {
  batchUpdate.mockReset();
});

describe("documentosDeGoogle · aplicarCambios", () => {
  it("un 400 sale como LoteRechazado, con el número de la solicitud", async () => {
    const original = errorDeGoogle(400, "Invalid requests[7].pinTableHeaderRows: Unknown name");
    batchUpdate.mockRejectedValue(original);

    const fallo = documentosDeGoogle().aplicarCambios("doc-1", []);
    await expect(fallo).rejects.toBeInstanceOf(LoteRechazado);
    await expect(fallo).rejects.toMatchObject({
      indice: 7,
      message: "Invalid requests[7].pinTableHeaderRows: Unknown name",
      cause: original,
    });
  });

  it("un fallo de red sale tal cual, sin convertirse en rechazo", async () => {
    const original = errorDeGoogle(undefined, "socket hang up");
    batchUpdate.mockRejectedValue(original);

    await expect(documentosDeGoogle().aplicarCambios("doc-1", [])).rejects.toBe(original);
  });

  it("un 403, un 429 o un 500 tampoco son un rechazo del lote", async () => {
    for (const status of [403, 429, 500]) {
      const original = errorDeGoogle(status, `estado ${status}`);
      batchUpdate.mockRejectedValueOnce(original);
      await expect(documentosDeGoogle().aplicarCambios("doc-1", [])).rejects.toBe(original);
    }
  });

  it("si entra, no lanza nada", async () => {
    batchUpdate.mockResolvedValue({ data: {} });
    await expect(documentosDeGoogle().aplicarCambios("doc-1", [])).resolves.toBeUndefined();
    expect(batchUpdate).toHaveBeenCalledWith({
      documentId: "doc-1",
      requestBody: { requests: [] },
    });
  });
});
