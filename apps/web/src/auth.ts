import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { handleJwt, handleSession, handleSignIn } from "./auth-callbacks";
import { DEMO_MODE, DEMO_USER_ID, DEMO_PROJECTS } from "./demo";

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
          credentials: {},
          async authorize() {
            return { id: DEMO_USER_ID, name: "Usuario Demo", email: "demo@proyinstelec.mx", image: null };
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
        params.token.sub = DEMO_USER_ID;
        params.token.rol = "campo";
        params.token.tipo = "temporal";
        params.token.perfil_completo = true;
        params.token.proyectos_asignados = Object.keys(DEMO_PROJECTS);
        params.token.odoo_sync = false;
        return params.token;
      }
      return handleJwt(params);
    },
    session: (params) => {
      if (DEMO_MODE) {
        params.session.user.id = DEMO_USER_ID;
        params.session.user.rol = "campo";
        params.session.user.tipo = "temporal";
        params.session.user.perfil_completo = true;
        params.session.user.proyectos_asignados = Object.keys(DEMO_PROJECTS);
        params.session.user.odoo_sync = false;
        return params.session;
      }
      return handleSession(params);
    },
  },
};

