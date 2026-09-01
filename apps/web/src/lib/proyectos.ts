import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { empresas, proyectos, proyectoUsuarios } from "../db/schema";

/**
 * Empresas cliente y proyectos.
 *
 * Las pantallas siguen consumiendo la forma snake_case de siempre; por dentro
 * `empresa_nombre` sale del JOIN con `empresas` y `usuarios_asignados` de la
 * tabla puente `proyecto_usuarios`, agregados en la misma consulta.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Empresa {
  empresa_id: string;
  nombre: string;
  created_at: string;
  updated_at: string;
}

export interface Proyecto {
  proyecto_id: string;
  empresa_id: string;
  empresa_nombre: string;
  nombre: string;
  descripcion?: string;
  estado: "activo" | "terminado";
  drive_folder_id?: string;
  drive_folder_url?: string;
  usuarios_asignados: string[];
  created_at: string;
  updated_at: string;
}

type EmpresaRow = typeof empresas.$inferSelect;
type ProyectoRow = typeof proyectos.$inferSelect;

function aEmpresa(row: EmpresaRow): Empresa {
  return {
    empresa_id: row.id,
    nombre: row.nombre,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function aProyecto(
  row: ProyectoRow,
  empresaNombre: string,
  usuarios: string[] = [],
): Proyecto {
  return {
    proyecto_id: row.id,
    empresa_id: row.empresaId,
    empresa_nombre: empresaNombre,
    nombre: row.nombre,
    descripcion: row.descripcion ?? undefined,
    estado: row.estado,
    drive_folder_id: row.driveFolderId ?? undefined,
    drive_folder_url: row.driveFolderUrl ?? undefined,
    usuarios_asignados: usuarios,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** array_agg de los asignados; el FILTER evita el `[null]` del LEFT JOIN vacío. */
const usuariosAgregados = sql<string[]>`coalesce(
  array_agg(${proyectoUsuarios.usuarioId}) filter (where ${proyectoUsuarios.usuarioId} is not null),
  '{}'
)`;

function consultaProyectos(filtro?: SQL) {
  return getDb()
    .select({
      proyecto: proyectos,
      empresaNombre: empresas.nombre,
      usuarios: usuariosAgregados,
    })
    .from(proyectos)
    .innerJoin(empresas, eq(proyectos.empresaId, empresas.id))
    .leftJoin(proyectoUsuarios, eq(proyectoUsuarios.proyectoId, proyectos.id))
    .where(filtro)
    .groupBy(proyectos.id, empresas.nombre);
}

// ── Empresas ──────────────────────────────────────────────────────────────────

export async function createEmpresa(nombre: string): Promise<Empresa> {
  const [row] = await getDb().insert(empresas).values({ nombre }).returning();
  return aEmpresa(row);
}

export async function listEmpresas(): Promise<Empresa[]> {
  const filas = await getDb().select().from(empresas).orderBy(empresas.nombre);
  return filas.map(aEmpresa);
}

export async function getEmpresa(empresa_id: string): Promise<Empresa | null> {
  const [row] = await getDb()
    .select()
    .from(empresas)
    .where(eq(empresas.id, empresa_id))
    .limit(1);
  return row ? aEmpresa(row) : null;
}

// ── Proyectos ─────────────────────────────────────────────────────────────────

export async function createProyecto(params: {
  empresa_id: string;
  empresa_nombre: string;
  nombre: string;
  descripcion?: string;
  drive_folder_id?: string;
  drive_folder_url?: string;
}): Promise<Proyecto> {
  const [row] = await getDb()
    .insert(proyectos)
    .values({
      empresaId: params.empresa_id,
      nombre: params.nombre,
      descripcion: params.descripcion ?? null,
      driveFolderId: params.drive_folder_id ?? null,
      driveFolderUrl: params.drive_folder_url ?? null,
    })
    .returning();

  return aProyecto(row, params.empresa_nombre, []);
}

export async function listProyectos(empresa_id?: string): Promise<Proyecto[]> {
  const filas = await consultaProyectos(
    empresa_id ? eq(proyectos.empresaId, empresa_id) : undefined,
  ).orderBy(proyectos.nombre);

  return filas.map((f) => aProyecto(f.proyecto, f.empresaNombre, f.usuarios ?? []));
}

export async function getProyecto(proyecto_id: string): Promise<Proyecto | null> {
  const [fila] = await consultaProyectos(eq(proyectos.id, proyecto_id)).limit(1);
  return fila ? aProyecto(fila.proyecto, fila.empresaNombre, fila.usuarios ?? []) : null;
}

export async function listProyectosByEmpresa(empresa_id: string): Promise<Proyecto[]> {
  return listProyectos(empresa_id);
}

// ── Asignación de trabajadores ────────────────────────────────────────────────

export async function asignarUsuario(proyecto_id: string, usuarioId: string): Promise<void> {
  await getDb()
    .insert(proyectoUsuarios)
    .values({ proyectoId: proyecto_id, usuarioId })
    .onConflictDoNothing();
}

export async function desasignarUsuario(proyecto_id: string, usuarioId: string): Promise<void> {
  await getDb()
    .delete(proyectoUsuarios)
    .where(
      and(
        eq(proyectoUsuarios.proyectoId, proyecto_id),
        eq(proyectoUsuarios.usuarioId, usuarioId),
      ),
    );
}

export async function updateProyectoEstado(
  proyecto_id: string,
  estado: "activo" | "terminado",
): Promise<void> {
  await getDb()
    .update(proyectos)
    .set({ estado, updatedAt: new Date() })
    .where(eq(proyectos.id, proyecto_id));
}
