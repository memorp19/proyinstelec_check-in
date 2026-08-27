import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { handleJwt, handleSession, handleSignIn } from "./auth-callbacks";
import { DEMO_MODE, DEMO_PRESETS, getDemoPresetById, type DemoRole } from "./demo";

if (!process.env.NEXTAUTH_SECRET) throw new Error("Missing NEXTAUTH_SECRET");

// Google credentials are only required outside demo mode
if (!DEMO_MODE) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error("Missing GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error("Missing GOOGLE_CLIENT_SECRET");
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers: DEMO_MODE
    ? [
        CredentialsProvider({
          id: "demo",
          name: "Demo",
          credentials: {
            demoRole: { label: "Demo Role", type: "text" },
          },
          async authorize(credentials) {
            const role = ((credentials?.demoRole as string) || "user") as DemoRole;
            const preset = DEMO_PRESETS[role] ?? DEMO_PRESETS.user;
            return { id: preset.id, name: preset.name, email: preset.email, image: null };
          },
        }),
      ]
    : [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          authorization: {
            params: {
              access_type: "offline",
              prompt: "consent",
              hd: "proyinstelec.mx",
            },
          },
        }),
      ],
  pages: {
    signIn: "/unirse",
    error: "/auth/error",
  },
  callbacks: {
    signIn: (params) => {
      if (DEMO_MODE) return true;
      return handleSignIn(params);
    },
    jwt: (params) => {
      if (DEMO_MODE) {
        const preset = getDemoPresetById(params.token.sub ?? "");
        params.token.rol = preset.rol;
        params.token.tipo = preset.tipo;
        params.token.es_super_admin = preset.es_super_admin;
        params.token.perfil_completo = preset.perfil_completo;
        params.token.proyectos_asignados = preset.proyectos_asignados;
        params.token.odoo_sync = preset.odoo_sync;
        return params.token;
      }
      return handleJwt(params);
    },
    session: (params) => {
      if (DEMO_MODE) {
        const preset = getDemoPresetById(params.token.sub ?? "");
        params.session.user.id = preset.id;
        params.session.user.rol = preset.rol;
        params.session.user.tipo = preset.tipo;
        params.session.user.es_super_admin = preset.es_super_admin;
        params.session.user.perfil_completo = preset.perfil_completo;
        params.session.user.proyectos_asignados = preset.proyectos_asignados;
        params.session.user.odoo_sync = preset.odoo_sync;
        return params.session;
      }
      return handleSession(params);
    },
  },
};

