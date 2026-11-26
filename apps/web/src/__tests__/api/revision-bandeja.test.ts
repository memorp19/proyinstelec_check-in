/**
 * La bandeja de revisión: cada cotización trae su PDF definitivo —lo que se
 * aprueba— y el aviso si el encabezado cambió después de congelarse.
 * Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/cotizaciones", () => ({
  buscarCotizaciones: vi.fn(),
  pdfDeLaVersion: vi.fn(),
}));

import { auth } from "@/src/auth";
import { buscarCotizaciones, pdfDeLaVersion } from "@/src/lib/cotizaciones";
import { documentoVacio } from "@/src/lib/cotizador";
import { GET } from "@/app/api/erp/revision/route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const REVISORA = {
  user: { email: "revisora@ejemplo.test", rol: "campo", permisos: ["cotizaciones.aprobar"] },
};

const cot = {
  numero: 454, anio: 2026, version: 0, folio: "PCOTOP-454-2026", estatus: "REVISION",
  cliente: "Cliente SA", titulo: "Título editado", dirigida_a: "Ing. Ruiz", aprobada: false,
};
const FOTO = {
  encabezado: { cliente: "Cliente SA", titulo: "Título congelado", dirigidaA: "Ing. Ruiz" },
  documento: documentoVacio(),
  direccionContacto: null,
  direccionCliente: null,
};

const pedir = () => new NextRequest("http://localhost/api/erp/revision?anio=2026");

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(REVISORA);
  vi.mocked(buscarCotizaciones).mockResolvedValue([cot] as never);
});

describe("GET /api/erp/revision", () => {
  it("trae el PDF definitivo y el aviso si el encabezado cambió", async () => {
    vi.mocked(pdfDeLaVersion).mockResolvedValue({ delCotizador: true, pdfDriveId: "pdf-definitivo", foto: FOTO });

    const [c] = (await (await GET(pedir())).json()).cotizaciones;

    expect(c.pdf_del_cotizador).toBe(true);
    expect(c.pdf_drive_id).toBe("pdf-definitivo");
    expect(c.aviso_pdf).toBeNull();
    expect(c.aviso_encabezado).toContain("el título ahora dice «Título editado» y el PDF lleva «Título congelado»");
  });

  // La 454: llegó a revisión sin PDF.
  it("armada y sin PDF definitivo: el aviso de generarlo", async () => {
    vi.mocked(pdfDeLaVersion).mockResolvedValue({ delCotizador: true, pdfDriveId: null, foto: FOTO });

    const [c] = (await (await GET(pedir())).json()).cotizaciones;

    expect(c.pdf_drive_id).toBeNull();
    expect(c.aviso_pdf).toContain("«Generar PDF»");
  });

  it("importada: sin aviso de PDF ni de encabezado, como antes", async () => {
    vi.mocked(pdfDeLaVersion).mockResolvedValue({ delCotizador: false, pdfDriveId: null, foto: null });

    const [c] = (await (await GET(pedir())).json()).cotizaciones;

    expect(c.pdf_del_cotizador).toBe(false);
    expect(c.aviso_pdf).toBeNull();
    expect(c.aviso_encabezado).toBeNull();
  });

  it("sin el permiso de revisar: 403, sin consultar nada", async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: "x@ejemplo.test", rol: "campo", permisos: [] } });

    expect((await GET(pedir())).status).toBe(403);
    expect(buscarCotizaciones).not.toHaveBeenCalled();
  });
});
