import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/src/auth", () => ({ authOptions: {} }));
vi.mock("@/src/lib/users", () => ({
  markProfileComplete: vi.fn(),
}));
vi.mock("@/src/lib/invitaciones", () => ({
  validateToken: vi.fn(),
  consumeToken: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { markProfileComplete } from "@/src/lib/users";
import { validateToken, consumeToken } from "@/src/lib/invitaciones";
import { POST } from "@/app/api/perfil/completar/route";

const INCOMPLETE_SESSION = {
  user: {
    id: "temporal-001",
    email: "temp@gmail.com",
    tipo: "temporal",
    rol: "campo",
    odoo_sync: false,
    proyectos_asignados: [],
    perfil_completo: false,
  },
};

const COMPLETE_SESSION = {
  user: { ...INCOMPLETE_SESSION.user, perfil_completo: true },
};

const VALID_BODY = {
  nombre: "Juan Pérez",
  telefono: "55 1234 5678",
  id_oficial: "CURP123456",
  contacto_emergencia: { nombre: "María Pérez", telefono: "55 9876 5432" },
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/perfil/completar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/perfil/completar", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("returns 409 when profile already complete", async () => {
    vi.mocked(getServerSession).mockResolvedValue(COMPLETE_SESSION);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(getServerSession).mockResolvedValue(INCOMPLETE_SESSION);
    const res = await POST(makeRequest({ nombre: "Juan" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when contacto_emergencia is missing telefono", async () => {
    vi.mocked(getServerSession).mockResolvedValue(INCOMPLETE_SESSION);
    const body = {
      ...VALID_BODY,
      contacto_emergencia: { nombre: "María" },
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it("calls markProfileComplete with correct data and returns 200", async () => {
    vi.mocked(getServerSession).mockResolvedValue(INCOMPLETE_SESSION);
    vi.mocked(markProfileComplete).mockResolvedValue(undefined);

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(markProfileComplete).toHaveBeenCalledWith(
      "temporal-001",
      expect.objectContaining({
        nombre: "Juan Pérez",
        telefono: "55 1234 5678",
        id_oficial: "CURP123456",
        contacto_emergencia: { nombre: "María Pérez", telefono: "55 9876 5432" },
        terminos_aceptados_at: expect.any(String),
      }),
    );
    expect(consumeToken).not.toHaveBeenCalled();
  });

  it("validates and consumes token when pending_token is provided", async () => {
    vi.mocked(getServerSession).mockResolvedValue(INCOMPLETE_SESSION);
    vi.mocked(markProfileComplete).mockResolvedValue(undefined);
    vi.mocked(validateToken).mockResolvedValue({
      valid: true,
      invitacion: {
        token: "tok-abc",
        proyectoId: "proj-1",
        creadoPor: "admin",
        nombreSugerido: "Juan",
        estado: "pendiente",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    vi.mocked(consumeToken).mockResolvedValue(undefined);

    const res = await POST(makeRequest({ ...VALID_BODY, pending_token: "tok-abc" }));

    expect(res.status).toBe(200);
    expect(validateToken).toHaveBeenCalledWith("tok-abc");
    expect(consumeToken).toHaveBeenCalledWith("tok-abc", "temporal-001");
  });

  it("returns 400 when pending_token is invalid", async () => {
    vi.mocked(getServerSession).mockResolvedValue(INCOMPLETE_SESSION);
    vi.mocked(validateToken).mockResolvedValue({ valid: false, reason: "expired" });

    const res = await POST(makeRequest({ ...VALID_BODY, pending_token: "bad-token" }));

    expect(res.status).toBe(400);
    expect(markProfileComplete).not.toHaveBeenCalled();
  });

  it("still returns 200 when consumeToken throws (race condition)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(INCOMPLETE_SESSION);
    vi.mocked(markProfileComplete).mockResolvedValue(undefined);
    vi.mocked(validateToken).mockResolvedValue({
      valid: true,
      invitacion: {
        token: "tok-abc",
        proyectoId: "proj-1",
        creadoPor: "admin",
        nombreSugerido: "Juan",
        estado: "pendiente",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    vi.mocked(consumeToken).mockRejectedValue(
      new Error("ConditionalCheckFailedException"),
    );

    const res = await POST(makeRequest({ ...VALID_BODY, pending_token: "tok-abc" }));

    // Profile was saved; token race is silently swallowed
    expect(res.status).toBe(200);
    expect(markProfileComplete).toHaveBeenCalled();
  });

  it("trims whitespace from all string fields", async () => {
    vi.mocked(getServerSession).mockResolvedValue(INCOMPLETE_SESSION);
    vi.mocked(markProfileComplete).mockResolvedValue(undefined);

    const res = await POST(
      makeRequest({
        nombre: "  Juan Pérez  ",
        telefono: "  55 1234 5678  ",
        id_oficial: "  CURP123456  ",
        contacto_emergencia: {
          nombre: "  María  ",
          telefono: "  55 9876 5432  ",
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(markProfileComplete).toHaveBeenCalledWith(
      "temporal-001",
      expect.objectContaining({
        nombre: "Juan Pérez",
        telefono: "55 1234 5678",
        id_oficial: "CURP123456",
        contacto_emergencia: { nombre: "María", telefono: "55 9876 5432" },
      }),
    );
  });
});
