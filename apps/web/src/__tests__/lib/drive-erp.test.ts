import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: `vi.mock` se eleva sobre las declaraciones, así que las dobles
// tienen que crearse en el mismo salto para poder inspeccionarlas después.
const {
  getDriveClient,
  getOrCreateFolder,
  getOrCreateFolderAlias,
  getOrCreateFolderPorPrefijo,
  buscarCarpetaAlias,
} = vi.hoisted(() => ({
  getDriveClient: vi.fn(),
  getOrCreateFolder: vi.fn(),
  getOrCreateFolderAlias: vi.fn(),
  getOrCreateFolderPorPrefijo: vi.fn(),
  buscarCarpetaAlias: vi.fn(),
}));

// Se doblan solo las funciones; las constantes salen del módulo real. Si se
// redefinieran aquí, el test afirmaría lo que él mismo escribió: quitar
// includeItemsFromAllDrives de la implementación dejaría los tests en verde.
vi.mock("@/src/lib/drive", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/drive")>()),
  getDriveClient,
  getOrCreateFolder,
  getOrCreateFolderAlias,
  getOrCreateFolderPorPrefijo,
  buscarCarpetaAlias,
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
  it("la encuentra en {raíz}/{año}/{NNN-AAAA} y no crea nada", async () => {
    getOrCreateFolder.mockResolvedValueOnce("carpeta-2026");
    buscarCarpetaAlias.mockResolvedValueOnce("carpeta-242");

    const r = await ensureCarpetaCotizacion(242, 2026);

    // El año se resuelve bajo la raíz, con match exacto
    expect(getOrCreateFolder.mock.calls[0].slice(1)).toEqual(["2026", "raiz-cotizaciones"]);
    // Y la carpeta de la cotización se busca DENTRO del año
    const [, nombres, padre] = buscarCarpetaAlias.mock.calls[0];
    expect(nombres).toEqual(["242-2026", "242 - 2026"]);
    expect(padre).toBe("carpeta-2026");
    expect(getOrCreateFolderAlias).not.toHaveBeenCalled();
    expect(r).toEqual({
      folderId: "carpeta-242",
      folderUrl: "https://drive.google.com/drive/folders/carpeta-242",
    });
  });

  it("una cotización de un año anterior busca en la carpeta de SU año", async () => {
    getOrCreateFolder.mockResolvedValueOnce("carpeta-2025");
    buscarCarpetaAlias.mockResolvedValueOnce("carpeta-137-2025");

    await ensureCarpetaCotizacion(137, 2025);

    expect(getOrCreateFolder.mock.calls[0].slice(1)).toEqual(["2025", "raiz-cotizaciones"]);
    expect(buscarCarpetaAlias.mock.calls[0][2]).toBe("carpeta-2025");
  });

  // Las importadas tienen drive_folder_id en NULL, así que al versionarlas la
  // carpeta se resuelve desde cero. Si su carpeta histórica cuelga directo de
  // la raíz, hay que reutilizarla: crear una vacía al lado dejaría el PDF
  // fuera de vista y el envío al cliente fallaría por PDF ausente.
  describe("fallback a la raíz", () => {
    it("reutiliza la carpeta histórica que cuelga de la raíz", async () => {
      getOrCreateFolder.mockResolvedValueOnce("carpeta-2026");
      buscarCarpetaAlias
        .mockResolvedValueOnce(null) // no está en el nivel del año
        .mockResolvedValueOnce("carpeta-historica"); // sí en la raíz

      const r = await ensureCarpetaCotizacion(242, 2026);

      expect(buscarCarpetaAlias.mock.calls[1][2]).toBe("raiz-cotizaciones");
      expect(r.folderId).toBe("carpeta-historica");
      // Lo que importa: NO se crea una carpeta nueva al lado de la que tiene los PDFs
      expect(getOrCreateFolderAlias).not.toHaveBeenCalled();
    });

    it("si no está en ningún nivel, la crea dentro del año", async () => {
      getOrCreateFolder.mockResolvedValueOnce("carpeta-2026");
      buscarCarpetaAlias.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      getOrCreateFolderAlias.mockResolvedValueOnce("carpeta-nueva");

      const r = await ensureCarpetaCotizacion(242, 2026);

      const [, nombres, padre] = getOrCreateFolderAlias.mock.calls[0];
      expect(nombres).toEqual(["242-2026", "242 - 2026"]);
      // Se crea en el nivel del año, nunca en la raíz
      expect(padre).toBe("carpeta-2026");
      expect(r.folderId).toBe("carpeta-nueva");
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

// El folio de la v0 es prefijo del de todas sus versiones: "PCOTOP-002-2026"
// empieza igual que "PCOTOP-002-2026-1". Y la carpeta la comparten todas, así
// que el caso es el normal. Lo que se adjunta va al correo del cliente.
describe("buscarPdfCotizacion — no confundir versiones", () => {
  /** Devuelve el PDF elegido, o null, con la carpeta llena de estos nombres. */
  async function elegir(folio: string, nombres: string[]) {
    const list = vi.fn().mockResolvedValue({
      data: { files: nombres.map((name, i) => ({ id: `f${i}`, name })) },
    });
    const get = vi.fn().mockResolvedValue({ data: new ArrayBuffer(8) });
    getDriveClient.mockResolvedValue({ files: { list, get } });

    const r = await buscarPdfCotizacion({ folderId: "carpeta-002", folio });
    return r.pdf?.filename ?? null;
  }

  const CARPETA = [
    "PCOTOP-002-2026 Subestación.pdf",
    "PCOTOP-002-2026-1 Subestación rev.pdf",
    "PCOTOP-002-2026-2 Subestación rev2.pdf",
  ];

  it("la v0 devuelve su PDF, no el de la v1 ni el de la v2", async () => {
    expect(await elegir("PCOTOP-002-2026", CARPETA)).toBe("PCOTOP-002-2026 Subestación.pdf");
  });

  it("la v1 devuelve el suyo, no el de la v0", async () => {
    expect(await elegir("PCOTOP-002-2026-1", CARPETA)).toBe(
      "PCOTOP-002-2026-1 Subestación rev.pdf",
    );
  });

  it("la v2 devuelve el suyo", async () => {
    expect(await elegir("PCOTOP-002-2026-2", CARPETA)).toBe(
      "PCOTOP-002-2026-2 Subestación rev2.pdf",
    );
  });

  // Antes, con el folio como prefijo a secas, este caso devolvía el PDF de la
  // v1 para la v0: el orden de Drive decidía qué se le mandaba al cliente.
  it("la v0 no se queda con el PDF de la v1 aunque venga primero", async () => {
    const alReves = [
      "PCOTOP-002-2026-1 Subestación rev.pdf",
      "PCOTOP-002-2026 Subestación.pdf",
    ];
    expect(await elegir("PCOTOP-002-2026", alReves)).toBe("PCOTOP-002-2026 Subestación.pdf");
  });

  it("acepta el PDF nombrado solo con el folio, sin título", async () => {
    expect(await elegir("PCOTOP-002-2026", ["PCOTOP-002-2026.pdf"])).toBe("PCOTOP-002-2026.pdf");
  });

  // Igualdad exacta, no prefijo: si valiera como prefijo volvería la ambigüedad.
  it("el PDF de la v1 sin título no sirve para la v0", async () => {
    expect(await elegir("PCOTOP-002-2026", ["PCOTOP-002-2026-1.pdf"])).toBeNull();
  });

  // El comodín "si solo hay un PDF, ese" se quitó: con una carpeta compartida
  // podía adjuntarle al cliente el PDF de otra versión.
  it("un único PDF que no es el suyo ya no se devuelve", async () => {
    expect(await elegir("PCOTOP-002-2026-1", ["PCOTOP-002-2026 Subestación.pdf"])).toBeNull();
  });

  it("no distingue mayúsculas", async () => {
    expect(await elegir("pcotop-002-2026", ["PCOTOP-002-2026 Subestación.pdf"])).toBe(
      "PCOTOP-002-2026 Subestación.pdf",
    );
  });

  it("carpeta vacía devuelve null", async () => {
    expect(await elegir("PCOTOP-002-2026", [])).toBeNull();
  });

  // La regla exige `<folio> ` con espacio exacto y los PDF los nombra el equipo
  // a mano. Sin saber qué había en la carpeta, un no-match es indiagnosticable.
  describe("qué había en la carpeta", () => {
    async function buscar(folio: string, nombres: string[]) {
      const list = vi.fn().mockResolvedValue({
        data: { files: nombres.map((name, i) => ({ id: `f${i}`, name })) },
      });
      const get = vi.fn().mockResolvedValue({ data: new ArrayBuffer(8) });
      getDriveClient.mockResolvedValue({ files: { list, get } });
      return buscarPdfCotizacion({ folderId: "carpeta-002", folio });
    }

    it("sin match devuelve los nombres que sí estaban", async () => {
      const r = await buscar("PCOTOP-002-2026", [
        "PCOTOP-002-2026_Subestación.pdf",
        "Cotización PCOTOP-002-2026.pdf",
      ]);

      expect(r.pdf).toBeNull();
      expect(r.nombresEnCarpeta).toEqual([
        "PCOTOP-002-2026_Subestación.pdf",
        "Cotización PCOTOP-002-2026.pdf",
      ]);
    });

    it("con match también los devuelve", async () => {
      const r = await buscar("PCOTOP-002-2026", ["PCOTOP-002-2026 Subestación.pdf"]);

      expect(r.pdf?.filename).toBe("PCOTOP-002-2026 Subestación.pdf");
      expect(r.nombresEnCarpeta).toEqual(["PCOTOP-002-2026 Subestación.pdf"]);
    });

    it("la carpeta vacía se distingue de la que tiene PDF ajenos", async () => {
      expect((await buscar("PCOTOP-002-2026", [])).nombresEnCarpeta).toEqual([]);
    });
  });
});
