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
 *   DATABASE_URL                  — cadena de conexión de Neon
 *
 * Uso:
 *   pnpm import:erp             # importa
 *   DRY_RUN=true pnpm import:erp  # solo reporta, no escribe
 */
import { google } from "googleapis";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../apps/web/src/db/schema";

config({ path: "apps/web/.env.local" });

const DRY = process.env.DRY_RUN === "true";
const ANIO = parseInt(process.env.IMPORT_ANIO ?? String(new Date().getFullYear()), 10);

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}

const db = drizzle(neon(process.env.DATABASE_URL), { schema });
const { cotizaciones, aprobaciones, clientes, contactos } = schema;

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

// ── Cotizaciones ──────────────────────────────────────────────────────────────

interface Fila {
  numero: number;
  anio: number;
  version: number;
  cliente: string;
  titulo: string;
  dirigidaA: string;
  prioridad: "BAJA" | "MEDIA" | "ALTA";
  estatus: string;
  elaboro: string;
  fechaSolicitud?: string;
  fechaEntrega?: string;
  oc?: string;
  ot?: string;
}

async function importarCotizaciones(sheetId: string): Promise<Fila[]> {
  // Cols B..O (encabezado fila 8, datos desde fila 9)
  const filas = await leerRango(sheetId, `Cotizaciones ${ANIO}!B9:O`);
  const parsed: Fila[] = [];
  const descartadas: string[] = [];

  for (const f of filas) {
    const [, numero, anio, version, cliente, titulo, dirigida, prioridad, estatus, elaboro, fSol, fEnt, oc, ot] = f;
    const num = parseInt(numero ?? "", 10);
    if (!num || isNaN(num)) continue;

    // Renglones "preparados" (número sin cliente ni título): no son cotizaciones
    if (!cliente?.trim() && !titulo?.trim()) {
      descartadas.push(numero);
      continue;
    }

    const prio = (prioridad ?? "").trim().toUpperCase();
    parsed.push({
      numero: num,
      anio: parseInt(anio ?? String(ANIO), 10) || ANIO,
      version: parseInt(version ?? "0", 10) || 0,
      cliente: (cliente ?? "").trim(),
      titulo: (titulo ?? "").trim(),
      dirigidaA: (dirigida ?? "").trim(),
      prioridad: (["BAJA", "MEDIA", "ALTA"].includes(prio) ? prio : "MEDIA") as Fila["prioridad"],
      estatus: normalizarEstatus(estatus ?? ""),
      elaboro: (elaboro ?? "").trim(),
      fechaSolicitud: parseFecha(fSol),
      fechaEntrega: parseFecha(fEnt),
      oc: (oc ?? "").trim() || undefined,
      ot: (ot ?? "").trim() || undefined,
    });
  }

  const delAnio = parsed.filter((x) => x.anio === ANIO);
  const numeros = new Set(delAnio.map((x) => x.numero));

  if (!DRY && delAnio.length > 0) {
    // Idempotente: una fila por (numero, anio, version); al reimportar se actualiza.
    await db
      .insert(cotizaciones)
      .values(
        delAnio.map((v) => ({
          numero: v.numero,
          anio: v.anio,
          version: v.version,
          folio:
            v.version > 0
              ? `PCOTOP-${pad(v.numero, 3)}-${v.anio}-${v.version}`
              : `PCOTOP-${pad(v.numero, 3)}-${v.anio}`,
          cliente: v.cliente,
          titulo: v.titulo,
          dirigidaA: v.dirigidaA,
          prioridad: v.prioridad,
          estatus: v.estatus as (typeof cotizaciones.$inferInsert)["estatus"],
          elaboro: v.elaboro,
          fechaSolicitud: v.fechaSolicitud ? new Date(`${v.fechaSolicitud}T12:00:00Z`) : new Date(),
          fechaEntrega: v.fechaEntrega ? new Date(`${v.fechaEntrega}T12:00:00Z`) : null,
          ordenCompra: v.oc,
          folioOt: v.ot,
          createdBy: "importador",
        })),
      )
      .onConflictDoUpdate({
        target: [cotizaciones.numero, cotizaciones.anio, cotizaciones.version],
        set: {
          cliente: sql`excluded.cliente`,
          titulo: sql`excluded.titulo`,
          dirigidaA: sql`excluded.dirigida_a`,
          prioridad: sql`excluded.prioridad`,
          estatus: sql`excluded.estatus`,
          elaboro: sql`excluded.elaboro`,
          fechaEntrega: sql`excluded.fecha_entrega`,
          ordenCompra: sql`excluded.orden_compra`,
          folioOt: sql`excluded.folio_ot`,
          updatedAt: new Date(),
        },
      });
  }

  console.log(`  📄  Cotizaciones: ${delAnio.length} versiones de ${numeros.size} números${DRY ? " (dry-run)" : ""}`);
  if (descartadas.length > 0) {
    console.log(`      Descartados ${descartadas.length} renglones preparados: ${descartadas.join(", ")}`);
  }
  return parsed;
}

// ── Clientes ──────────────────────────────────────────────────────────────────

