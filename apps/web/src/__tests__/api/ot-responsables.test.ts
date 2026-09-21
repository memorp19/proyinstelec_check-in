import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/users", () => ({ getUserByEmail: vi.fn() }));

// Se doblan solo las funciones que tocan la base; el resto del módulo es el
// real, para que `esEstatusOT` y `ESTATUS_OT` sean los de producción y no una
// copia que el test se inventa.
vi.mock("@/src/lib/ot", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/ot")>()),
  getOT: vi.fn(),
  listResponsables: vi.fn(),
  agregarResponsable: vi.fn(),
  desactivarResponsable: vi.fn(),
  cambiarEstatusOT: vi.fn(),
}));

import { auth } from "@/src/auth";
/** `auth()` está sobrecargada en Auth.js v5; el cast deja usarla como mock simple. */
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

import { getUserByEmail } from "@/src/lib/users";
import {
  getOT,
  listResponsables,
  agregarResponsable,
  desactivarResponsable,
  cambiarEstatusOT,
} from "@/src/lib/ot";
import { POST } from "@/app/api/erp/ot/[folio]/responsables/route";
import { DELETE } from "@/app/api/erp/ot/[folio]/responsables/[id]/route";
import { PATCH } from "@/app/api/erp/ot/[folio]/route";

const FOLIO = "OT001260";
const params = { folio: FOLIO };

/** Usuario con el permiso operativo, que es el que abren estas rutas. */
const CON_PERMISO = { user: { email: "jefe@proyinstelec.mx", rol: "campo", permisos: ["ot.reasignar"] } };
/** Tiene el alta comercial pero NO la reasignación: son ejes distintos. */
const SOLO_CREAR = { user: { email: "ventas@proyinstelec.mx", rol: "campo", permisos: ["ot.crear"] } };

const ot = { folio: FOLIO, estatus: "" };
const usuario = { email: "juan@proyinstelec.mx", nombre: "Juan Pérez", iniciales: "JUPE" };

const pedir = (body: unknown, metodo = "POST") =>
  new NextRequest(`http://localhost/api/erp/ot/${FOLIO}/responsables`, {
    method: metodo,
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(CON_PERMISO);
  vi.mocked(getOT).mockResolvedValue(ot as never);
  vi.mocked(getUserByEmail).mockResolvedValue(usuario as never);
  vi.mocked(listResponsables).mockResolvedValue([] as never);
});

describe("POST responsables — autorización", () => {
  it("sin sesión responde 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(pedir({ correo: usuario.email }), { params });
    expect(res.status).toBe(401);
  });

  it("ot.crear NO alcanza: reasignar es un permiso aparte", async () => {
    mockAuth.mockResolvedValue(SOLO_CREAR);

    const res = await POST(pedir({ correo: usuario.email }), { params });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("ot.reasignar");
    expect(agregarResponsable).not.toHaveBeenCalled();
  });
});

describe("POST responsables", () => {
  it("agrega y devuelve la lista actualizada", async () => {
    vi.mocked(agregarResponsable).mockResolvedValue({ id: "r2", slot: 2 } as never);
    vi.mocked(listResponsables).mockResolvedValue([{ id: "r1" }, { id: "r2" }] as never);

    const res = await POST(pedir({ correo: "Juan@Proyinstelec.MX" }), { params });

    expect(res.status).toBe(201);
    expect(vi.mocked(agregarResponsable).mock.calls[0][0]).toMatchObject({
      folioOt: FOLIO,
      correo: "juan@proyinstelec.mx", // normalizado antes de llamar a la lib
      asignadoPor: "jefe@proyinstelec.mx",
    });
    expect((await res.json()).responsables).toHaveLength(2);
  });

  it("rechaza un folio que no es de OT", async () => {
    const res = await POST(pedir({ correo: usuario.email }), { params: { folio: "PCOTOP-1" } });
    expect(res.status).toBe(400);
    expect(agregarResponsable).not.toHaveBeenCalled();
  });

  it("exige el correo", async () => {
    const res = await POST(pedir({}), { params });
    expect(res.status).toBe(400);
  });

  it("404 si la OT no existe", async () => {
    vi.mocked(getOT).mockResolvedValue(null);
    const res = await POST(pedir({ correo: usuario.email }), { params });
    expect(res.status).toBe(404);
  });

  it("422 si la persona no está en el catálogo", async () => {
    vi.mocked(getUserByEmail).mockResolvedValue(null);
    const res = await POST(pedir({ correo: "fuera@x.mx" }), { params });
    expect(res.status).toBe(422);
    expect(agregarResponsable).not.toHaveBeenCalled();
  });

  // Misma regla que el alta de OT: las iniciales son la llave del ERP.
  it("422 si el responsable no tiene iniciales capturadas", async () => {
    vi.mocked(getUserByEmail).mockResolvedValue({ ...usuario, iniciales: null } as never);

    const res = await POST(pedir({ correo: usuario.email }), { params });

    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("iniciales");
    expect(agregarResponsable).not.toHaveBeenCalled();
  });

  it("409 cuando ya hay tres responsables", async () => {
    vi.mocked(agregarResponsable).mockRejectedValue(
      new Error("La OT OT001260 ya tiene 3 responsables activos. Quita a uno antes de agregar otro."),
    );

    const res = await POST(pedir({ correo: usuario.email }), { params });

    expect(res.status).toBe(409);
  });

  it("409 cuando la persona ya es responsable activo", async () => {
    vi.mocked(agregarResponsable).mockRejectedValue(
      new Error("juan@proyinstelec.mx ya es responsable activo de la OT OT001260"),
    );

    const res = await POST(pedir({ correo: usuario.email }), { params });

    expect(res.status).toBe(409);
  });
});

