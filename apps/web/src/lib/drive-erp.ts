import type { drive_v3 } from "googleapis";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { getDriveClient, getOrCreateFolder } from "./drive";
import { pad } from "./folios";

// ── Config (carpetas raíz y plantillas del ERP) ───────────────────────────────

interface ErpDriveConfig {
  cotizacionesRootId: string; // carpeta raíz de cotizaciones (subcarpetas "NNN - AAAA")
  otRootId: string; // carpeta raíz de OT por año
  plantillaDocId: string; // Google Doc base de cotización
  plantillaSheetId: string; // Google Sheet base de cotización
}

let _cachedConfig: ErpDriveConfig | null = null;

async function getErpDriveConfig(): Promise<ErpDriveConfig> {
  if (_cachedConfig) return _cachedConfig;

  // Local dev: variables de entorno directas
  if (process.env.ERP_COTIZACIONES_FOLDER_ID) {
    _cachedConfig = {
      cotizacionesRootId: process.env.ERP_COTIZACIONES_FOLDER_ID,
      otRootId: process.env.ERP_OT_FOLDER_ID ?? "",
      plantillaDocId: process.env.ERP_PLANTILLA_DOC_ID ?? "",
      plantillaSheetId: process.env.ERP_PLANTILLA_SHEET_ID ?? "",
    };
    return _cachedConfig;
  }

  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const get = async (name: string) => {
    const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    return r.Parameter?.Value ?? "";
  };

  _cachedConfig = {
    cotizacionesRootId: await get("/proyinstelec/erp/cotizaciones-folder-id"),
    otRootId: await get("/proyinstelec/erp/ot-folder-id"),
    plantillaDocId: await get("/proyinstelec/erp/plantilla-doc-id"),
    plantillaSheetId: await get("/proyinstelec/erp/plantilla-sheet-id"),
  };
  return _cachedConfig;
}

export function _resetErpDriveConfigCache() {
  _cachedConfig = null;
}

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

// ── Carpeta de cotización: "NNN - AAAA" ───────────────────────────────────────

/**
 * Busca/crea la carpeta `NNN - AAAA` de una cotización (compartida por todas
 * sus versiones, convención del legacy) y devuelve id + url.
 */
export async function ensureCarpetaCotizacion(
  numero: number,
  anio: number,
): Promise<{ folderId: string; folderUrl: string }> {
  const config = await getErpDriveConfig();
  const drive = await getDriveClient();
  const nombre = `${pad(numero, 3)} - ${anio}`;
  const folderId = await getOrCreateFolder(drive, nombre, config.cotizacionesRootId);
  return { folderId, folderUrl: folderUrl(folderId) };
}

/**
 * Copia las plantillas base (Doc + Sheet) a la carpeta de la cotización con
 * el nombre estándar: `PCOTOP-NNN-AAAA[-v] <titulo>` (convención con la que
 * después se localiza el PDF).
 */
export async function copiarPlantillasCotizacion(params: {
  folderId: string;
  folio: string; // PCOTOP-NNN-AAAA[-v]
  titulo: string;
}): Promise<void> {
  const config = await getErpDriveConfig();
  if (!config.plantillaDocId && !config.plantillaSheetId) return; // plantillas no configuradas
  const drive = await getDriveClient();
  const nombre = `${params.folio} ${params.titulo}`.trim();

  const copiar = async (fileId: string) => {
    await drive.files.copy({
      fileId,
      requestBody: { name: nombre, parents: [params.folderId] },
    });
  };
  if (config.plantillaDocId) await copiar(config.plantillaDocId);
  if (config.plantillaSheetId) await copiar(config.plantillaSheetId);
}

// ── PDF de la cotización ──────────────────────────────────────────────────────

/**
 * Localiza el PDF de la cotización en su carpeta (el PDF lo genera el equipo
 * manualmente; se busca por prefijo del folio, como el legacy) y lo descarga
 * para adjuntarlo a un correo. Null si no existe — el envío al cliente es
 * obligatorio con PDF.
 */
export async function buscarPdfCotizacion(params: {
  folderId: string;
  folio: string;
}): Promise<{ filename: string; contenido: Buffer } | null> {
  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: `'${params.folderId}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 50,
  });
  const archivos = res.data.files ?? [];
  if (archivos.length === 0) return null;

  // Prefiere el PDF cuyo nombre empieza con el folio exacto; si no, el único PDF
  const porFolio = archivos.find((f) => (f.name ?? "").toUpperCase().startsWith(params.folio.toUpperCase()));
  const elegido = porFolio ?? (archivos.length === 1 ? archivos[0] : null);
  if (!elegido?.id) return null;

  const contenido = await descargarArchivo(drive, elegido.id);
  return { filename: elegido.name ?? `${params.folio}.pdf`, contenido };
}

async function descargarArchivo(drive: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

// ── Carpeta de OT: "<folio> - CLIENTE" bajo la carpeta del año ────────────────

/**
 * Crea la estructura de la OT: {raíz OT}/{año}/{folio - CLIENTE}/OC
 * y devuelve los ids. Sube además el archivo de la OC si se proporciona
 * (también deja copia en la subcarpeta OC de la cotización, como el legacy).
 */
export async function ensureCarpetaOT(params: {
  folioOt: string;
  cliente: string;
  anio: number;
}): Promise<{ folderId: string; folderUrl: string; ocFolderId: string }> {
  const config = await getErpDriveConfig();
  const drive = await getDriveClient();

  const anioFolder = await getOrCreateFolder(drive, String(params.anio), config.otRootId);
  const otFolder = await getOrCreateFolder(
    drive,
    `${params.folioOt} - ${params.cliente.toUpperCase()}`,
    anioFolder,
  );
  const ocFolder = await getOrCreateFolder(drive, "OC", otFolder);
  return { folderId: otFolder, folderUrl: folderUrl(otFolder), ocFolderId: ocFolder };
}

/** Sube un archivo (p. ej. la OC) a una carpeta de Drive. */
export async function subirArchivoErp(params: {
  folderId: string;
  filename: string;
  mimeType: string;
  contenido: Buffer;
}): Promise<{ driveFileId: string; webViewLink: string }> {
  const drive = await getDriveClient();
  const { Readable } = await import("stream");
  const res = await drive.files.create({
    requestBody: { name: params.filename, parents: [params.folderId] },
    media: { mimeType: params.mimeType, body: Readable.from(params.contenido) },
    fields: "id, webViewLink",
  });
  const id = res.data.id!;
  return {
    driveFileId: id,
    webViewLink: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view`,
  };
}

/** Subcarpeta "OC" dentro de la carpeta de la cotización (copia del adjunto). */
export async function ensureSubcarpetaOCCotizacion(cotFolderId: string): Promise<string> {
  const drive = await getDriveClient();
  return getOrCreateFolder(drive, "OC", cotFolderId);
}
