/**
 * Importador Fase 1: Sheets del ERP legacy → DynamoDB.
 * Idempotente: puede correrse varias veces; actualiza en lugar de duplicar.
 *
 * Fuentes (IDs por variables de entorno):
 *   IMPORT_SHEET_COTIZACIONES_ID  — archivo con la hoja "Cotizaciones 2026"
 *                                   (encabezado fila 8, datos desde fila 9, cols B-O)
 *   IMPORT_SHEET_CLIENTES_ID      — archivo con las hojas "Clientes" y "Aprobaciones"
 *                                   (si se omite, usa el mismo archivo de cotizaciones)
 *   IMPORT_ANIO                   — año a importar (default: año actual)
 *   DRIVE_SERVICE_ACCOUNT_KEY     — llave JSON del service account (scope sheets.readonly)
 *
 * Uso:
 *   pnpm import:erp             # importa
 *   DRY_RUN=true pnpm import:erp  # solo reporta, no escribe
 */
import { google } from "googleapis";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const DRY = process.env.DRY_RUN === "true";
const ANIO = parseInt(process.env.IMPORT_ANIO ?? String(new Date().getFullYear()), 10);
const TABLE = process.env.MAIN_TABLE ?? "proyinstelec-main";

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient(
    process.env.DYNAMODB_ENDPOINT
      ? {
          endpoint: process.env.DYNAMODB_ENDPOINT,
          region: "us-east-1",
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {},
  ),
  { marshallOptions: { removeUndefinedValues: true } },
);

const pad = (n: number, w: number) => String(n).padStart(w, "0");

// ── Sheets client ─────────────────────────────────────────────────────────────

async function getSheets() {
  const keyJson = process.env.DRIVE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("Falta DRIVE_SERVICE_ACCOUNT_KEY");
  const parsed = JSON.parse(keyJson);
  const auth = new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function leerRango(sheetId: string, rango: string): Promise<string[][]> {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: rango });
  return (res.data.values ?? []) as string[][];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFecha(valor: string | undefined): string | undefined {
  if (!valor?.trim()) return undefined;
  // dd/mm/aaaa o aaaa-mm-dd
  const ddmm = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmm) return `${ddmm[3]}-${pad(+ddmm[2], 2)}-${pad(+ddmm[1], 2)}`;
  const iso = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return valor.slice(0, 10);
  const d = new Date(valor);
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function normalizarEstatus(valor: string): string {
  const v = valor.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (v.startsWith("REVISION") || v === "APROBADA") return "REVISION";
  if (v.startsWith("CORRECCION") || v === "EN PROCESO" || v === "PROCESO") return "PROCESO";
  if (["ENVIADA", "ASIGNADA", "CANCELADA", "DEPENDIENTE PROVEEDOR", "DEPENDIENTE CLIENTE"].includes(v)) return v;
  return "PROCESO";
}

async function put(Item: Record<string, unknown>) {
  if (DRY) return;
  await db.send(new PutCommand({ TableName: TABLE, Item }));
}

// ── Cotizaciones ──────────────────────────────────────────────────────────────

interface Fila {
  numero: number;
  anio: number;
  version: number;
  cliente: string;
  titulo: string;
  dirigidaA: string;
  prioridad: string;
  estatus: string;
  elaboro: string;
  fechaSolicitud?: string;
  fechaEntrega?: string;
  oc?: string;
  ot?: string;
}

