/**
 * Backfill de `cotizaciones.drive_folder_id` — herramienta de administración.
 *
 * El importador nunca escribió `drive_folder_id`, así que todas las
 * cotizaciones importadas lo tienen en NULL. La app sabe resolver la carpeta
 * sola (ver `ensureCarpetaCotizacion`), pero mientras el dato esté vacío cada
 * versión nueva vuelve a buscarla, y una carpeta mal resuelta deja el PDF
 * fuera de vista: el envío al cliente falla porque el PDF es obligatorio.
 *
 * Este script resuelve la carpeta de cada una y, con --aplicar, guarda el id.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin --aplicar solo imprime el reporte.
 *
 * Lo corre quien administra Neon. Usa la MISMA cuenta de servicio que la app
 * (`getDriveClient`), no una cuenta personal: si se corriera con un usuario
 * con más permisos, encontraría carpetas que la app no ve y guardaría ids que
 * en producción dan 404.
 *
 * Uso, desde la raíz del repo:
 *   pnpm backfill:carpetas                 # reporte, no escribe
 *   pnpm backfill:carpetas --anio 2026     # solo un año
 *   pnpm backfill:carpetas --aplicar       # escribe las del grupo 1 verificadas
 *
 * Variables (apps/web/.env.local o el entorno):
 *   DATABASE_URL, DRIVE_SERVICE_ACCOUNT_KEY, DRIVE_ROOT_FOLDER_ID,
 *   ERP_COTIZACIONES_FOLDER_ID  ← la raíz que CONTIENE las carpetas por año
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { drive_v3 } from "googleapis";
import * as schema from "../apps/web/src/db/schema";
import { getDriveClient, LISTAR_TODAS_LAS_UNIDADES } from "../apps/web/src/lib/drive";
import { nombresCarpetaCotizacion } from "../apps/web/src/lib/drive-erp";
import { folioCotizacion } from "../apps/web/src/lib/folios";

config({ path: "apps/web/.env.local" });

const APLICAR = process.argv.includes("--aplicar");
const ANIO_FILTRO = (() => {
  const i = process.argv.indexOf("--anio");
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : null;
})();

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}
const RAIZ = process.env.ERP_COTIZACIONES_FOLDER_ID;
if (!RAIZ) {
  console.error(
    "❌  Falta ERP_COTIZACIONES_FOLDER_ID — la raíz que contiene las carpetas por año, no la del año",
  );
  process.exit(1);
}

const db = drizzle(neon(process.env.DATABASE_URL), { schema });
const { cotizaciones } = schema;

// ── Índice de carpetas de Drive ───────────────────────────────────────────────

interface Carpeta {
  id: string;
  nombre: string;
  createdTime: string;
  /** Año de la carpeta contenedora, o "raíz" si cuelga directo de la raíz. */
  ubicacion: string;
}

/** Lista TODAS las subcarpetas de un padre, paginando. */
async function listarSubcarpetas(drive: drive_v3.Drive, parentId: string): Promise<Carpeta[]> {
  const salida: Carpeta[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "nextPageToken, files(id, name, createdTime)",
      orderBy: "createdTime",
      pageSize: 1000,
      pageToken,
      ...LISTAR_TODAS_LAS_UNIDADES,
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) {
        salida.push({ id: f.id, nombre: f.name, createdTime: f.createdTime ?? "", ubicacion: "" });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return salida;
}

/**
 * Recorre la raíz una sola vez y construye el índice completo: las carpetas de
 * cada año más las que cuelgan directo de la raíz. Así la resolución de cada
 * cotización se hace en memoria y no a golpe de llamada a Drive.
 */
async function construirIndice(drive: drive_v3.Drive): Promise<Carpeta[]> {
  const enRaiz = await listarSubcarpetas(drive, RAIZ!);
  const anios = enRaiz.filter((c) => /^\d{4}$/.test(c.nombre.trim()));
  const sueltas = enRaiz
    .filter((c) => !/^\d{4}$/.test(c.nombre.trim()))
    .map((c) => ({ ...c, ubicacion: "raíz" }));

  console.log(
    `  📁  Raíz: ${anios.length} carpetas de año (${anios.map((a) => a.nombre).join(", ")}) ` +
      `y ${sueltas.length} carpetas sueltas`,
  );

  const todas = [...sueltas];
  for (const anio of anios) {
    const hijas = await listarSubcarpetas(drive, anio.id);
    todas.push(...hijas.map((h) => ({ ...h, ubicacion: anio.nombre.trim() })));
    console.log(`  📁  ${anio.nombre.trim()}: ${hijas.length} carpetas`);
  }
  return todas;
}

// ── Resolución ────────────────────────────────────────────────────────────────

/**
 * Elige entre las candidatas con el mismo criterio que la app, para que el
 * backfill y `ensureCarpetaCotizacion` no discrepen nunca:
 *   1. el orden de preferencia de los nombres (gana "NNN-AAAA", sin espacios)
 *   2. entre carpetas del mismo nombre, la de createdTime más antiguo
 */
function elegir(candidatas: Carpeta[], nombres: string[]): Carpeta | null {
  for (const nombre of nombres) {
    const conEseNombre = candidatas
      .filter((c) => c.nombre === nombre)
      .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    if (conEseNombre.length > 0) return conEseNombre[0];
  }
  return null;
}

/**
 * ¿La carpeta tiene algún archivo del folio? Es la misma regla que usa
 * `buscarPdfCotizacion`, y sirve para distinguir la carpeta buena de una vacía
 * creada por error. Sin esta comprobación el backfill podría dejar apuntando
 * el dato a una carpeta sin los PDFs.
 */
async function tieneArchivosDelFolio(
  drive: drive_v3.Drive,
  folderId: string,
  folio: string,
): Promise<boolean> {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id, name)",
    pageSize: 100,
    ...LISTAR_TODAS_LAS_UNIDADES,
  });
  const objetivo = folio.toUpperCase();
  return (res.data.files ?? []).some((f) => (f.name ?? "").toUpperCase().startsWith(objetivo));
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Resuelta {
  numero: number;
  anio: number;
  folio: string;
  carpeta: Carpeta;
  verificada: boolean;
}

