/**
 * Carga el catálogo de clientes —direcciones y contactos— desde la hoja
 * `Clientes` del control, en Google Sheets.
 *
 * Es lo que le falta al ERP para que la carta de una cotización salga
 * completa. El importador de 2026 (`importar:2026`) escribe la razón social y
 * nada más: `clientes.direccion` está vacía y no hay un solo contacto, así que
 * el bloque del destinatario llega a medias.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin `--aplicar` solo reporta.
 *
 * La regla: **solo llena lo que está vacío**. Un dato que ya existe y no
 * coincide se reporta y no se toca — pudo corregirlo una persona después de la
 * última carga, y esto no sabe más que ella. Tampoco crea clientes: una razón
 * social que no está en el ERP se reporta.
 *
 * Uso, desde la raíz del repositorio:
 *   pnpm clientes:importar                                    # solo reporta
 *   pnpm clientes:importar --ensayo  --destino=ep-xxx.neon.tech
 *   pnpm clientes:importar --aplicar --destino=ep-xxx.neon.tech
 *
 * Opciones:
 *   --hoja=<nombre>     la pestaña a leer (default: Clientes)
 *   --reporte=<ruta>    guarda el reporte en JSON (ponlo fuera del repositorio)
 *   --sobrescribir      reemplaza los datos que ya existen y no coinciden
 *                       (solo con --aplicar; sin esto se reportan y no se tocan)
 *
 * Variables: IMPORT_SHEET_CLIENTES_ID, DRIVE_SERVICE_ACCOUNT_KEY, DATABASE_URL
 * y, opcionalmente, PRODUCTION_DATABASE_HOST.
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";
import {
  leerFilaCliente,
  planearCarga,
  sentenciasDelPlan,
  type ClienteEnErp,
  type FilaClienteExcel,
  type Plan,
} from "../apps/web/src/lib/importacion-clientes";
import { ejecutarLote, leerBanderas, opcion, verificarDestino } from "./guardas";

config({ path: "apps/web/.env.local" });

const HOJA = opcion("hoja") ?? "Clientes";
const REPORTE = opcion("reporte");

/**
 * Pisar lo que ya está escrito es una decisión aparte de `--aplicar`.
 *
 * Una corrida con la hoja a medio llenar, o con una versión vieja, revertiría
 * de una pasada todas las correcciones que alguien hizo a mano en el ERP. Que
 * haya que teclearlo convierte el descuido en una decisión. El reporte lista
 * las diferencias siempre, se vaya a escribir o no.
 */
const SOBRESCRIBIR = process.argv.includes("--sobrescribir");

