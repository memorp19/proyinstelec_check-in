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

vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      Parameter: {
        Value: JSON.stringify({
          client_email: "test@sa.iam.gserviceaccount.com",
          private_key: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
        }),
      },
    }),
  })),
  GetParameterCommand: vi.fn(),
}));

import { google } from "googleapis";
import {
  getOrCreateFolder,
  buildFolderPath,
  uploadFile,
  getThumbnailUrl,
  _resetDriveConfigCache,
} from "@/src/lib/drive";

// Access mocks via the module mock
const getMocks = () => {
  const driveInstance = vi.mocked(google.drive)();
  return {
    filesCreate: driveInstance.files.create as ReturnType<typeof vi.fn>,
    filesList: driveInstance.files.list as ReturnType<typeof vi.fn>,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetDriveConfigCache();
  process.env.DRIVE_ROOT_FOLDER_ID_PARAM = "/proyinstelec/drive/root-folder-id";
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

    const drive = vi.mocked(google.drive)() as any;
    const id = await getOrCreateFolder(drive, "Proyectos", "root-folder");
    expect(id).toBe("existing-folder-id");
    // Should NOT have called create
    expect(drive.files.create).not.toHaveBeenCalled();
  });

  it("creates and returns a new folder when not found", async () => {
    const { filesList, filesCreate } = getMocks();
    filesList.mockResolvedValue({ data: { files: [] } });
    filesCreate.mockResolvedValue({ data: { id: "new-folder-id" } });

    const drive = vi.mocked(google.drive)() as any;
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

    const drive = vi.mocked(google.drive)() as any;
    await getOrCreateFolder(drive, "O'Brien Project", "root");
    const query = filesList.mock.calls[0][0].q as string;
    expect(query).toContain("\\'");
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
    const drive = vi.mocked(google.drive)() as any;
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
    const drive = vi.mocked(google.drive)() as any;
    const r1 = await uploadFile({ buffer, filename: "a.jpg", mimeType: "image/jpeg", folderId: "f" });
    const r2 = await uploadFile({ buffer, filename: "b.jpg", mimeType: "image/jpeg", folderId: "f" });

    expect(r1.hash).toBe(r2.hash);
  });

  it("generates a fallback webViewLink when API returns none", async () => {
    const { filesCreate } = getMocks();
    filesCreate.mockResolvedValue({ data: { id: "fallback-id", webViewLink: null } });

    const drive = vi.mocked(google.drive)() as any;
    const result = await uploadFile({
      buffer: Buffer.from("x"),
      filename: "x.jpg",
      mimeType: "image/jpeg",
      folderId: "f",
    });

    expect(result.webViewLink).toContain("fallback-id");
  });
});
