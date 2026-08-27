import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { proyectoUsuarios, users } from "../db/schema";

/**
 * Perfiles de usuario.
 *
 * La identidad la administra Auth.js: el id es `users.id` y el `sub` de Google
 * vive en la tabla `accounts`. Este módulo expone el perfil de dominio en
 * snake_case, que es como lo consumen las pantallas.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  nombre: string;
  nickname?: string;
  foto_url?: string;
  tipo: "planta" | "temporal" | "admin" | "cliente";
  rol: "campo" | "admin" | "cliente";
  odoo_sync: boolean;
  perfil_completo: boolean;
  activo: boolean;
  proyectos_asignados: string[];
  permisos: string[];
  iniciales?: string;
  gerencia?: string;
  telefono?: string;
  id_oficial?: string;
  contacto_emergencia?: { nombre: string; telefono: string };
  terminos_aceptados_at?: string;
  created_at: string;
  updated_at: string;
}

type Row = typeof users.$inferSelect;

function aPerfil(row: Row, proyectos: string[] = []): UserProfile {
  return {
    id: row.id,
    email: row.email,
    nombre: row.name ?? row.email.split("@")[0],
    nickname: row.nickname ?? undefined,
    foto_url: row.fotoUrl ?? row.image ?? undefined,
    tipo: row.tipo,
    rol: row.rol,
    odoo_sync: row.odooSync,
    perfil_completo: row.perfilCompleto,
    activo: row.activo,
    proyectos_asignados: proyectos,
    permisos: row.permisos ?? [],
    iniciales: row.iniciales ?? undefined,
    gerencia: row.gerencia ?? undefined,
    telefono: row.telefono ?? undefined,
    id_oficial: row.idOficial ?? undefined,
    contacto_emergencia: row.contactoEmergencia ?? undefined,
    terminos_aceptados_at: row.terminosAceptadosAt?.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Proyectos asignados de varios usuarios en una sola consulta. */
async function proyectosDe(usuarioIds: string[]): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (usuarioIds.length === 0) return mapa;
  const filas = await getDb()
    .select()
    .from(proyectoUsuarios)
    .where(inArray(proyectoUsuarios.usuarioId, usuarioIds));
  for (const f of filas) {
    mapa.set(f.usuarioId, [...(mapa.get(f.usuarioId) ?? []), f.proyectoId]);
  }
  return mapa;
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

export async function getUserById(id: string): Promise<UserProfile | null> {
  const [row] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) return null;
  return aPerfil(row, (await proyectosDe([id])).get(id) ?? []);
}

export async function getUserByEmail(email: string): Promise<UserProfile | null> {
  const [row] = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (!row) return null;
  return aPerfil(row, (await proyectosDe([row.id])).get(row.id) ?? []);
}

export async function listUsers(): Promise<UserProfile[]> {
  const filas = await getDb().select().from(users).orderBy(users.email);
  const proyectos = await proyectosDe(filas.map((f) => f.id));
  return filas.map((f) => aPerfil(f, proyectos.get(f.id) ?? []));
}

/** Busca por iniciales — la llave con la que el ERP identifica personas. */
export async function getUserByIniciales(iniciales: string): Promise<UserProfile | null> {
  const [row] = await getDb()
    .select()
    .from(users)
    .where(eq(users.iniciales, iniciales.toUpperCase()))
    .limit(1);
  return row ? aPerfil(row) : null;
}

// ── Escrituras ────────────────────────────────────────────────────────────────

export async function updateUserRol(
  id: string,
  rol: "campo" | "admin" | "cliente",
  tipo: "planta" | "temporal" | "admin" | "cliente",
): Promise<void> {
  await getDb().update(users).set({ rol, tipo, updatedAt: new Date() }).where(eq(users.id, id));
}

/**
 * Campos del ERP. `undefined` deja el campo intacto; `null` o cadena vacía lo
 * limpian. Las iniciales duplicadas las rechaza el índice único de la tabla.
 */
export async function updateUserErp(
  id: string,
  data: { permisos?: string[]; iniciales?: string | null; gerencia?: string | null },
): Promise<void> {
  const cambios: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (data.permisos !== undefined) cambios.permisos = data.permisos;
  if (data.iniciales !== undefined) cambios.iniciales = data.iniciales || null;
  if (data.gerencia !== undefined) cambios.gerencia = data.gerencia || null;
  await getDb().update(users).set(cambios).where(eq(users.id, id));
}

export async function updatePerfil(
  id: string,
  data: { nickname?: string | null; foto_url?: string | null },
): Promise<void> {
  const cambios: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (data.nickname !== undefined) cambios.nickname = data.nickname || null;
  if (data.foto_url !== undefined) cambios.fotoUrl = data.foto_url || null;
  await getDb().update(users).set(cambios).where(eq(users.id, id));
}

/** Cierra el alta de un trabajador temporal. */
export async function markProfileComplete(
  id: string,
  data: {
    nombre: string;
    telefono: string;
    id_oficial: string;
    contacto_emergencia: { nombre: string; telefono: string };
    terminos_aceptados_at: string;
  },
): Promise<void> {
  await getDb()
    .update(users)
    .set({
      perfilCompleto: true,
      name: data.nombre,
      telefono: data.telefono,
      idOficial: data.id_oficial,
      contactoEmergencia: data.contacto_emergencia,
      terminosAceptadosAt: new Date(data.terminos_aceptados_at),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
}

export async function setUsuarioActivo(id: string, activo: boolean): Promise<void> {
  await getDb().update(users).set({ activo, updatedAt: new Date() }).where(eq(users.id, id));
}

/**
 * Alta previa de un usuario que todavía no inicia sesión (siembra, importación).
 * Al entrar con Google, Auth.js enlaza por correo con este perfil.
 */
export async function upsertUserSembrado(data: {
  email: string;
  nombre: string;
  tipo?: UserProfile["tipo"];
  rol?: UserProfile["rol"];
  permisos?: string[];
  iniciales?: string;
  gerencia?: string;
  perfil_completo?: boolean;
}): Promise<string> {
  const tipo = data.tipo ?? classifyEmail(data.email);
  const [row] = await getDb()
    .insert(users)
    .values({
      email: data.email.toLowerCase(),
      name: data.nombre,
      tipo,
      rol: data.rol ?? "campo",
      permisos: data.permisos ?? [],
      iniciales: data.iniciales,
      gerencia: data.gerencia,
      perfilCompleto: data.perfil_completo ?? tipo !== "temporal",
      odooSync: tipo === "planta",
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: data.nombre,
        tipo,
        rol: data.rol ?? "campo",
        ...(data.permisos ? { permisos: data.permisos } : {}),
        ...(data.iniciales ? { iniciales: data.iniciales } : {}),
        ...(data.gerencia ? { gerencia: data.gerencia } : {}),
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });
  return row.id;
}

// ── Utilidades ────────────────────────────────────────────────────────────────

/** Clasifica un correo como personal de planta o trabajador temporal. */
export function classifyEmail(email: string): "planta" | "temporal" {
  const dominio = process.env.GOOGLE_WORKSPACE_DOMAIN ?? "proyinstelec.mx";
  return email.toLowerCase().endsWith(`@${dominio}`) ? "planta" : "temporal";
}

/** Total de usuarios — usado por diagnósticos y por la siembra. */
export async function contarUsuarios(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}
