/**
 * Recarga las cotizaciones y órdenes de trabajo de 2026 desde los controles en
 * Excel.
 *
 * La base de `app-pruebas` se cargó el 5 de octubre con INSERT generados fuera
 * del repositorio, y quedó con 12 OC perdidas, 20 versiones faltantes, estatus
 * desactualizados y la OC/OT de la 002 en la versión equivocada. En vez de
 * parchar fila por fila, se recarga desde la fuente con un importador que vive
 * en el repositorio y que sirve igual para producción.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin --aplicar solo reporta.
 *
 * Uso, desde la raíz del repositorio:
 *   pnpm importar:2026
 *   pnpm importar:2026 --aplicar --destino=ep-xxx.neon.tech --limpiar
 *
 * Fuentes, en `importacion/` (fuera del repositorio):
 *   control-cotizaciones-2026.xlsx   hoja "Cotizaciones 2026"
 *   control-proceso-2026.xlsx        hoja "Proceso 2026"
 *   control-ot-2026.xlsx             hoja "Ordenes de Trabajo 2026"
 *
 * Variables: DATABASE_URL y, opcionalmente, PRODUCTION_DATABASE_HOST.
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { LibroExcel, texto, fechaDeSerial } from "../apps/web/src/lib/excel";
import {
  aplicarAjustes,
  esFilaCargable,
  leerAjustes,
  leerFilaCotizacion,
  mapearEstatusOT,
  normalizarRazon,
  otRepetidas,
  resolverCliente,
  resolverFolioOT,
  revisarCotizacion,
  versionesNoAsignadas,
  type AjusteAplicado,
  type FilaCotizacion,
  type Hallazgo,
} from "../apps/web/src/lib/importacion-2026";
import { ESTATUS_COTIZACION } from "../apps/web/src/lib/cotizaciones";

config({ path: "apps/web/.env.local" });

const ANIO = 2026;
const DIR = "importacion";
const USUARIO = "importador";
const DETALLE_BITACORA = "carga inicial desde Control de Cotizaciones 2026";

const APLICAR = process.argv.includes("--aplicar");
const LIMPIAR = process.argv.includes("--limpiar");
const DESTINO = (process.argv.find((a) => a.startsWith("--destino=")) ?? "").split("=")[1] ?? null;

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}

const HOST = new URL(process.env.DATABASE_URL).host;
const sql = neon(process.env.DATABASE_URL);

// ── Guardas de destino ────────────────────────────────────────────────────────

/**
 * Escribir exige nombrar el host al que se escribe.
 *
 * `DATABASE_URL` apunta a lo que tenga el `.env.local` de quien ejecuta, y este
 * script borra y recarga un año entero. Teclear el host es la confirmación de
 * que quien corre esto sabe en qué base está parado.
 */
function verificarDestino(): void {
  console.log(`🔌  Base: ${HOST}\n`);

  const produccion = process.env.PRODUCTION_DATABASE_HOST?.trim();
  if (produccion && HOST === produccion) {
    console.error(
      `❌  ${HOST} es el host de producción (PRODUCTION_DATABASE_HOST).\n` +
        "    Este script borra y recarga un año completo; no se ejecuta aquí.\n" +
        "    Para cargar producción, hazlo sobre una rama de Neon y promuévela.",
    );
    process.exit(1);
  }

  if (!APLICAR) return;

  if (!DESTINO) {
    console.error(
      `❌  Para escribir hay que nombrar el destino:\n       --destino=${HOST}`,
    );
    process.exit(1);
  }
  if (DESTINO !== HOST) {
    console.error(`❌  --destino=${DESTINO} no es la base conectada (${HOST}). No se escribe nada.`);
    process.exit(1);
  }
}

// ── Lectura de las tres fuentes ───────────────────────────────────────────────

function abrir(archivo: string): LibroExcel {
  try {
    return LibroExcel.desdeBuffer(readFileSync(`${DIR}/${archivo}`));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error(`❌  No se pudo leer ${DIR}/${archivo}: ${motivo}`);
    process.exit(1);
  }
}

/** Filas de datos del Control de Cotizaciones, ya convertidas. */
function leerCotizaciones(): FilaCotizacion[] {
  const libro = abrir("control-cotizaciones-2026.xlsx");
  const fuera: FilaCotizacion[] = [];
  for (const { numero, celdas } of libro.filas("Cotizaciones 2026")) {
    if (numero < 9) continue;
    const fila = leerFilaCotizacion(numero, celdas);
    if (fila && fila.anio === ANIO && esFilaCargable(fila.numero, fila.estatus)) fuera.push(fila);
  }
  return fuera;
}

