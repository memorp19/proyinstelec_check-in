import type { Account, Profile, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import { getUserByGoogleSub, getUserByEmail, deleteUser, upsertUser, buildInitialProfile, classifyEmail } from "./lib/users";

// ── signIn callback ───────────────────────────────────────────────────────────
// Called right after Google returns a valid token.
// Returns true to allow sign-in, false or a redirect URL to deny.

export async function handleSignIn(params: {
  user: User;
  account: Account | null;
}): Promise<boolean | string> {
  const { user, account } = params;

  // Only handle Google OAuth (not credentials)
  if (account?.provider !== "google") return false;

  const email = user.email;
  const googleSub = account.providerAccountId; // stable Google user ID

  if (!email || !googleSub) return false;

  const tipo = classifyEmail(email);
  const existing = await getUserByGoogleSub(googleSub);

  if (!existing) {
    // Check for a pre-seeded profile (e.g. admin registered before first login).
    // Migrate it to the real google_sub so role/tipo are preserved.
    const preSeeded = await getUserByEmail(email);
    if (preSeeded) {
      const placeholder = preSeeded.google_sub;
      await upsertUser({
        ...preSeeded,
        google_sub: googleSub,
        foto_url: user.image ?? preSeeded.foto_url,
        updated_at: new Date().toISOString(),
      });
      if (placeholder !== googleSub) {
        await deleteUser(placeholder);
      }
    } else if (tipo === "planta") {
      // Auto-create planta profile on first login
      await upsertUser(
        buildInitialProfile({
          googleSub,
          email,
          nombre: user.name ?? email.split("@")[0],
          fotoUrl: user.image ?? undefined,
          tipo: "planta",
        }),
      );
    } else {
      // Temporales must arrive via /unirse?token=xxx — their profile is created there.
      // Allow sign-in; the middleware will redirect them to complete registration
      // if no valid session profile exists yet in DynamoDB.
      await upsertUser(
        buildInitialProfile({
          googleSub,
          email,
          nombre: user.name ?? email.split("@")[0],
          fotoUrl: user.image ?? undefined,
          tipo: "temporal",
        }),
      );
    }
  }

  return true;
}

// ── jwt callback ──────────────────────────────────────────────────────────────
// Runs every time a JWT is created or updated.
// We load the DB profile on first sign-in and cache it in the token.

export async function handleJwt(params: {
  token: JWT;
  account: Account | null;
}): Promise<JWT> {
  const { token, account } = params;

  // Refresh from DB on first sign-in OR whenever the profile is still incomplete
  // (the latter lets update() after /api/perfil/completar pick up the new value)
  if ((account?.provider === "google" || token.perfil_completo === false) && token.sub) {
    const profile = await getUserByGoogleSub(token.sub);
    if (profile) {
      token.rol = profile.rol;
      token.tipo = profile.tipo;
      token.perfil_completo = profile.perfil_completo;
      token.proyectos_asignados = profile.proyectos_asignados;
      token.odoo_sync = profile.odoo_sync;
    } else {
      // Fallback in case DB write in handleSignIn hasn't propagated (rare)
      token.rol = "campo";
      token.tipo = classifyEmail(token.email ?? "") === "planta" ? "planta" : "temporal";
      token.perfil_completo = false;
      token.proyectos_asignados = [];
      token.odoo_sync = false;
    }
  }

  return token;
}

// ── session callback ──────────────────────────────────────────────────────────
// Shapes the client-visible session from the JWT.

export function handleSession(params: { session: Session; token: JWT }): Session {
  const { session, token } = params;

  session.user.id = token.sub;
  session.user.rol = token.rol;
  session.user.tipo = token.tipo;
  session.user.perfil_completo = token.perfil_completo;
  session.user.proyectos_asignados = token.proyectos_asignados ?? [];
  session.user.odoo_sync = token.odoo_sync;

  return session;
}
