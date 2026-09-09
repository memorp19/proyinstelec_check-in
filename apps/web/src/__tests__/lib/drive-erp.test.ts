import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: `vi.mock` se eleva sobre las declaraciones, así que las dobles
// tienen que crearse en el mismo salto para poder inspeccionarlas después.
const { getDriveClient, getOrCreateFolder, getOrCreateFolderAlias, getOrCreateFolderPorPrefijo } =
  vi.hoisted(() => ({
    getDriveClient: vi.fn(),
    getOrCreateFolder: vi.fn(),
    getOrCreateFolderAlias: vi.fn(),
    getOrCreateFolderPorPrefijo: vi.fn(),
  }));

vi.mock("@/src/lib/drive", () => ({
  getDriveClient,
  getOrCreateFolder,
  getOrCreateFolderAlias,
  getOrCreateFolderPorPrefijo,
  ESCRIBIR_TODAS_LAS_UNIDADES: { supportsAllDrives: true },
  LISTAR_TODAS_LAS_UNIDADES: { supportsAllDrives: true, includeItemsFromAllDrives: true },
}));

import {
  ensureCarpetaOT,
  ensureCarpetaCotizacion,
  nombresCarpetaCotizacion,
  buscarPdfCotizacion,
  copiarPlantillasCotizacion,
  _resetErpDriveConfigCache,
} from "@/src/lib/drive-erp";

beforeEach(() => {
  vi.clearAllMocks();
  _resetErpDriveConfigCache();
  process.env.ERP_COTIZACIONES_FOLDER_ID = "raiz-cotizaciones";
  getDriveClient.mockResolvedValue({});
});

describe("ensureCarpetaOT — raíz sin configurar", () => {
  it("avisa por el nombre de la variable en lugar de dejar que Drive falle con un padre vacío", async () => {
    delete process.env.ERP_OT_FOLDER_ID;

    await expect(
      ensureCarpetaOT({ folioOt: "OT001260", cliente: "Aceros del Norte", anio: 2026 }),
    ).rejects.toThrow("Falta ERP_OT_FOLDER_ID");

    // Nunca se intenta crear nada colgando de ""
    expect(getOrCreateFolder).not.toHaveBeenCalled();
  });

  it("trata la cadena vacía igual que la variable ausente", async () => {
    process.env.ERP_OT_FOLDER_ID = "";

    await expect(
      ensureCarpetaOT({ folioOt: "OT001260", cliente: "Aceros del Norte", anio: 2026 }),
    ).rejects.toThrow("Falta ERP_OT_FOLDER_ID");
  });
});

describe("ensureCarpetaOT — estructura de carpetas", () => {
  beforeEach(() => {
    process.env.ERP_OT_FOLDER_ID = "raiz-ot";
  });

  it("anida {raíz}/{año}/{folio - cliente}/OC como el legacy", async () => {
    getOrCreateFolder
      .mockResolvedValueOnce("carpeta-2026")
      .mockResolvedValueOnce("carpeta-oc");
    getOrCreateFolderPorPrefijo.mockResolvedValueOnce("carpeta-ot");

    const r = await ensureCarpetaOT({
      folioOt: "OT001260",
      cliente: "Aceros del Norte",
      anio: 2026,
    });

    // El año y la subcarpeta OC son nombres que controlamos: match exacto
    expect(getOrCreateFolder.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["2026", "raiz-ot"],
      ["OC", "carpeta-ot"],
    ]);
    expect(r).toEqual({
      folderId: "carpeta-ot",
      folderUrl: "https://drive.google.com/drive/folders/carpeta-ot",
      ocFolderId: "carpeta-oc",
    });
  });

  it("busca la carpeta de OT por folio y no fuerza mayúsculas en el cliente", async () => {
    getOrCreateFolder.mockResolvedValueOnce("carpeta-2026").mockResolvedValueOnce("carpeta-oc");
    getOrCreateFolderPorPrefijo.mockResolvedValueOnce("carpeta-ot");

    await ensureCarpetaOT({
      folioOt: "OT450260",
      cliente: "IGSA S.A.P.I de C.V.",
      anio: 2026,
    });

    const [, prefijo, nombreNuevo, padre] = getOrCreateFolderPorPrefijo.mock.calls[0];
    expect(prefijo).toBe("OT450260");
    // El cliente va tal cual: forzar mayúsculas creaba una tercera escritura
    expect(nombreNuevo).toBe("OT450260 - IGSA S.A.P.I de C.V.");
    expect(padre).toBe("carpeta-2026");
  });
});

