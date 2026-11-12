/**
 * La ruta que genera el documento y el PDF.
 *
 * Lo que se prueba aquí no es cómo queda el documento —de eso se encargan las
 * pruebas de `docs/`, con la implementación falsa— sino lo que la ruta decide:
 * quién puede, en qué estatus, qué pasa sin configuración de Google y qué se
 * guarda al final.
 *
 * Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/cotizador-db", () => ({
  getArmado: vi.fn(),
  guardarIdsDeDocumento: vi.fn(),
}));
vi.mock("@/src/lib/clientes", () => ({ contactoParaCarta: vi.fn() }));
vi.mock("@/src/lib/drive-erp", () => ({
  ensureCarpetaCotizacion: vi.fn(),
  subirArchivoErp: vi.fn(),
}));
vi.mock("@/src/lib/cotizador/docs/generar", () => ({ generarDocumento: vi.fn() }));
vi.mock("@/src/lib/documentos-google", async () => {
  const real = await vi.importActual<typeof import("@/src/lib/documentos-google")>(
    "@/src/lib/documentos-google",
  );
  return {
    // El error de configuración es el de verdad: la ruta lo distingue por tipo.
    FaltaConfiguracionDeDocumentos: real.FaltaConfiguracionDeDocumentos,
    documentosDeGoogle: vi.fn(() => ({})),
    plantillaDeCotizacion: vi.fn(() => "plantilla-de-prueba"),
  };
});

import { auth } from "@/src/auth";
/** `auth()` está sobrecargada en Auth.js v5; el cast deja usarla como mock simple. */
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

import { getArmado, guardarIdsDeDocumento } from "@/src/lib/cotizador-db";
import { contactoParaCarta } from "@/src/lib/clientes";
import { ensureCarpetaCotizacion, subirArchivoErp } from "@/src/lib/drive-erp";
import { generarDocumento } from "@/src/lib/cotizador/docs/generar";
import { FaltaConfiguracionDeDocumentos, plantillaDeCotizacion } from "@/src/lib/documentos-google";
import { POST } from "@/app/api/erp/cotizaciones/[key]/documento/route";

const KEY = "450-2026";
const params = { key: KEY };

const DUEÑA = { user: { email: "ana@proyinstelec.mx", rol: "campo", permisos: ["modulo.cotizaciones"] } };
const OTRO = {
  user: {
    email: "otro@proyinstelec.mx",
    rol: "campo",
    permisos: ["modulo.cotizaciones"],
    iniciales: "OTRO",
  },
};
const GERENTE = {
  user: {
    email: "gerente@proyinstelec.mx",
    rol: "campo",
    permisos: ["modulo.cotizaciones", "cotizaciones.armar.todas"],
  },
};
const SIN_MODULO = { user: { email: "campo@proyinstelec.mx", rol: "campo", permisos: [] } };

const cotizacion = {
  numero: 450, anio: 2026, version: 0, folio: "PCOTOP-450-2026",
  cliente: "Cliente SA", titulo: "Pruebas", dirigida_a: "Quien sea",
  estatus: "PROCESO", elaboro: "EAOL", created_by: "ana@proyinstelec.mx",
};

const partida = {
  id: "P1", orden: 1, titulo: "Una", bloques: [], cantidad: 1, unidad: "servicio",
  ajuste: 0, precioUnitarioFinal: null, recibeGastosGenerales: true, gastoManual: null,
  formato: "NORMAL", notas: "", conceptos: [],
};

const completo = {
  cotizacion,
  armado: { numero: 450, anio: 2026, version: 0, condiciones: {}, documento: {}, partidas: [partida], gastos: [] },
  resultado: { total: 1000, moneda: "MXN", avisos: [], partidas: [] },
  desfases: [],
  avisos: [],
  docDriveId: "doc-viejo",
  pdfDriveId: "pdf-viejo",
  congelado: null,
  actualizadoEn: "2026-10-13T10:00:00.000Z",
};

const generado = {
  docId: "doc-nuevo",
  pdf: { nombre: "PCOTOP-450-2026 Pruebas.pdf", contenido: Buffer.from("pdf"), mimeType: "application/pdf" },
  nombre: "PCOTOP-450-2026 Pruebas",
  fecha: "2026-11-11",
  fechaEsNueva: true,
  avisos: ["Falta el lugar de entrega: sale como ⟨falta⟩ en el documento."],
  solicitudes: 144,
};

