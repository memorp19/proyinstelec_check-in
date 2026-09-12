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
 *   pnpm backfill:carpetas --aplicar       # escribe los grupos 0 y 1 verificados
 *
 * Cada corrida deja un backfill-carpetas-<fecha>.json con el detalle completo.
 *
 * Variables (apps/web/.env.local o el entorno):
 *   DATABASE_URL, DRIVE_SERVICE_ACCOUNT_KEY, DRIVE_ROOT_FOLDER_ID,
 *   ERP_COTIZACIONES_FOLDER_ID  ← la raíz que CONTIENE las carpetas por año
 */
import { writeFileSync } from "node:fs";
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
  if (i < 0) return null;
  // Sin validar, `--anio` con el valor olvidado procesaba TODOS los años en
  // silencio, y `--anio 26x` metía un NaN en el filtro. Con --aplicar eso es
  // una trampa, no una comodidad.
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
 * Elige entre candidatas que están TODAS en la misma ubicación:
 *   1. el orden de preferencia de los nombres (gana "NNN-AAAA", sin espacios)
 *   2. entre carpetas del mismo nombre, la de createdTime más antiguo
 *
 * La ubicación no se decide aquí a propósito: la prioridad año → raíz la aplica
 * `resolverCarpeta`, porque ese es el orden que sigue `ensureCarpetaCotizacion`
 * y los dos tienen que coincidir. Antes se mezclaban ambos niveles y ganaba la
 * más antigua, así que una carpeta vieja en la raíz le ganaba a la del año — y
 * la app habría usado la del año.
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
 * Resuelve la carpeta en el mismo orden que `ensureCarpetaCotizacion`:
 * primero dentro del año, y solo si ahí no está, colgando de la raíz.
 * Devuelve además las descartadas, para poder reportar la ambigüedad en vez
 * de quedarse callado con la primera.
 */
function resolverCarpeta(
  candidatas: Carpeta[],
  nombres: string[],
  anio: number,
): { elegida: Carpeta | null; descartadas: Carpeta[] } {
  const enAnio = candidatas.filter((c) => c.ubicacion === String(anio));
  const enRaiz = candidatas.filter((c) => c.ubicacion === "raíz");
  const elegida = elegir(enAnio, nombres) ?? elegir(enRaiz, nombres);
  return {
    elegida,
    descartadas: [...enAnio, ...enRaiz].filter((c) => c.id !== elegida?.id),
  };
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
  /** Otras carpetas con el mismo nombre que se descartaron al elegir. */
  descartadas: Carpeta[];
}

/** Par (numero, anio) al que le falta el id en alguna versión. */
interface Pendiente {
  numero: number;
  anio: number;
  /** Ids ya guardados en otras versiones del mismo par, sin repetir. */
  idsExistentes: string[];
}