describe("DELETE responsables", () => {
  const paramsDel = { folio: FOLIO, id: "r1" };

  it("exige ot.reasignar", async () => {
    mockAuth.mockResolvedValue(SOLO_CREAR);
    const res = await DELETE(new Request("http://localhost"), { params: paramsDel });
    expect(res.status).toBe(403);
    expect(desactivarResponsable).not.toHaveBeenCalled();
  });

  it("da de baja y devuelve la lista", async () => {
    vi.mocked(listResponsables)
      .mockResolvedValueOnce([{ id: "r1" }] as never)
      .mockResolvedValueOnce([{ id: "r1", activo: false }] as never);

    const res = await DELETE(new Request("http://localhost"), { params: paramsDel });

    expect(res.status).toBe(200);
    expect(desactivarResponsable).toHaveBeenCalledWith("r1");
  });

  // Sin esta comprobación, la URL de una OT serviría para dar de baja a un
  // responsable de otra: el id es único y la ruta no lo notaría.
  it("404 si ese responsable no es de esta OT", async () => {
    vi.mocked(listResponsables).mockResolvedValue([{ id: "otro" }] as never);

    const res = await DELETE(new Request("http://localhost"), { params: paramsDel });

    expect(res.status).toBe(404);
    expect(desactivarResponsable).not.toHaveBeenCalled();
  });
});

describe("PATCH estatus de la OT", () => {
  const pedirPatch = (body: unknown) =>
    new NextRequest(`http://localhost/api/erp/ot/${FOLIO}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

  it("exige ot.reasignar", async () => {
    mockAuth.mockResolvedValue(SOLO_CREAR);
    const res = await PATCH(pedirPatch({ estatus: "Asignado" }), { params });
    expect(res.status).toBe(403);
    expect(cambiarEstatusOT).not.toHaveBeenCalled();
  });

  it("avanza al siguiente estatus", async () => {
    vi.mocked(cambiarEstatusOT).mockResolvedValue({ ...ot, estatus: "Asignado" } as never);

    const res = await PATCH(pedirPatch({ estatus: "Asignado" }), { params });

    expect(res.status).toBe(200);
    expect(cambiarEstatusOT).toHaveBeenCalledWith(FOLIO, "Asignado");
    expect((await res.json()).ot.estatus).toBe("Asignado");
  });

  // Los siete valores del legacy ya no existen; se rechazan en la frontera.
  it("400 con un estatus fuera del catálogo", async () => {
    const res = await PATCH(pedirPatch({ estatus: "TERMINADO" }), { params });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Asignado");
    expect(cambiarEstatusOT).not.toHaveBeenCalled();
  });

  it("409 si la transición no es válida", async () => {
    vi.mocked(cambiarEstatusOT).mockRejectedValue(
      new Error("Transición no permitida: (vacío) → Cerrado"),
    );

    const res = await PATCH(pedirPatch({ estatus: "Cerrado" }), { params });

    expect(res.status).toBe(409);
  });

  it("404 si la OT no existe", async () => {
    vi.mocked(cambiarEstatusOT).mockRejectedValue(new Error("La OT OT999260 no existe"));

    const res = await PATCH(pedirPatch({ estatus: "Asignado" }), { params });

    expect(res.status).toBe(404);
  });
});
