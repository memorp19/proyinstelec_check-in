/**
 * «Generar PDF»: la ruta del PDF definitivo de una versión en REVISION.
 *
 * Lo que se prueba es lo que la ruta decide —quién, en qué estatus y qué
 * contesta si algo falla—; de dónde sale cada dato lo prueba
 * `lib/cotizador-pdf.test.ts`. Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/cotizaciones", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/cotizaciones")>()),
  getVersion: vi.fn(),
}));
// Quién puede y la clase de error son los de verdad: es lo que la ruta decide.
vi.mock("@/src/lib/cotizador-pdf", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/cotizador-pdf")>()),
  generarPdfDefinitivo: vi.fn(),
}));

import { auth } from "@/src/auth";
import { getVersion } from "@/src/lib/cotizaciones";
import { generarPdfDefinitivo, SinCongelar } from "@/src/lib/cotizador-pdf";
import { FaltaConfiguracionDeDocumentos } from "@/src/lib/documentos-google";
import { POST } from "@/app/api/erp/cotizaciones/[key]/documento/definitivo/route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const params = { key: "454-2026" };

const QUIEN_ENVIA = {
  user: { email: "alguien@ejemplo.test", rol: "campo", permisos: ["modulo.cotizaciones", "cotizaciones.enviar"] },
};
const SOLO_MODULO = {
  user: { email: "otra@ejemplo.test", rol: "campo", permisos: ["modulo.cotizaciones"] },
};

const enRevision = {
  numero: 454, anio: 2026, version: 0, folio: "PCOTOP-454-2026",
  estatus: "REVISION", created_by: "duena@ejemplo.test", elaboro: "DUE",
};

const pedir = (cuerpo: unknown = { version: 0 }) =>
  new NextRequest("http://localhost/api/erp/cotizaciones/454-2026/documento/definitivo", {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(QUIEN_ENVIA);
  vi.mocked(getVersion).mockResolvedValue(enRevision as never);
  vi.mocked(generarPdfDefinitivo).mockResolvedValue({
    nombre: "PCOTOP-454-2026 Pruebas",
    pdfDriveId: "pdf-definitivo",
    pdfUrl: "https://drive.google.com/file/d/pdf-definitivo/view",
    fecha: "2026-11-23",
    avisos: [],
  });
});

describe("POST /documento/definitivo", () => {
  it("en REVISION lo genera y devuelve el enlace", async () => {
    const r = await POST(pedir(), { params });

    expect(r.status).toBe(200);
    expect((await r.json()).pdfUrl).toBe("https://drive.google.com/file/d/pdf-definitivo/view");
    expect(generarPdfDefinitivo).toHaveBeenCalledWith({ numero: 454, anio: 2026, version: 0 });
  });

  it("genera la versión que se le pide", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...enRevision, version: 2 } as never);

    await POST(pedir({ version: 2 }), { params });

    expect(getVersion).toHaveBeenCalledWith(454, 2026, 2);
    expect(generarPdfDefinitivo).toHaveBeenCalledWith({ numero: 454, anio: 2026, version: 2 });
  });

  // Ese PDF es el que tiene el cliente.
  it("ya enviada, nunca: 409 y no toca nada", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...enRevision, estatus: "ENVIADA" } as never);

    const r = await POST(pedir(), { params });

    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("no se regenera");
    expect(generarPdfDefinitivo).not.toHaveBeenCalled();
  });

  it("con solo el módulo y ajena: 403", async () => {
    mockAuth.mockResolvedValueOnce(SOLO_MODULO);

    expect((await POST(pedir(), { params })).status).toBe(403);
    expect(generarPdfDefinitivo).not.toHaveBeenCalled();
  });

  it("sin sesión: 401", async () => {
    mockAuth.mockResolvedValueOnce(null);

    expect((await POST(pedir(), { params })).status).toBe(401);
    expect(getVersion).not.toHaveBeenCalled();
  });

  it("una versión que no existe: 404", async () => {
    vi.mocked(getVersion).mockResolvedValue(null);
    expect((await POST(pedir(), { params })).status).toBe(404);
  });

  it("una importada, sin nada congelado: 409 con el porqué", async () => {
    vi.mocked(generarPdfDefinitivo).mockRejectedValue(new SinCongelar("Esta versión no tiene nada congelado"));

    const r = await POST(pedir(), { params });

    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("no tiene nada congelado");
  });

  it("sin la configuración de Google: 503", async () => {
    vi.mocked(generarPdfDefinitivo).mockRejectedValue(
      new FaltaConfiguracionDeDocumentos(["ERP_PLANTILLA_DOC_COTIZACION_ID"]),
    );
    expect((await POST(pedir(), { params })).status).toBe(503);
  });

  it("si Google falla: 502, y lo dice", async () => {
    vi.mocked(generarPdfDefinitivo).mockRejectedValue(new Error("Google contestó 500"));
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await POST(pedir(), { params });

    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("No se pudo generar el PDF: Google contestó 500");
    consola.mockRestore();
  });
});
