import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import { getDb } from "./db";
import { users, accounts, sessions, verificationTokens } from "./db/schema";
import { DEMO_MODE, getDemoPresetById } from "./demo";
import { classifyEmail } from "./lib/users";

/**
 * Instancia completa de Auth.js v5: la configuración compartida más el
 * adaptador de Drizzle (Neon) y los callbacks que leen datos de dominio.
 *
 * La configuración es una función para que `getDb()` sólo se evalúe al atender
 * una petición: así el build de Vercel no necesita DATABASE_URL.
 */

interface DatosDominio {
  rol: "campo" | "admin" | "cliente";
  tipo: "planta" | "temporal" | "admin" | "cliente";
  perfil_completo: boolean;
  odoo_sync: boolean;
  permisos: string[];
  iniciales?: string;
  gerencia?: string;
  es_super_admin: boolean;
}

async function cargarDominio(userId: string): Promise<DatosDominio | null> {
  const [row] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  return {
    rol: row.rol,
    tipo: row.tipo,
    perfil_completo: row.perfilCompleto,
    odoo_sync: row.odooSync,
    permisos: row.permisos ?? [],
    iniciales: row.iniciales ?? undefined,
    gerencia: row.gerencia ?? undefined,
    es_super_admin: row.esSuperAdmin,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...authConfig,
  // En modo demo nada se persiste: el adaptador sobra.
  adapter: DEMO_MODE
    ? undefined
    : DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      }),

  callbacks: {
    ...authConfig.callbacks,

    async signIn({ account }) {
      if (DEMO_MODE) return true;
      return account?.provider === "google";
    },

    async jwt({ token, user, trigger }) {
      if (DEMO_MODE) {
        const preset = getDemoPresetById((user?.id as string) ?? token.sub ?? "");
        return {
          ...token,
          sub: preset.id,
          rol: preset.rol,
          tipo: preset.tipo,
          es_super_admin: preset.es_super_admin,
          perfil_completo: preset.perfil_completo,
          odoo_sync: preset.odoo_sync,
          permisos: [],
        };
      }

      // Recarga desde la base al iniciar sesión, tras un update() explícito
      // (p. ej. al terminar el alta) y mientras el perfil siga incompleto.
      const debeRefrescar =
        Boolean(user) || trigger === "update" || token.perfil_completo === false;

      if (debeRefrescar && (user?.id ?? token.sub)) {
        const id = (user?.id as string) ?? (token.sub as string);
        const dominio = await cargarDominio(id);
        if (dominio) {
          token.sub = id;
          Object.assign(token, dominio);
        } else {
          // La escritura del adaptador aún no se ve (raro): valores mínimos.
          token.rol ??= "campo";
          token.tipo ??= classifyEmail(token.email ?? "");
          token.perfil_completo ??= false;
          token.odoo_sync ??= false;
          token.permisos ??= [];
        }
        // Un super admin siempre manda con rol de administrador
        if (token.es_super_admin) {
          token.rol = "admin";
          token.tipo = "admin";
        }
      }

      return token;
    },
  },

  events: {
    /**
     * Alta automática: el personal de planta (@proyinstelec.mx) entra listo para
     * trabajar; los temporales quedan con el perfil incompleto hasta que llenan
     * el formulario de alta.
     */
    async createUser({ user }) {
      if (!user.id || !user.email) return;
      const tipo = classifyEmail(user.email);
      const esPlanta = tipo === "planta";
      await getDb()
        .update(users)
        .set({
          tipo,
          rol: "campo",
          odooSync: esPlanta,
          perfilCompleto: esPlanta,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    },
  },
}));
