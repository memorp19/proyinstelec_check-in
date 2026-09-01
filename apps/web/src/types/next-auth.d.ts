import "next-auth";
import "next-auth/jwt";

type Rol = "campo" | "admin" | "cliente";
type Tipo = "planta" | "temporal" | "admin" | "cliente";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      rol: Rol;
      tipo: Tipo;
      es_super_admin: boolean;
      perfil_completo: boolean;
      odoo_sync: boolean;
      permisos: string[];
      iniciales?: string;
      gerencia?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub?: string;
    rol: Rol;
    tipo: Tipo;
    es_super_admin?: boolean;
    perfil_completo?: boolean;
    odoo_sync?: boolean;
    permisos?: string[];
    iniciales?: string;
    gerencia?: string;
  }
}