async function main() {
  console.log(
    `🔁  Backfill de carpetas de cotización${APLICAR ? "" : "  (REPORTE — no escribe nada)"}\n`,
  );

  // Se traen TODAS las versiones, no solo las que tienen el id en NULL.
  //
  // `updateCotizacion` escribe drive_folder_id solo en la versión vigente, así
  // que en producción existe el caso "v2 con id, v0 y v1 en NULL". Si se
  // seleccionara únicamente por NULL, el par entraría al backfill, se
  // re-resolvería contra Drive y podría escribirse en v0/v1 un id DISTINTO del
  // que ya tiene v2: las versiones de una misma cotización acabarían apuntando
  // a carpetas diferentes, que es justo el daño que este script evita.
  // Teniendo todas las filas, cuando el par ya tiene un id se propaga ese, sin
  // preguntarle nada a Drive.
  const todasLasVersiones = await (ANIO_FILTRO
    ? db
        .select({
          numero: cotizaciones.numero,
          anio: cotizaciones.anio,
          driveFolderId: cotizaciones.driveFolderId,
          driveFolderUrl: cotizaciones.driveFolderUrl,
        })
        .from(cotizaciones)
        .where(eq(cotizaciones.anio, ANIO_FILTRO))
    : db
        .select({
          numero: cotizaciones.numero,
          anio: cotizaciones.anio,
          driveFolderId: cotizaciones.driveFolderId,
          driveFolderUrl: cotizaciones.driveFolderUrl,
        })
        .from(cotizaciones));

  const porPar = new Map<string, { numero: number; anio: number; ids: (string | null)[] }>();
  for (const v of todasLasVersiones) {
    const clave = `${v.anio}-${v.numero}`;
    const grupo = porPar.get(clave) ?? { numero: v.numero, anio: v.anio, ids: [] };
    grupo.ids.push(v.driveFolderId);
    porPar.set(clave, grupo);
  }

  const pendientes: Pendiente[] = [];
  const inconsistentes: Array<{ folio: string; ids: string[] }> = [];
  for (const g of [...porPar.values()].sort((a, b) => a.anio - b.anio || a.numero - b.numero)) {
    if (!g.ids.some((id) => id === null)) continue; // el par está completo
    const idsExistentes = [...new Set(g.ids.filter((id): id is string => id !== null))];
    if (idsExistentes.length > 1) {
      // Ya están rotas antes de que este script las toque: no se arreglan solas
      // y elegir una por nuestra cuenta puede empeorarlo. Se reportan.
      inconsistentes.push({ folio: folioCotizacion(g.numero, g.anio), ids: idsExistentes });
      continue;
    }
    pendientes.push({ numero: g.numero, anio: g.anio, idsExistentes });
  }

  if (pendientes.length === 0 && inconsistentes.length === 0) {
    console.log("✅  No hay cotizaciones con drive_folder_id en NULL. Nada que hacer.\n");
    return;
  }

  const aPropagar = pendientes.filter((p) => p.idsExistentes.length === 1);
  const aResolver = pendientes.filter((p) => p.idsExistentes.length === 0);
  console.log(
    `  🔎  ${pendientes.length} cotizaciones con alguna versión sin carpeta ` +
      `(${aPropagar.length} ya tienen id en otra versión, ${aResolver.length} hay que buscarlas en Drive)\n`,
  );

  const propagadas: Resuelta[] = [];
  const resueltas: Resuelta[] = [];
  const otroAnio: Array<{ folio: string; anio: number; carpeta: Carpeta }> = [];
  const sinCarpeta: Array<{ folio: string; nombres: string[] }> = [];

  // Las que ya tienen id en otra versión no tocan Drive: se copia y ya.
  for (const { numero, anio, idsExistentes } of aPropagar) {
    const id = idsExistentes[0];
    propagadas.push({
      numero,
      anio,
      folio: folioCotizacion(numero, anio),
      carpeta: { id, nombre: "(la que ya tenía otra versión)", createdTime: "", ubicacion: "—" },
      verificada: true,
      descartadas: [],
    });
  }

  if (aResolver.length > 0) {
    const drive = await getDriveClient();
    const indice = await construirIndice(drive);
    console.log();

    for (const { numero, anio } of aResolver) {
      const nombres = nombresCarpetaCotizacion(numero, anio);
      const folio = folioCotizacion(numero, anio);
      const candidatas = indice.filter((c) => nombres.includes(c.nombre));

      // El nombre lleva el año dentro, así que "su sitio" es su año o la raíz.
      const { elegida, descartadas } = resolverCarpeta(candidatas, nombres, anio);

      if (elegida) {
        const verificada = await tieneArchivosDelFolio(drive, elegida.id, folio);
        resueltas.push({ numero, anio, folio, carpeta: elegida, verificada, descartadas });
        continue;
      }

      const enOtroAnio = elegir(candidatas, nombres);
      if (enOtroAnio) {
        otroAnio.push({ folio, anio, carpeta: enOtroAnio });
        continue;
      }
      sinCarpeta.push({ folio, nombres });
    }
  }

  // ── Reporte ─────────────────────────────────────────────────────────────────

  if (propagadas.length > 0) {
    console.log(`── 0. Se copia el id que ya tiene otra versión (${propagadas.length}) ──`);
    for (const p of propagadas) {
      console.log(`  ↔️   ${p.folio}  →  ${p.carpeta.id}`);
    }
    console.log();
  }

  console.log(`── 1. Se resolverían contra Drive (${resueltas.length}) ──`);
  for (const r of resueltas) {
    const marca = r.verificada ? "✅" : "⚠️ ";
    const nota = r.verificada ? "" : "  ← sin archivos del folio dentro";
    console.log(
      `  ${marca} ${r.folio}  →  ${r.carpeta.nombre}  [${r.carpeta.ubicacion}]  ${r.carpeta.id}${nota}`,
    );
    for (const d of r.descartadas) {
      console.log(`        ↳ descartada: ${d.nombre}  [${d.ubicacion}]  ${d.id}`);
    }
  }
  const ambiguas = resueltas.filter((r) => r.descartadas.length > 0).length;
  if (ambiguas > 0) {
    console.log(
      `\n  ⚠️   ${ambiguas} tenían más de una carpeta candidata. Se eligió con el mismo` +
        "\n      criterio que la app (primero dentro del año, luego la raíz), pero conviene" +
        "\n      mirar las descartadas antes de aplicar.",
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

  console.log(`\n── 4. Versiones apuntando a carpetas distintas (${inconsistentes.length}) ──`);
  for (const i of inconsistentes) {
    console.log(`  ❌  ${i.folio}  ids: ${i.ids.join(", ")}`);
  }
  if (inconsistentes.length > 0) {
    console.log(
      "\n      Ya estaban así antes de esta corrida. El script no las toca: elegir una" +
        "\n      por su cuenta puede dejar el PDF fuera de vista. Decide una persona.",
    );
  }

  // ── Escritura ───────────────────────────────────────────────────────────────

  const escribibles = [...propagadas, ...resueltas.filter((r) => r.verificada)];

  // El reporte va a archivo: los grupos 2, 3 y 4 son cola de trabajo humano y
  // en una corrida única contra producción no pueden depender del scrollback.
  const archivo = `backfill-carpetas-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    archivo,
    JSON.stringify(
      {
        corrida: new Date().toISOString(),
        modo: APLICAR ? "aplicar" : "reporte",
        anioFiltro: ANIO_FILTRO,
        propagadas: propagadas.map((p) => ({ folio: p.folio, id: p.carpeta.id })),
        resueltas: resueltas.map((r) => ({
          folio: r.folio,
          id: r.carpeta.id,
          nombre: r.carpeta.nombre,
          ubicacion: r.carpeta.ubicacion,
          verificada: r.verificada,
          descartadas: r.descartadas,
        })),
        sinCarpeta,
        otroAnio,
        inconsistentes,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`\n📄  Reporte completo: ${archivo}`);

  console.log();
  if (!APLICAR) {
    console.log(
      `📋  Reporte, no se escribió nada. Con --aplicar se guardarían ${escribibles.length} carpetas.\n`,
    );
    return;
  }

  console.log(`✍️   Escribiendo ${escribibles.length} cotizaciones...\n`);

  let filasTocadas = 0;
  const fallidas: Array<{ folio: string; error: string }> = [];
  for (const r of escribibles) {
    // Todas las versiones de (numero, anio) comparten la carpeta. El isNull
    // mantiene la idempotencia: relanzar tras una interrupción no repisa nada.
    try {
      const filas = await db
        .update(cotizaciones)
        .set({
          driveFolderId: r.carpeta.id,
          driveFolderUrl: `https://drive.google.com/drive/folders/${r.carpeta.id}`,
          // updated_at NO se toca: esto es un backfill, no una edición de
          // negocio, y ese campo se expone en la API. Pisarlo borraría de
          // forma irreversible la última modificación real de cada fila.
        })
        .where(
          and(
            eq(cotizaciones.numero, r.numero),
            eq(cotizaciones.anio, r.anio),
            isNull(cotizaciones.driveFolderId),
          ),
        )
        .returning({ numero: cotizaciones.numero });
      filasTocadas += filas.length;
    } catch (err) {
      // Una fila que falla no debe tirar la corrida entera ni dejarte sin
      // saber qué alcanzó a escribirse.
      fallidas.push({ folio: r.folio, error: (err as Error).message });
      console.error(`  ❌  ${r.folio}: ${(err as Error).message}`);
    }
  }

  const [{ pendientes: siguenNulas }] = await db
    .select({ pendientes: sql<number>`count(*)::int` })
    .from(cotizaciones)
    .where(isNull(cotizaciones.driveFolderId));

  console.log(
    `\n✅  ${escribibles.length - fallidas.length} cotizaciones actualizadas ` +
      `(${filasTocadas} versiones).`,
  );
  if (fallidas.length > 0) {
    console.log(`⚠️   ${fallidas.length} fallaron — relanzar es seguro, solo escribe las que faltan.`);
  }
  console.log(`    Quedan ${siguenNulas} versiones con drive_folder_id en NULL.\n`);
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
