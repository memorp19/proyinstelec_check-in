import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/bitacora", () => ({ registrarBitacora: vi.fn() }));
// Solo se doblan las funciones que tocan la base: `puedeEliminarse` es la real,
// para que la regla que prueba la ruta sea la de producción y no una copia.
vi.mock("@/src/lib/cotizaciones", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/cotizaciones")>()),
  getVersion: vi.fn(),
  eliminarVersion: vi.fn(),
}));

import { auth } from "@/src/auth";
/** `auth()` está sobrecargada en Auth.js v5; el cast deja usarla como mock simple. */
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

import { eliminarVersion, getVersion } from "@/src/lib/cotizaciones";
import { registrarBitacora } from "@/src/lib/bitacora";
import { POST } from "@/app/api/erp/cotizaciones/[key]/eliminar/route";

const KEY = "260-2026";
const params = { key: KEY };
const FOLIO = "PCOTOP-260-2026";

const DUEÑA = { user: { email: "ana@proyinstelec.mx", rol: "campo", permisos: ["modulo.cotizaciones"] } };
const OTRO = {
  user: { email: "otro@proyinstelec.mx", rol: "campo", permisos: ["modulo.cotizaciones"], iniciales: "OTRO" },
};
const GERENTE = {
  user: {
    email: "gerente@proyinstelec.mx",
    rol: "campo",
    permisos: ["modulo.cotizaciones", "cotizaciones.armar.todas"],
  },
};

const cotizacion = {
  numero: 260, anio: 2026, version: 0, folio: FOLIO,
  cliente: "Cliente SA", titulo: "Pruebas", dirigida_a: "Ing. Pérez",
  prioridad: "MEDIA", estatus: "PROCESO", elaboro: "EAOL",
  fecha_solicitud: "2026-10-01", created_by: "ana@proyinstelec.mx",
  drive_folder_url: "https://drive.google.com/carpeta",
};

const pedir = (cuerpo: unknown) =>
  new NextRequest(`http://localhost/api/erp/cotizaciones/${KEY}/eliminar`, {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(DUEÑA);
  vi.mocked(getVersion).mockResolvedValue(cotizacion as never);
  vi.mocked(eliminarVersion).mockResolvedValue({ eliminada: true } as never);
});

describe("POST eliminar", () => {
  it("la borra y deja constancia con el enlace de su carpeta", async () => {
    const r = await POST(pedir({ version: 0, confirmacion: FOLIO }), { params });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ eliminada: true, folio: FOLIO });

    const [evento] = vi.mocked(registrarBitacora).mock.calls[0];
    expect(evento.accion).toBe("COTIZACION_ELIMINADA");
    expect(evento.usuario).toBe("ana@proyinstelec.mx");
    expect(evento.detalle).toContain(FOLIO);
    // Drive no se toca desde aquí: el enlace es lo único que va a quedar.
    expect(evento.detalle).toContain("https://drive.google.com/carpeta");
  });

  /**
   * Teclear el folio es la confirmación. Un "¿estás seguro?" se contesta que sí
   * sin leerlo; copiar el folio obliga a mirar cuál se está borrando, que es el
   * error que de verdad ocurre.
   */
  it("sin el folio exacto no borra, y dice cuál hay que escribir", async () => {
    const r = await POST(pedir({ version: 0, confirmacion: "sí" }), { params });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain(FOLIO);
    expect(eliminarVersion).not.toHaveBeenCalled();
  });

  it("el folio confirma sin importar mayúsculas ni espacios", async () => {
    const r = await POST(pedir({ version: 0, confirmacion: "  pcotop-260-2026  " }), { params });
    expect(r.status).toBe(200);
  });

  it("quien no la dio de alta no puede", async () => {
    mockAuth.mockResolvedValue(OTRO);
    const r = await POST(pedir({ version: 0, confirmacion: FOLIO }), { params });
    expect(r.status).toBe(403);
    expect(eliminarVersion).not.toHaveBeenCalled();
  });

  it("el gerente de operaciones sí", async () => {
    mockAuth.mockResolvedValue(GERENTE);
    expect((await POST(pedir({ version: 0, confirmacion: FOLIO }), { params })).status).toBe(200);
  });

  it("lo que ya salió no se borra, aunque sea tuya", async () => {
    for (const [campo, valor] of [
      ["estatus", "ENVIADA"],
      ["fecha_envio", "2026-10-02"],
      ["folio_ot", "OT260260"],
      ["orden_compra", "4501122596"],
    ] as const) {
      vi.mocked(getVersion).mockResolvedValue({ ...cotizacion, [campo]: valor } as never);
      const r = await POST(pedir({ version: 0, confirmacion: FOLIO }), { params });
      expect([campo, r.status]).toEqual([campo, 422]);
    }
    expect(eliminarVersion).not.toHaveBeenCalled();
  });

  // Entre mirar y borrar cabe que alguien la mande a revisión: el DELETE lleva
  // la condición dentro y devuelve que no borró nada.
  it("si cambió de estatus mientras tanto, 409", async () => {
    vi.mocked(eliminarVersion).mockResolvedValue({ eliminada: false } as never);
    const r = await POST(pedir({ version: 0, confirmacion: FOLIO }), { params });
    expect(r.status).toBe(409);
    expect(registrarBitacora).not.toHaveBeenCalled();
  });

  it("una que no existe, 404", async () => {
    vi.mocked(getVersion).mockResolvedValue(null as never);
    expect((await POST(pedir({ version: 0, confirmacion: FOLIO }), { params })).status).toBe(404);
  });

  it("sin sesión, 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST(pedir({ version: 0, confirmacion: FOLIO }), { params })).status).toBe(401);
  });

  it("una llave que no es llave, 400", async () => {
    const r = await POST(pedir({ version: 0, confirmacion: FOLIO }), { params: { key: "no-es" } });
    expect(r.status).toBe(400);
  });
});
