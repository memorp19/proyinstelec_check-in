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
 *   --dar-de-baja      pone activo = false en los códigos que ya no vienen en
 *                      el Excel (solo con --aplicar; sin esto se reportan y no
 *                      se tocan)
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
import { cabeEnEscala, decimalesDe, ESCALA_MONTO } from "../apps/web/src/lib/cotizador/persistencia";
import { ejecutarLote, leerBanderas, opcion, verificarDestino } from "./guardas";

config({ path: "apps/web/.env.local" });

const HOJA = "COSTOS";
const ARCHIVO = opcion("archivo") ?? "importacion/catalogo-2026.xlsx";
const USUARIO = opcion("usuario") ?? "importador";
const MOTIVO = opcion("motivo") ?? "Carga del catálogo 2026 (PFAD-024-2026)";
/** Todo el formato está en pesos; no hay una columna de moneda. */
const MONEDA = "MXN";

const banderas = leerBanderas();

/**
 * Dar de baja los códigos que ya no vienen en el Excel.
 *
 * Es una bandera aparte de `--aplicar` a propósito. El reporte SIEMPRE lista
 * los sobrantes, pero apagarlos es otra cosa: una corrida con el archivo
 * equivocado —una versión vieja, una hoja a medio llenar— dejaría medio
 * catálogo inactivo de una sola pasada. Que haya que teclearlo convierte el
 * descuido en una decisión.
 *
 * Nunca borra: un código inactivo sigue existiendo porque hay cotizaciones
 * viejas que lo citan.
 */
const DAR_DE_BAJA = process.argv.includes("--dar-de-baja");

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
  /**
   * Valores con más decimales de los que la columna guarda. **Detienen la
   * carga**: Postgres los redondearía sin decir nada, y un costo redondeado
   * mueve el total de cada cotización que lo use.
   */
  excesos: Array<{ codigo: string; campo: string; valor: string; decimales: number }>;
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
  const excesos: Lectura["excesos"] = [];
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

    // Se cuenta sobre el texto de la celda: el número ya convertido no sirve
    // para saber cuántos decimales traía de verdad.
    if (fila.costoCrudo && !cabeEnEscala(fila.costoCrudo)) {
      excesos.push({
        codigo: fila.codigo,
        campo: "costo (ZK)",
        valor: fila.costoCrudo,
        decimales: decimalesDe(fila.costoCrudo),
      });
    }
    if (esfuerzo && !cabeEnEscala(esfuerzo.tarifaHora)) {
      excesos.push({
        codigo: fila.codigo,
        campo: "tarifa por hora",
        valor: String(esfuerzo.tarifaHora),
        decimales: decimalesDe(esfuerzo.tarifaHora),
      });
    }

    servicios.push({ ...fila, familia: familiaDeFila(fila.codigo), tipo, esfuerzo });
  }

  return { servicios, huecos, separadores, desacuerdos, sinBloque, excesos };
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
        -- La columna activo NO se toca al actualizar: un alta entra activa,
        -- pero un código que alguien apagó a mano no revive por volver a
        -- cargar el Excel. Encenderlo y apagarlo son decisiones de una
        -- persona, no efectos de una corrida.
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

/**
 * Las bajas: `activo = false` y su renglón en el historial, con motivo.
 *
 * No se borra el código. Hay cotizaciones de años anteriores que lo citan, y
 * un catálogo que pierde un renglón deja esas cotizaciones hablando de algo
 * que ya no existe.
 */
function bajas(codigos: string[]) {
  const lote: unknown[] = [];
  for (const codigo of codigos) {
    lote.push(sql`
      UPDATE cat_servicios
         SET activo = false, updated_at = now(), updated_by = ${USUARIO}
       WHERE codigo = ${codigo} AND activo = true
    `);
    lote.push(sql`
      INSERT INTO cat_servicios_cambios (id, codigo, campo, antes, despues, usuario, motivo)
      VALUES (${randomUUID()}, ${codigo}, ${"activo"}, ${"true"}, ${"false"}, ${USUARIO},
              ${`${MOTIVO} — el código ya no viene en el Excel`})
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

  // Un valor que no cabe en la columna no se carga recortado: se detiene todo.
  // Redondearlo en silencio es lo que movió el total de la 068 diez centavos.
  if (lectura.excesos.length) {
    console.error(
      `\n❌  ${lectura.excesos.length} valores traen más de ${ESCALA_MONTO} decimales y la columna\n` +
        "    los redondearía sin avisar. No se carga nada:\n",
    );
    for (const e of lectura.excesos) {
      console.error(`    ${e.codigo.padEnd(24)} ${e.campo}: ${e.valor} (${e.decimales} decimales)`);
    }
    console.error(
      "\n    Corrige el Excel, o sube la escala de la columna en el esquema si el\n" +
        "    dato de verdad necesita esos decimales.\n",
    );
    process.exit(1);
  }

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

  // Están en el Excel y apagados en la base: la carga ya no los enciende sola,
  // así que hay que poder verlos.
  const apagadosEnBase = servicios
    .map((s) => s.codigo)
    .filter((c) => base.has(c) && !base.get(c)!.activo);
  if (apagadosEnBase.length) {
    console.log(
      `
    ${apagadosEnBase.length} vienen en el Excel pero están inactivos en la base:
` +
        `      ${apagadosEnBase.join(", ")}
` +
        "      Se actualizan sus datos y siguen inactivos. Encenderlos es a mano.",
    );
  }
  const soloEnBase = [...base.keys()].filter((c) => !enExcel.has(c));

  console.log(`\n🗃️  Contra ${HOST}:`);
  console.log(
    `    ${altas.length} altas · ${new Set(cambios.map((c) => c.codigo)).size} con cambios · ` +
      `${iguales} sin cambio`,
  );
  for (const c of cambios) {
    console.log(`    ~ ${c.codigo.padEnd(24)} ${c.campo}: ${c.antes ?? "—"} → ${c.despues ?? "—"}`);
  }
  // Los sobrantes se listan SIEMPRE, vengan o no acompañados de --dar-de-baja:
  // un servicio retirado del catálogo que se sigue ofreciendo es justo lo que
  // nadie nota hasta que aparece en una cotización.
  const activosSobrantes = soloEnBase.filter((c) => base.get(c)?.activo);
  if (soloEnBase.length) {
    console.log(
      `\n    ${soloEnBase.length} códigos están en la base y no vienen en el Excel ` +
        `(${activosSobrantes.length} siguen activos):`,
    );
    for (const c of soloEnBase) {
      console.log(`    ${base.get(c)?.activo ? "·" : "×"} ${c.padEnd(24)} ${base.get(c)?.descripcion ?? ""}`);
    }
    console.log(
      DAR_DE_BAJA
        ? `      Se van a dar de baja los ${activosSobrantes.length} activos (activo = false).`
        : "      Se quedan como están. Para apagarlos: --dar-de-baja (además de --aplicar).",
    );
  }

  if (!banderas.escribe) {
    console.log(`\n👀  Solo reporte. Para escribir: --aplicar --destino=${HOST}\n`);
    return;
  }

  const lote = sentencias(servicios, cambios);
  if (DAR_DE_BAJA && activosSobrantes.length) lote.push(...bajas(activosSobrantes));
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
      `${cambios.length ? ` y ${cambios.length} cambios en el historial` : ""}` +
      `${DAR_DE_BAJA && activosSobrantes.length ? ` · ${activosSobrantes.length} dados de baja` : ""}.\n`,
  );
}

main().catch((err) => {
  console.error("\n❌ ", err instanceof Error ? err.message : err);
  process.exit(1);
});
