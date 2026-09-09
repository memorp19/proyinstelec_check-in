import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock googleapis before importing drive.ts
vi.mock("googleapis", () => {
  const mockFilesCreate = vi.fn();
  const mockFilesList = vi.fn();
  const mockDrive = { files: { create: mockFilesCreate, list: mockFilesList } };
  return {
    google: {
      auth: { JWT: vi.fn().mockImplementation(() => ({})) },
      drive: vi.fn().mockReturnValue(mockDrive),
    },
    __mocks: { mockFilesCreate, mockFilesList },
  };
});


import { google } from "googleapis";
import {
  getOrCreateFolder,
  getOrCreateFolderAlias,
  getOrCreateFolderPorPrefijo,
  buildFolderPath,
  uploadFile,
  getThumbnailUrl,
  _resetDriveConfigCache,
} from "@/src/lib/drive";

// Access mocks via the module mock
const getMocks = () => {
  const driveInstance = vi.mocked(google.drive)({ version: "v3" });
  return {
    filesCreate: driveInstance.files.create as ReturnType<typeof vi.fn>,
    filesList: driveInstance.files.list as ReturnType<typeof vi.fn>,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetDriveConfigCache();
  // Credenciales del service account por variables de entorno (antes venían de SSM)
  process.env.DRIVE_SERVICE_ACCOUNT_KEY = JSON.stringify({
    client_email: "drive@proyecto.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----\\n",
  });
  process.env.DRIVE_ROOT_FOLDER_ID = "root-folder-id";
});

describe("getThumbnailUrl", () => {
  it("returns a thumbnail URL with the file ID", () => {
    const url = getThumbnailUrl("abc123");
    expect(url).toContain("abc123");
    expect(url).toContain("drive.google.com/thumbnail");
  });

  it("uses 400px width by default", () => {
    expect(getThumbnailUrl("id1")).toContain("sz=w400");
  });

  it("accepts a custom width", () => {
    expect(getThumbnailUrl("id1", 800)).toContain("sz=w800");
  });
});

