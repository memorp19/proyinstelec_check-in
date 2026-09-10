import type { drive_v3 } from "googleapis";
import {
  getDriveClient,
  getOrCreateFolder,
  getOrCreateFolderAlias,
  getOrCreateFolderPorPrefijo,
  buscarCarpetaAlias,
  ESCRIBIR_TODAS_LAS_UNIDADES,
  LISTAR_TODAS_LAS_UNIDADES,
} from "./drive";
import { pad } from "./folios";

// ── Config (carpetas raíz y plantillas del ERP) ───────────────────────────────

interface ErpDriveConfig {
  /** Raíz de cotizaciones. El código crea dentro el nivel del año: {raíz}/{año}/{NNN-AAAA}. */
  cotizacionesRootId: string;
  otRootId: string; // carpeta raíz de OT por año
  /** Plantilla base de la cotización: es un .docx de Office, no un Google Doc. */
  plantillaDocId: string;
  /** Plantilla base de la cotización: es un .xlsx de Office, no un Google Sheet. */
  plantillaSheetId: string;
}

let _cachedConfig: ErpDriveConfig | null = null;

/** Carpetas raíz y plantillas del ERP (variables de entorno del proyecto). */
async function getErpDriveConfig(): Promise<ErpDriveConfig> {
  if (_cachedConfig) return _cachedConfig;
  const cotizacionesRootId = process.env.ERP_COTIZACIONES_FOLDER_ID;
  if (!cotizacionesRootId) {
    throw new Error(
      "Falta ERP_COTIZACIONES_FOLDER_ID — raíz de cotizaciones en Drive (la que contiene las carpetas por año, no la del año)",
    );
  }
  _cachedConfig = {
    cotizacionesRootId,
    otRootId: process.env.ERP_OT_FOLDER_ID ?? "",
    plantillaDocId: process.env.ERP_PLANTILLA_DOC_ID ?? "",
    plantillaSheetId: process.env.ERP_PLANTILLA_SHEET_ID ?? "",
  };
  return _cachedConfig;
}

export function _resetErpDriveConfigCache() {
  _cachedConfig = null;
}

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

// ── Carpeta de cotización: {raíz}/{año}/{NNN-AAAA} ────────────────────────────

/**
 * Nombres con los que puede estar guardada la carpeta de una cotización. En
 * Drive conviven las dos escrituras porque se crearon a mano; predomina la
 * pegada ("242-2026"), así que es la que se usa al crear.
 */
export function nombresCarpetaCotizacion(numero: number, anio: number): string[] {
  const n = pad(numero, 3);
  return [`${n}-${anio}`, `${n} - ${anio}`];
}

/**
 * Busca/crea la carpeta de una cotización (compartida por todas sus versiones,
 * convención del legacy) y devuelve id + url. Reconoce las dos escrituras para
 * no duplicar la carpeta que ya tiene los archivos históricos.
 *
 * El nivel del año lo crea el código, igual que `ensureCarpetaOT`: así el año
 * sale del dato y no de la configuración —nadie tiene que cambiar
 * `ERP_COTIZACIONES_FOLDER_ID` cada enero— y las cotizaciones de años
 * anteriores siguen siendo alcanzables (una versión nueva de una de 2025
 * encuentra su carpeta en `2025/`, con sus PDFs).
 */
export async function ensureCarpetaCotizacion(
  numero: number,
  anio: number,
): Promise<{ folderId: string; folderUrl: string }> {
  const config = await getErpDriveConfig();
  const drive = await getDriveClient();
  const nombres = nombresCarpetaCotizacion(numero, anio);

  // 1. Donde debe estar: {raíz}/{año}/{NNN-AAAA}.
  const anioFolder = await getOrCreateFolder(drive, String(anio), config.cotizacionesRootId);
  const enAnio = await buscarCarpetaAlias(drive, nombres, anioFolder);
  if (enAnio) return { folderId: enAnio, folderUrl: folderUrl(enAnio) };

  // 2. Si no está ahí, colgando directo de la raíz: es la disposición anterior
  //    al nivel del año. Importa porque el importador nunca escribe
  //    `drive_folder_id` —todas las cotizaciones importadas lo tienen en NULL—,
  //    así que al versionar una se vuelve a resolver la carpeta desde cero. Sin
  //    este fallback se crearía una vacía al lado de la histórica, el PDF
  //    quedaría fuera de vista y el envío al cliente fallaría por PDF ausente.
  const enRaiz = await buscarCarpetaAlias(drive, nombres, config.cotizacionesRootId);
  if (enRaiz) return { folderId: enRaiz, folderUrl: folderUrl(enRaiz) };

  // 3. No existe en ningún nivel: se crea donde toca a partir de ahora.
  const creada = await getOrCreateFolderAlias(drive, nombres, anioFolder);
  return { folderId: creada, folderUrl: folderUrl(creada) };
}

