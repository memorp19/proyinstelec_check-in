/**
 * Carga el catálogo de servicios 2026 en `cat_servicios`, desde el formato de
 * cotización `PFAD-024-2026` (hoja `COSTOS`).
 *
 * De las tres columnas del catálogo —`ZI` código, `ZJ` descripción, `ZK`
 * costo— solo se cargan los códigos que de verdad son un servicio: el formato
 * viene preasignado con 176 códigos de los que 89 son huecos ("Disponible" o
 * sin descripción). Los estudios (`AR`) además traen su desglose de esfuerzo
 * en los bloques de `YZ:ZF`, y de ahí salen horas, días, ingenieros, semanas y
 * tarifa.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin `--aplicar` solo reporta.
 *
 * Uso, desde la raíz del repositorio:
 *   pnpm catalogo:importar                                  # solo reporta
 *   pnpm catalogo:importar --ensayo  --destino=ep-xxx.neon.tech
 *   pnpm catalogo:importar --aplicar --destino=ep-xxx.neon.tech
 *
 * Opciones:
 *   --archivo=<ruta>   el .xlsx a leer (default: importacion/catalogo-2026.xlsx)
 *   --usuario=<quien>  queda en `updated_by` y en el historial (default: importador)
 *   --motivo=<texto>   el motivo del cambio, obligatorio en el historial
 *
 * Variables: DATABASE_URL y, opcionalmente, PRODUCTION_DATABASE_HOST.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { LibroExcel } from "../apps/web/src/lib/excel";
import {
  costoDeEstudio,
  esDescarte,
  familiaDeFila,
  leerBloquesEstudio,
  leerFilaCatalogo,
  resumirPorFamilia,
  type FilaCatalogo,
  type ParamsEstudio,
} from "../apps/web/src/lib/catalogo-2026";
import { tipoDeCodigo } from "../apps/web/src/lib/cotizador/catalogo";
import { ejecutarLote, leerBanderas, opcion, verificarDestino } from "./guardas";

config({ path: "apps/web/.env.local" });

const HOJA = "COSTOS";
const ARCHIVO = opcion("archivo") ?? "importacion/catalogo-2026.xlsx";
const USUARIO = opcion("usuario") ?? "importador";
const MOTIVO = opcion("motivo") ?? "Carga del catálogo 2026 (PFAD-024-2026)";
/** Todo el formato está en pesos; no hay una columna de moneda. */
const MONEDA = "MXN";

const banderas = leerBanderas();

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const HOST = new URL(process.env.DATABASE_URL).host;

const pesos = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Lectura ───────────────────────────────────────────────────────────────────

interface Servicio extends FilaCatalogo {
  familia: string;
  tipo: string;
  esfuerzo: ParamsEstudio | null;
}

interface Lectura {
  servicios: Servicio[];
  huecos: number;
  separadores: number;
  /** Estudios cuyo bloque de esfuerzo no da el costo de la columna `ZK`. */
  desacuerdos: Array<{ codigo: string; segunBloque: number; segunColumna: number | null }>;
  /** Estudios sin bloque: se cargan con el costo, pero sin desglose. */
  sinBloque: string[];
}

