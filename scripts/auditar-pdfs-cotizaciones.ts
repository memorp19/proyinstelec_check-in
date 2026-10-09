/**
 * Auditoría de los PDF de cotización en Drive — SOLO LECTURA.
 *
 * No escribe nada: ni en Drive ni en la base. No tiene modo de aplicar nada.
 *
 * Comprueba que cada versión de cada cotización tenga un PDF localizable con la
 * MISMA regla que usa el envío al cliente (`esPdfConTitulo` / `esPdfSoloFolio`
 * de src/lib/drive-erp.ts, importadas aquí a propósito: si la regla cambia, la
 * auditoría cambia con ella y no empieza a mentir).
 *
 * Reporta cuatro cosas:
 *   1. PDF cuyo nombre no empieza por un folio bien formado.
 *   2. Variantes con separadores raros, como "PCOTOP-002-2026 - 1 ...".
 *   3. PDF que satisfacen la búsqueda de más de una versión.
 *   4. Versiones de la base sin PDF localizable.
 *
 * Usa la cuenta de servicio del propio código (`getDriveClient`), no una cuenta
 * personal: lo que no vea ella es lo que la app tampoco va a ver.
 *
 * Uso, desde la raíz del repo:
 *   pnpm auditar:pdfs
 *   pnpm auditar:pdfs --anio 2026
 *
 * Variables: DATABASE_URL, DRIVE_SERVICE_ACCOUNT_KEY, DRIVE_ROOT_FOLDER_ID,
 * ERP_COTIZACIONES_FOLDER_ID (la raíz que CONTIENE las carpetas por año).
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import type { drive_v3 } from "googleapis";
import {
  getDriveClient,
  LISTAR_TODAS_LAS_UNIDADES,
} from "../apps/web/src/lib/drive";
import {
  esPdfConTitulo,
  esPdfSoloFolio,
  nombresCarpetaCotizacion,
} from "../apps/web/src/lib/drive-erp";

config({ path: "apps/web/.env.local" });

const ANIO_FILTRO = (() => {
  const i = process.argv.indexOf("--anio");
  if (i < 0) return null;
  const valor = process.argv[i + 1];
  if (!valor || !/^\d{4}$/.test(valor)) {
    console.error("❌  --anio necesita un año de 4 dígitos, p. ej. --anio 2026");
    process.exit(1);
  }
  return parseInt(valor, 10);
})();

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}
const RAIZ = process.env.ERP_COTIZACIONES_FOLDER_ID;
if (!RAIZ) {
  console.error("❌  Falta ERP_COTIZACIONES_FOLDER_ID — la raíz con las carpetas por año");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

/** Folio bien formado: PCOTOP-NNN-AAAA, con sufijo de versión opcional. */
const FOLIO_OK = /^PCOTOP-\d{3}-\d{4}(-\d+)?(\s|\.pdf$)/i;

/** La variante que motivó esta auditoría: separadores con espacios alrededor. */
const SEPARADOR_RARO = /^PCOTOP-\d{3}-\d{4}\s*[-–—]\s+\d+/i;

interface Archivo {
  id: string;
  name: string;
}

