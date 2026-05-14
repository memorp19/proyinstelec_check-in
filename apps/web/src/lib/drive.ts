import { google, type drive_v3 } from "googleapis";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { createHash } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadResult {
  driveFileId: string;
  webViewLink: string;
  hash: string; // SHA-256 hex of the original buffer
}

// ── SSM config ────────────────────────────────────────────────────────────────

interface DriveConfig {
  serviceAccountEmail: string;
  privateKey: string;
  rootFolderId: string;
}

let _cachedConfig: DriveConfig | null = null;

async function getDriveConfig(): Promise<DriveConfig> {
  if (_cachedConfig) return _cachedConfig;

  // Local dev shortcut — set DRIVE_SERVICE_ACCOUNT_KEY (JSON) and DRIVE_ROOT_FOLDER_ID in .env.local
  // to bypass SSM entirely.
  if (process.env.DRIVE_SERVICE_ACCOUNT_KEY && process.env.DRIVE_ROOT_FOLDER_ID) {
    let parsed: { client_email: string; private_key: string };
    try {
      parsed = JSON.parse(process.env.DRIVE_SERVICE_ACCOUNT_KEY);
    } catch {
      throw new Error("DRIVE_SERVICE_ACCOUNT_KEY env var is not valid JSON");
    }
    _cachedConfig = {
      serviceAccountEmail: parsed.client_email,
      privateKey: parsed.private_key,
      rootFolderId: process.env.DRIVE_ROOT_FOLDER_ID,
    };
    return _cachedConfig;
  }

  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const get = async (name: string) => {
    const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    return r.Parameter?.Value ?? "";
  };

  const keyJson = await get(
    process.env.DRIVE_SERVICE_ACCOUNT_KEY_PARAM ?? "/proyinstelec/drive/service-account-key",
  );

  let parsed: { client_email: string; private_key: string };
  try {
    parsed = JSON.parse(keyJson);
  } catch {
    throw new Error("DRIVE_SERVICE_ACCOUNT_KEY is not valid JSON");
  }

  _cachedConfig = {
    serviceAccountEmail: parsed.client_email,
    privateKey: parsed.private_key,
    rootFolderId: await get(
      process.env.DRIVE_ROOT_FOLDER_ID_PARAM ?? "/proyinstelec/drive/root-folder-id",
    ),
  };

  return _cachedConfig;
}

export function _resetDriveConfigCache() {
  _cachedConfig = null;
}

// ── Drive client ──────────────────────────────────────────────────────────────

async function getDriveClient(): Promise<drive_v3.Drive> {
  const config = await getDriveConfig();

  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

// ── Folder management ─────────────────────────────────────────────────────────

/**
 * Finds a folder by name inside parentId; creates it if it doesn't exist.
 * Idempotent — safe to call on every upload.
 */
export async function getOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<string> {
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1,
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  return created.data.id!;
}

/**
 * Builds (and guarantees existence of) the canonical folder path for a photo:
 * {root} / Proyectos / {proyectoNombre} / {YYYY-MM-DD} / {trabajadorNombre}
 *
 * Returns the leaf folder ID.
 */
export async function buildFolderPath(params: {
  drive: drive_v3.Drive;
  rootFolderId: string;
  proyectoNombre: string;
  fecha: string;       // YYYY-MM-DD
  trabajadorNombre: string;
}): Promise<string> {
  const { drive, rootFolderId, proyectoNombre, fecha, trabajadorNombre } = params;

  const proyectosFolder = await getOrCreateFolder(drive, "Proyectos", rootFolderId);
  const proyectoFolder = await getOrCreateFolder(drive, proyectoNombre, proyectosFolder);
  const fechaFolder = await getOrCreateFolder(drive, fecha, proyectoFolder);
  const trabajadorFolder = await getOrCreateFolder(drive, trabajadorNombre, fechaFolder);

  return trabajadorFolder;
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadFile(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  folderId: string;
}): Promise<UploadResult> {
  const { buffer, filename, mimeType, folderId } = params;

  const hash = createHash("sha256").update(buffer).digest("hex");
  const drive = await getDriveClient();

  const { Readable } = await import("stream");
  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: { mimeType, body: stream },
    fields: "id, webViewLink",
  });

  const driveFileId = res.data.id!;
  const webViewLink = res.data.webViewLink ?? `https://drive.google.com/file/d/${driveFileId}/view`;

  return { driveFileId, webViewLink, hash };
}

// ── Thumbnail URL ─────────────────────────────────────────────────────────────

/**
 * Returns a thumbnail URL usable by authenticated Workspace accounts.
 * sz=w400 gives a 400px-wide thumbnail — suitable for mobile previews.
 */
export function getThumbnailUrl(driveFileId: string, width = 400): string {
  return `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w${width}`;
}

// ── High-level upload helper (used by the API route) ─────────────────────────

export async function uploadPhoto(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  proyectoNombre: string;
  fecha: string;       // YYYY-MM-DD  (America/Mexico_City local date)
  trabajadorNombre: string;
}): Promise<UploadResult> {
  const config = await getDriveConfig();
  const drive = await getDriveClient();

  const folderId = await buildFolderPath({
    drive,
    rootFolderId: config.rootFolderId,
    proyectoNombre: params.proyectoNombre,
    fecha: params.fecha,
    trabajadorNombre: params.trabajadorNombre,
  });

  return uploadFile({
    buffer: params.buffer,
    filename: params.filename,
    mimeType: params.mimeType,
    folderId,
  });
}
