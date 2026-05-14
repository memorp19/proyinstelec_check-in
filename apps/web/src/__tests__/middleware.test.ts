import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Mock next-auth/jwt so we control token values without real JWTs
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { middleware } from "@/middleware";

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${pathname}`));
}

function getRedirectPath(response: NextResponse): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  return new URL(location).pathname;
}

describe("middleware — public routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes through _next static assets without checking auth", async () => {
    const res = await middleware(makeRequest("/_next/static/chunk.js"));
    expect(res.status).toBe(200);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("passes through the public landing page", async () => {
    const res = await middleware(makeRequest("/"));
    expect(res.status).toBe(200);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("passes through /api/auth routes (next-auth internal)", async () => {
    const res = await middleware(makeRequest("/api/auth/callback/google"));
    expect(res.status).toBe(200);
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe("middleware — unauthenticated user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getToken).mockResolvedValue(null);
  });

  it("redirects to /unirse when accessing /app without session", async () => {
    const res = await middleware(makeRequest("/app"));
    expect(res.status).toBe(307);
    expect(getRedirectPath(res)).toBe("/unirse");
  });

  it("redirects to /unirse when accessing /admin without session", async () => {
    const res = await middleware(makeRequest("/admin"));
    expect(res.status).toBe(307);
    expect(getRedirectPath(res)).toBe("/unirse");
  });

  it("redirects to /unirse when accessing /cliente without session", async () => {
    const res = await middleware(makeRequest("/cliente"));
    expect(res.status).toBe(307);
  });

  it("allows access to /unirse without a session (onboarding entry point)", async () => {
    const res = await middleware(makeRequest("/unirse"));
    expect(res.status).toBe(200);
  });
});

describe("middleware — temporal with incomplete profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to /unirse/completar-perfil when perfil_completo is false", async () => {
    vi.mocked(getToken).mockResolvedValue({
      sub: "abc",
      rol: "campo",
      tipo: "temporal",
      perfil_completo: false,
      proyectos_asignados: [],
      odoo_sync: false,
    } as any);

    const res = await middleware(makeRequest("/app"));
    expect(res.status).toBe(307);
    expect(getRedirectPath(res)).toBe("/unirse/completar-perfil");
  });
});

describe("middleware — authenticated planta worker", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockResolvedValue({
      sub: "google-sub-planta",
      rol: "campo",
      tipo: "planta",
      perfil_completo: true,
      proyectos_asignados: ["proj-1"],
      odoo_sync: true,
    } as any);
  });

  it("allows access to /app", async () => {
    const res = await middleware(makeRequest("/app"));
    expect(res.status).toBe(200);
  });

  it("denies access to /admin (rol: campo, not admin)", async () => {
    const res = await middleware(makeRequest("/admin"));
    expect(res.status).toBe(307);
    expect(getRedirectPath(res)).toBe("/acceso-denegado");
  });

  it("denies access to /cliente (wrong role)", async () => {
    const res = await middleware(makeRequest("/cliente"));
    expect(res.status).toBe(307);
    expect(getRedirectPath(res)).toBe("/acceso-denegado");
  });
});

describe("middleware — admin user", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockResolvedValue({
      sub: "google-sub-admin",
      rol: "admin",
      tipo: "planta",
      perfil_completo: true,
      proyectos_asignados: [],
      odoo_sync: false,
    } as any);
  });

  it("allows access to /admin", async () => {
    const res = await middleware(makeRequest("/admin"));
    expect(res.status).toBe(200);
  });

  it("allows access to /app (admin has campo role too)", async () => {
    const res = await middleware(makeRequest("/app"));
    expect(res.status).toBe(200);
  });
});

describe("middleware — cliente user", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockResolvedValue({
      sub: "google-sub-cliente",
      rol: "cliente",
      tipo: "cliente",
      perfil_completo: true,
      proyectos_asignados: ["proj-ext-1"],
      odoo_sync: false,
    } as any);
  });

  it("allows access to /cliente", async () => {
    const res = await middleware(makeRequest("/cliente"));
    expect(res.status).toBe(200);
  });

  it("denies access to /admin", async () => {
    const res = await middleware(makeRequest("/admin"));
    expect(res.status).toBe(307);
    expect(getRedirectPath(res)).toBe("/acceso-denegado");
  });

  it("denies access to /app", async () => {
    const res = await middleware(makeRequest("/app"));
    expect(res.status).toBe(307);
    expect(getRedirectPath(res)).toBe("/acceso-denegado");
  });
});