async function importarCotizaciones(sheetId: string) {
  // Cols B..O (encabezado fila 8, datos desde fila 9)
  const filas = await leerRango(sheetId, `Cotizaciones ${ANIO}!B9:O`);
  const parsed: Fila[] = [];
  const descartadas: string[] = [];

  for (const f of filas) {
    const [_pref, numero, anio, version, cliente, titulo, dirigida, prioridad, estatus, elaboro, fSol, fEnt, oc, ot] = [
      f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9], f[10], f[11], f[12], f[13],
    ];
    const num = parseInt(numero ?? "", 10);
    if (!num || isNaN(num)) continue;
    // Renglones "preparados" (número sin cliente ni título) se descartan — regla del legacy
    if (!cliente?.trim() && !titulo?.trim()) {
      descartadas.push(`${numero} (renglón preparado)`);
      continue;
    }
    parsed.push({
      numero: num,
      anio: parseInt(anio ?? String(ANIO), 10) || ANIO,
      version: parseInt(version ?? "0", 10) || 0,
      cliente: (cliente ?? "").trim(),
      titulo: (titulo ?? "").trim(), // se conserva tal cual, incl. sufijo _cliente
      dirigidaA: (dirigida ?? "").trim(),
      prioridad: ["BAJA", "MEDIA", "ALTA"].includes((prioridad ?? "").trim().toUpperCase())
        ? (prioridad ?? "").trim().toUpperCase()
        : "MEDIA",
      estatus: normalizarEstatus(estatus ?? ""),
      elaboro: (elaboro ?? "").trim(),
      fechaSolicitud: parseFecha(fSol),
      fechaEntrega: parseFecha(fEnt),
      oc: (oc ?? "").trim() || undefined,
      ot: (ot ?? "").trim() || undefined,
    });
  }

  // Agrupar por número: todas las versiones se escriben; solo la máxima lleva GSI4
  const porNumero = new Map<number, Fila[]>();
  for (const p of parsed.filter((x) => x.anio === ANIO)) {
    porNumero.set(p.numero, [...(porNumero.get(p.numero) ?? []), p]);
  }

  let escritas = 0;
  for (const [numero, versiones] of porNumero) {
    versiones.sort((a, b) => a.version - b.version);
    const maxV = versiones[versiones.length - 1].version;
    for (const v of versiones) {
      const esVigente = v.version === maxV;
      const folio =
        v.version > 0
          ? `PCOTOP-${pad(numero, 3)}-${v.anio}-${v.version}`
          : `PCOTOP-${pad(numero, 3)}-${v.anio}`;
      const now = new Date().toISOString();
      await put({
        pk: `COT#${pad(numero, 3)}-${v.anio}`,
        sk: `V#${pad(v.version, 2)}`,
        numero,
        anio: v.anio,
        version: v.version,
        folio,
        cliente: v.cliente,
        titulo: v.titulo,
        dirigida_a: v.dirigidaA,
        prioridad: v.prioridad,
        estatus: v.estatus,
        elaboro: v.elaboro,
        fecha_solicitud: v.fechaSolicitud ? `${v.fechaSolicitud}T12:00:00.000Z` : now,
        fecha_entrega: v.fechaEntrega,
        orden_compra: v.oc,
        folio_ot: v.ot,
        created_by: "importador",
        created_at: now,
        updated_at: now,
        ...(esVigente
          ? { gsi4pk: `COT#${v.anio}`, gsi4sk: `${v.estatus}#${pad(numero, 3)}` }
          : {}),
      });
      escritas++;
    }
  }

  console.log(`  📄  Cotizaciones: ${escritas} versiones de ${porNumero.size} números${DRY ? " (dry-run)" : ""}`);
  if (descartadas.length > 0) console.log(`      Descartadas ${descartadas.length}: ${descartadas.join(", ")}`);
  return parsed;
}

// ── Clientes ──────────────────────────────────────────────────────────────────

