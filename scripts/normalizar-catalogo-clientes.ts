/**
 * Limpia las columnas normalizadas del catálogo de clientes:
 * `clientes.razon_normalizada` y `contactos.nombre_normalizado`.
 *
 * Una carga anterior las escribió en mayúsculas, con acentos y con el sufijo
 * legal intacto —nunca pasaron por el normalizador—. Eso las vuelve inútiles
 * para lo único que hacen: reconocer a alguien que ya está dado de alta.
 *
 * Lo que de verdad arregla es el índice `UNIQUE (cliente_id,
 * nombre_normalizado)`. Compara cadenas, así que mientras convivan
 * `"ADRIAN RAMIREZ"` y `adrian ramirez` el índice no protege de nada y un alta
 * por la pantalla del ERP crea el duplicado en silencio.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin `--aplicar` solo reporta.
 *
 * **Se detiene si hay choques.** Si al limpiarse dos filas del mismo grupo
 * quedan con la misma llave, es que ya eran duplicados y la columna sucia los
 * tenía escondidos. Escribirlos rompería el índice; cuál se queda lo decide
 * una persona.
 *
 * Uso, desde la raíz del repositorio:
 *   pnpm clientes:normalizar                                    # solo reporta
 *   pnpm clientes:normalizar --ensayo  --destino=ep-xxx.neon.tech
 *   pnpm clientes:normalizar --aplicar --destino=ep-xxx.neon.tech
 *
 * Opciones:
 *   --reporte=<ruta>   guarda el reporte en JSON (ponlo fuera del repositorio)
 *
 * Variables: DATABASE_URL y, opcionalmente, PRODUCTION_DATABASE_HOST.
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import {
  corregirCliente,
  corregirContacto,
  normalizarDeCliente,
  normalizarDeContacto,
  planearLimpieza,
  type FilaNormalizable,
  type PlanDeLimpieza,
} from "../apps/web/src/lib/normalizacion-catalogo";
import { ejecutarLote, leerBanderas, opcion, verificarDestino } from "./guardas";

config({ path: "apps/web/.env.local" });

const REPORTE = opcion("reporte");
const banderas = leerBanderas();

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const HOST = new URL(process.env.DATABASE_URL).host;

// ── Lectura ───────────────────────────────────────────────────────────────────

async function leerClientes(): Promise<FilaNormalizable[]> {
  const filas = (await sql`
    SELECT id, razon_social, razon_normalizada FROM clientes ORDER BY razon_social
  `) as Array<{ id: string; razon_social: string; razon_normalizada: string }>;
  return filas.map((f) => ({
    id: f.id,
    texto: f.razon_social,
    normalizadoActual: f.razon_normalizada,
  }));
}

async function leerContactos(): Promise<FilaNormalizable[]> {
  const filas = (await sql`
    SELECT id, cliente_id, nombre, nombre_normalizado FROM contactos ORDER BY nombre
  `) as Array<{ id: string; cliente_id: string; nombre: string; nombre_normalizado: string }>;
  return filas.map((f) => ({
    id: f.id,
    texto: f.nombre,
    normalizadoActual: f.nombre_normalizado,
    // La llave es única por cliente, no en toda la tabla.
    grupo: f.cliente_id,
  }));
}

// ── Reporte ───────────────────────────────────────────────────────────────────

function reportar(titulo: string, plan: PlanDeLimpieza, total: number): void {
  console.log(
    `\n${titulo}: ${total} filas · ${plan.correctas} ya correctas · ` +
      `${plan.correcciones.length} a corregir`,
  );
  for (const c of plan.correcciones.slice(0, 20)) {
    console.log(`    ${c.texto}`);
    console.log(`        ${JSON.stringify(c.antes)}  →  ${JSON.stringify(c.despues)}`);
  }
  if (plan.correcciones.length > 20) {
    console.log(`    … y ${plan.correcciones.length - 20} más (están completas en --reporte)`);
  }
}

function reportarChoques(titulo: string, plan: PlanDeLimpieza): void {
  if (plan.choques.length === 0) return;
  console.error(`\n❌  ${titulo}: ${plan.choques.length} choques al limpiar.`);
  console.error("    Estas filas quedarían con la misma llave, así que YA son duplicados:\n");
  for (const ch of plan.choques) {
    console.error(`    ${JSON.stringify(ch.valor)}${ch.grupo ? `  (cliente ${ch.grupo})` : ""}`);
    for (const f of ch.filas) console.error(`        ${f.id}  ${f.texto}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const modo = banderas.ensayo
    ? "  (ENSAYO — escribe y revierte)"
    : banderas.aplicar
      ? ""
      : "  (REPORTE — no escribe nada)";
  console.log(`\n🧼  Normalización del catálogo de clientes${modo}\n`);
  verificarDestino(HOST, banderas, "Este script reescribe las columnas normalizadas");

  const filasClientes = await leerClientes();
  const filasContactos = await leerContactos();
  const planClientes = planearLimpieza(filasClientes, normalizarDeCliente);
  const planContactos = planearLimpieza(filasContactos, normalizarDeContacto);

  reportar("🏢  clientes.razon_normalizada", planClientes, filasClientes.length);
  reportar("👤  contactos.nombre_normalizado", planContactos, filasContactos.length);

  if (REPORTE) {
    writeFileSync(
      REPORTE,
      JSON.stringify({ host: HOST, clientes: planClientes, contactos: planContactos }, null, 2),
      "utf-8",
    );
    console.log(`\n💾  Reporte en ${REPORTE}`);
  }

  reportarChoques("🏢  clientes", planClientes);
  reportarChoques("👤  contactos", planContactos);
  if (planClientes.choques.length || planContactos.choques.length) {
    console.error(
      "\n    No se escribe nada. Resuelve los duplicados —decide cuál se queda—\n" +
        "    y vuelve a correr esto.\n",
    );
    process.exit(1);
  }

  const lote = [
    ...planClientes.correcciones.map((c) => corregirCliente(sql, c)),
    ...planContactos.correcciones.map((c) => corregirContacto(sql, c)),
  ];
  if (lote.length === 0) {
    console.log("\n✅  Las dos columnas ya están limpias.\n");
    return;
  }

  if (!banderas.escribe) {
    console.log(`\n👀  Solo reporte. Para escribir: --aplicar --destino=${HOST}\n`);
    return;
  }

  const { aplicado } = await ejecutarLote(sql, lote, banderas);
  if (!aplicado) {
    console.log(
      `\n✅  Ensayo correcto: las ${lote.length} sentencias se ejecutaron sin error y la\n` +
        "    transacción revirtió. No quedó nada escrito.\n",
    );
    return;
  }

  console.log(
    `\n✅  Aplicado: ${planClientes.correcciones.length} razones sociales y ` +
      `${planContactos.correcciones.length} nombres normalizados de nuevo.\n`,
  );
}

main().catch((err) => {
  console.error("\n❌ ", err instanceof Error ? err.message : err);
  process.exit(1);
});
