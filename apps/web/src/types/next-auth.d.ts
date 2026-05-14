import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;           // google_sub
      name?: string | null;
      email?: string | null;
      image?: string | null;
      rol: "campo" | "admin" | "cliente";
      tipo: "planta" | "temporal" | "admin" | "cliente";
      perfil_completo: boolean;
      proyectos_asignados: string[];
      odoo_sync: boolean;
    };
  }

  interface User {
    id: string;             // google_sub
    rol?: "campo" | "admin" | "cliente";
    tipo?: "planta" | "temporal" | "admin" | "cliente";
    perfil_completo?: boolean;
    proyectos_asignados?: string[];
    odoo_sync?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub: string;            // google_sub — always present after Google auth
    rol: "campo" | "admin" | "cliente";
    tipo: "planta" | "temporal" | "admin" | "cliente";
    perfil_completo: boolean;
    proyectos_asignados: string[];
    odoo_sync: boolean;
  }
}
