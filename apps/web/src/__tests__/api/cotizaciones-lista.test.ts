/**
 * La lista de cotizaciones: cada tarjeta trae el enlace a su PDF definitivo,
 * que es lo primero que se busca después de mandarla a revisión.
 * Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/cotizaciones", () => ({
  ESTATUS_COTIZACION: ["PROCESO", "REVISION", "ENVIADA"],
  buscarCotizaciones: vi.fn(),
  pdfsDefinitivosDe: vi.fn(),
  siguienteNumeroCotizacion: vi.fn(),
  versionesDe: vi.fn(),
}));
vi.mock("@/src/lib/cotizaciones-flujos", () => ({ crearCotizacionCompleta: vi.fn() }));

import { auth } from "@/src/auth";
import { buscarCotizaciones, pdfsDefinitivosDe, versionesDe } from "@/src/lib/cotizaciones";
import { GET } from "@/app/api/erp/cotizaciones/route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const USUARIA = {
  user: { email: "alguien@ejemplo.test", rol: "campo", permisos: ["modulo.cotizaciones"] },
};

const enRevision = { numero: 453, anio: 2026, version: 0, folio: "PCOTOP-453-2026", estatus: "REVISION" };
const enProceso = { numero: 452, anio: 2026, version: 0, folio: "PCOTOP-452-2026", estatus: "PROCESO" };
// La carga de 2026 guardó algunos folios con "-v1": el enlace va por el folio
// canónico, no por lo que diga la columna.
const conFolioViejo = { numero: 450, anio: 2026, version: 1, folio: "PCOTOP-450-2026-v1", estatus: "ENVIADA" };

const pedir = () => new NextRequest("http://localhost/api/erp/cotizaciones?anio=2026");

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(USUARIA);
  vi.mocked(versionesDe).mockResolvedValue(new Map());
});

describe("GET /api/erp/cotizaciones — el PDF definitivo en la tarjeta", () => {
  it("cada una trae su enlace, o null si no tiene", async () => {
    vi.mocked(buscarCotizaciones).mockResolvedValue([enRevision, enProceso, conFolioViejo] as never);
    vi.mocked(pdfsDefinitivosDe).mockResolvedValue(
      new Map([
        ["PCOTOP-453-2026", "https://drive.google.com/file/d/pdf-453/view"],
        ["PCOTOP-450-2026-1", "https://drive.google.com/file/d/pdf-450/view"],
      ]),
    );

    const r = await GET(pedir());
    const { cotizaciones } = await r.json();

    expect(r.status).toBe(200);
    expect(cotizaciones.map((c: { pdf_definitivo_url: string | null }) => c.pdf_definitivo_url)).toEqual([
      "https://drive.google.com/file/d/pdf-453/view",
      null,
      "https://drive.google.com/file/d/pdf-450/view",
    ]);
    // Una consulta para toda la lista, no una por tarjeta.
    expect(pdfsDefinitivosDe).toHaveBeenCalledTimes(1);
    expect(pdfsDefinitivosDe).toHaveBeenCalledWith([enRevision, enProceso, conFolioViejo]);
  });
});