describe("nombresCarpetaCotizacion", () => {
  it("ofrece las dos escrituras, la pegada primero (es la que se crea)", () => {
    expect(nombresCarpetaCotizacion(242, 2026)).toEqual(["242-2026", "242 - 2026"]);
  });

  it("rellena el número a 3 dígitos como el legacy", () => {
    expect(nombresCarpetaCotizacion(6, 2026)).toEqual(["006-2026", "006 - 2026"]);
  });
});

describe("ensureCarpetaCotizacion", () => {
  it("busca por alias para no duplicar la carpeta histórica", async () => {
    getOrCreateFolderAlias.mockResolvedValueOnce("carpeta-242");

    const r = await ensureCarpetaCotizacion(242, 2026);

    const [, nombres, padre] = getOrCreateFolderAlias.mock.calls[0];
    expect(nombres).toEqual(["242-2026", "242 - 2026"]);
    expect(padre).toBe("raiz-cotizaciones");
    expect(r).toEqual({
      folderId: "carpeta-242",
      folderUrl: "https://drive.google.com/drive/folders/carpeta-242",
    });
  });
});

describe("buscarPdfCotizacion — unidades compartidas", () => {
  it("pide a Drive que incluya el contenido de unidades compartidas", async () => {
    const list = vi.fn().mockResolvedValue({ data: { files: [] } });
    getDriveClient.mockResolvedValue({ files: { list } });

    await buscarPdfCotizacion({ folderId: "carpeta-242", folio: "PCOTOP-242-2026" });

    expect(list.mock.calls[0][0]).toMatchObject({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  });
});

// Sin plantillas la cotización nace con carpeta y sin nada que llenar; el fallo
// aparecía dos pasos después, al no encontrar un PDF que nadie pudo generar.
describe("copiarPlantillasCotizacion — plantillas sin configurar", () => {
  const params = { folderId: "carpeta-001", folio: "PCOTOP-001-2026", titulo: "Subestación" };

  it("falla nombrando las dos variables cuando no hay ninguna", async () => {
    delete process.env.ERP_PLANTILLA_DOC_ID;
    delete process.env.ERP_PLANTILLA_SHEET_ID;

    await expect(copiarPlantillasCotizacion(params)).rejects.toThrow(
      "ERP_PLANTILLA_DOC_ID y ERP_PLANTILLA_SHEET_ID",
    );
    // Nunca se pide el cliente de Drive si no hay nada que copiar
    expect(getDriveClient).not.toHaveBeenCalled();
  });

  it("falla si solo falta el Doc", async () => {
    delete process.env.ERP_PLANTILLA_DOC_ID;
    process.env.ERP_PLANTILLA_SHEET_ID = "sheet-base";

    await expect(copiarPlantillasCotizacion(params)).rejects.toThrow("ERP_PLANTILLA_DOC_ID");
  });

  it("falla si solo falta el Sheet", async () => {
    process.env.ERP_PLANTILLA_DOC_ID = "doc-base";
    delete process.env.ERP_PLANTILLA_SHEET_ID;

    await expect(copiarPlantillasCotizacion(params)).rejects.toThrow("ERP_PLANTILLA_SHEET_ID");
  });

  it("trata la cadena vacía igual que la variable ausente", async () => {
    process.env.ERP_PLANTILLA_DOC_ID = "";
    process.env.ERP_PLANTILLA_SHEET_ID = "";

    await expect(copiarPlantillasCotizacion(params)).rejects.toThrow("ERP_PLANTILLA_DOC_ID");
  });
});

describe("copiarPlantillasCotizacion — con plantillas configuradas", () => {
  it("copia Doc y Sheet a la carpeta con el nombre estándar del folio", async () => {
    process.env.ERP_PLANTILLA_DOC_ID = "doc-base";
    process.env.ERP_PLANTILLA_SHEET_ID = "sheet-base";
    const copy = vi.fn().mockResolvedValue({});
    getDriveClient.mockResolvedValue({ files: { copy } });

    await copiarPlantillasCotizacion({
      folderId: "carpeta-001",
      folio: "PCOTOP-001-2026",
      titulo: "Subestación",
    });

    // supportsAllDrives va también aquí: las plantillas viven en una unidad
    // compartida y sin el flag `copy` responde 404 al padre.
    expect(copy.mock.calls.map((c) => c[0])).toEqual([
      {
        fileId: "doc-base",
        requestBody: { name: "PCOTOP-001-2026 Subestación", parents: ["carpeta-001"] },
        supportsAllDrives: true,
      },
      {
        fileId: "sheet-base",
        requestBody: { name: "PCOTOP-001-2026 Subestación", parents: ["carpeta-001"] },
        supportsAllDrives: true,
      },
    ]);
  });
});