const pedir = (cuerpo: unknown = { version: 0 }) =>
  new NextRequest(`http://localhost/api/erp/cotizaciones/${KEY}/documento`, {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(DUEÑA);
  vi.mocked(getArmado).mockResolvedValue(completo as never);
  vi.mocked(contactoParaCarta).mockResolvedValue({ empresa: null, contacto: null } as never);
  vi.mocked(ensureCarpetaCotizacion).mockResolvedValue({
    folderId: "carpeta-450",
    folderUrl: "https://drive/carpeta-450",
  } as never);
  vi.mocked(generarDocumento).mockResolvedValue(generado as never);
  vi.mocked(subirArchivoErp).mockResolvedValue({
    driveFileId: "pdf-nuevo",
    webViewLink: "https://drive/pdf-nuevo",
  } as never);
  vi.mocked(guardarIdsDeDocumento).mockResolvedValue(undefined as never);
  vi.mocked(plantillaDeCotizacion).mockReturnValue("plantilla-de-prueba");
});

// ── Autorización ─────────────────────────────────────────────────────────────

describe("autorización", () => {
  it("sin sesión, 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST(pedir(), { params })).status).toBe(401);
  });

  it("sin el permiso del módulo, 403", async () => {
    mockAuth.mockResolvedValue(SIN_MODULO);
    expect((await POST(pedir(), { params })).status).toBe(403);
  });

  /**
   * Quien no la dio de alta no la genera. La pantalla ya esconde el botón;
   * esto es lo que de verdad protege, porque la ruta se puede llamar a mano.
   */
  it("quien no es el dueño, 403 y no toca Drive", async () => {
    mockAuth.mockResolvedValue(OTRO);
    const r = await POST(pedir(), { params });

    expect(r.status).toBe(403);
    expect(ensureCarpetaCotizacion).not.toHaveBeenCalled();
    expect(generarDocumento).not.toHaveBeenCalled();
  });

  it("el gerente de operaciones sí, aunque no sea suya", async () => {
    mockAuth.mockResolvedValue(GERENTE);
    expect((await POST(pedir(), { params })).status).toBe(200);
  });

  it("una llave que no es una llave, 400", async () => {
    expect((await POST(pedir(), { params: { key: "no-es-una-llave" } })).status).toBe(400);
  });

  it("una cotización que no existe, 404", async () => {
    vi.mocked(getArmado).mockResolvedValue(null as never);
    expect((await POST(pedir(), { params })).status).toBe(404);
  });
});

// ── Estatus y contenido ──────────────────────────────────────────────────────

describe("cuándo se puede generar", () => {
  /**
   * Una versión congelada tiene su documento —el que el cliente recibió— y
   * rehacerlo lo sustituiría por otro con precios que pudieron moverse.
   */
  it("una versión ya mandada a revisión, 403", async () => {
    vi.mocked(getArmado).mockResolvedValue({
      ...completo,
      cotizacion: { ...cotizacion, estatus: "REVISION" },
    } as never);

    const r = await POST(pedir(), { params });
    expect(r.status).toBe(403);
    expect(generarDocumento).not.toHaveBeenCalled();
  });

  it("sin partidas, 422 y lo dice", async () => {
    vi.mocked(getArmado).mockResolvedValue({
      ...completo,
      armado: { ...completo.armado, partidas: [] },
    } as never);

    const r = await POST(pedir(), { params });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("no tiene ninguna partida");
    expect(ensureCarpetaCotizacion).not.toHaveBeenCalled();
  });
});

// ── Sin configuración de Google ──────────────────────────────────────────────

