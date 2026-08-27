import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { clientes, contactos } from "../db/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Clientes del ERP (empresas a las que se cotiza) y sus contactos.
 * Distintos de las "empresas" del módulo de campo (proyectos.ts).
 */
export interface ClienteEmpresa {
  cliente_id: string;
  razon_social: string;
  /** Razón social normalizada (sin sufijos legales) para anti-duplicados y match */
  razon_normalizada: string;
  direccion?: string;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface Contacto {
  contacto_id: string;
  cliente_id: string;
  nombre: string;
  puesto?: string;
  telefono?: string;
  correo?: string;
  created_at: string;
  updated_at: string;
}

type FilaCliente = typeof clientes.$inferSelect;
type FilaContacto = typeof contactos.$inferSelect;

function aEmpresa(f: FilaCliente): ClienteEmpresa {
  return {
    cliente_id: f.id,
    razon_social: f.razonSocial,
    razon_normalizada: f.razonNormalizada,
    direccion: f.direccion ?? undefined,
    created_at: f.createdAt.toISOString(),
    created_by: f.createdBy,
    updated_at: f.updatedAt.toISOString(),
  };
}

function aContacto(f: FilaContacto): Contacto {
  return {
    contacto_id: f.id,
    cliente_id: f.clienteId,
    nombre: f.nombre,
    puesto: f.puesto ?? undefined,
    telefono: f.telefono ?? undefined,
    correo: f.correo ?? undefined,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

// ── Normalización (reglas del ERP legacy) ─────────────────────────────────────

const SUFIJOS_LEGALES =
  /\b(s\.?\s?a\.?\s?p\.?\s?i\.?|s\.?\s?a\.?\s?b?\.?|de\s+c\.?\s?v\.?|s\.?\s+de\s+r\.?\s?l\.?|s\.?\s?c\.?|a\.?\s?c\.?|s\.?\s?r\.?\s?l\.?)\b/gi;

/**
 * Normaliza una razón social: minúsculas, sin acentos, sin sufijos legales
 * (S.A. de C.V., S. de R.L., etc.), sin puntuación ni espacios dobles.
 */
export function normalizarRazonSocial(razon: string): string {
  return razon
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SUFIJOS_LEGALES, " ")
    .replace(/[.,;:()\-&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Títulos personales que se quitan al comparar nombres de contacto (legacy). */
const TITULOS = /^(lic|ing|arq|c\.?p|dr|dra|mtro|mtra|sr|sra|srita)\.?\s+/i;

export function normalizarNombreContacto(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(TITULOS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match de empresa por razón social normalizada.
 * "exacta" reutiliza automáticamente; "parcial" (contains bidireccional)
 * requiere confirmación del usuario (regla del legacy).
 */
export function compararRazones(a: string, b: string): "exacta" | "parcial" | "ninguna" {
  const na = normalizarRazonSocial(a);
  const nb = normalizarRazonSocial(b);
  if (!na || !nb) return "ninguna";
  if (na === nb) return "exacta";
  if (na.includes(nb) || nb.includes(na)) return "parcial";
  return "ninguna";
}

// ── Empresas ──────────────────────────────────────────────────────────────────

export async function listClientes(): Promise<ClienteEmpresa[]> {
  const filas = await getDb().select().from(clientes).orderBy(asc(clientes.razonSocial));
  return filas.map(aEmpresa);
}

/** `%` y `_` romperían el patrón; la normalización ya dejó solo letras y espacios. */
function patronLike(texto: string): string {
  return texto.replace(/[%_\\]/g, "");
}

/**
 * Busca empresas cuyo nombre coincide exacta o parcialmente con `razon`.
 * Para el flujo de alta con verificación de duplicados.
 *
 * El "contains bidireccional" del legacy se resuelve en SQL (la normalizada
 * contiene a la buscada, o al revés) y solo los candidatos se afinan en
 * memoria con compararRazones, que es la regla autoritativa.
 */
export async function buscarEmpresasParecidas(
  razon: string,
): Promise<Array<{ empresa: ClienteEmpresa; match: "exacta" | "parcial" }>> {
  const norm = patronLike(normalizarRazonSocial(razon));
  if (!norm) return [];

  const candidatas = await getDb()
    .select()
    .from(clientes)
    .where(
      or(
        ilike(clientes.razonNormalizada, `%${norm}%`),
        sql`${norm} ILIKE '%' || ${clientes.razonNormalizada} || '%'`,
      ),
    )
    .orderBy(asc(clientes.razonSocial));

  const resultados: Array<{ empresa: ClienteEmpresa; match: "exacta" | "parcial" }> = [];
  for (const f of candidatas) {
    const match = compararRazones(razon, f.razonSocial);
    if (match !== "ninguna") resultados.push({ empresa: aEmpresa(f), match });
  }
  return resultados.sort((a) => (a.match === "exacta" ? -1 : 1));
}

export async function createClienteEmpresa(params: {
  razonSocial: string;
  direccion?: string;
  createdBy: string;
}): Promise<ClienteEmpresa> {
  const [fila] = await getDb()
    .insert(clientes)
    .values({
      razonSocial: params.razonSocial.trim(),
      razonNormalizada: normalizarRazonSocial(params.razonSocial),
      direccion: params.direccion?.trim() || null,
      createdBy: params.createdBy,
    })
    .returning();
  return aEmpresa(fila);
}

export async function getClienteEmpresa(clienteId: string): Promise<ClienteEmpresa | null> {
  const [fila] = await getDb()
    .select()
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);
  return fila ? aEmpresa(fila) : null;
}

// ── Contactos ─────────────────────────────────────────────────────────────────

export async function listContactos(clienteId: string): Promise<Contacto[]> {
  const filas = await getDb()
    .select()
    .from(contactos)
    .where(eq(contactos.clienteId, clienteId))
    .orderBy(asc(contactos.nombre));
  return filas.map(aContacto);
}

/** Violación del índice único (cliente_id, nombre_normalizado). */
function esConflictoDeUnicidad(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string } };
  return (
    e?.code === "23505" ||
    e?.cause?.code === "23505" ||
    /duplicate key|unique constraint/i.test(e?.message ?? "")
  );
}

export async function createContacto(params: {
  clienteId: string;
  nombre: string;
  puesto?: string;
  telefono?: string;
  correo?: string;
}): Promise<Contacto> {
  try {
    const [fila] = await getDb()
      .insert(contactos)
      .values({
        clienteId: params.clienteId,
        nombre: params.nombre.trim(),
        // El anti-duplicado empresa+contacto del legacy lo garantiza el índice único
        nombreNormalizado: normalizarNombreContacto(params.nombre),
        puesto: params.puesto?.trim() || null,
        telefono: params.telefono?.trim() || null,
        correo: params.correo?.trim().toLowerCase() || null,
      })
      .returning();
    return aContacto(fila);
  } catch (err) {
    if (esConflictoDeUnicidad(err)) {
      throw new Error(`El contacto "${params.nombre}" ya existe en esta empresa`);
    }
    throw err;
  }
}

/** Solo puesto/teléfono/correo son editables (regla del legacy). */
export async function updateContacto(
  clienteId: string,
  contactoId: string,
  data: { puesto?: string | null; telefono?: string | null; correo?: string | null },
): Promise<void> {
  const cambios: Partial<typeof contactos.$inferInsert> = { updatedAt: new Date() };
  if (data.puesto !== undefined) cambios.puesto = data.puesto?.trim() || null;
  if (data.telefono !== undefined) cambios.telefono = data.telefono?.trim() || null;
  if (data.correo !== undefined) cambios.correo = data.correo?.trim().toLowerCase() || null;

  await getDb()
    .update(contactos)
    .set(cambios)
    .where(and(eq(contactos.id, contactoId), eq(contactos.clienteId, clienteId)));
}

export async function deleteContacto(clienteId: string, contactoId: string): Promise<void> {
  await getDb()
    .delete(contactos)
    .where(and(eq(contactos.id, contactoId), eq(contactos.clienteId, clienteId)));
}

// ── Match para el envío de cotizaciones ───────────────────────────────────────

/**
 * Localiza la empresa de una cotización por razón social (match del legacy)
 * y sugiere el contacto que corresponde a "Dirigida a".
 */
export async function contactosParaEnvio(params: {
  razonSocial: string;
  dirigidaA?: string;
}): Promise<{
  empresa: ClienteEmpresa | null;
  contactos: Contacto[];
  sugeridoId: string | null;
}> {
  const parecidas = await buscarEmpresasParecidas(params.razonSocial);
  const empresa = parecidas[0]?.empresa ?? null;
  if (!empresa) return { empresa: null, contactos: [], sugeridoId: null };

  const lista = (await listContactos(empresa.cliente_id)).filter((c) => c.correo);

  let sugeridoId: string | null = null;
  if (params.dirigidaA) {
    const objetivo = normalizarNombreContacto(params.dirigidaA);
    // exacto → parcial → por palabra (>2 letras), como el legacy
    const exacto = lista.find((c) => normalizarNombreContacto(c.nombre) === objetivo);
    const parcial =
      exacto ??
      lista.find((c) => {
        const n = normalizarNombreContacto(c.nombre);
        return n.includes(objetivo) || objetivo.includes(n);
      });
    const porPalabra =
      parcial ??
      lista.find((c) => {
        const palabras = normalizarNombreContacto(c.nombre).split(" ");
        return objetivo.split(" ").some((p) => p.length > 2 && palabras.includes(p));
      });
    sugeridoId = porPalabra?.contacto_id ?? null;
  }

  return { empresa, contactos: lista, sugeridoId };
}
