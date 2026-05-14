import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/src/auth", () => ({ authOptions: {} }));
vi.mock("@/src/lib/jornadas", () => ({
  createJornada: vi.fn(),
  getJornada: vi.fn(),
  closeJornada: vi.fn(),
  getOpenJornada: vi.fn(),
}));
vi.mock("@/src/lib/odoo", () => ({ syncToOdooAsync: vi.fn() }));
vi.mock("@/src/lib/device-info", () => ({
  getDeviceInfo: vi.fn().mockReturnValue({ userAgent: "test", platform: "test", screenWidth: 390, screenHeight: 844, language: "es-MX" }),
}));

import { getServerSession } from "next-auth";
import { createJornada, getJornada, closeJornada, getOpenJornada } from "@/src/lib/jornadas";
import { syncToOdooAsync } from "@/src/lib/odoo";
import { POST } from "@/app/api/jornada/route";
import { PATCH } from "@/app/api/jornada/[jornadaId]/route";

const PLANTA_SESSION = {
  user: {
    id: "planta-001",
    email: "carlos@proyinstelec.mx",
    tipo: "planta",
    rol: "campo",
    odoo_sync: true,
    proyectos_asignados: ["proj-1"],
    perfil_completo: true,
  },
};

const TEMPORAL_SESSION = {
  user: {
    id: "temporal-001",
    email: "temp@gmail.com",
    tipo: "temporal",
    rol: "campo",
    odoo_sync: false,
    proyectos_asignados: ["proj-1"],
    perfil_completo: true,
  },
};

const VALID_CHECKIN_BODY = {
  proyectoId: "proj-1",
  checkIn: {
    timestamp: "2026-05-14T09:41:00.000Z",
    lat: 19.4284,
    lng: -99.1946,
    precision: 8,
    driveFileId: "drive-file-123",
    fotoHash: "abc123",
  },
};

function makeRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

// ── POST /api/jornada ─────────────────────────────────────────────────────────

describe("POST /api/jornada (check-in)", () => {
  beforeEach(() => {
    vi.mocked(getOpenJornada).mockResolvedValue(null);
    vi.mocked(createJornada).mockResolvedValue({ id: "jornada-abc", checkIn: { timestamp: "2026-05-14T09:41:00.000Z" } } as any);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(makeRequest("http://localhost/api/jornada", VALID_CHECKIN_BODY));
    expect(res.status).toBe(401);
  });

  it("returns 409 when user already has an open jornada", async () => {
    vi.mocked(getServerSession).mockResolvedValue(PLANTA_SESSION as any);
    vi.mocked(getOpenJornada).mockResolvedValue({ id: "existing" } as any);

    const res = await POST(makeRequest("http://localhost/api/jornada", VALID_CHECKIN_BODY));
    expect(res.status).toBe(409);
  });

  it("creates jornada and returns 201 with jornadaId for planta", async () => {
    vi.mocked(getServerSession).mockResolvedValue(PLANTA_SESSION as any);

    const res = await POST(makeRequest("http://localhost/api/jornada", VALID_CHECKIN_BODY));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.jornadaId).toBe("jornada-abc");
  });

  it("fires Odoo sync for planta workers", async () => {
    vi.mocked(getServerSession).mockResolvedValue(PLANTA_SESSION as any);

    await POST(makeRequest("http://localhost/api/jornada", VALID_CHECKIN_BODY));
    expect(syncToOdooAsync).toHaveBeenCalledOnce();
    expect(syncToOdooAsync).toHaveBeenCalledWith(
      expect.objectContaining({ email: "carlos@proyinstelec.mx" }),
    );
  });

  it("does NOT fire Odoo sync for temporal workers", async () => {
    vi.mocked(getServerSession).mockResolvedValue(TEMPORAL_SESSION as any);

    await POST(makeRequest("http://localhost/api/jornada", VALID_CHECKIN_BODY));
    expect(syncToOdooAsync).not.toHaveBeenCalled();
  });

  it("returns 403 when temporal tries to check in to unassigned project", async () => {
    vi.mocked(getServerSession).mockResolvedValue(TEMPORAL_SESSION as any);

    const res = await POST(
      makeRequest("http://localhost/api/jornada", { ...VALID_CHECKIN_BODY, proyectoId: "proj-not-assigned" }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(getServerSession).mockResolvedValue(PLANTA_SESSION as any);

    const res = await POST(makeRequest("http://localhost/api/jornada", { proyectoId: "p1" }));
    expect(res.status).toBe(400);
  });

  it("sets uploadStatus to 'pendiente' when no driveFileId provided (offline case)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(PLANTA_SESSION as any);
    const { driveFileId: _, ...noFile } = VALID_CHECKIN_BODY.checkIn;

    await POST(makeRequest("http://localhost/api/jornada", { ...VALID_CHECKIN_BODY, checkIn: noFile }));

    expect(createJornada).toHaveBeenCalledWith(
      expect.objectContaining({
        checkIn: expect.objectContaining({ uploadStatus: "pendiente" }),
      }),
    );
  });
});

// ── PATCH /api/jornada/[jornadaId] ───────────────────────────────────────────

describe("PATCH /api/jornada/:id (check-out)", () => {
  const OPEN_JORNADA = {
    id: "jornada-abc",
    usuarioId: "planta-001",
    estado: "abierta",
    checkIn: { timestamp: "2026-05-14T09:41:00.000Z" },
  };

  const VALID_CHECKOUT_BODY = {
    checkOut: {
      timestamp: "2026-05-14T17:41:00.000Z",
      lat: 19.4284,
      lng: -99.1946,
      precision: 10,
      driveFileId: "drive-checkout-456",
      fotoHash: "def456",
    },
  };

  beforeEach(() => {
    vi.mocked(getJornada).mockResolvedValue(OPEN_JORNADA as any);
    vi.mocked(closeJornada).mockResolvedValue(480);
  });

  function makePatchRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/jornada/jornada-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await PATCH(makePatchRequest(VALID_CHECKOUT_BODY), { params: { jornadaId: "jornada-abc" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when jornada not found", async () => {
    vi.mocked(getServerSession).mockResolvedValue(PLANTA_SESSION as any);
    vi.mocked(getJornada).mockResolvedValue(null);
    const res = await PATCH(makePatchRequest(VALID_CHECKOUT_BODY), { params: { jornadaId: "ghost" } });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user tries to close another user's jornada", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { ...PLANTA_SESSION.user, id: "other-user" } } as any);
    const res = await PATCH(makePatchRequest(VALID_CHECKOUT_BODY), { params: { jornadaId: "jornada-abc" } });
    expect(res.status).toBe(403);
  });

  it("returns duracionMinutos on success", async () => {
    vi.mocked(getServerSession).mockResolvedValue(PLANTA_SESSION as any);
    const res = await PATCH(makePatchRequest(VALID_CHECKOUT_BODY), { params: { jornadaId: "jornada-abc" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duracionMinutos).toBe(480);
  });

  it("returns 409 when jornada is already closed", async () => {
    vi.mocked(getServerSession).mockResolvedValue(PLANTA_SESSION as any);
    vi.mocked(getJornada).mockResolvedValue({ ...OPEN_JORNADA, estado: "cerrada" } as any);
    const res = await PATCH(makePatchRequest(VALID_CHECKOUT_BODY), { params: { jornadaId: "jornada-abc" } });
    expect(res.status).toBe(409);
  });
});