function leer(): Lectura {
  let libro: LibroExcel;
  try {
    libro = LibroExcel.desdeBuffer(readFileSync(ARCHIVO));
  } catch (err) {
    console.error(`❌  No se pudo leer ${ARCHIVO}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const filas = libro.filas(HOJA);
  if (filas.length === 0) {
    console.error(`❌  La hoja "${HOJA}" de ${ARCHIVO} no tiene datos.`);
    process.exit(1);
  }

  const bloques = leerBloquesEstudio(filas);
  const servicios: Servicio[] = [];
  const desacuerdos: Lectura["desacuerdos"] = [];
  const sinBloque: string[] = [];
  let huecos = 0;
  let separadores = 0;

  for (const { numero, celdas } of filas) {
    const fila = leerFilaCatalogo(numero, celdas);
    if (!fila) continue;
    if (esDescarte(fila)) {
      if (fila.motivo === "HUECO") huecos++;
      else separadores++;
      continue;
    }

    const tipo = tipoDeCodigo(fila.codigo);
    const esfuerzo = tipo === "ESTUDIO" ? bloques.get(fila.codigo.toUpperCase()) ?? null : null;

    if (tipo === "ESTUDIO") {
      if (!esfuerzo) sinBloque.push(fila.codigo);
      // El bloque y la columna son dos caminos al mismo número. Si no coinciden
      // alguien movió uno de los dos y hay que mirarlo: el script no elige.
      else if (costoDeEstudio(esfuerzo) !== fila.costo) {
        desacuerdos.push({ codigo: fila.codigo, segunBloque: costoDeEstudio(esfuerzo), segunColumna: fila.costo });
      }
    }

    servicios.push({ ...fila, familia: familiaDeFila(fila.codigo), tipo, esfuerzo });
  }

  return { servicios, huecos, separadores, desacuerdos, sinBloque };
}

// ── Lo que ya hay en la base ──────────────────────────────────────────────────

interface EnBase {
  codigo: string;
  descripcion: string;
  costo: string | null;
  activo: boolean;
}

async function leerBase(): Promise<Map<string, EnBase>> {
  let filas: EnBase[];
  try {
    filas = (await sql`SELECT codigo, descripcion, costo, activo FROM cat_servicios`) as EnBase[];
  } catch (err) {
    // La tabla la crea la migración 0006. Decirlo aquí ahorra leer el error
    // del driver, que solo dice que la relación no existe.
    const e = err as { code?: string; message?: string };
    if (e?.code === "42P01" || (e?.message ?? "").includes("cat_servicios")) {
      console.error(
        `\n❌  ${HOST} no tiene la tabla cat_servicios.\n` +
          "    Corre primero la migración:  pnpm db:migrate\n",
      );
      process.exit(1);
    }
    throw err;
  }
  return new Map(filas.map((f) => [f.codigo, f]));
}

interface Campo {
  campo: string;
  antes: string | null;
  despues: string | null;
}

type Clase = "ALTA" | "CAMBIA" | "IGUAL";

function clasificar(s: Servicio, previo: EnBase | undefined): { clase: Clase; campos: Campo[] } {
  // Un alta no genera historial: el renglón del catálogo ya es su primer dato.
  if (!previo) return { clase: "ALTA", campos: [] };

  const campos: Campo[] = [];
  const costoPrevio = previo.costo === null ? null : Number(previo.costo);
  if (costoPrevio !== s.costo) {
    campos.push({
      campo: "costo",
      antes: costoPrevio === null ? null : String(costoPrevio),
      despues: s.costo === null ? null : String(s.costo),
    });
  }
  if (previo.descripcion !== s.descripcion) {
    campos.push({ campo: "descripcion", antes: previo.descripcion, despues: s.descripcion });
  }
  return { clase: campos.length ? "CAMBIA" : "IGUAL", campos };
}

// ── Escritura ─────────────────────────────────────────────────────────────────

function sentencias(servicios: Servicio[], cambios: Array<Campo & { codigo: string }>) {
  const lote: unknown[] = [];

  for (const s of servicios) {
    const e = s.esfuerzo;
    lote.push(sql`
      INSERT INTO cat_servicios
        (codigo, familia, descripcion, costo, moneda, tipo,
         horas_por_dia, dias_por_semana, ingenieros, semanas, tarifa_hora,
         activo, updated_at, updated_by)
      VALUES
        (${s.codigo}, ${s.familia}, ${s.descripcion}, ${s.costo}, ${MONEDA}, ${s.tipo},
         ${e?.horasPorDia ?? null}, ${e?.diasPorSemana ?? null}, ${e?.ingenieros ?? null},
         ${e?.semanas ?? null}, ${e?.tarifaHora ?? null},
         true, now(), ${USUARIO})
      ON CONFLICT (codigo) DO UPDATE SET
        familia = EXCLUDED.familia,
        descripcion = EXCLUDED.descripcion,
        costo = EXCLUDED.costo,
        moneda = EXCLUDED.moneda,
        tipo = EXCLUDED.tipo,
        horas_por_dia = EXCLUDED.horas_por_dia,
        dias_por_semana = EXCLUDED.dias_por_semana,
        ingenieros = EXCLUDED.ingenieros,
        semanas = EXCLUDED.semanas,
        tarifa_hora = EXCLUDED.tarifa_hora,
        activo = true,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by
    `);
  }

  // El historial va DESPUÉS de los altas: `cat_servicios_cambios` tiene llave
  // foránea al código, y el lote entero es una sola transacción.
  for (const c of cambios) {
    lote.push(sql`
      INSERT INTO cat_servicios_cambios (id, codigo, campo, antes, despues, usuario, motivo)
      VALUES (${randomUUID()}, ${c.codigo}, ${c.campo}, ${c.antes}, ${c.despues}, ${USUARIO}, ${MOTIVO})
    `);
  }

  return lote;
}

// ── Reporte y ejecución ───────────────────────────────────────────────────────

async function main() {
  console.log("\n📘  Catálogo de servicios 2026\n");
  verificarDestino(HOST, banderas, "Este script reescribe el catálogo completo");

  const lectura = leer();
  const { servicios } = lectura;
  console.log(`📄  ${ARCHIVO} · hoja ${HOJA}`);
  console.log(
    `    ${servicios.length} servicios · ${lectura.huecos} huecos del formato descartados` +
      `${lectura.separadores ? ` · ${lectura.separadores} separadores` : ""}\n`,
  );

  console.log("    Familia   Códigos   Sin costo");
  for (const r of resumirPorFamilia(servicios)) {
    console.log(
      `    ${r.familia.padEnd(9)} ${String(r.total).padStart(7)}   ` +
        (r.sinCosto.length ? r.sinCosto.join(", ") : "—"),
    );
  }

  const estudios = servicios.filter((s) => s.esfuerzo);
  console.log(`\n🔬  ${estudios.length} estudios con desglose de esfuerzo:`);
  for (const s of estudios) {
    const e = s.esfuerzo!;
    console.log(
      `    ${s.codigo}  ${e.horasPorDia} h/día × ${e.diasPorSemana} días × ${e.ingenieros} ing × ` +
        `${e.semanas} sem × $${e.tarifaHora}/h = ${pesos(costoDeEstudio(e))}`,
    );
  }
  for (const c of lectura.desacuerdos) {
    console.log(
      `    ⚠️  ${c.codigo}: el bloque da ${pesos(c.segunBloque)} y la columna ZK dice ` +
        `${pesos(c.segunColumna)}. Se carga lo de ZK.`,
    );
  }
  if (lectura.sinBloque.length) {
    console.log(`    ⚠️  sin bloque de esfuerzo: ${lectura.sinBloque.join(", ")} (se cargan solo con su costo)`);
  }
  console.log(
    "\n    Los nodos base no vienen en el Excel: cada estudio los toma de\n" +
      "    BASE_NODOS_ESTUDIO en config_erp mientras no se le capture uno propio.",
  );

  // ── Contra lo que ya hay ───────────────────────────────────────────────────
  const base = await leerBase();
  const altas: string[] = [];
  const cambios: Array<Campo & { codigo: string }> = [];
  let iguales = 0;

  for (const s of servicios) {
    const { clase, campos } = clasificar(s, base.get(s.codigo));
    if (clase === "ALTA") altas.push(s.codigo);
    else if (clase === "IGUAL") iguales++;
    for (const c of campos) cambios.push({ codigo: s.codigo, ...c });
  }

  const enExcel = new Set(servicios.map((s) => s.codigo));
  const soloEnBase = [...base.keys()].filter((c) => !enExcel.has(c));

  console.log(`\n🗃️  Contra ${HOST}:`);
  console.log(
    `    ${altas.length} altas · ${new Set(cambios.map((c) => c.codigo)).size} con cambios · ` +
      `${iguales} sin cambio`,
  );
  for (const c of cambios) {
    console.log(`    ~ ${c.codigo.padEnd(24)} ${c.campo}: ${c.antes ?? "—"} → ${c.despues ?? "—"}`);
  }
  if (soloEnBase.length) {
    console.log(
      `    ${soloEnBase.length} códigos están en la base y no en el Excel; se quedan como están:\n` +
        `      ${soloEnBase.join(", ")}\n` +
        "      Darlos de baja es una decisión de alguien, no de un script.",
    );
  }

  if (!banderas.escribe) {
    console.log(`\n👀  Solo reporte. Para escribir: --aplicar --destino=${HOST}\n`);
    return;
  }

  const lote = sentencias(servicios, cambios);
  const { aplicado } = await ejecutarLote(sql, lote, banderas);

  if (!aplicado) {
    console.log(
      `\n✅  Ensayo correcto: las ${lote.length} sentencias se ejecutaron sin error y la\n` +
        "    transacción revirtió. No quedó nada escrito.\n",
    );
    return;
  }
  console.log(
    `\n✅  Catálogo cargado: ${servicios.length} servicios` +
      `${cambios.length ? ` y ${cambios.length} cambios en el historial` : ""}.\n`,
  );
}

main().catch((err) => {
  console.error("\n❌ ", err instanceof Error ? err.message : err);
  process.exit(1);
});
