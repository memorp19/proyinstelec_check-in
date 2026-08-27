import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DEMO_MODE, DEMO_PRESETS, type DemoRole } from "./demo";

/**
 * Configuración compartida y libre de base de datos.
 *
 * El middleware corre en el runtime edge y sólo necesita verificar el token,
 * así que monta Auth.js con esta configuración; la instancia completa
 * (con adaptador de Drizzle y callbacks que leen Neon) vive en `auth.ts`.
 */
export const authConfig = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/unirse", error: "/auth/error" },

  providers: DEMO_MODE
    ? [
        Credentials({
          id: "demo",
          name: "Demo",
          credentials: { demoRole: { label: "Demo Role", type: "text" } },
          async authorize(credentials) {
            const role = ((credentials?.demoRole as string) || "user") as DemoRole;
            const preset = DEMO_PRESETS[role] ?? DEMO_PRESETS.user;
            return { id: preset.id, name: preset.name, email: preset.email, image: null };
          },
        }),
      ]
    : [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
          authorization: {
            params: {
              access_type: "offline",
              prompt: "consent",
              hd: process.env.GOOGLE_WORKSPACE_DOMAIN ?? "proyinstelec.mx",
            },
          },
          /**
           * Enlaza por correo con un perfil ya sembrado (alta previa del admin,
           * importación) en lugar de fallar con OAuthAccountNotLinked. Es seguro
           * aquí: Google es el único proveedor y siempre entrega correo verificado.
           */
          allowDangerousEmailAccountLinking: true,
        }),
      ],

  callbacks: {
    /** Proyecta el token en la sesión. No toca la base: sirve también en edge. */
    session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.rol = token.rol;
      session.user.tipo = token.tipo;
      session.user.es_super_admin = Boolean(token.es_super_admin);
      session.user.perfil_completo = Boolean(token.perfil_completo);
      session.user.odoo_sync = Boolean(token.odoo_sync);
      session.user.permisos = token.permisos ?? [];
      session.user.iniciales = token.iniciales;
      session.user.gerencia = token.gerencia;
      return session;
    },
  },
} satisfies NextAuthConfig;