/**
 * Copia las plantillas base (Doc + Sheet) a la carpeta de la cotización con
 * el nombre estándar: `PCOTOP-NNN-AAAA[-v] <titulo>` (convención con la que
 * después se localiza el PDF).
 *
 * Falla si alguna plantilla no está configurada: sin ellas la cotización no
 * sirve para nada.
 */
export async function copiarPlantillasCotizacion(params: {
  folderId: string;
  folio: string; // PCOTOP-NNN-AAAA[-v]
  titulo: string;
}): Promise<void> {
  const config = await getErpDriveConfig();

  // Antes esto hacía `return` en silencio: la cotización quedaba con carpeta y
  // sin Doc ni Sheet que llenar, y el fallo aparecía dos pasos después, al no
  // encontrar el PDF que nadie pudo generar. Se avisa aquí, con el nombre de la
  // variable, para que el problema se vea donde nace.
  const faltantes: string[] = [];
  if (!config.plantillaDocId) faltantes.push("ERP_PLANTILLA_DOC_ID");
  if (!config.plantillaSheetId) faltantes.push("ERP_PLANTILLA_SHEET_ID");
  if (faltantes.length > 0) {
    throw new Error(
      `Falta ${faltantes.join(" y ")} — sin las plantillas la cotización nace sin Doc ni Sheet, y sin ellos no hay PDF que enviar al cliente`,
    );
  }

  const drive = await getDriveClient();
  const nombre = `${params.folio} ${params.titulo}`.trim();

  const copiar = async (fileId: string) => {
    await drive.files.copy({
      fileId,
      requestBody: { name: nombre, parents: [params.folderId] },
      ...ESCRIBIR_TODAS_LAS_UNIDADES,
    });
  };
  await copiar(config.plantillaDocId);
  await copiar(config.plantillaSheetId);
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
    ...LISTAR_TODAS_LAS_UNIDADES,
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
    { fileId, alt: "media", ...ESCRIBIR_TODAS_LAS_UNIDADES },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

// ── Carpeta de OT: "<folio> - <cliente>" bajo la carpeta del año ─────────────

/**
 * Crea la estructura de la OT: {raíz OT}/{año}/{folio - cliente}/OC
 * y devuelve los ids. Sube además el archivo de la OC si se proporciona
 * (también deja copia en la subcarpeta OC de la cotización, como el legacy).
 */
export async function ensureCarpetaOT(params: {
  folioOt: string;
  cliente: string;
  anio: number;
}): Promise<{ folderId: string; folderUrl: string; ocFolderId: string }> {
  const config = await getErpDriveConfig();
  // Sin raíz configurada, `getOrCreateFolder` pediría a Drive crear en el padre
  // "" y fallaría con un error opaco. Se avisa aquí con el nombre de la variable:
  // quien reciba el aviso en la pantalla de OC sabe qué configurar.
  if (!config.otRootId) {
    throw new Error("Falta ERP_OT_FOLDER_ID — carpeta raíz de las OT en Drive");
  }
  const drive = await getDriveClient();

  const anioFolder = await getOrCreateFolder(drive, String(params.anio), config.otRootId);
  // Se busca por folio, no por nombre completo: el cliente está escrito a mano
  // en Drive con mayúsculas y puntuación variables. Y al crear se respeta el
  // nombre tal como viene, sin forzar mayúsculas, para no introducir una
  // tercera escritura del mismo cliente.
  const otFolder = await getOrCreateFolderPorPrefijo(
    drive,
    params.folioOt,
    `${params.folioOt} - ${params.cliente.trim()}`,
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
    ...ESCRIBIR_TODAS_LAS_UNIDADES,
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
