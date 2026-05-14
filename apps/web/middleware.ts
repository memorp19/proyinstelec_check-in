import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// ── Route protection table ────────────────────────────────────────────────────
// Each entry: path prefix → required rol values (OR logic).
const PROTECTED_ROUTES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/app", roles: ["campo", "admin"] },
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/cliente", roles: ["cliente"] },
];

// Routes that require auth but no specific role (handled separately)
const AUTH_REQUIRED_PREFIXES = ["/app", "/admin", "/cliente", "/unirse"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets and next-auth internal routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const requiresAuth = AUTH_REQUIRED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!requiresAuth) return NextResponse.next();

  // /unirse is special: accessible without auth (it's the entry point for temporales)
  if (pathname.startsWith("/unirse")) return NextResponse.next();

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    // Not authenticated — redirect to sign-in with return URL
    const signIn = new URL("/unirse", request.url);
    signIn.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signIn);
  }

  // Temporales who haven't completed the onboarding form must do so before anything else
  if (token.perfil_completo === false && !pathname.startsWith("/unirse")) {
    return NextResponse.redirect(new URL("/unirse/completar-perfil", request.url));
  }

  // Role-based access
  for (const route of PROTECTED_ROUTES) {
    if (pathname.startsWith(route.prefix)) {
      if (!route.roles.includes(token.rol as string)) {
        // Authenticated but wrong role — show a 403-equivalent page
        return NextResponse.redirect(new URL("/acceso-denegado", request.url));
      }
      break;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/app/:path*",
    "/admin/:path*",
    "/cliente/:path*",
    "/unirse/:path*",
  ],
};
