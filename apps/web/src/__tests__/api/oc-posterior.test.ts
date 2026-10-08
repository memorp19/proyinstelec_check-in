import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/bitacora", () => ({ registrarBitacora: vi.fn() }));

// Se doblan solo las funciones que tocan la base; el resto del módulo es el
// real, para que `parseCotKey` y los catálogos sean los de producción.
vi.mock("@/src/lib/cotizaciones-flujos", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/cotizaciones-flujos")>()),
  registrarOcPosterior: vi.fn(),
}));
vi.mock("@/src/lib/cotizaciones", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/cotizaciones")>()),
  cambiarEstatus: vi.fn(),
  updateCotizacion: vi.fn(),
}));

import { auth } from "@/src/auth";
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

import { registrarOcPosterior } from "@/src/lib/cotizaciones-flujos";
import { updateCotizacion } from "@/src/lib/cotizaciones";
import { POST } from "@/app/api/erp/cotizaciones/[key]/oc-posterior/route";
import { PATCH } from "@/app/api/erp/cotizaciones/[key]/route";

const KEY = "224-2026";
const params = { key: KEY };

const CON_PERMISO = {
  user: { email: "ventas@proyinstelec.mx", rol: "campo", permisos: ["ot.crear", "modulo.cotizaciones"] },
};
/** Puede ver cotizaciones pero no tocar órdenes de trabajo. */
const SOLO_LECTURA = {
  user: { email: "mirona@proyinstelec.mx", rol: "campo", permisos: ["modulo.cotizaciones"] },
};

const pedir = (body: unknown, ruta = "oc-posterior", metodo = "POST") =>
  new NextRequest(`http://localhost/api/erp/cotizaciones/${KEY}/${ruta}`, {
    method: metodo,
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(CON_PERMISO);
  vi.mocked(registrarOcPosterior).mockResolvedValue({
    version: 1,
    folioOt: "OT224261",
    ordenCompra: "4501122596",
  } as never);
});

describe("POST /oc-posterior", () => {
  it("registra la OC y devuelve la versión y la OT donde quedó", async () => {
    const res = await POST(pedir({ ordenCompra: "4501122596" }), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 1,
      folioOt: "OT224261",
      ordenCompra: "4501122596",
    });
    expect(registrarOcPosterior).toHaveBeenCalledWith({
      numero: 224,
      anio: 2026,
      ordenCompra: "4501122596",
      usuario: "ventas@proyinstelec.mx",
    });
  });

  // Es alta de orden de trabajo, no edición de cotización: el permiso es el
  // mismo que genera la OT.
  it("exige ot.crear", async () => {
    mockAuth.mockResolvedValue(SOLO_LECTURA);

    const res = await POST(pedir({ ordenCompra: "4501122596" }), { params });

    expect(res.status).toBe(403);
    expect(registrarOcPosterior).not.toHaveBeenCalled();
  });

  it("400 con OC vacía, de solo espacios, ausente o de otro tipo", async () => {
    for (const body of [{ ordenCompra: "" }, { ordenCompra: "   " }, {}, { ordenCompra: 9140 }]) {
      const res = await POST(pedir(body), { params });
      expect(res.status).toBe(400);
    }
    expect(registrarOcPosterior).not.toHaveBeenCalled();
  });

  it("400 con una llave de cotización inválida", async () => {
    const res = await POST(pedir({ ordenCompra: "9140" }), { params: { key: "no-es-una-llave" } });
    expect(res.status).toBe(400);
  });

  // No se pisa en silencio una OC ya registrada.
  it("409 si esa versión ya tiene orden de compra", async () => {
    vi.mocked(registrarOcPosterior).mockRejectedValue(
      new Error("La v1 ya tiene la orden de compra 82043"),
    );

    const res = await POST(pedir({ ordenCompra: "9140" }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("82043");
  });

  it("422 si no hay una versión ASIGNADA con OT", async () => {
    vi.mocked(registrarOcPosterior).mockRejectedValue(
      new Error("La cotización COT#044-2026 no tiene una versión ASIGNADA con orden de trabajo"),
    );

    const res = await POST(pedir({ ordenCompra: "9140" }), { params });
    expect(res.status).toBe(422);
  });

  it("un fallo inesperado sale como 500, no como 422", async () => {
    vi.mocked(registrarOcPosterior).mockRejectedValue(new Error("connection terminated"));

    const res = await POST(pedir({ ordenCompra: "9140" }), { params });
    expect(res.status).toBe(500);
  });
});

// El PATCH tipaba su body pero no lo validaba: `req.json()` devuelve cualquier
// cosa y el resto se le pasaba entero a `updateCotizacion`. Se podía escribir
// `orden_compra` con un permiso más laxo y sobre la versión equivocada.
describe("PATCH /cotizaciones/[key] — lista blanca de campos", () => {
  it("deja pasar los campos del formulario", async () => {
    const res = await PATCH(pedir({ titulo: "NUEVO TÍTULO" }, "", "PATCH"), { params });

    expect(res.status).toBe(200);
    expect(updateCotizacion).toHaveBeenCalledWith(224, 2026, { titulo: "NUEVO TÍTULO" });
  });

  it("rechaza ordenCompra con 400 y nombra el campo", async () => {
    const res = await PATCH(pedir({ ordenCompra: "9140" }, "", "PATCH"), { params });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ordenCompra");
    expect(updateCotizacion).not.toHaveBeenCalled();
  });

  it("rechaza los demás campos que tienen su propio flujo", async () => {
    for (const campo of ["folioOt", "version", "numero", "folio", "clienteId", "createdBy"]) {
      const res = await PATCH(pedir({ [campo]: "x" }, "", "PATCH"), { params });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain(campo);
    }
    expect(updateCotizacion).not.toHaveBeenCalled();
  });

  // Un campo bueno no legitima a los demás: basta uno malo para rechazar todo.
  it("un campo prohibido mezclado con uno válido rechaza la petición entera", async () => {
    const res = await PATCH(pedir({ titulo: "OK", ordenCompra: "9140" }, "", "PATCH"), { params });

    expect(res.status).toBe(400);
    expect(updateCotizacion).not.toHaveBeenCalled();
  });
});
