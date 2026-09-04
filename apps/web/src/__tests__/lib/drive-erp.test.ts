import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: `vi.mock` se eleva sobre las declaraciones, así que las dobles
// tienen que crearse en el mismo salto para poder inspeccionarlas después.
const { getDriveClient, getOrCreateFolder } = vi.hoisted(() => ({
  getDriveClient: vi.fn(),
  getOrCreateFolder: vi.fn(),
}));

vi.mock("@/src/lib/drive", () => ({ getDriveClient, getOrCreateFolder }));

import { ensureCarpetaOT, _resetErpDriveConfigCache } from "@/src/lib/drive-erp";

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
