/**
 * Los encabezados de seguridad (B11, docs/seguridad-erp.md §3.6): que el ERP
 * no se pueda meter en un marco ajeno, más `nosniff` y `Referrer-Policy`, en
 * todas las respuestas.
 *
 * Se lee `next.config.js` tal cual lo carga Next, con `next-pwa` encima, para
 * que un envoltorio que se coma `headers()` también se note aquí.
 */
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);

interface Regla {
  source: string;
  headers: Array<{ key: string; value: string }>;
}
const config = require("../../../next.config.js") as { headers?: () => Promise<Regla[]> };
/** El mismo comparador con el que Next decide a qué rutas aplica cada regla. */
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match") as {
  getPathMatch: (ruta: string) => (pathname: string) => false | object;
};

/** Los encabezados que recibe una ruta, juntando todas las reglas que le aplican. */
async function encabezadosDe(pathname: string): Promise<Record<string, string>> {
  const reglas = (await config.headers?.()) ?? [];
  const fuera: Record<string, string> = {};
  for (const r of reglas) {
    if (getPathMatch(r.source)(pathname) === false) continue;
    for (const { key, value } of r.headers) fuera[key.toLowerCase()] = value;
  }
  return fuera;
}

const RUTAS = [
  "/",
  "/erp/cotizaciones",
  "/erp/revision",
  "/app",
  "/api/upload",
  "/api/erp/cotizaciones/453-2026/enviar",
  "/api/auth/callback/google",
  "/_next/static/chunks/main.js",
  "/manifest.json",
];

describe("los encabezados de seguridad", () => {
  it.each(RUTAS)("%s no se deja enmarcar", async (ruta) => {
    const h = await encabezadosDe(ruta);

    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toBe("frame-ancestors 'none'");
  });

  it.each(RUTAS)("%s lleva nosniff y Referrer-Policy", async (ruta) => {
    const h = await encabezadosDe(ruta);

    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  // Una CSP con más directivas (script-src, connect-src…) puede romper el
  // inicio de sesión con Google o la PWA sin que nada falle en el servidor.
  // Ampliarla es una decisión aparte, y esta prueba obliga a tomarla.
  it("la CSP solo decide quién puede enmarcar al ERP", async () => {
    const csp = (await encabezadosDe("/"))["content-security-policy"];

    expect(csp.split(";").map((d) => d.trim()).filter(Boolean)).toEqual(["frame-ancestors 'none'"]);
  });
});
