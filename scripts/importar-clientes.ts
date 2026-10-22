/**
 * Carga el catálogo de clientes —direcciones y contactos— desde la hoja
 * `Clientes` del control, en Google Sheets o en un `.xlsx` exportado.
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
 *   --archivo=<ruta>    lee un .xlsx en vez de Google Sheets. Con esto no
 *                       hacen falta IMPORT_SHEET_CLIENTES_ID ni la llave del
 *                       service account
 *   --hoja=<nombre>     la pestaña a leer (default: Clientes)
 *   --reporte=<ruta>    guarda el reporte en JSON (ponlo fuera del repositorio)
 *   --sobrescribir      reemplaza los datos que ya existen y no coinciden
 *                       (solo con --aplicar; sin esto se reportan y no se tocan)
 *
 * Variables: DATABASE_URL y, opcionalmente, PRODUCTION_DATABASE_HOST. Sin
 * `--archivo`, además IMPORT_SHEET_CLIENTES_ID y DRIVE_SERVICE_ACCOUNT_KEY.
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";
import { LibroExcel } from "../apps/web/src/lib/excel";
import {
  filaDesdeCeldas,
  leerFilas,
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
/** Un `.xlsx` exportado de la hoja, para correrlo sin credenciales de Google. */
const ARCHIVO = opcion("archivo");
/** El dominio de la empresa; sale del mismo sitio que lo lee la app. */
const DOMINIO = (process.env.GOOGLE_WORKSPACE_DOMAIN ?? "proyinstelec.mx").toLowerCase();

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
if (!ARCHIVO && !SHEET_ID) {
  console.error(
    "❌  Falta IMPORT_SHEET_CLIENTES_ID (apps/web/.env.local): es el archivo de\n" +
      "    Google con la hoja «Clientes». Es el mismo que usa import:erp.\n" +
      "    O pasa un .xlsx exportado con --archivo=<ruta>.",
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const HOST = new URL(process.env.DATABASE_URL).host;

// ── La hoja ───────────────────────────────────────────────────────────────────

/**
 * Las dos fuentes entregan lo mismo: una matriz de renglones de texto, de la
 * `A` a la `H`. De ahí en adelante hay un solo lector, `leerFilas`, así que
 * `--archivo` no puede desviarse de lo que hace la corrida contra Sheets.
 *
 * La columna `I` (ASESORIA) no se lee. Qué significa está por confirmar.
 */
function leerDeArchivo(ruta: string): string[][] {
  const libro = LibroExcel.desdeBuffer(readFileSync(ruta));
  // La fila 1 es el encabezado, igual que el rango A2:H de Sheets.
  return libro.filas(HOJA).filter((f) => f.numero >= 2).map((f) => filaDesdeCeldas(f.celdas));
}

async function leerDeSheets(): Promise<string[][]> {
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
  return (res.data.values ?? []) as string[][];
}

async function leerFuente(): Promise<{
  filas: FilaClienteExcel[];
  ignoradas: number[];
  leidas: number;
  de: string;
}> {
  const valores = ARCHIVO ? leerDeArchivo(ARCHIVO) : await leerDeSheets();
  const { filas, ignoradas } = leerFilas(valores);
  return { filas, ignoradas, leidas: valores.length, de: ARCHIVO ?? "Google Sheets" };
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
    SELECT id, cliente_id, nombre, nombre_normalizado, puesto, telefono, correo, direccion
    FROM contactos
  `) as Array<{
    id: string;
    cliente_id: string;
    nombre: string;
    nombre_normalizado: string;
    puesto: string | null;
    telefono: string | null;
    correo: string | null;
    direccion: string | null;
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
      direccion: p.direccion,
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

function reportar(plan: Plan, clientes: ClienteEnErp[], ignoradas: number[]): void {
  console.log(`\n🗃️  Contra ${HOST}: ${clientes.length} clientes en el ERP\n`);
  console.log(
    `    ${plan.direcciones.length} direcciones · ${plan.contactosNuevos.length} contactos nuevos · ` +
      `${plan.contactosActualizados.length} contactos con campos llenados · ` +
      `${plan.diferencias.length} diferencias`,
  );

  // La del cliente es el respaldo: la que usa el documento cuando no encuentra
  // a la persona. El dato bueno va en cada contacto.
  lista(
    "📍  Dirección de respaldo del cliente (la más repetida entre sus contactos):",
    plan.direcciones.map((d) => `${d.cliente}  [${d.deCuantos} contacto(s)]  →  ${d.direccion}`),
  );

  lista(
    "👤  Contactos que se agregan:",
    plan.contactosNuevos.map(
      (c) =>
        `[${String(c.fila).padStart(4)}] ${c.cliente} · ${c.nombre}${c.puesto ? ` (${c.puesto})` : ""}` +
        (c.direccion ? `
           ${c.direccion}` : ""),
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

  // Un mismo id con dos razones sociales manda los contactos a clientes
  // distintos sin que nadie lo note: o el id se reusó, o una está mal escrita.
  lista(
    "🧩  Un mismo ID Emp con razones sociales distintas:",
    plan.idsAmbiguos.map(
      (a) => `${a.idEmp}  (filas ${a.filas.join(", ")})\n` + a.razones.map((r) => `           · ${r}`).join("\n"),
    ),
    "El emparejado es por razón social, así que estos quedan en clientes distintos.",
  );

  // Un contacto del cliente no tiene correo nuestro.
  lista(
    `📨  Contactos con correo interno (@${DOMINIO}):`,
    plan.correosInternos.map((c) => `[${String(c.fila).padStart(4)}] ${c.quien}  →  ${c.correo}`),
    "Se cargan igual, pero probablemente sea el correo del asesor.",
  );

  // Restos de copiar y pegar que, sin esto, acaban impresos en la carta.
  lista(
    "🧹  Limpieza al leer (comillas sueltas):",
    plan.limpiezas.map((l) => `[${String(l.fila).padStart(4)}] ${l.campo}
           ${l.antes}
           ${l.despues}`),
  );

  // Puede ser la misma persona capturada dos veces, o dos que comparten
  // nombre. No se fusionan: decidirlo necesita a alguien que conozca al cliente.
  lista(
    "👥  Posibles duplicados (un nombre contiene al otro):",
    plan.posiblesDuplicados.map(
      (d) => `${d.cliente}
           «${d.nombres[0]}»  y  «${d.nombres[1]}»` +
        (d.filas.length ? `   (filas ${d.filas.join(", ")})` : "   (los dos ya en el ERP)"),
    ),
    "Solo aviso: no se fusiona nada.",
  );

  // Los descartados se nombran, no se cuentan: cada uno es un dato que alguien
  // capturó y que esta carga no puede colocar en ningún cliente.
  const sinRazon = [...ignoradas].sort((a, b) => a - b);
  if (sinRazon.length || plan.ignoradas) {
    console.log(
      `\n🚫  ${sinRazon.length + plan.ignoradas} renglones sin razón social utilizable` +
        (sinRazon.length ? `: filas ${sinRazon.join(", ")}` : "") +
        (plan.ignoradas ? `\n      y ${plan.ignoradas} cuya razón social queda vacía al normalizarla.` : ""),
    );
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

  const { filas, ignoradas, leidas, de } = await leerFuente();
  console.log(`📄  ${de} · hoja ${HOJA} · ${leidas} renglones, ${filas.length} con razón social\n`);

  const clientes = await leerBase();
  const plan = planearCarga({
    filas,
    clientes,
    sobrescribir: SOBRESCRIBIR,
    dominioInterno: DOMINIO,
  });
  reportar(plan, clientes, ignoradas);

  if (REPORTE) {
    const contenido = { host: HOST, fuente: de, hoja: HOJA, filasIgnoradas: ignoradas, ...plan };
    writeFileSync(REPORTE, JSON.stringify(contenido, null, 2), "utf-8");
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
  const msg = err instanceof Error ? err.message : String(err);
  console.error("\n❌ ", msg);
  // La 0007 agrega `contactos.direccion`. Sin ella, el error de Postgres no
  // dice qué hacer, y lo que hay que hacer es una sola cosa.
  if (/column "direccion" does not exist/i.test(msg)) {
    console.error(
      "\n    Falta la migración 0007 en esta base. Aplícala y vuelve a intentar:\n" +
        "      pnpm db:migrate\n",
    );
  }
  process.exit(1);
});
