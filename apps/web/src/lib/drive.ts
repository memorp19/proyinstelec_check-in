import { google, type drive_v3 } from "googleapis";
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

/**
 * Credenciales del service account de Google Drive.
 * En Vercel se definen como variables de entorno del proyecto (Settings →
 * Environment Variables); en local, en apps/web/.env.local.
 */
async function getDriveConfig(): Promise<DriveConfig> {
  if (_cachedConfig) return _cachedConfig;

  const keyJson = process.env.DRIVE_SERVICE_ACCOUNT_KEY;
  const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!keyJson || !rootFolderId) {
    throw new Error(
      "Faltan DRIVE_SERVICE_ACCOUNT_KEY y/o DRIVE_ROOT_FOLDER_ID (ver docs/setup-google-drive.md)",
    );
  }

  let parsed: { client_email: string; private_key: string };
  try {
    parsed = JSON.parse(keyJson);
  } catch {
    throw new Error("DRIVE_SERVICE_ACCOUNT_KEY no es un JSON válido");
  }

  _cachedConfig = {
    serviceAccountEmail: parsed.client_email,
    // Vercel guarda los saltos de línea escapados: hay que restaurarlos.
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    rootFolderId,
  };
  return _cachedConfig;
}

export function _resetDriveConfigCache() {
  _cachedConfig = null;
}

// ── Drive client ──────────────────────────────────────────────────────────────

export async function getDriveClient(): Promise<drive_v3.Drive> {
  const config = await getDriveConfig();

  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

// ── Unidades compartidas ──────────────────────────────────────────────────────

/**
 * Las carpetas del ERP viven en unidades compartidas (sus ids empiezan con
 * "0A"). Sin estos parámetros la API se comporta como si no existieran:
 * `files.list` omite su contenido y `create`/`copy`/`get` responden 404 al
 * padre. Van en TODA llamada, no solo en las del ERP.
 *
 * `includeItemsFromAllDrives` solo lo acepta `files.list`; el resto de métodos
 * llevan únicamente `supportsAllDrives`.
 */
export const LISTAR_TODAS_LAS_UNIDADES = {
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
} as const;

export const ESCRIBIR_TODAS_LAS_UNIDADES = { supportsAllDrives: true } as const;

// ── Folder management ─────────────────────────────────────────────────────────

/**
 * Escapa un valor para meterlo entre comillas simples en una query de Drive.
 * La barra invertida va PRIMERO: si se escaparan las comillas antes, el
 * escape que acabamos de añadir se volvería a escapar. Los nombres vienen de
 * entrada de usuario (títulos, razones sociales), así que ninguno de los dos
 * caracteres es hipotético.
 */
const escaparValor = (valor: string) => valor.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const CARPETA = "mimeType='application/vnd.google-apps.folder' and trashed=false";

/** Una candidata devuelta por Drive, o `undefined` si ninguna sirve. */
type Elegir = (carpetas: drive_v3.Schema$File[]) => drive_v3.Schema$File | undefined;

/**
 * Lista carpetas que cumplen `q`, siempre de la más antigua a la más nueva.
 * El `orderBy` no es cosmético: es lo que hace determinista cuál se elige
 * cuando hay duplicados (antes era `pageSize: 1` sin orden, así que Drive
 * devolvía cualquiera y dos llamadas podían discrepar).
 */
async function listarCarpetas(
  drive: drive_v3.Drive,
  q: string,
): Promise<drive_v3.Schema$File[]> {
  const res = await drive.files.list({
    q,
    fields: "files(id, name, createdTime)",
    orderBy: "createdTime",
    pageSize: 25,
    ...LISTAR_TODAS_LAS_UNIDADES,
  });
  return res.data.files ?? [];
}

async function crearCarpeta(
  drive: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<string> {
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    ...ESCRIBIR_TODAS_LAS_UNIDADES,
  });

  return created.data.id!;
}

/**
 * Crea la carpeta y decide con cuál quedarse.
 *
 * Drive no impone unicidad de nombre, así que "listar y si no está, crear" es
 * una carrera: dos personas dando de alta una cotización el mismo segundo
 * dejan dos carpetas "2026" y el año se parte en dos árboles, cada uno con
 * archivos distintos dentro.
 *
 * La carrera no se puede evitar desde el cliente, pero sí se puede hacer que
 * todos los que compitieron converjan en la MISMA carpeta: se vuelve a listar
 * y gana la más antigua. El que pierde deja una carpeta vacía —basura visible
 * y fácil de borrar— en lugar de un árbol paralelo con contenido.
 */
async function crearYResolverCarrera(
  drive: drive_v3.Drive,
  nombre: string,
  parentId: string,
  q: string,
  elegir: Elegir,
): Promise<string> {
  const creadaId = await crearCarpeta(drive, nombre, parentId);
  const ganadora = elegir(await listarCarpetas(drive, q));
  return ganadora?.id ?? creadaId;
}

/**
 * Finds a folder by name inside parentId; creates it if it doesn't exist.
 * Idempotent — safe to call on every upload.
 *
 * El match es exacto: úsala solo cuando el nombre lo controlamos nosotros
 * ("Proyectos", "OC", el año). Para nombres que el equipo ya escribió a mano en
 * Drive, ver `getOrCreateFolderAlias` y `getOrCreateFolderPorPrefijo`.
 */
