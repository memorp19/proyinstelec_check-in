/**
 * La ruta de revisión de las importadas (`[key]/revision`): solo para las que
 * no tienen armado. Una armada en el cotizador llegaría a REVISION sin
 * congelar ni generar su PDF definitivo, y el envío mandaría el de antes.
 * Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
// Solo se doblan las que tocan la base; `parseCotKey` es la real.
vi.mock("@/src/lib/cotizaciones", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/cotizaciones")>()),
  getVersion: vi.fn(),
  getVigente: vi.fn(),
  seArmoEnElCotizador: vi.fn(),
}));
vi.mock("@/src/lib/cotizaciones-flujos", () => ({ enviarARevision: vi.fn() }));

import { auth } from "@/src/auth";
import { getVersion, getVigente, seArmoEnElCotizador } from "@/src/lib/cotizaciones";
import { enviarARevision } from "@/src/lib/cotizaciones-flujos";
import { POST } from "@/app/api/erp/cotizaciones/[key]/revision/route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const USUARIA = {
  user: { email: "alguien@ejemplo.test", rol: "campo", permisos: ["modulo.cotizaciones"] },
};
const params = { key: "453-2026" };

const version = (n: number) => ({
  numero: 453, anio: 2026, version: n, folio: `PCOTOP-453-2026${n ? `-${n}` : ""}`,
  estatus: "PROCESO", cliente: "Cliente SA", titulo: "Pruebas",
});

const pedir = (cuerpo?: unknown) =>
  new NextRequest("http://localhost/api/erp/cotizaciones/453-2026/revision", {
    method: "POST",
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(USUARIA);
  vi.mocked(getVersion).mockResolvedValue(version(0) as never);
  vi.mocked(enviarARevision).mockResolvedValue({ cotizacion: version(0), avisos: [] } as never);
});

describe("POST [key]/revision — solo las importadas", () => {
  it("importada, sin armado: la manda, como siempre", async () => {
    vi.mocked(seArmoEnElCotizador).mockResolvedValue(false);

    const r = await POST(pedir({ version: 0, nota: "Va sin armado" }), { params });

    expect(r.status).toBe(200);
    expect(enviarARevision).toHaveBeenCalledWith(
      expect.objectContaining({ numero: 453, anio: 2026, version: 0, usuario: "alguien@ejemplo.test" }),
    );
  });

  it("armada en el cotizador: 409, dice por dónde, y no la mueve", async () => {
    vi.mocked(seArmoEnElCotizador).mockResolvedValue(true);

    const r = await POST(pedir({ version: 0 }), { params });

    expect(r.status).toBe(409);
    const { error } = await r.json();
    expect(error).toContain("La PCOTOP-453-2026 se armó en el cotizador");
    expect(error).toContain("«Vista previa»");
    expect(error).toContain("solo para las importadas");
    expect(enviarARevision).not.toHaveBeenCalled();
  });

  // Sin versión en el cuerpo se resuelve la vigente, y se revisa ESA: no la v0.
  it("sin versión en el cuerpo: revisa la vigente, que es la que se movería", async () => {
    vi.mocked(getVigente).mockResolvedValue(version(2) as never);
    vi.mocked(seArmoEnElCotizador).mockResolvedValue(true);

    const r = await POST(pedir(), { params });

    expect(r.status).toBe(409);
    expect(seArmoEnElCotizador).toHaveBeenCalledWith(expect.objectContaining({ numero: 453, anio: 2026, version: 2 }));
    expect((await r.json()).error).toContain("PCOTOP-453-2026-2");
    expect(enviarARevision).not.toHaveBeenCalled();
  });

  it("si no existe: 404, sin preguntar nada más", async () => {
    vi.mocked(getVersion).mockResolvedValue(null as never);

    expect((await POST(pedir({ version: 5 }), { params })).status).toBe(404);
    expect(seArmoEnElCotizador).not.toHaveBeenCalled();
    expect(enviarARevision).not.toHaveBeenCalled();
  });
});
