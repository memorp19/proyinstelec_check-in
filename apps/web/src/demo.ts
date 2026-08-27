/** Central demo-mode constants. Imported by auth, API routes, and pages. */

export const DEMO_MODE = process.env.DEMO_MODE === "true";

export const DEMO_USER_ID = "demo-user-001";

/** Project IDs → display names shown to the demo user. */
export const DEMO_PROJECTS: Record<string, string> = {
  "demo-norte": "Subestación Norte",
  "demo-sur": "Planta Industrial Sur",
};

// ── Demo role switcher ────────────────────────────────────────────────────────

export type DemoRole = "user" | "admin" | "superAdmin" | "guest";

export interface DemoPreset {
  id: string;
  name: string;
  email: string;
  rol: "campo" | "admin" | "cliente";
  tipo: "planta" | "temporal" | "admin" | "cliente";
  es_super_admin: boolean;
  perfil_completo: boolean;
  proyectos_asignados: string[];
  odoo_sync: boolean;
  // UI only
  label: string;
  descripcion: string;
  badgeColor: string; // tailwind bg class
  route: string;     // where to land after switching
}

export const DEMO_PRESETS: Record<DemoRole, DemoPreset> = {
  user: {
    id: "demo-user-001",
    name: "Usuario Demo",
    email: "demo@proyinstelec.mx",
    rol: "campo",
    tipo: "temporal",
    es_super_admin: false,
    perfil_completo: true,
    proyectos_asignados: Object.keys(DEMO_PROJECTS),
    odoo_sync: false,
    label: "Usuario de campo",
    descripcion: "Hace check-in/out en proyectos",
    badgeColor: "bg-amber",
    route: "/app",
  },
  admin: {
    id: "demo-admin-001",
    name: "Admin Demo",
    email: "admin@proyinstelec.mx",
    rol: "admin",
    tipo: "admin",
    es_super_admin: false,
    perfil_completo: true,
    proyectos_asignados: Object.keys(DEMO_PROJECTS),
    odoo_sync: true,
    label: "Admin",
    descripcion: "Gestiona proyectos y asigna usuarios",
    badgeColor: "bg-blue",
    route: "/admin",
  },
  superAdmin: {
    id: "demo-superadmin-001",
    name: "Super Admin Demo",
    email: "superadmin@proyinstelec.mx",
    rol: "admin",
    tipo: "admin",
    es_super_admin: true,
    perfil_completo: true,
    proyectos_asignados: Object.keys(DEMO_PROJECTS),
    odoo_sync: true,
    label: "Super Admin",
    descripcion: "Control total: usuarios, proyectos y estadísticas",
    badgeColor: "bg-purple-500",
    route: "/admin",
  },
  guest: {
    id: "demo-guest-001",
    name: "Invitado Demo",
    email: "cliente@empresa-demo.com",
    rol: "cliente",
    tipo: "cliente",
    es_super_admin: false,
    perfil_completo: true,
    proyectos_asignados: ["demo-norte"],
    odoo_sync: false,
    label: "Invitado / Cliente",
    descripcion: "Solo lectura de reportes del proyecto asignado",
    badgeColor: "bg-green",
    route: "/cliente",
  },
};

export function getDemoPresetById(id: string): DemoPreset {
  return Object.values(DEMO_PRESETS).find((p) => p.id === id) ?? DEMO_PRESETS.user;
}

export function getDemoRoleLabel(id: string): string {
  return getDemoPresetById(id).label;
}

export interface ProyectoStats {
  proyectoId: string;
  nombre: string;
  totalMinutos: number;
  sesiones: number;
  ultimaFecha: string;
}

export interface DemoUser {
  id: string;
  email: string;
  nombre: string;
  rol: "campo" | "admin" | "cliente";
  tipo: "planta" | "temporal" | "admin" | "cliente";
  proyectos_asignados: string[];
  perfil_completo: boolean;
  created_at: string;
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: "demo-user-001",
    email: "demo@proyinstelec.mx",
    nombre: "Usuario Demo",
    rol: "campo",
    tipo: "temporal",
    proyectos_asignados: Object.keys(DEMO_PROJECTS),
    perfil_completo: true,
    created_at: "2026-01-15T10:00:00.000Z",
  },
  {
    id: "demo-planta-001",
    email: "carlos.reyes@proyinstelec.mx",
    nombre: "Carlos Reyes",
    rol: "campo",
    tipo: "planta",
    proyectos_asignados: ["demo-norte"],
    perfil_completo: true,
    created_at: "2025-11-03T09:30:00.000Z",
  },
  {
    id: "demo-planta-002",
    email: "lucia.mendoza@proyinstelec.mx",
    nombre: "Lucía Mendoza",
    rol: "campo",
    tipo: "planta",
    proyectos_asignados: ["demo-norte", "demo-sur"],
    perfil_completo: true,
    created_at: "2025-11-10T08:00:00.000Z",
  },
  {
    id: "demo-admin-001",
    email: "admin@proyinstelec.mx",
    nombre: "Admin Demo",
    rol: "admin",
    tipo: "admin",
    proyectos_asignados: Object.keys(DEMO_PROJECTS),
    perfil_completo: true,
    created_at: "2025-10-01T07:00:00.000Z",
  },
  {
    id: "demo-guest-001",
    email: "cliente@empresa-demo.com",
    nombre: "Invitado Demo",
    rol: "cliente",
    tipo: "cliente",
    proyectos_asignados: ["demo-norte"],
    perfil_completo: true,
    created_at: "2026-03-20T11:00:00.000Z",
  },
];

export const DEMO_HISTORIAL: ProyectoStats[] = [
  {
    proyectoId: "demo-norte",
    nombre: "Subestación Norte",
    totalMinutos: 2640,
    sesiones: 12,
    ultimaFecha: "2026-06-15T18:00:00.000Z",
  },
  {
    proyectoId: "demo-sur",
    nombre: "Planta Industrial Sur",
    totalMinutos: 1320,
    sesiones: 6,
    ultimaFecha: "2026-06-10T17:30:00.000Z",
  },
];