async function listarHijos(
  drive: drive_v3.Drive,
  parentId: string,
  soloCarpetas: boolean,
): Promise<Archivo[]> {
  const tipo = soloCarpetas
    ? "mimeType='application/vnd.google-apps.folder'"
    : "mimeType='application/pdf'";
  const salida: Archivo[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and ${tipo} and trashed=false`,
      fields: "nextPageToken, files(id, name)",
      pageSize: 1000,
      pageToken,
      ...LISTAR_TODAS_LAS_UNIDADES,
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) salida.push({ id: f.id, name: f.name });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return salida;
}

async function main() {
  console.log("🔎  Auditoría de PDF de cotización  (SOLO LECTURA)\n");

  // ── Versiones de la base ────────────────────────────────────────────────────
  const versiones = (await sql(
    ANIO_FILTRO
      ? `SELECT numero, anio, version, folio FROM cotizaciones WHERE anio = ${ANIO_FILTRO}
           ORDER BY numero, version`
      : `SELECT numero, anio, version, folio FROM cotizaciones ORDER BY anio, numero, version`,
  )) as Array<{ numero: number; anio: number; version: number; folio: string }>;

  if (versiones.length === 0) {
    console.log("No hay cotizaciones que auditar.\n");
    return;
  }
  console.log(`  ${versiones.length} versiones en la base\n`);

  const drive = await getDriveClient();

  // ── Índice de carpetas: {raíz}/{año}/{NNN-AAAA} y las sueltas de la raíz ─────
  const enRaiz = await listarHijos(drive, RAIZ!, true);
  const carpetasPorNombre = new Map<string, string>(); // nombre → id
  for (const c of enRaiz.filter((c) => !/^\d{4}$/.test(c.name.trim()))) {
    carpetasPorNombre.set(c.name.trim(), c.id);
  }
  for (const anio of enRaiz.filter((c) => /^\d{4}$/.test(c.name.trim()))) {
    for (const hija of await listarHijos(drive, anio.id, true)) {
      carpetasPorNombre.set(hija.name.trim(), hija.id);
    }
  }
  console.log(`  ${carpetasPorNombre.size} carpetas de cotización en Drive\n`);

  // ── Recorrido ───────────────────────────────────────────────────────────────
  const malFormados: Array<{ carpeta: string; nombre: string }> = [];
  const separadorRaro: Array<{ carpeta: string; nombre: string }> = [];
  const ambiguos: Array<{ carpeta: string; nombre: string; folios: string[] }> = [];
  const sinPdf: Array<{ folio: string; motivo: string }> = [];

  /** PDF de cada carpeta, pedidos una sola vez. */
  const pdfsPorCarpeta = new Map<string, Archivo[]>();

  // Agrupadas por (numero, anio): todas las versiones comparten carpeta.
  const porCotizacion = new Map<string, typeof versiones>();
  for (const v of versiones) {
    const clave = `${v.numero}-${v.anio}`;
    porCotizacion.set(clave, [...(porCotizacion.get(clave) ?? []), v]);
  }

  for (const [, grupo] of porCotizacion) {
    const { numero, anio } = grupo[0];
    const nombres = nombresCarpetaCotizacion(numero, anio);
    const carpetaId = nombres.map((n) => carpetasPorNombre.get(n)).find(Boolean);

    if (!carpetaId) {
      for (const v of grupo) sinPdf.push({ folio: v.folio, motivo: "sin carpeta en Drive" });
      continue;
    }

    const nombreCarpeta = nombres.find((n) => carpetasPorNombre.has(n))!;
    if (!pdfsPorCarpeta.has(carpetaId)) {
      pdfsPorCarpeta.set(carpetaId, await listarHijos(drive, carpetaId, false));
    }
    const pdfs = pdfsPorCarpeta.get(carpetaId)!;

    // 1 y 2: forma del nombre, independiente de qué versión sea
    for (const pdf of pdfs) {
      if (SEPARADOR_RARO.test(pdf.name)) {
        separadorRaro.push({ carpeta: nombreCarpeta, nombre: pdf.name });
      } else if (!FOLIO_OK.test(pdf.name)) {
        malFormados.push({ carpeta: nombreCarpeta, nombre: pdf.name });
      }
    }

    // 3: un PDF que satisface la búsqueda de más de una versión
    for (const pdf of pdfs) {
      const coinciden = grupo
        .filter((v) => esPdfConTitulo(pdf.name, v.folio) || esPdfSoloFolio(pdf.name, v.folio))
        .map((v) => v.folio);
      if (coinciden.length > 1) {
        ambiguos.push({ carpeta: nombreCarpeta, nombre: pdf.name, folios: coinciden });
      }
    }

    // 4: versiones sin PDF localizable con la regla del envío
    for (const v of grupo) {
      const hay = pdfs.some(
        (p) => esPdfConTitulo(p.name, v.folio) || esPdfSoloFolio(p.name, v.folio),
      );
      if (!hay) {
        sinPdf.push({
          folio: v.folio,
          motivo: pdfs.length === 0 ? "la carpeta no tiene PDF" : `${pdfs.length} PDF, ninguno suyo`,
        });
      }
    }
  }

  // ── Reporte ─────────────────────────────────────────────────────────────────
  const bloque = (titulo: string, filas: string[], nota?: string) => {
    console.log(`── ${titulo} (${filas.length}) ──`);
    for (const f of filas) console.log(`  ${f}`);
    if (filas.length > 0 && nota) console.log(`\n      ${nota}`);
    console.log();
  };

  bloque(
    "1. PDF con nombre que no empieza por un folio válido",
    malFormados.map((m) => `[${m.carpeta}]  ${m.nombre}`),
    "El envío al cliente no los va a encontrar. Renómbralos como «<folio> <título>.pdf».",
  );

  bloque(
    "2. PDF con separador raro en la versión",
    separadorRaro.map((m) => `[${m.carpeta}]  ${m.nombre}`),
    'Es la variante «PCOTOP-002-2026 - 1 ...»: el folio correcto no lleva espacios alrededor del guion.',
  );

  bloque(
    "3. PDF que coinciden con más de una versión",
    ambiguos.map((a) => `[${a.carpeta}]  ${a.nombre}  →  ${a.folios.join(", ")}`),
    "Con la regla actual esto no debería pasar; si aparece, hay folios repetidos en la base.",
  );

  bloque(
    "4. Versiones sin PDF localizable",
    sinPdf.map((s) => `${s.folio}  —  ${s.motivo}`),
    "Esas cotizaciones no se pueden enviar al cliente: el PDF es obligatorio.",
  );

  const total = malFormados.length + separadorRaro.length + ambiguos.length + sinPdf.length;
  console.log(
    total === 0
      ? "✅  Sin hallazgos: cada versión tiene su PDF y ninguno es ambiguo.\n"
      : `📋  ${total} hallazgos. Nada se modificó.\n`,
  );
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
