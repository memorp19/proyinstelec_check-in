import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: `vi.mock` se eleva sobre las declaraciones, así que las dobles
// tienen que crearse en el mismo salto para poder inspeccionarlas después.
const { getDriveClient, getOrCreateFolder } = vi.hoisted(() => ({
  getDriveClient: vi.fn(),
  getOrCreateFolder: vi.fn(),
}));

vi.mock("@/src/lib/drive", () => ({ getDriveClient, getOrCreateFolder }));

import {
  ensureCarpetaOT,
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

  it("anida {raíz}/{año}/{folio - CLIENTE}/OC como el legacy", async () => {
    getOrCreateFolder
      .mockResolvedValueOnce("carpeta-2026")
      .mockResolvedValueOnce("carpeta-ot")
      .mockResolvedValueOnce("carpeta-oc");

    const r = await ensureCarpetaOT({
      folioOt: "OT001260",
      cliente: "Aceros del Norte",
      anio: 2026,
    });

    expect(getOrCreateFolder.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["2026", "raiz-ot"],
      ["OT001260 - ACEROS DEL NORTE", "carpeta-2026"],
      ["OC", "carpeta-ot"],
    ]);
    expect(r).toEqual({
      folderId: "carpeta-ot",
      folderUrl: "https://drive.google.com/drive/folders/carpeta-ot",
      ocFolderId: "carpeta-oc",
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

    expect(copy.mock.calls.map((c) => c[0])).toEqual([
      {
        fileId: "doc-base",
        requestBody: { name: "PCOTOP-001-2026 Subestación", parents: ["carpeta-001"] },
      },
      {
        fileId: "sheet-base",
        requestBody: { name: "PCOTOP-001-2026 Subestación", parents: ["carpeta-001"] },
      },
    ]);
  });
});
