/**
 * El PDF definitivo: sale de lo congelado —importes y foto—, nunca de lo
 * vivo. Lo que se prueba aquí es de dónde toma cada dato y qué guarda; cómo
 * queda el documento lo prueban las de `docs/`.
 *
 * Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/cotizador-db", () => ({
  getArmado: vi.fn(),
  leerCongelado: vi.fn(),
  guardarFoto: vi.fn(),
  guardarPdfDefinitivo: vi.fn(),
  tomarFoto: vi.fn(),
}));
vi.mock("@/src/lib/cotizador/docs/generar", () => ({ generarDocumento: vi.fn() }));
vi.mock("@/src/lib/documentos-google", () => ({
  documentosDeGoogle: vi.fn(() => ({})),
  plantillaDeCotizacion: vi.fn(() => "plantilla-de-prueba"),
}));
vi.mock("@/src/lib/drive-erp", () => ({
  ensureCarpetaCotizacion: vi.fn(),
  subirArchivoErp: vi.fn(),
}));

import {
  getArmado,
  guardarFoto,
  guardarPdfDefinitivo,
  leerCongelado,
  tomarFoto,
} from "@/src/lib/cotizador-db";
import { generarDocumento } from "@/src/lib/cotizador/docs/generar";
import { ensureCarpetaCotizacion, subirArchivoErp } from "@/src/lib/drive-erp";
import { documentoVacio } from "@/src/lib/cotizador";
import {
  generarPdfDefinitivo,
  puedeGenerarPdfDefinitivo,
  SinCongelar,
} from "@/src/lib/cotizador-pdf";

const V = { numero: 454, anio: 2026, version: 0 };

const partida = { id: "P1", orden: 1, titulo: "Una", conceptos: [] };

/** Lo vivo: el encabezado ya lo editó alguien después de congelar. */
const completo = {
  cotizacion: {
    numero: 454, anio: 2026, version: 0, folio: "PCOTOP-454-2026",
    cliente: "Cliente Renombrado", titulo: "Título editado", dirigida_a: "Otra Persona",
    estatus: "REVISION",
  },
  armado: {
    partidas: [partida],
    condiciones: { lugar: "la planta" },
    documento: { ...documentoVacio(), objeto: "lo vivo" },
  },
  // Lo recalculado hoy: no es lo que se congeló.
  resultado: { total: 999_999, moneda: "MXN" },
  docDriveId: "doc-borrador",
  pdfDriveId: "pdf-borrador",
};

const FOTO = {
  encabezado: { cliente: "Cliente Congelado", titulo: "Título congelado", dirigidaA: "Ing. Congelado" },
  documento: { ...documentoVacio(), objeto: "lo congelado", fecha: "" },
  direccionContacto: "Calle Congelada 1",
  direccionCliente: null,
};

const congelado = { resultado: { total: 1000, moneda: "MXN" }, letra: "MIL PESOS", foto: FOTO };

const generado = {
  docId: "doc-definitivo",
  pdf: { nombre: "PCOTOP-454-2026 Título congelado.pdf", contenido: Buffer.from("pdf"), mimeType: "application/pdf" },
  nombre: "PCOTOP-454-2026 Título congelado",
  fecha: "2026-11-23",
  fechaEsNueva: true,
  avisos: [],
  solicitudes: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getArmado).mockResolvedValue(completo as never);
  vi.mocked(leerCongelado).mockResolvedValue(congelado as never);
  vi.mocked(ensureCarpetaCotizacion).mockResolvedValue({ folderId: "carpeta", folderUrl: "url-carpeta" } as never);
  vi.mocked(generarDocumento).mockResolvedValue(generado as never);
  vi.mocked(subirArchivoErp).mockResolvedValue({
    driveFileId: "pdf-definitivo",
    webViewLink: "https://drive.google.com/file/d/pdf-definitivo/view",
  } as never);
});