/** `${numero}-${version}` → folio de OT, según el Control de Proceso. */
function leerOtDeProceso(): Map<string, string> {
  const libro = abrir("control-proceso-2026.xlsx");
  const fuera = new Map<string, string>();
  for (const { numero, celdas } of libro.filas("Proceso 2026")) {
    if (numero < 9 || texto(celdas.B).toUpperCase() !== "PCOTOP") continue;
    const ot = texto(celdas.K);
    if (!ot || ot === "-") continue;
    const clave = `${parseInt(texto(celdas.C), 10)}-${parseInt(texto(celdas.E) || "0", 10)}`;
    if (!fuera.has(clave)) fuera.set(clave, ot);
  }
  return fuera;
}

interface FilaControlOT {
  folio: string;
  estatusCrudo: string;
}

/**
 * El Control de OT, indexado de dos formas: por `${numero}-${version}` para la
 * validación cruzada, y por folio para poder encontrar el estatus de una OT que
 * los controles guardan bajo otro folio (ver `equivalenciaOt`).
 */
function leerControlOT(): { porClave: Map<string, FilaControlOT>; porFolio: Map<string, FilaControlOT> } {
  const libro = abrir("control-ot-2026.xlsx");
  const porClave = new Map<string, FilaControlOT>();
  const porFolio = new Map<string, FilaControlOT>();
  for (const { numero, celdas } of libro.filas("Ordenes de Trabajo 2026")) {
    if (numero < 9 || texto(celdas.B).toUpperCase() !== "OT") continue;
    const folio = texto(celdas.J);
    if (!folio || folio === "-") continue;
    const fila = { folio, estatusCrudo: texto(celdas.K) };
    porClave.set(`${parseInt(texto(celdas.C), 10)}-${parseInt(texto(celdas.E) || "0", 10)}`, fila);
    porFolio.set(folio.trim().toUpperCase(), fila);
  }
  return { porClave, porFolio };
}

// ── Armado de la carga ────────────────────────────────────────────────────────

interface Cargable {
  cotizacion: FilaCotizacion;
  /** El estatus final, ya con NO ASIGNADA aplicada. */
  estatusFinal: string;
  clienteId: string | null;
  altaCliente: string | null;
  ot: { folio: string; estatus: string } | null;
}

