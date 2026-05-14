import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all DynamoDB operations
vi.mock("@/src/lib/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/users")>();
  return {
    ...actual, // keep classifyEmail and buildInitialProfile (pure functions)
    getUserByGoogleSub: vi.fn(),
    getUserByEmail: vi.fn(),
    deleteUser: vi.fn(),
    upsertUser: vi.fn(),
  };
});

import { getUserByGoogleSub, getUserByEmail, deleteUser, upsertUser, buildInitialProfile } from "@/src/lib/users";
import { handleSignIn, handleJwt, handleSession } from "@/src/auth-callbacks";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

// ── handleSignIn ──────────────────────────────────────────────────────────────

describe("handleSignIn", () => {
  const googleAccount = { provider: "google", providerAccountId: "google-sub-abc" } as any;

  beforeEach(() => vi.clearAllMocks());

  it("returns false for non-Google providers", async () => {
    const result = await handleSignIn({
      user: { id: "1", email: "x@y.com" },
      account: { provider: "credentials", providerAccountId: "1" } as any,
    });
    expect(result).toBe(false);
  });

  it("returns false when email is missing", async () => {
    const result = await handleSignIn({ user: { id: "1", email: null }, account: googleAccount });
    expect(result).toBe(false);
  });

  it("creates a planta profile on first login for @proyinstelec.mx", async () => {
    vi.mocked(getUserByGoogleSub).mockResolvedValue(null);
    vi.mocked(getUserByEmail).mockResolvedValue(null);
    vi.mocked(upsertUser).mockResolvedValue(undefined);

    const result = await handleSignIn({
      user: { id: "1", name: "Carlos Reyes", email: "carlos@proyinstelec.mx", image: null },
      account: googleAccount,
    });

    expect(result).toBe(true);
    expect(upsertUser).toHaveBeenCalledOnce();
    const calledWith = vi.mocked(upsertUser).mock.calls[0][0];
    expect(calledWith.tipo).toBe("planta");
    expect(calledWith.odoo_sync).toBe(true);
    expect(calledWith.perfil_completo).toBe(true);
  });

  it("creates a temporal profile on first login for external email", async () => {
    vi.mocked(getUserByGoogleSub).mockResolvedValue(null);
    vi.mocked(getUserByEmail).mockResolvedValue(null);
    vi.mocked(upsertUser).mockResolvedValue(undefined);

    const result = await handleSignIn({
      user: { id: "1", name: "Juan Temp", email: "juan@gmail.com", image: null },
      account: googleAccount,
    });

    expect(result).toBe(true);
    const calledWith = vi.mocked(upsertUser).mock.calls[0][0];
    expect(calledWith.tipo).toBe("temporal");
    expect(calledWith.odoo_sync).toBe(false);
    expect(calledWith.perfil_completo).toBe(false);
  });

  it("skips upsert when user already exists", async () => {
    vi.mocked(getUserByGoogleSub).mockResolvedValue({
      google_sub: "google-sub-abc",
      email: "carlos@proyinstelec.mx",
      tipo: "planta",
    } as any);

    const result = await handleSignIn({
      user: { id: "1", email: "carlos@proyinstelec.mx" },
      account: googleAccount,
    });

    expect(result).toBe(true);
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it("migrates a pre-seeded admin profile to the real google_sub on first login", async () => {
    const preSeeded = {
      google_sub: "superadmin-placeholder-memorp19",
      email: "memorp19@gmail.com",
      nombre: "Super Admin",
      tipo: "admin",
      rol: "admin",
      odoo_sync: false,
      perfil_completo: true,
      proyectos_asignados: [],
    };
    vi.mocked(getUserByGoogleSub).mockResolvedValue(null);
    vi.mocked(getUserByEmail).mockResolvedValue(preSeeded as any);
    vi.mocked(upsertUser).mockResolvedValue(undefined);
    vi.mocked(deleteUser).mockResolvedValue(undefined);

    const result = await handleSignIn({
      user: { id: "1", name: "Real Name", email: "memorp19@gmail.com", image: "https://photo.jpg" },
      account: { provider: "google", providerAccountId: "real-google-sub-xyz" } as any,
    });

    expect(result).toBe(true);
    // upserted with the real google_sub preserving admin role
    expect(upsertUser).toHaveBeenCalledOnce();
    const upserted = vi.mocked(upsertUser).mock.calls[0][0];
    expect(upserted.google_sub).toBe("real-google-sub-xyz");
    expect(upserted.rol).toBe("admin");
    expect(upserted.tipo).toBe("admin");
    expect(upserted.perfil_completo).toBe(true);
    expect(upserted.foto_url).toBe("https://photo.jpg");
    // placeholder deleted
    expect(deleteUser).toHaveBeenCalledWith("superadmin-placeholder-memorp19");
  });
});

// ── handleJwt ─────────────────────────────────────────────────────────────────

describe("handleJwt", () => {
  const baseToken: JWT = {
    sub: "google-sub-abc",
    email: "carlos@proyinstelec.mx",
    rol: "campo",
    tipo: "planta",
    perfil_completo: true,
    proyectos_asignados: [],
    odoo_sync: true,
  };

  const googleAccount = { provider: "google" } as any;

  beforeEach(() => vi.clearAllMocks());

  it("enriches the token with DB profile on first sign-in", async () => {
    vi.mocked(getUserByGoogleSub).mockResolvedValue({
      google_sub: "google-sub-abc",
      rol: "admin",
      tipo: "planta",
      perfil_completo: true,
      proyectos_asignados: ["proj-1"],
      odoo_sync: true,
    } as any);

    const result = await handleJwt({ token: { ...baseToken }, account: googleAccount });

    expect(result.rol).toBe("admin");
    expect(result.proyectos_asignados).toEqual(["proj-1"]);
  });

  it("uses fallback defaults when DB profile not found", async () => {
    vi.mocked(getUserByGoogleSub).mockResolvedValue(null);

    const result = await handleJwt({ token: { ...baseToken }, account: googleAccount });

    expect(result.rol).toBe("campo");
    expect(result.perfil_completo).toBe(false);
  });

  it("does not call DB when account is null (subsequent requests)", async () => {
    const result = await handleJwt({ token: { ...baseToken }, account: null });
    expect(getUserByGoogleSub).not.toHaveBeenCalled();
    expect(result).toEqual(baseToken);
  });
});

// ── handleSession ─────────────────────────────────────────────────────────────

describe("handleSession", () => {
  it("maps JWT fields onto the session user", () => {
    const session: Session = {
      user: { name: "Carlos", email: "carlos@proyinstelec.mx", image: null } as any,
      expires: "2099-01-01",
    };
    const token: JWT = {
      sub: "google-sub-abc",
      rol: "admin",
      tipo: "planta",
      perfil_completo: true,
      proyectos_asignados: ["p1", "p2"],
      odoo_sync: true,
    };

    const result = handleSession({ session, token });

    expect(result.user.id).toBe("google-sub-abc");
    expect(result.user.rol).toBe("admin");
    expect(result.user.proyectos_asignados).toEqual(["p1", "p2"]);
  });

  it("defaults proyectos_asignados to empty array when token has none", () => {
    const session: Session = {
      user: { name: "Test" } as any,
      expires: "2099-01-01",
    };
    const token: JWT = {
      sub: "abc",
      rol: "campo",
      tipo: "temporal",
      perfil_completo: false,
      proyectos_asignados: undefined as any,
      odoo_sync: false,
    };

    const result = handleSession({ session, token });
    expect(result.user.proyectos_asignados).toEqual([]);
  });
});