describe("sin configuración de Google", () => {
  /**
   * 503 y no 500: no hay nada que reintentar, y quien lo vea en la pantalla
   * necesita saber qué configurar y no que "falló Google".
   */
  it("sin plantilla, 503 con el nombre de la variable", async () => {
    vi.mocked(plantillaDeCotizacion).mockImplementation(() => {
      throw new FaltaConfiguracionDeDocumentos(["ERP_PLANTILLA_DOC_COTIZACION_ID"]);
    });

    const r = await POST(pedir(), { params });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("ERP_PLANTILLA_DOC_COTIZACION_ID");
  });

  it("no crea la carpeta si no hay plantilla: dejaría basura en Drive", async () => {
    vi.mocked(plantillaDeCotizacion).mockImplementation(() => {
      throw new FaltaConfiguracionDeDocumentos(["ERP_PLANTILLA_DOC_COTIZACION_ID"]);
    });

    await POST(pedir(), { params });
    expect(ensureCarpetaCotizacion).not.toHaveBeenCalled();
  });

  it("sin credenciales, también 503 y con el nombre de la variable", async () => {
    vi.mocked(generarDocumento).mockRejectedValue(
      new Error("Falta DRIVE_SERVICE_ACCOUNT_KEY (ver docs/setup-google-drive.md)."),
    );

    const r = await POST(pedir(), { params });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("DRIVE_SERVICE_ACCOUNT_KEY");
  });

  it("un fallo de red de Google sigue siendo 500", async () => {
    vi.mocked(generarDocumento).mockRejectedValue(new Error("socket hang up"));
    expect((await POST(pedir(), { params })).status).toBe(500);
  });

  it("si falla, no se guarda ningún id", async () => {
    vi.mocked(generarDocumento).mockRejectedValue(new Error("socket hang up"));
    await POST(pedir(), { params });
    expect(guardarIdsDeDocumento).not.toHaveBeenCalled();
  });
});

// ── El camino feliz ──────────────────────────────────────────────────────────

describe("cuando sale bien", () => {
  it("devuelve con qué mirarlo y los avisos del documento", async () => {
    const r = await POST(pedir(), { params });
    const cuerpo = await r.json();

    expect(r.status).toBe(200);
    expect(cuerpo).toMatchObject({
      nombre: "PCOTOP-450-2026 Pruebas",
      docDriveId: "doc-nuevo",
      pdfDriveId: "pdf-nuevo",
      pdfUrl: "https://drive/pdf-nuevo",
      carpetaUrl: "https://drive/carpeta-450",
      fecha: "2026-11-11",
    });
    expect(cuerpo.avisos).toEqual(generado.avisos);
  });

  it("el PDF se sube a la carpeta de la cotización, con su nombre", async () => {
    await POST(pedir(), { params });
    expect(subirArchivoErp).toHaveBeenCalledWith({
      folderId: "carpeta-450",
      filename: "PCOTOP-450-2026 Pruebas.pdf",
      mimeType: "application/pdf",
      contenido: generado.pdf.contenido,
    });
  });

  /** Lo anterior se aparta **después** de tener lo nuevo, no antes. */
  it("le pasa los ids anteriores para que los mande a la papelera", async () => {
    await POST(pedir(), { params });
    const entorno = vi.mocked(generarDocumento).mock.calls[0][1];
    expect(entorno.anteriores).toEqual(["doc-viejo", "pdf-viejo"]);
  });

  it("guarda los dos ids nuevos", async () => {
    await POST(pedir(), { params });
    expect(guardarIdsDeDocumento).toHaveBeenCalledWith(
      expect.objectContaining({
        numero: 450, anio: 2026, version: 0,
        docDriveId: "doc-nuevo", pdfDriveId: "pdf-nuevo",
      }),
    );
  });

  /**
   * La fecha se guarda solo la primera vez. Si se reescribiera en cada
   * regeneración, una cotización rehecha una semana después cambiaría la que
   * el cliente ya tiene impresa.
   */
  it("guarda la fecha solo cuando el documento acaba de fijarla", async () => {
    await POST(pedir(), { params });
    expect(vi.mocked(guardarIdsDeDocumento).mock.calls[0][0].fecha).toBe("2026-11-11");

    vi.mocked(generarDocumento).mockResolvedValue({ ...generado, fechaEsNueva: false } as never);
    await POST(pedir(), { params });
    expect(vi.mocked(guardarIdsDeDocumento).mock.calls[1][0].fecha).toBeUndefined();
  });

  it("genera la versión que se le pida, no siempre la v0", async () => {
    await POST(pedir({ version: 2 }), { params });
    expect(getArmado).toHaveBeenCalledWith(450, 2026, 2);
  });

  it("sin cuerpo, la v0", async () => {
    const sinCuerpo = new NextRequest(`http://localhost/api/erp/cotizaciones/${KEY}/documento`, {
      method: "POST",
    });
    await POST(sinCuerpo, { params });
    expect(getArmado).toHaveBeenCalledWith(450, 2026, 0);
  });
});