const banderas = leerBanderas();

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}
const SHEET_ID = process.env.IMPORT_SHEET_CLIENTES_ID;
if (!SHEET_ID) {
  console.error(
    "❌  Falta IMPORT_SHEET_CLIENTES_ID (apps/web/.env.local): es el archivo de\n" +
      "    Google con la hoja «Clientes». Es el mismo que usa import:erp.",
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const HOST = new URL(process.env.DATABASE_URL).host;

// ── La hoja ───────────────────────────────────────────────────────────────────

async function leerHoja(): Promise<{ filas: FilaClienteExcel[]; leidas: number }> {
  const keyJson = process.env.DRIVE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("Falta DRIVE_SERVICE_ACCOUNT_KEY (scope sheets.readonly)");
  const parsed = JSON.parse(keyJson);
  const auth = new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // Desde la fila 2: la 1 es el encabezado. El rango es el mismo que lee
  // `import:erp`, para que las dos cargas no puedan desalinearse.
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${HOJA}!A2:H`,
  });
  const valores = (res.data.values ?? []) as string[][];

  const filas: FilaClienteExcel[] = [];
  valores.forEach((v, i) => {
    const fila = leerFilaCliente(i + 2, v);
    if (fila) filas.push(fila);
  });
  return { filas, leidas: valores.length };
}

// ── Lo que ya hay ─────────────────────────────────────────────────────────────

async function leerBase(): Promise<ClienteEnErp[]> {
  const empresas = (await sql`
    SELECT id, razon_social, razon_normalizada, direccion FROM clientes ORDER BY razon_social
  `) as Array<{
    id: string;
    razon_social: string;
    razon_normalizada: string;
    direccion: string | null;
  }>;

  const personas = (await sql`
    SELECT id, cliente_id, nombre, nombre_normalizado, puesto, telefono, correo FROM contactos
  `) as Array<{
    id: string;
    cliente_id: string;
    nombre: string;
    nombre_normalizado: string;
    puesto: string | null;
    telefono: string | null;
    correo: string | null;
  }>;

  const porCliente = new Map<string, ClienteEnErp["contactos"]>();
  for (const p of personas) {
    const lista = porCliente.get(p.cliente_id) ?? [];
    lista.push({
      id: p.id,
      nombre: p.nombre,
      nombreNormalizado: p.nombre_normalizado,
      puesto: p.puesto,
      telefono: p.telefono,
      correo: p.correo,
    });
    porCliente.set(p.cliente_id, lista);
  }

  return empresas.map((e) => ({
    id: e.id,
    razonSocial: e.razon_social,
    razonNormalizada: e.razon_normalizada,
    direccion: e.direccion,
    contactos: porCliente.get(e.id) ?? [],
  }));
}

// ── Reporte ───────────────────────────────────────────────────────────────────

const lista = (titulo: string, renglones: string[], nota?: string) => {
  if (renglones.length === 0) return;
  console.log(`\n${titulo}`);
  for (const r of renglones) console.log(`    ${r}`);
  if (nota) console.log(`      ${nota}`);
};

function reportar(plan: Plan, clientes: ClienteEnErp[]): void {
  console.log(`\n🗃️  Contra ${HOST}: ${clientes.length} clientes en el ERP\n`);
  console.log(
    `    ${plan.direcciones.length} direcciones · ${plan.contactosNuevos.length} contactos nuevos · ` +
      `${plan.contactosActualizados.length} contactos con campos llenados · ` +
      `${plan.diferencias.length} diferencias`,
  );

  lista(
    "📍  Direcciones que se escriben:",
    plan.direcciones.map((d) => `${d.cliente}  →  ${d.direccion}`),
  );

  lista(
    "👤  Contactos que se agregan:",
    plan.contactosNuevos.map(
      (c) => `[${String(c.fila).padStart(4)}] ${c.cliente} · ${c.nombre}${c.puesto ? ` (${c.puesto})` : ""}`,
    ),
  );

  lista(
    "✏️   Campos vacíos que se llenan:",
    plan.llenos
      .filter((l) => l.campo !== "dirección")
      .map((l) => `[${String(l.fila).padStart(4)}] ${l.quien} · ${l.campo}: ${l.valor}`),
  );

  // Las diferencias se listan SIEMPRE. Son el resultado más valioso de la
  // corrida: cada una es un dato que alguien va a tener que mirar, y callarlas
  // porque "no se van a escribir" es justo lo que las deja sin resolver.
  lista(
    "⚠️   Diferencias (el ERP ya tiene otro dato):",
    plan.diferencias.map(
      (d) =>
        `[${String(d.fila).padStart(4)}] ${d.quien} · ${d.campo}\n` +
        `           ERP:   ${d.enErp}\n` +
        `           Excel: ${d.enExcel}${d.seEscribe ? "   ← se sobrescribe" : ""}`,
    ),
    SOBRESCRIBIR
      ? "Se van a escribir las del Excel (--sobrescribir)."
      : "No se tocan. Para reemplazarlas: --sobrescribir (además de --aplicar).",
  );

  lista(
    "❓  Razones sociales de la hoja que no existen en el ERP:",
    plan.sinCliente.map((s) => `${s.razonSocial}   (filas ${s.filas.join(", ")})`),
    "No se crean. Dalas de alta en el ERP y vuelve a correr esto.",
  );

  lista(
    "🔁  Renglones repetidos en la hoja (gana el primero):",
    plan.duplicados.map((d) => `[${String(d.fila).padStart(4)}] ${d.quien}  ya venía en la fila ${d.primeraFila}`),
  );

  if (plan.ignoradas > 0) {
    console.log(`\n    ${plan.ignoradas} renglones sin razón social legible, ignorados.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const modo = banderas.ensayo
    ? "  (ENSAYO — escribe y revierte)"
    : banderas.aplicar
      ? ""
      : "  (REPORTE — no escribe nada)";
  console.log(`\n🏢  Catálogo de clientes${modo}\n`);
  verificarDestino(HOST, banderas, "Este script escribe direcciones y contactos de clientes");

  const { filas, leidas } = await leerHoja();
  console.log(`📄  Google Sheets · hoja ${HOJA} · ${leidas} renglones, ${filas.length} con razón social\n`);

  const clientes = await leerBase();
  const plan = planearCarga({ filas, clientes, sobrescribir: SOBRESCRIBIR });
  reportar(plan, clientes);

  if (REPORTE) {
    writeFileSync(REPORTE, JSON.stringify({ host: HOST, hoja: HOJA, ...plan }, null, 2), "utf-8");
    console.log(`\n💾  Reporte en ${REPORTE}`);
  }

  const lote = sentenciasDelPlan(sql, plan);
  if (lote.length === 0) {
    console.log("\n✅  No hay nada que escribir.\n");
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
    `\n✅  Aplicado: ${plan.direcciones.length} direcciones, ${plan.contactosNuevos.length} contactos nuevos, ` +
      `${plan.contactosActualizados.length} actualizados (${lote.length} sentencias).\n`,
  );
}

main().catch((err) => {
  console.error("\n❌ ", err instanceof Error ? err.message : err);
  process.exit(1);
});
