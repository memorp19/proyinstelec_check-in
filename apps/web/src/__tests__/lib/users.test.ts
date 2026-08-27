import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { classifyEmail, getUserById, getUserByEmail } from "@/src/lib/users";

/** Encadenado falso de Drizzle: el `await` final entrega el siguiente resultado. */
function fakeDb(resultados: unknown[][]) {
  const cola = [...resultados];
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          const filas = cola.shift() ?? [];
          return (resolve: (v: unknown) => void) => resolve(filas);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

function filaUsuario(over: Record<string, unknown> = {}) {
  return {
    id: "user-001",
    name: "Carlos Reyes",
    email: "carlos@proyinstelec.mx",
    emailVerified: null,
    image: null,
    tipo: "planta",
    rol: "campo",
    permisos: ["cotizaciones.ver"],
    iniciales: "CRZ",
    gerencia: "Operación",
    activo: true,
    perfilCompleto: true,
    odooSync: true,
    nickname: null,
    fotoUrl: "https://drive/foto",
    telefono: null,
    idOficial: null,
    contactoEmergencia: null,
    terminosAceptadosAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

// ── Regla de negocio: clasificación por dominio ───────────────────────────────

describe("classifyEmail", () => {
  it("clasifica proyinstelec.mx como planta", () => {
    expect(classifyEmail("carlos@proyinstelec.mx")).toBe("planta");
  });

  it("no distingue mayúsculas", () => {
    expect(classifyEmail("Carlos@PROYINSTELEC.MX")).toBe("planta");
  });

  it("clasifica gmail como temporal", () => {
    expect(classifyEmail("worker@gmail.com")).toBe("temporal");
  });

  it("clasifica otros dominios corporativos como temporal", () => {
    expect(classifyEmail("user@clienteempresa.com")).toBe("temporal");
  });

  it("no confunde un subdominio de proyinstelec.mx", () => {
    expect(classifyEmail("user@mail.proyinstelec.mx")).toBe("temporal");
  });
});

// ── Mapeo fila → UserProfile ──────────────────────────────────────────────────

describe("getUserById", () => {
  it("expone el perfil en snake_case con los proyectos de la tabla puente", async () => {
    vi.mocked(getDb).mockReturnValue(
      fakeDb([
        [filaUsuario()],
        [
          { usuarioId: "user-001", proyectoId: "p1" },
          { usuarioId: "user-001", proyectoId: "p2" },
        ],
      ]),
    );

    const perfil = await getUserById("user-001");

    expect(perfil).toMatchObject({
      id: "user-001",
      email: "carlos@proyinstelec.mx",
      nombre: "Carlos Reyes",
      tipo: "planta",
      rol: "campo",
      perfil_completo: true,
      odoo_sync: true,
      activo: true,
      iniciales: "CRZ",
      foto_url: "https://drive/foto",
    });
    expect(perfil?.proyectos_asignados).toEqual(["p1", "p2"]);
  });

  it("usa la parte local del correo cuando no hay nombre", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[filaUsuario({ name: null })], []]));
    const perfil = await getUserById("user-001");
    expect(perfil?.nombre).toBe("carlos");
    expect(perfil?.proyectos_asignados).toEqual([]);
  });

  it("devuelve null cuando el usuario no existe", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[]]));
    expect(await getUserById("fantasma")).toBeNull();
  });
});

describe("getUserByEmail", () => {
  it("devuelve null cuando nadie coincide", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[]]));
    expect(await getUserByEmail("nadie@example.com")).toBeNull();
  });
});