async function importarClientes(sheetId: string) {
  let filas: string[][] = [];
  try {
    filas = await leerRango(sheetId, "Clientes!A2:H");
  } catch {
    console.log("  ⚠️   Hoja Clientes no encontrada; se omite");
    return;
  }

  // Empresas existentes en Dynamo (idempotencia por razón social)
  const existentes = await db.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: "begins_with(pk, :p) AND sk = :m",
      ExpressionAttributeValues: { ":p": "CLIENTE#", ":m": "#METADATA" },
    }),
  );
  const porRazon = new Map<string, string>();
  for (const e of existentes.Items ?? []) {
    porRazon.set(String(e.razon_social).toLowerCase(), String(e.cliente_id));
  }

  // A=ID Emp, B=ID Cliente, C=Razón social, D=Contacto, E=Puesto, F=Teléfono, G=Correo, H=Dirección
  const porIdEmp = new Map<string, string>(); // ID Emp legacy → cliente_id nuevo
  let empresas = 0, contactos = 0;

  for (const f of filas) {
    const [idEmp, _idCli, razon, contacto, puesto, telefono, correo, direccion] = f;
    if (!razon?.trim() || !contacto?.trim()) continue;

    let clienteId = idEmp ? porIdEmp.get(idEmp) : undefined;
    if (!clienteId) clienteId = porRazon.get(razon.trim().toLowerCase());
    if (!clienteId) {
      clienteId = randomUUID();
      const now = new Date().toISOString();
      await put({
        pk: `CLIENTE#${clienteId}`,
        sk: "#METADATA",
        cliente_id: clienteId,
        razon_social: razon.trim(),
        razon_normalizada: razon.trim().toLowerCase(),
        direccion: direccion?.trim() || undefined,
        created_at: now,
        created_by: "importador",
        updated_at: now,
      });
      porRazon.set(razon.trim().toLowerCase(), clienteId);
      empresas++;
    }
    if (idEmp) porIdEmp.set(idEmp, clienteId);

    const contactoId = randomUUID();
    const now = new Date().toISOString();
    await put({
      pk: `CLIENTE#${clienteId}`,
      sk: `CONTACTO#${contactoId}`,
      contacto_id: contactoId,
      cliente_id: clienteId,
      nombre: contacto.trim(),
      puesto: puesto?.trim() || undefined,
      telefono: telefono?.trim() || undefined,
      correo: correo?.trim().toLowerCase() || undefined,
      created_at: now,
      updated_at: now,
    });
    contactos++;
  }
  console.log(`  🏢  Clientes: ${empresas} empresas nuevas, ${contactos} contactos${DRY ? " (dry-run)" : ""}`);
}

// ── Aprobaciones ──────────────────────────────────────────────────────────────

async function importarAprobaciones(sheetId: string) {
  let filas: string[][] = [];
  try {
    filas = await leerRango(sheetId, "Aprobaciones!A2:F");
  } catch {
    console.log("  ⚠️   Hoja Aprobaciones no encontrada; se omite");
    return;
  }
  let n = 0;
  // Fecha, Hora, Numero, Anio, Version, Cliente
  for (const f of filas) {
    const numero = parseInt(f[2] ?? "", 10);
    const anio = parseInt(f[3] ?? "", 10);
    const version = parseInt(f[4] ?? "0", 10) || 0;
    if (!numero || !anio) continue;
    await put({
      pk: `COT#${pad(numero, 3)}-${anio}`,
      sk: `APROBACION#V#${pad(version, 2)}`,
      numero,
      anio,
      version,
      aprobado_por: "importador (revisor legacy)",
      fecha: parseFecha(f[0]) ?? new Date().toISOString(),
    });
    n++;
  }
  console.log(`  ✅  Aprobaciones: ${n}${DRY ? " (dry-run)" : ""}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cotId = process.env.IMPORT_SHEET_COTIZACIONES_ID;
  if (!cotId) throw new Error("Falta IMPORT_SHEET_COTIZACIONES_ID");
  const cliId = process.env.IMPORT_SHEET_CLIENTES_ID ?? cotId;

  console.log(`🔁  Importando ERP ${ANIO} desde Sheets${DRY ? " (DRY RUN — no escribe)" : ""}...\n`);

  const cotizaciones = await importarCotizaciones(cotId);
  await importarClientes(cliId);
  await importarAprobaciones(cliId);

  // Reporte de elaboradores (iniciales) que habrá que cruzar con los perfiles
  const elaboradores = [...new Set(cotizaciones.map((c) => c.elaboro).filter(Boolean))];
  console.log(`\n  👥  Elaboradores encontrados: ${elaboradores.join(", ")}`);
  console.log("      Verifica que cada uno tenga sus iniciales capturadas en Admin → Usuarios → ERP.");
  console.log("\n✅  Importación terminada.\n");
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