export async function getOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<string> {
  const q = `name='${escaparValor(name)}' and '${parentId}' in parents and ${CARPETA}`;
  // Todas las candidatas tienen el nombre exacto; `listarCarpetas` las devuelve
  // de la más antigua a la más nueva, así que la primera es la ganadora.
  const elegir: Elegir = (carpetas) => carpetas[0];

  const existente = elegir(await listarCarpetas(drive, q));
  if (existente?.id) return existente.id;

  return crearYResolverCarrera(drive, name, parentId, q, elegir);
}

/**
 * Igual que `getOrCreateFolder` pero acepta varias escrituras del mismo nombre.
 * Existe porque el equipo creó las carpetas a mano durante años y conviven dos
 * formatos ("242-2026" y "242 - 2026"); si buscáramos solo uno, crearíamos una
 * carpeta duplicada al lado de la que ya tiene los archivos.
 *
 * `nombres[0]` es el que se usa al crear.
 */
function queryAlias(nombres: string[], parentId: string): string {
  const alternativas = nombres.map((n) => `name='${escaparValor(n)}'`).join(" or ");
  return `(${alternativas}) and '${parentId}' in parents and ${CARPETA}`;
}

/**
 * Si existen varias escrituras, gana el orden en que se pidieron; entre
 * carpetas del mismo nombre gana la más antigua, porque `listarCarpetas` las
 * entrega ordenadas y `find` devuelve la primera.
 */
const elegirAlias =
  (nombres: string[]): Elegir =>
  (carpetas) => {
    for (const nombre of nombres) {
      const exacta = carpetas.find((f) => f.name === nombre);
      if (exacta) return exacta;
    }
    return carpetas[0];
  };

/**
 * Busca sin crear. Devuelve `null` si no está: lo usa el fallback de las
 * cotizaciones, que necesita mirar en dos sitios antes de decidir crear.
 */
export async function buscarCarpetaAlias(
  drive: drive_v3.Drive,
  nombres: string[],
  parentId: string,
): Promise<string | null> {
  if (nombres.length === 0) throw new Error("buscarCarpetaAlias sin nombres");
  const encontrada = elegirAlias(nombres)(
    await listarCarpetas(drive, queryAlias(nombres, parentId)),
  );
  return encontrada?.id ?? null;
}

export async function getOrCreateFolderAlias(
  drive: drive_v3.Drive,
  nombres: string[],
  parentId: string,
): Promise<string> {
  if (nombres.length === 0) throw new Error("getOrCreateFolderAlias sin nombres");

  const q = queryAlias(nombres, parentId);
  const elegir = elegirAlias(nombres);

  const existente = elegir(await listarCarpetas(drive, q));
  if (existente?.id) return existente.id;

  return crearYResolverCarrera(drive, nombres[0], parentId, q, elegir);
}

/**
 * Busca una carpeta cuyo nombre empiece con `prefijo`; si no existe crea
 * `nombreNuevo`. Para las carpetas de OT, cuyo nombre es "<folio> - <cliente>":
 * el folio es estable y único, y el nombre del cliente está escrito a mano con
 * mayúsculas y puntuación variables ("IGSA S.A.P.I de C.V."), así que buscar
 * por el nombre completo nunca acertaría.
 */
export async function getOrCreateFolderPorPrefijo(
  drive: drive_v3.Drive,
  prefijo: string,
  nombreNuevo: string,
  parentId: string,
): Promise<string> {
  // `contains` es subcadena y no distingue mayúsculas: se filtra después para
  // exigir que el prefijo esté al principio.
  const q = `name contains '${escaparValor(prefijo)}' and '${parentId}' in parents and ${CARPETA}`;
  const objetivo = prefijo.trim().toUpperCase();
  const elegir: Elegir = (carpetas) =>
    carpetas.find((f) => (f.name ?? "").trim().toUpperCase().startsWith(objetivo));

  const existente = elegir(await listarCarpetas(drive, q));
  if (existente?.id) return existente.id;

  return crearYResolverCarrera(drive, nombreNuevo, parentId, q, elegir);
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
    ...ESCRIBIR_TODAS_LAS_UNIDADES,
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

// ── Project folder creation ───────────────────────────────────────────────────

/**
 * Creates the canonical folder hierarchy for a project:
 * {root} / Empresas / {empresaNombre} / {proyectoNombre}
 *
 * Idempotent — safe to call multiple times. Returns the project folder ID.
 */
export async function createEmpresaProyectoFolder(params: {
  empresaNombre: string;
  proyectoNombre: string;
}): Promise<{ folderId: string; folderUrl: string }> {
  const config = await getDriveConfig();
  const drive = await getDriveClient();

  const empresasRoot = await getOrCreateFolder(drive, "Empresas", config.rootFolderId);
  const empresaFolder = await getOrCreateFolder(drive, params.empresaNombre, empresasRoot);
  const proyectoFolderId = await getOrCreateFolder(drive, params.proyectoNombre, empresaFolder);

  return {
    folderId: proyectoFolderId,
    folderUrl: `https://drive.google.com/drive/folders/${proyectoFolderId}`,
  };
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