async function main() {
  console.log(
    `🔁  Recarga de ${ANIO} desde los controles en Excel` +
      `${APLICAR ? "" : "  (REPORTE — no escribe nada)"}\n`,
  );
  verificarDestino();

  const filas = leerCotizaciones();
  const otProceso = leerOtDeProceso();
  const controlOT = leerControlOT();
  console.log(
    `📖  Cotizaciones: ${filas.length} versiones · Proceso: ${otProceso.size} OT · Control de OT: ${controlOT.porClave.size} OT\n`,
  );

  // Los ajustes entran aquí: sobre las filas ya leídas y antes de que ninguna
  // regla las mire, para que todo lo que sigue —descartes, OT, verificación—
  // trabaje sobre la versión de los datos que la operación considera buena.
  const lectura = leerAjustes(
    JSON.parse(readFileSync("scripts/ajustes-importacion-2026.json", "utf-8")),
  );
  const ajustados = aplicarAjustes(filas, lectura.ajustes);

  const alias: Record<string, string> = JSON.parse(
    readFileSync("scripts/alias-clientes.json", "utf-8"),
  );
  delete (alias as Record<string, unknown>)._comentario as never;

  const catalogo = (await sql(
    `SELECT id, razon_social, razon_normalizada FROM clientes`,
  )) as Array<{ id: string; razon_social: string; razon_normalizada: string }>;

  const hallazgos: Hallazgo[] = [
    ...lectura.hallazgos,
    ...ajustados.hallazgos,
    ...otRepetidas(filas),
  ];
  const cargables: Cargable[] = [];
  const bloqueadas = new Set<number>();
  /** Razón social → filas que la necesitan, para dar de alta una sola vez. */
  const altasCliente = new Map<string, string>();

  // ── Por cotización ──────────────────────────────────────────────────────────
  const porNumero = new Map<number, FilaCotizacion[]>();
  for (const f of filas) {
    porNumero.set(f.numero, [...(porNumero.get(f.numero) ?? []), f]);
  }

  for (const [numero, versiones] of [...porNumero].sort((a, b) => a[0] - b[0])) {
    const ref = `${String(numero).padStart(3, "0")}-${ANIO}`;
    const propios = revisarCotizacion(numero, ANIO, versiones, ESTATUS_COTIZACION);
    hallazgos.push(...propios);

    const descarte = versionesNoAsignadas(
      versiones.map((v) => ({ version: v.version, estatus: v.estatus })),
      ref,
    );
    hallazgos.push(...descarte.hallazgos);

    const propiosBloqueantes = [...propios, ...descarte.hallazgos].some(
      (h) => h.severidad === "bloqueante",
    );
    if (propiosBloqueantes) {
      bloqueadas.add(numero);
      continue;
    }

    for (const v of versiones) {
      const clave = `${v.numero}-${v.version}`;
      const cliente = resolverCliente({
        nombreExcel: v.cliente,
        catalogo: catalogo.map((c) => ({ id: c.id, razonNormalizada: c.razon_normalizada })),
        alias,
      });
      hallazgos.push(...cliente.hallazgos);
      if (cliente.altaComo) altasCliente.set(normalizarRazon(cliente.altaComo), cliente.altaComo);

      const estatusFinal = descarte.descartadas.includes(v.version) ? "NO ASIGNADA" : v.estatus;

      // ── OT: solo las ASIGNADA ────────────────────────────────────────────
      let ot: Cargable["ot"] = null;
      if (estatusFinal === "ASIGNADA") {
        const equivalencia = ajustados.equivalencias.get(clave) ?? null;
        const resuelto = resolverFolioOT({
          numero: v.numero,
          anio: v.anio,
          version: v.version,
          deCotizaciones: v.folioOt,
          deProceso: otProceso.get(clave) ?? null,
          deControlOT: controlOT.porClave.get(clave)?.folio ?? null,
          equivalenciaOt: equivalencia,
        });
        hallazgos.push(...resuelto.hallazgos);

        if (resuelto.folio) {
          // Con equivalencia, el estatus se busca por el folio con el que la OT
          // vive en el control, no por (numero, version): el control no tiene
          // una fila para esta versión.
          const enControl = equivalencia
            ? controlOT.porFolio.get(equivalencia)
            : controlOT.porClave.get(clave);
          const estatus = mapearEstatusOT(enControl?.estatusCrudo ?? "", resuelto.folio);
          hallazgos.push(...estatus.hallazgos);
          if (estatus.estatus !== null) ot = { folio: resuelto.folio, estatus: estatus.estatus };
        }
      }

      cargables.push({
        cotizacion: v,
        estatusFinal,
        clienteId: cliente.clienteId,
        altaCliente: cliente.altaComo,
        ot,
      });
    }
  }

  // ── Reporte ─────────────────────────────────────────────────────────────────
  const bloqueantes = hallazgos.filter((h) => h.severidad === "bloqueante");
  const avisos = hallazgos.filter((h) => h.severidad === "aviso");
  const informativos = hallazgos.filter((h) => h.severidad === "informativo");

  imprimirAjustes(ajustados.aplicados);
  imprimirHallazgos("BLOQUEANTES", bloqueantes);
  imprimirHallazgos("Avisos", avisos);
  imprimirHallazgos("Informativo (no requiere acción)", informativos);

  console.log(
    `📦  Se cargarían ${cargables.length} versiones de ${porNumero.size - bloqueadas.size} ` +
      `cotizaciones, ${cargables.filter((c) => c.ot).length} OT y ${altasCliente.size} clientes nuevos,` +
      `
    con ${ajustados.aplicados.length} ajustes de operación aplicados.`,
  );
  if (bloqueadas.size > 0) {
    console.log(`    ${bloqueadas.size} cotizaciones NO se cargan: ${[...bloqueadas].join(", ")}`);
  }

  const reporte = {
    corrida: new Date().toISOString(),
    modo: APLICAR ? "aplicar" : "reporte",
    host: HOST,
    totales: {
      versionesLeidas: filas.length,
      versionesCargables: cargables.length,
      cotizacionesBloqueadas: bloqueadas.size,
      ot: cargables.filter((c) => c.ot).length,
      clientesNuevos: altasCliente.size,
      ajustesAplicados: ajustados.aplicados.length,
      bloqueantes: bloqueantes.length,
      avisos: avisos.length,
      informativos: informativos.length,
    },
    cotizacionesBloqueadas: [...bloqueadas],
    clientesNuevos: [...altasCliente.values()],
    ajustesAplicados: ajustados.aplicados.map((a) => ({
      cotizacion: `${String(a.ajuste.cotizacion).padStart(3, "0")}-${a.ajuste.anio} v${a.ajuste.version}`,
      cambios: a.cambios,
      motivo: a.ajuste.motivo,
    })),
    bloqueantes,
    avisos,
    informativos,
  };
  mkdirSync(`${DIR}/reportes`, { recursive: true });
  const archivo = `${DIR}/reportes/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(archivo, JSON.stringify(reporte, null, 2), "utf-8");
  console.log(`\n📄  Reporte completo: ${archivo}`);

  if (!APLICAR) {
    console.log("\n📋  Reporte, no se escribió nada. Con --aplicar se aplica la carga.\n");
    return;
  }

  if (bloqueantes.length > 0) {
    console.error(
      `\n❌  Hay ${bloqueantes.length} hallazgos bloqueantes. Corrígelos en los Excel y vuelve\n` +
        "    a correr el reporte: la carga solo se aplica cuando sale limpia.\n",
    );
    process.exit(1);
  }

  await aplicar(cargables, altasCliente);
  await verificar(cargables);
}

/** Cada ajuste aplicado, con lo que cambió y por qué. */
function imprimirAjustes(aplicados: AjusteAplicado[]) {
  if (aplicados.length === 0) return;
  console.log(`── Ajustes de operación aplicados (${aplicados.length}) ──`);
  for (const { ajuste, cambios } of aplicados) {
    const ref = `${String(ajuste.cotizacion).padStart(3, "0")}-${ajuste.anio} v${ajuste.version}`;
    console.log(`  ${ref}: ${cambios.join(" · ")}`);
    console.log(`    motivo: ${ajuste.motivo}`);
  }
  console.log();
}

function imprimirHallazgos(titulo: string, lista: Hallazgo[]) {
  if (lista.length === 0) return;
  console.log(`── ${titulo} (${lista.length}) ──`);
  const porTipo = new Map<string, Hallazgo[]>();
  for (const h of lista) porTipo.set(h.tipo, [...(porTipo.get(h.tipo) ?? []), h]);
  for (const [tipo, hs] of porTipo) {
    // Un cliente nuevo lo señalan todas sus filas, pero el alta es una sola:
    // repetir la línea por cada fila convertía 7 altas en 16 renglones.
    const unicos = [...new Map(hs.map((h) => [`${h.referencia}|${h.mensaje}`, h])).values()];
    console.log(`  ${tipo} (${unicos.length})`);
    for (const h of unicos) console.log(`    ${h.referencia}: ${h.mensaje}`);
  }
  console.log();
}

// ── Escritura ─────────────────────────────────────────────────────────────────

async function aplicar(cargables: Cargable[], altas: Map<string, string>) {
  const existentes = (await sql(
    `SELECT count(*)::int AS n FROM cotizaciones WHERE anio = ${ANIO}`,
  )) as Array<{ n: number }>;

  if (existentes[0].n > 0 && !LIMPIAR) {
    console.error(
      `❌  Ya hay ${existentes[0].n} cotizaciones de ${ANIO} en ${HOST}.\n` +
        "    Usa --limpiar para reemplazarlas, o apunta a una base vacía.",
    );
    process.exit(1);
  }

  // Un solo lote: el driver HTTP de Neon no tiene transacciones interactivas,
  // pero sí ejecuta un arreglo de sentencias como una sola transacción. Importa
  // aquí más que en ningún otro script: entre el borrado y la carga no puede
  // haber un instante con el año a medias.
  const lote = [];

  if (LIMPIAR) {
    // En orden de dependencia: los responsables cuelgan de la OT, y la OT de
    // la cotización. `ot_responsables` cae por ON DELETE CASCADE, pero se
    // borra explícitamente para que el orden quede escrito.
    lote.push(
      sql(`DELETE FROM ot_responsables WHERE folio_ot IN (
             SELECT folio FROM ordenes_trabajo WHERE anio = ${ANIO})`),
      sql(`DELETE FROM aprobaciones WHERE anio = ${ANIO}`),
      sql(`DELETE FROM ordenes_trabajo WHERE anio = ${ANIO}`),
      sql(`DELETE FROM bitacora WHERE referencia LIKE '%-${ANIO}'`),
      sql(`DELETE FROM cotizaciones WHERE anio = ${ANIO}`),
    );
  }

  for (const razon of altas.values()) {
    lote.push(
      sql(`INSERT INTO clientes (id, razon_social, razon_normalizada, created_by)
           VALUES (gen_random_uuid()::text, ${razon}, ${normalizarRazon(razon)}, ${USUARIO})
           ON CONFLICT DO NOTHING`),
    );
  }

  console.log(`\n✍️   Escribiendo ${cargables.length} versiones…`);
  await sql.transaction(lote);

  // Los ids de los clientes recién creados hacen falta para ligar las filas.
  const catalogo = (await sql(`SELECT id, razon_normalizada FROM clientes`)) as Array<{
    id: string;
    razon_normalizada: string;
  }>;
  const porNorm = new Map(catalogo.map((c) => [normalizarRazon(c.razon_normalizada), c.id]));

  const segundo = [];
  for (const c of cargables) {
    const v = c.cotizacion;
    const clienteId =
      c.clienteId ?? (c.altaCliente ? (porNorm.get(normalizarRazon(c.altaCliente)) ?? null) : null);

    segundo.push(
      sql(`INSERT INTO cotizaciones
             (numero, anio, version, folio, cliente, cliente_id, titulo, dirigida_a,
              prioridad, estatus, elaboro, fecha_solicitud, fecha_entrega,
              orden_compra, folio_ot, created_by)
           VALUES (${v.numero}, ${v.anio}, ${v.version}, ${v.folio}, ${v.cliente}, ${clienteId},
                   ${v.titulo}, ${v.dirigidaA}, ${v.prioridad}, ${c.estatusFinal}, ${v.elaboro},
                   ${fechaDeSerial(v.fechaSolicitud!).toISOString()},
                   ${v.fechaEntrega === null ? null : fechaDeSerial(v.fechaEntrega).toISOString()},
                   ${v.ordenCompra}, ${c.ot?.folio ?? null}, ${USUARIO})`),
    );

    if (c.ot) {
      segundo.push(
        sql(`INSERT INTO ordenes_trabajo
               (folio, numero_cotizacion, anio, version, orden_compra, cliente, titulo,
                dirigida_a, estatus, created_by)
             VALUES (${c.ot.folio}, ${v.numero}, ${v.anio}, ${v.version}, ${v.ordenCompra},
                     ${v.cliente}, ${v.titulo}, ${v.dirigidaA}, ${c.ot.estatus}, ${USUARIO})`),
      );
    }
  }

  // Una entrada por cotización, no por versión: lo que pasó es una carga, no
  // un cambio de estatus por fila.
  for (const numero of new Set(cargables.map((c) => c.cotizacion.numero))) {
    segundo.push(
      sql(`INSERT INTO bitacora (id, accion, usuario, referencia, detalle)
           VALUES (gen_random_uuid()::text, 'COTIZACION_IMPORTADA', ${USUARIO},
                   ${`${String(numero).padStart(3, "0")}-${ANIO}`}, ${DETALLE_BITACORA})`),
    );
  }

  await sql.transaction(segundo);
  console.log("✅  Carga aplicada.\n");
}

// ── Verificación contra los Excel ─────────────────────────────────────────────

async function verificar(cargables: Cargable[]) {
  console.log("🔎  Verificando contra los Excel, versión por versión…");

  const enBase = (await sql(
    `SELECT numero, version, folio, estatus, orden_compra, folio_ot
       FROM cotizaciones WHERE anio = ${ANIO}`,
  )) as Array<{
    numero: number;
    version: number;
    folio: string;
    estatus: string;
    orden_compra: string | null;
    folio_ot: string | null;
  }>;
  const porClave = new Map(enBase.map((c) => [`${c.numero}-${c.version}`, c]));

  const malas: string[] = [];
  for (const c of cargables) {
    const v = c.cotizacion;
    const fila = porClave.get(`${v.numero}-${v.version}`);
    const ref = `${v.folio}`;
    if (!fila) {
      malas.push(`${ref}: no quedó en la base`);
      continue;
    }
    if (fila.folio !== v.folio) malas.push(`${ref}: folio ${fila.folio}`);
    if (fila.estatus !== c.estatusFinal) malas.push(`${ref}: estatus ${fila.estatus} ≠ ${c.estatusFinal}`);
    if ((fila.orden_compra ?? null) !== v.ordenCompra) {
      malas.push(`${ref}: OC ${fila.orden_compra} ≠ ${v.ordenCompra}`);
    }
    if ((fila.folio_ot ?? null) !== (c.ot?.folio ?? null)) {
      malas.push(`${ref}: OT ${fila.folio_ot} ≠ ${c.ot?.folio ?? null}`);
    }
  }

  const sobran = enBase.length - cargables.length;
  if (sobran !== 0) malas.push(`la base tiene ${enBase.length} filas y se cargaron ${cargables.length}`);

  if (malas.length === 0) {
    console.log(`✅  Las ${cargables.length} versiones coinciden con el Excel.\n`);
    return;
  }
  console.error(`❌  ${malas.length} diferencias tras la carga:`);
  for (const m of malas.slice(0, 30)) console.error(`    ${m}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("❌  Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
