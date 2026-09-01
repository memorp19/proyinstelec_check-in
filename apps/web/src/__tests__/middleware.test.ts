import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * El middleware corre sobre Auth.js v5: se monta con `NextAuth(authConfig)` y
 * recibe la sesión ya resuelta en `req.auth`. Aquí mockeamos ese wrapper para
 * controlar la sesión y probar sólo las reglas de acceso.
 */
let sesionActual: unknown = null;

vi.mock("next-auth", () => ({
  default: () => ({
    auth: (handler: (req: NextRequest & { auth: unknown }) => unknown) => (req: NextRequest) => {
      const conAuth = Object.assign(req, { auth: sesionActual });
      return handler(conAuth as NextRequest & { auth: unknown });
    },
  }),
}));

vi.mock("@/src/auth.config", () => ({ authConfig: {} }));

const { default: middleware } = await import("@/middleware");

function pedir(pathname: string) {
  return middleware(new NextRequest(new URL(`http://localhost${pathname}`)), undefined as never);
}

function destino(res: Response): string | null {
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
}

function sesion(user: Record<string, unknown>) {
  sesionActual = { user: { id: "u1", perfil_completo: true, permisos: [], ...user } };
}

beforeEach(() => {
  sesionActual = null;
});

describe("middleware — sin sesión", () => {
  it("manda a /unirse conservando el destino", async () => {
    const res = (await pedir("/app")) as Response;
    expect(res.status).toBe(307);
    expect(destino(res)).toBe("/unirse");
    expect(new URL(res.headers.get("location")!).searchParams.get("callbackUrl")).toBe("/app");
  });

  it("deja pasar /unirse (puerta de entrada)", async () => {
    const res = (await pedir("/unirse")) as Response;
    expect(res.status).toBe(200);
  });
});

describe("middleware — alta incompleta", () => {
  it("obliga a terminar el registro antes de cualquier ruta", async () => {
    sesion({ rol: "campo", perfil_completo: false });
    const res = (await pedir("/app")) as Response;
    expect(destino(res)).toBe("/unirse/completar-perfil");
  });
});

describe("middleware — roles", () => {
  it("campo entra a /app pero no a /admin ni /cliente", async () => {
    sesion({ rol: "campo" });
    expect(((await pedir("/app")) as Response).status).toBe(200);
    expect(destino((await pedir("/admin")) as Response)).toBe("/acceso-denegado");
    expect(destino((await pedir("/cliente")) as Response)).toBe("/acceso-denegado");
  });

  it("admin entra a /admin y a /app", async () => {
    sesion({ rol: "admin" });
    expect(((await pedir("/admin")) as Response).status).toBe(200);
    expect(((await pedir("/app")) as Response).status).toBe(200);
  });

  it("cliente sólo entra a /cliente", async () => {
    sesion({ rol: "cliente" });
    expect(((await pedir("/cliente")) as Response).status).toBe(200);
    expect(destino((await pedir("/app")) as Response)).toBe("/acceso-denegado");
  });
});

describe("middleware — /erp", () => {
  it("admin entra siempre", async () => {
    sesion({ rol: "admin" });
    expect(((await pedir("/erp")) as Response).status).toBe(200);
  });

  it("un usuario de campo entra si tiene al menos un permiso del ERP", async () => {
    sesion({ rol: "campo", permisos: ["modulo.cotizaciones"] });
    expect(((await pedir("/erp/cotizaciones")) as Response).status).toBe(200);
  });

  it("sin permisos del ERP, no entra", async () => {
    sesion({ rol: "campo", permisos: [] });
    expect(destino((await pedir("/erp")) as Response)).toBe("/acceso-denegado");
  });

  it("el super admin entra aunque su rol no sea admin", async () => {
    sesion({ rol: "campo", es_super_admin: true });
    expect(((await pedir("/erp")) as Response).status).toBe(200);
  });
});