describe("generarPdfDefinitivo", () => {
  it("imprime la foto y los importes congelados, no el encabezado vivo ni el recálculo", async () => {
    await generarPdfDefinitivo(V);

    const [datos] = vi.mocked(generarDocumento).mock.calls[0];
    expect(datos.cliente).toBe("Cliente Congelado");
    expect(datos.titulo).toBe("Título congelado");
    expect(datos.documento.objeto).toBe("lo congelado");
    expect(datos.direccionContacto).toBe("Calle Congelada 1");
    expect(datos.calculo).toEqual({ total: 1000, moneda: "MXN" });
  });

  // Si algo falla a medio camino, el documento que había sigue ahí.
  it("aparta el anterior (el borrador) después de tener el nuevo", async () => {
    await generarPdfDefinitivo(V);

    const [, entorno] = vi.mocked(generarDocumento).mock.calls[0];
    expect(entorno.anteriores).toEqual(["doc-borrador", "pdf-borrador"]);
  });

  it("lo guarda como el definitivo, con la fecha si el documento la acaba de fijar", async () => {
    const pdf = await generarPdfDefinitivo(V);

    expect(guardarPdfDefinitivo).toHaveBeenCalledWith({
      ...V, docDriveId: "doc-definitivo", pdfDriveId: "pdf-definitivo", fecha: "2026-11-23",
    });
    expect(pdf.pdfUrl).toBe("https://drive.google.com/file/d/pdf-definitivo/view");
  });

  // Regenerar con «Generar PDF» no mueve la fecha: ya la fijó el primero.
  it("si la fecha ya estaba fijada, no la vuelve a guardar", async () => {
    vi.mocked(generarDocumento).mockResolvedValue({ ...generado, fechaEsNueva: false } as never);

    await generarPdfDefinitivo(V);

    expect(vi.mocked(guardarPdfDefinitivo).mock.calls[0][0].fecha).toBeUndefined();
  });

  it("lo congelado antes de que existiera la foto: la toma ahora, la guarda y lo dice", async () => {
    vi.mocked(leerCongelado).mockResolvedValue({ ...congelado, foto: null } as never);
    vi.mocked(tomarFoto).mockResolvedValue(FOTO as never);
    vi.mocked(guardarFoto).mockResolvedValue(FOTO as never);

    const pdf = await generarPdfDefinitivo(V);

    expect(tomarFoto).toHaveBeenCalledWith(completo);
    expect(guardarFoto).toHaveBeenCalledWith({ ...V, foto: FOTO });
    expect(pdf.avisos[0]).toContain("se congeló antes de que existiera la foto");
  });

  it("con foto, no la vuelve a tomar", async () => {
    await generarPdfDefinitivo(V);
    expect(tomarFoto).not.toHaveBeenCalled();
    expect(guardarFoto).not.toHaveBeenCalled();
  });

  it("sin nada congelado no genera nada", async () => {
    vi.mocked(leerCongelado).mockResolvedValue(null);

    await expect(generarPdfDefinitivo(V)).rejects.toBeInstanceOf(SinCongelar);
    expect(generarDocumento).not.toHaveBeenCalled();
    expect(guardarPdfDefinitivo).not.toHaveBeenCalled();
  });

  it("si Google falla, no guarda nada", async () => {
    vi.mocked(generarDocumento).mockRejectedValue(new Error("Google contestó 500"));

    await expect(generarPdfDefinitivo(V)).rejects.toThrow("Google contestó 500");
    expect(guardarPdfDefinitivo).not.toHaveBeenCalled();
  });
});

describe("puedeGenerarPdfDefinitivo", () => {
  const enRevision = { estatus: "REVISION" as const, created_by: "duena@ejemplo.test", elaboro: "DUE" };
  const con = (...permisos: string[]) => ({ email: "alguien@ejemplo.test", rol: "campo", permisos });

  it.each([
    ["quien envía", con("modulo.cotizaciones", "cotizaciones.enviar")],
    ["quien revisa", con("modulo.cotizaciones", "cotizaciones.aprobar")],
    ["quien arma todas", con("modulo.cotizaciones", "cotizaciones.armar.todas")],
    ["quien la dio de alta", { email: "duena@ejemplo.test", rol: "campo", permisos: ["modulo.cotizaciones"] }],
  ])("en REVISION puede %s", (_quien, usuario) => {
    expect(puedeGenerarPdfDefinitivo(enRevision, usuario)).toEqual({ puede: true });
  });

  it("con solo el módulo, y ajena, no: 403", () => {
    const r = puedeGenerarPdfDefinitivo(enRevision, con("modulo.cotizaciones"));
    expect(r).toMatchObject({ puede: false, status: 403 });
  });

  // Ese PDF es el que tiene el cliente.
  it.each(["ENVIADA", "ASIGNADA", "NO ASIGNADA"] as const)("en %s nunca: 409", (estatus) => {
    const r = puedeGenerarPdfDefinitivo({ ...enRevision, estatus }, con("cotizaciones.enviar"));
    expect(r).toMatchObject({ puede: false, status: 409 });
    if (!r.puede) expect(r.motivo).toContain("no se regenera");
  });

  it("en PROCESO todavía no: se genera al mandarla a revisión", () => {
    const r = puedeGenerarPdfDefinitivo({ ...enRevision, estatus: "PROCESO" }, con("cotizaciones.enviar"));
    expect(r).toMatchObject({ puede: false, status: 409 });
    if (!r.puede) expect(r.motivo).toContain("Ver cotización");
  });
});
