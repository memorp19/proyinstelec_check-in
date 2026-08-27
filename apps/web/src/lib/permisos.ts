/**
 * Catálogo de permisos del ERP (Fase 0).
 *
 * Modelo simplificado respecto al ERP legacy (ver docs/plan-migracion-erp.md, D2):
 * los permisos viven como lista plana en el perfil del usuario (`permisos`).
 * El rol "admin" y el super admin tienen implícitamente TODOS los permisos.
 *
 * Las llaves se conservan del legacy para que la documentación de análisis
 * (docs/erp-legacy/*) siga siendo el mapa directo de qué habilita cada una.
 */

// ── Catálogo ──────────────────────────────────────────────────────────────────

export const PERMISOS = [
  // Módulos (llave de entrada por sección del ERP)
  "modulo.cotizaciones",
  "modulo.clientes",
  "modulo.ot",
  "modulo.control.operativo",
  "modulo.weekly",
  "modulo.kpi",

  // Tableros
  "dashboard.cotizaciones",
  "dashboard.gerencial",

  // Comercial
  "cotizaciones.enviar",   // enviar cotización al cliente (ex EQUIPO_REMITENTES)
  "cotizaciones.aprobar",  // revisar/aprobar/solicitar corrección

  // Actividades / Weekly
  "actividades.asignar",
  "actividades.confirmar", // gerencia: cambia estatus/fecha, cancela, reprograma
  "actividades.ver.todas",
  "actividades.ver.gerencia",
  "solicitudes.resolver",
  "ayudas.responder",
  "weekly.enviar",

  // KPIs
  "kpi.administrar",
  "kpi.asignar",
  "kpi.evaluar",
  "kpi.ver.todos",
  "kpi.ver.gerencia",

  // OT / Control Operativo
  "ot.crear",
  "ot.documentos",
  "control.operativo.crear",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export function esPermisoValido(valor: string): valor is Permiso {
  return (PERMISOS as readonly string[]).includes(valor);
}

// ── Grupos para UI (edición de permisos en admin) ─────────────────────────────

export const GRUPOS_PERMISOS: Array<{ titulo: string; permisos: Permiso[] }> = [
  {
    titulo: "Módulos",
    permisos: [
      "modulo.cotizaciones",
      "modulo.clientes",
      "modulo.ot",
      "modulo.control.operativo",
      "modulo.weekly",
      "modulo.kpi",
    ],
  },
  {
    titulo: "Tableros",
    permisos: ["dashboard.cotizaciones", "dashboard.gerencial"],
  },
  {
    titulo: "Comercial",
    permisos: ["cotizaciones.enviar", "cotizaciones.aprobar"],
  },
  {
    titulo: "Actividades y seguimiento",
    permisos: [
      "actividades.asignar",
      "actividades.confirmar",
      "actividades.ver.todas",
      "actividades.ver.gerencia",
      "solicitudes.resolver",
      "ayudas.responder",
      "weekly.enviar",
    ],
  },
  {
    titulo: "KPIs",
    permisos: ["kpi.administrar", "kpi.asignar", "kpi.evaluar", "kpi.ver.todos", "kpi.ver.gerencia"],
  },
  {
    titulo: "Órdenes de Trabajo",
    permisos: ["ot.crear", "ot.documentos", "control.operativo.crear"],
  },
];

// ── Resolución de permisos efectivos ──────────────────────────────────────────

interface UsuarioConPermisos {
  rol?: string;
  es_super_admin?: boolean;
  permisos?: string[];
}

/**
 * Permisos efectivos de un usuario: rol admin / super admin → todos;
 * cualquier otro → la lista guardada en su perfil (filtrada al catálogo).
 */
export function permisosEfectivos(usuario: UsuarioConPermisos | null | undefined): Permiso[] {
  if (!usuario) return [];
  if (usuario.rol === "admin" || usuario.es_super_admin) return [...PERMISOS];
  return (usuario.permisos ?? []).filter(esPermisoValido);
}

export function tienePermiso(
  usuario: UsuarioConPermisos | null | undefined,
  permiso: Permiso,
): boolean {
  return permisosEfectivos(usuario).includes(permiso);
}

/**
 * Guard para API routes. La UI solo esconde; la protección real es esta
 * (regla heredada del ERP legacy: toda función valida permiso en servidor).
 *
 * Uso típico:
 *   const rechazo = exigirPermiso(session?.user, "cotizaciones.enviar");
 *   if (rechazo) return rechazo;
 */
export function exigirPermiso(
  usuario: UsuarioConPermisos | null | undefined,
  permiso: Permiso,
): { error: string; status: 401 | 403 } | null {
  if (!usuario) return { error: "No autorizado", status: 401 };
  if (!tienePermiso(usuario, permiso)) {
    return { error: `Se requiere el permiso ${permiso}`, status: 403 };
  }
  return null;
}

// ── Iniciales ─────────────────────────────────────────────────────────────────

/**
 * Iniciales de usuario (2-5 mayúsculas, p. ej. EAOL). Son la llave con la que
 * el ERP legacy identifica personas en cotizaciones y controles operativos;
 * deben capturarse antes de importar datos.
 */
export const REGEX_INICIALES = /^[A-ZÑ]{2,5}$/;

export function esInicialesValidas(valor: string): boolean {
  return REGEX_INICIALES.test(valor);
}
