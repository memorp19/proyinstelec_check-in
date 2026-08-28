import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/src/auth.config";

/**
 * Protección de rutas en el runtime edge. Usa la configuración sin adaptador:
 * aquí sólo se verifica el token de sesión, nunca se consulta la base.
 */
const { auth } = NextAuth(authConfig);

/** Prefijo de ruta → roles admitidos (OR). */
const RUTAS_PROTEGIDAS: Array<{ prefijo: string; roles: string[] }> = [
  { prefijo: "/app", roles: ["campo", "admin"] },
  { prefijo: "/admin", roles: ["admin"] },
  { prefijo: "/cliente", roles: ["cliente", "admin"] },
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const sesion = req.auth;

  // /unirse es la puerta de entrada: siempre accesible
  if (pathname.startsWith("/unirse")) return NextResponse.next();

  if (!sesion?.user) {
    const login = new URL("/unirse", req.nextUrl.origin);
    login.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(login);
  }

  // Los temporales completan su alta antes de cualquier otra cosa
  if (sesion.user.perfil_completo === false) {
    return NextResponse.redirect(new URL("/unirse/completar-perfil", req.nextUrl.origin));
  }

  // ERP: admins, super admin o cualquiera con al menos un permiso del catálogo.
  // La autorización fina por módulo la aplica cada ruta con exigirPermiso().
  if (pathname.startsWith("/erp")) {
    const puede =
      sesion.user.rol === "admin" ||
      sesion.user.es_super_admin === true ||
      (sesion.user.permisos?.length ?? 0) > 0;
    return puede
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/acceso-denegado", req.nextUrl.origin));
  }

  for (const ruta of RUTAS_PROTEGIDAS) {
    if (pathname.startsWith(ruta.prefijo)) {
      if (!ruta.roles.includes(sesion.user.rol)) {
        return NextResponse.redirect(new URL("/acceso-denegado", req.nextUrl.origin));
      }
      break;
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/cliente/:path*", "/unirse/:path*", "/erp/:path*"],
};
