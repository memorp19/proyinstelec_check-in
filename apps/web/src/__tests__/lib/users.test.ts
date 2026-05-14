import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyEmail, buildInitialProfile } from "@/src/lib/users";

// ── Unit tests for pure functions ─────────────────────────────────────────────
// DynamoDB-dependent functions are tested via the mocked client below.

describe("classifyEmail", () => {
  it("classifies proyinstelec.mx as planta", () => {
    expect(classifyEmail("carlos@proyinstelec.mx")).toBe("planta");
  });

  it("is case-insensitive", () => {
    expect(classifyEmail("Carlos@PROYINSTELEC.MX")).toBe("planta");
  });

  it("classifies gmail as temporal", () => {
    expect(classifyEmail("worker@gmail.com")).toBe("temporal");
  });

  it("classifies other corporate domains as temporal", () => {
    expect(classifyEmail("user@clienteempresa.com")).toBe("temporal");
  });

  it("does not confuse a subdomain of proyinstelec.mx", () => {
    // e.g. mail.proyinstelec.mx is NOT a valid employee email
    expect(classifyEmail("user@mail.proyinstelec.mx")).toBe("temporal");
  });
});

describe("buildInitialProfile", () => {
  const baseParams = {
    googleSub: "1234567890",
    email: "carlos@proyinstelec.mx",
    nombre: "Carlos Reyes",
    fotoUrl: "https://lh3.googleusercontent.com/photo.jpg",
  };

  it("builds a planta profile with odoo_sync true and perfil_completo true", () => {
    const profile = buildInitialProfile({ ...baseParams, tipo: "planta" });
    expect(profile.tipo).toBe("planta");
    expect(profile.rol).toBe("campo");
    expect(profile.odoo_sync).toBe(true);
    expect(profile.perfil_completo).toBe(true);
  });

  it("builds a temporal profile with odoo_sync false and perfil_completo false", () => {
    const profile = buildInitialProfile({
      ...baseParams,
      email: "worker@gmail.com",
      tipo: "temporal",
    });
    expect(profile.tipo).toBe("temporal");
    expect(profile.odoo_sync).toBe(false);
    expect(profile.perfil_completo).toBe(false);
  });

  it("sets rol to campo by default", () => {
    const profile = buildInitialProfile({ ...baseParams, tipo: "planta" });
    expect(profile.rol).toBe("campo");
  });

  it("initialises proyectos_asignados as empty array", () => {
    const profile = buildInitialProfile({ ...baseParams, tipo: "temporal" });
    expect(profile.proyectos_asignados).toEqual([]);
  });

  it("sets created_at and updated_at as ISO strings", () => {
    const profile = buildInitialProfile({ ...baseParams, tipo: "planta" });
    expect(profile.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(profile.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("omits foto_url when not provided", () => {
    const { fotoUrl: _, ...params } = baseParams;
    const profile = buildInitialProfile({ ...params, tipo: "planta" });
    expect(profile.foto_url).toBeUndefined();
  });
});

// ── DynamoDB-dependent tests ──────────────────────────────────────────────────

vi.mock("@/src/lib/dynamo-client", () => ({
  getDocClient: vi.fn(),
}));

import { getDocClient } from "@/src/lib/dynamo-client";
import { getUserByGoogleSub, getUserByEmail, deleteUser, upsertUser, markProfileComplete } from "@/src/lib/users";

function makeMockClient(sendResult: unknown) {
  return { send: vi.fn().mockResolvedValue(sendResult) };
}

describe("getUserByGoogleSub", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the user when found", async () => {
    const mockUser = { google_sub: "abc", email: "a@proyinstelec.mx" };
    vi.mocked(getDocClient).mockReturnValue(makeMockClient({ Item: mockUser }) as any);

    const result = await getUserByGoogleSub("abc");
    expect(result).toEqual(mockUser);
  });

  it("returns null when the item does not exist", async () => {
    vi.mocked(getDocClient).mockReturnValue(makeMockClient({ Item: undefined }) as any);
    const result = await getUserByGoogleSub("nonexistent");
    expect(result).toBeNull();
  });
});

describe("upsertUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls PutCommand with the correct table and item", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    const profile = buildInitialProfile({
      googleSub: "xyz",
      email: "r@proyinstelec.mx",
      nombre: "Raul",
      tipo: "planta",
    });
    await upsertUser(profile);

    expect(mockSend).toHaveBeenCalledOnce();
    const command = mockSend.mock.calls[0][0];
    expect(command.input.TableName).toBe("proyinstelec-users");
    expect(command.input.Item.google_sub).toBe("xyz");
  });
});

describe("getUserByEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user when found via email-index", async () => {
    const mockUser = { google_sub: "abc", email: "admin@example.com", tipo: "admin" };
    vi.mocked(getDocClient).mockReturnValue(
      makeMockClient({ Items: [mockUser] }) as any,
    );
    const result = await getUserByEmail("admin@example.com");
    expect(result).toEqual(mockUser);
  });

  it("returns null when no item matches", async () => {
    vi.mocked(getDocClient).mockReturnValue(
      makeMockClient({ Items: [] }) as any,
    );
    const result = await getUserByEmail("nobody@example.com");
    expect(result).toBeNull();
  });
});

describe("deleteUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls DeleteCommand with the correct key", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await deleteUser("sub-to-delete");

    const command = mockSend.mock.calls[0][0];
    expect(command.input.TableName).toBe("proyinstelec-users");
    expect(command.input.Key).toEqual({ google_sub: "sub-to-delete" });
  });
});

describe("markProfileComplete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends an UpdateCommand with perfil_completo true", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.mocked(getDocClient).mockReturnValue({ send: mockSend } as any);

    await markProfileComplete("abc123", {
      nombre: "Ana López",
      telefono: "5512345678",
      id_oficial: "INE123",
      contacto_emergencia: { nombre: "Miguel", telefono: "5598765432" },
      terminos_aceptados_at: "2026-05-14T10:00:00.000Z",
    });

    const command = mockSend.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[":t"]).toBe(true);
    expect(command.input.ExpressionAttributeValues[":n"]).toBe("Ana López");
  });
});