describe("getOrCreateFolder", () => {
  it("returns existing folder id when found", async () => {
    const { filesList } = getMocks();
    filesList.mockResolvedValue({ data: { files: [{ id: "existing-folder-id" }] } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const id = await getOrCreateFolder(drive, "Proyectos", "root-folder");
    expect(id).toBe("existing-folder-id");
    // Should NOT have called create
    expect(drive.files.create).not.toHaveBeenCalled();
  });

  it("creates and returns a new folder when not found", async () => {
    const { filesList, filesCreate } = getMocks();
    filesList.mockResolvedValue({ data: { files: [] } });
    filesCreate.mockResolvedValue({ data: { id: "new-folder-id" } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const id = await getOrCreateFolder(drive, "NuevaCarpeta", "root-folder");
    expect(id).toBe("new-folder-id");
    expect(filesCreate).toHaveBeenCalledOnce();
    const call = filesCreate.mock.calls[0][0];
    expect(call.requestBody.mimeType).toBe("application/vnd.google-apps.folder");
    expect(call.requestBody.name).toBe("NuevaCarpeta");
  });

  it("escapes single quotes in folder names to avoid query injection", async () => {
    const { filesList } = getMocks();
    filesList.mockResolvedValue({ data: { files: [{ id: "fid" }] } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    await getOrCreateFolder(drive, "O'Brien Project", "root");
    const query = filesList.mock.calls[0][0].q as string;
    expect(query).toContain("\\'");
  });
});

// Las carpetas del ERP viven en unidades compartidas. Sin estos parámetros la
// API finge que no existen: list omite su contenido y create responde 404 al
// padre, así que la integración entera falla sin dar una pista.
describe("unidades compartidas", () => {
  it("getOrCreateFolder los pasa al buscar y al crear", async () => {
    const { filesList, filesCreate } = getMocks();
    filesList.mockResolvedValue({ data: { files: [] } });
    filesCreate.mockResolvedValue({ data: { id: "nueva" } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    await getOrCreateFolder(drive, "Proyectos", "raiz");

    expect(filesList.mock.calls[0][0]).toMatchObject({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    expect(filesCreate.mock.calls[0][0]).toMatchObject({ supportsAllDrives: true });
    // includeItemsFromAllDrives solo existe en files.list
    expect(filesCreate.mock.calls[0][0]).not.toHaveProperty("includeItemsFromAllDrives");
  });

  it("uploadFile lo pasa al subir", async () => {
    const { filesCreate } = getMocks();
    filesCreate.mockResolvedValue({ data: { id: "f1", webViewLink: "http://x" } });

    await uploadFile({
      buffer: Buffer.from("x"),
      filename: "foto.jpg",
      mimeType: "image/jpeg",
      folderId: "carpeta",
    });

    expect(filesCreate.mock.calls[0][0]).toMatchObject({ supportsAllDrives: true });
  });
});

describe("getOrCreateFolderAlias", () => {
  it("consulta las dos escrituras en una sola query", async () => {
    const { filesList } = getMocks();
    filesList.mockResolvedValue({ data: { files: [{ id: "fid", name: "242-2026" }] } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    await getOrCreateFolderAlias(drive, ["242-2026", "242 - 2026"], "raiz");

    const query = filesList.mock.calls[0][0].q as string;
    expect(query).toContain("name='242-2026'");
    expect(query).toContain("name='242 - 2026'");
  });

  it("encuentra la carpeta histórica escrita con espacios", async () => {
    const { filesList, filesCreate } = getMocks();
    filesList.mockResolvedValue({ data: { files: [{ id: "vieja", name: "242 - 2026" }] } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const id = await getOrCreateFolderAlias(drive, ["242-2026", "242 - 2026"], "raiz");

    expect(id).toBe("vieja");
    // Lo que importa: NO crea una carpeta nueva junto a la que tiene los archivos
    expect(filesCreate).not.toHaveBeenCalled();
  });

  it("si existen las dos, gana el orden pedido (resultado estable)", async () => {
    const { filesList } = getMocks();
    filesList.mockResolvedValue({
      data: { files: [{ id: "con-espacios", name: "242 - 2026" }, { id: "pegada", name: "242-2026" }] },
    });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const id = await getOrCreateFolderAlias(drive, ["242-2026", "242 - 2026"], "raiz");

    expect(id).toBe("pegada");
  });

  it("al crear usa el primer nombre: el formato sin espacios", async () => {
    const { filesList, filesCreate } = getMocks();
    filesList.mockResolvedValue({ data: { files: [] } });
    filesCreate.mockResolvedValue({ data: { id: "nueva" } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const id = await getOrCreateFolderAlias(drive, ["242-2026", "242 - 2026"], "raiz");

    expect(id).toBe("nueva");
    expect(filesCreate.mock.calls[0][0].requestBody.name).toBe("242-2026");
  });
});

describe("getOrCreateFolderPorPrefijo", () => {
  it("encuentra la carpeta sin importar cómo esté escrito el cliente", async () => {
    const { filesList, filesCreate } = getMocks();
    filesList.mockResolvedValue({
      data: { files: [{ id: "ot-real", name: "OT450260 - IGSA S.A.P.I de C.V." }] },
    });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const id = await getOrCreateFolderPorPrefijo(
      drive,
      "OT450260",
      "OT450260 - Igsa",
      "carpeta-2026",
    );

    expect(id).toBe("ot-real");
    expect(filesCreate).not.toHaveBeenCalled();
  });

  it("exige que el prefijo esté al principio, no en medio", async () => {
    const { filesList, filesCreate } = getMocks();
    filesList.mockResolvedValue({
      data: { files: [{ id: "otra", name: "Respaldo OT450260 - viejo" }] },
    });
    filesCreate.mockResolvedValue({ data: { id: "nueva-ot" } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const id = await getOrCreateFolderPorPrefijo(
      drive,
      "OT450260",
      "OT450260 - IGSA",
      "carpeta-2026",
    );

    expect(id).toBe("nueva-ot");
  });

  it("crea con el nombre dado cuando no hay ninguna", async () => {
    const { filesList, filesCreate } = getMocks();
    filesList.mockResolvedValue({ data: { files: [] } });
    filesCreate.mockResolvedValue({ data: { id: "nueva-ot" } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    await getOrCreateFolderPorPrefijo(drive, "OT001260", "OT001260 - Aceros del Norte", "c2026");

    expect(filesCreate.mock.calls[0][0].requestBody.name).toBe("OT001260 - Aceros del Norte");
  });
});

describe("uploadFile", () => {
  it("returns driveFileId, webViewLink and SHA-256 hash", async () => {
    const { filesCreate } = getMocks();
    filesCreate.mockResolvedValue({
      data: {
        id: "uploaded-file-id",
        webViewLink: "https://drive.google.com/file/d/uploaded-file-id/view",
      },
    });

    const buffer = Buffer.from("fake-image-bytes");
    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const result = await uploadFile({
      buffer,
      filename: "checkin_0941.jpg",
      mimeType: "image/jpeg",
      folderId: "some-folder-id",
    });

    expect(result.driveFileId).toBe("uploaded-file-id");
    expect(result.webViewLink).toContain("drive.google.com");
    expect(result.hash).toHaveLength(64); // SHA-256 hex
  });

  it("computes a deterministic SHA-256 hash", async () => {
    const { filesCreate } = getMocks();
    filesCreate.mockResolvedValue({ data: { id: "f1", webViewLink: "https://x" } });

    const buffer = Buffer.from("test content");
    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const r1 = await uploadFile({ buffer, filename: "a.jpg", mimeType: "image/jpeg", folderId: "f" });
    const r2 = await uploadFile({ buffer, filename: "b.jpg", mimeType: "image/jpeg", folderId: "f" });

    expect(r1.hash).toBe(r2.hash);
  });

  it("generates a fallback webViewLink when API returns none", async () => {
    const { filesCreate } = getMocks();
    filesCreate.mockResolvedValue({ data: { id: "fallback-id", webViewLink: null } });

    const drive = vi.mocked(google.drive)({ version: "v3" }) as any;
    const result = await uploadFile({
      buffer: Buffer.from("x"),
      filename: "x.jpg",
      mimeType: "image/jpeg",
      folderId: "f",
    });

    expect(result.webViewLink).toContain("fallback-id");
  });
});