async function main() {
  console.log(
    `🔁  Backfill de carpetas de cotización${APLICAR ? "" : "  (REPORTE — no escribe nada)"}\n`,
  );

  // Una fila por (numero, anio): todas las versiones comparten carpeta.
  const filas = await db
    .selectDistinct({ numero: cotizaciones.numero, anio: cotizaciones.anio })
    .from(cotizaciones)
    .where(
      ANIO_FILTRO
        ? and(isNull(cotizaciones.driveFolderId), eq(cotizaciones.anio, ANIO_FILTRO))
        : isNull(cotizaciones.driveFolderId),
    )
    .orderBy(cotizaciones.anio, cotizaciones.numero);

  if (filas.length === 0) {
    console.log("✅  No hay cotizaciones con drive_folder_id en NULL. Nada que hacer.\n");
    return;
  }
  console.log(`  🔎  ${filas.length} cotizaciones sin carpeta registrada\n`);

  const drive = await getDriveClient();
  const indice = await construirIndice(drive);
  console.log();

  const resueltas: Resuelta[] = [];
  const otroAnio: Array<{ folio: string; anio: number; carpeta: Carpeta }> = [];
  const sinCarpeta: Array<{ folio: string; nombres: string[] }> = [];

  for (const { numero, anio } of filas) {
    const nombres = nombresCarpetaCotizacion(numero, anio);
    const folio = folioCotizacion(numero, anio);
    const candidatas = indice.filter((c) => nombres.includes(c.nombre));

    // El nombre lleva el año dentro, así que "su sitio" es su año o la raíz.
    const enSuSitio = candidatas.filter(
      (c) => c.ubicacion === String(anio) || c.ubicacion === "raíz",
    );
    const elegida = elegir(enSuSitio, nombres);

    if (elegida) {
      const verificada = await tieneArchivosDelFolio(drive, elegida.id, folio);
      resueltas.push({ numero, anio, folio, carpeta: elegida, verificada });
      continue;
    }

    const enOtroAnio = elegir(candidatas, nombres);
    if (enOtroAnio) {
      otroAnio.push({ folio, anio, carpeta: enOtroAnio });
      continue;
    }
    sinCarpeta.push({ folio, nombres });
  }

  // ── Reporte ─────────────────────────────────────────────────────────────────

  console.log(`── 1. Se resolverían (${resueltas.length}) ──`);
  for (const r of resueltas) {
    const marca = r.verificada ? "✅" : "⚠️ ";
    const nota = r.verificada ? "" : "  ← sin archivos del folio dentro";
    console.log(
      `  ${marca} ${r.folio}  →  ${r.carpeta.nombre}  [${r.carpeta.ubicacion}]  ${r.carpeta.id}${nota}`,
    );
  }
  const sinVerificar = resueltas.filter((r) => !r.verificada).length;
  if (sinVerificar > 0) {
    console.log(
      `\n  ⚠️   ${sinVerificar} carpetas no contienen ningún archivo que empiece con su folio.` +
        "\n      Suelen ser carpetas vacías creadas por error. NO se escriben ni con --aplicar;" +
        "\n      revísalas a mano antes de decidir.",
    );
  }

  console.log(`\n── 2. No aparecen en ningún nivel (${sinCarpeta.length}) ──`);
  for (const s of sinCarpeta) {
    console.log(`  ❌  ${s.folio}   buscado como: ${s.nombres.join("  |  ")}`);
  }

  console.log(`\n── 3. Aparecen en un año distinto (${otroAnio.length}) ──`);
  for (const o of otroAnio) {
    console.log(
      `  ⚠️   ${o.folio}  es de ${o.anio} pero su carpeta está en [${o.carpeta.ubicacion}]  ` +
        `${o.carpeta.nombre}  ${o.carpeta.id}`,
    );
  }
  if (otroAnio.length > 0) {
    console.log(
      "\n      El dato y el archivo no coinciden: o la cotización tiene mal el año, o la" +
        "\n      carpeta está mal clasificada. No se escriben nunca; decide una persona.",
    );
  }

  // ── Escritura ───────────────────────────────────────────────────────────────

  const escribibles = resueltas.filter((r) => r.verificada);
  console.log();
  if (!APLICAR) {
    console.log(
      `📋  Reporte, no se escribió nada. Con --aplicar se guardarían ${escribibles.length} carpetas.\n`,
    );
    return;
  }

  for (const r of escribibles) {
    // Todas las versiones de (numero, anio) comparten la carpeta.
    await db
      .update(cotizaciones)
      .set({
        driveFolderId: r.carpeta.id,
        driveFolderUrl: `https://drive.google.com/drive/folders/${r.carpeta.id}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(cotizaciones.numero, r.numero),
          eq(cotizaciones.anio, r.anio),
          isNull(cotizaciones.driveFolderId),
        ),
      );
  }
  const [{ pendientes }] = await db
    .select({ pendientes: sql<number>`count(*)::int` })
    .from(cotizaciones)
    .where(isNull(cotizaciones.driveFolderId));

  console.log(`✅  ${escribibles.length} cotizaciones actualizadas.`);
  console.log(`    Quedan ${pendientes} versiones con drive_folder_id en NULL.\n`);
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