function normalizarRazon(razon: string): string {
  return razon
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\b(s\.?\s?a\.?\s?p\.?\s?i\.?|s\.?\s?a\.?\s?b?\.?|de\s+c\.?\s?v\.?|s\.?\s+de\s+r\.?\s?l\.?|s\.?\s?c\.?|a\.?\s?c\.?)\b/gi,
      " ",
    )
    .replace(/[.,;:()\-&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(lic|ing|arq|c\.?p|dr|dra|mtro|mtra|sr|sra|srita)\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function importarClientes(sheetId: string) {
  let filas: string[][] = [];
  try {
    filas = await leerRango(sheetId, "Clientes!A2:H");
  } catch {
    console.log("  ⚠️   Hoja Clientes no encontrada; se omite");
    return;
  }

  // Empresas ya existentes, por razón social normalizada
  const existentes = DRY ? [] : await db.select().from(clientes);
  const porNorm = new Map(existentes.map((e) => [e.razonNormalizada, e.id]));
  const porIdEmpLegacy = new Map<string, string>();
  let nuevasEmpresas = 0;
  let nuevosContactos = 0;

  for (const f of filas) {
    // A=ID Emp, B=ID Cliente, C=Razón social, D=Contacto, E=Puesto, F=Teléfono, G=Correo, H=Dirección
    const [idEmp, , razon, contacto, puesto, telefono, correo, direccion] = f;
    if (!razon?.trim() || !contacto?.trim()) continue;

    const norm = normalizarRazon(razon);
    let clienteId = (idEmp && porIdEmpLegacy.get(idEmp)) || porNorm.get(norm);

    if (!clienteId) {
      if (DRY) {
        clienteId = `dry-${norm}`;
      } else {
        const [row] = await db
          .insert(clientes)
          .values({
            razonSocial: razon.trim(),
            razonNormalizada: norm,
            direccion: direccion?.trim() || null,
            createdBy: "importador",
          })
          .returning({ id: clientes.id });
        clienteId = row.id;
      }
      porNorm.set(norm, clienteId);
      nuevasEmpresas++;
    }
    if (idEmp) porIdEmpLegacy.set(idEmp, clienteId);

    if (!DRY) {
      // El índice único (cliente, nombre normalizado) hace la importación repetible
      await db
        .insert(contactos)
        .values({
          clienteId,
          nombre: contacto.trim(),
          nombreNormalizado: normalizarNombre(contacto),
          puesto: puesto?.trim() || null,
          telefono: telefono?.trim() || null,
          correo: correo?.trim().toLowerCase() || null,
        })
        .onConflictDoUpdate({
          target: [contactos.clienteId, contactos.nombreNormalizado],
          set: {
            puesto: sql`excluded.puesto`,
            telefono: sql`excluded.telefono`,
            correo: sql`excluded.correo`,
            updatedAt: new Date(),
          },
        });
    }
    nuevosContactos++;
  }

  console.log(`  🏢  Clientes: ${nuevasEmpresas} empresas nuevas, ${nuevosContactos} contactos${DRY ? " (dry-run)" : ""}`);
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

  // Fecha, Hora, Numero, Anio, Version, Cliente
  const registros = filas
    .map((f) => ({
      numero: parseInt(f[2] ?? "", 10),
      anio: parseInt(f[3] ?? "", 10),
      version: parseInt(f[4] ?? "0", 10) || 0,
      fecha: parseFecha(f[0]),
    }))
    .filter((r) => r.numero && r.anio);

  if (!DRY && registros.length > 0) {
    await db
      .insert(aprobaciones)
      .values(
        registros.map((r) => ({
          numero: r.numero,
          anio: r.anio,
          version: r.version,
          aprobadoPor: "importador (revisor del sistema anterior)",
          fecha: r.fecha ? new Date(`${r.fecha}T12:00:00Z`) : new Date(),
        })),
      )
      .onConflictDoNothing();
  }

  console.log(`  ✅  Aprobaciones: ${registros.length}${DRY ? " (dry-run)" : ""}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cotId = process.env.IMPORT_SHEET_COTIZACIONES_ID;
  if (!cotId) throw new Error("Falta IMPORT_SHEET_COTIZACIONES_ID");
  const cliId = process.env.IMPORT_SHEET_CLIENTES_ID ?? cotId;

  console.log(`🔁  Importando ERP ${ANIO} desde Sheets${DRY ? " (DRY RUN — no escribe)" : ""}...\n`);

  const cotizacionesLeidas = await importarCotizaciones(cotId);
  await importarClientes(cliId);
  await importarAprobaciones(cliId);

  // Las iniciales son la llave con la que el ERP identifica personas: si un
  // elaborador no las tiene capturadas en su perfil, no cruzará con nada.
  const elaboradores = [...new Set(cotizacionesLeidas.map((c) => c.elaboro).filter(Boolean))];
  console.log(`\n  👥  Elaboradores encontrados: ${elaboradores.join(", ")}`);
  console.log("      Verifica que cada uno tenga sus iniciales en Admin → Usuarios → ERP.");
  console.log("\n✅  Importación terminada.\n");
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
