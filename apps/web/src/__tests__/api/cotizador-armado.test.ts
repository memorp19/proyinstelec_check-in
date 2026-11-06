import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/cotizador-db", () => ({
  getArmado: vi.fn(),
  guardarArmado: vi.fn(),
  congelarVersion: vi.fn(),
  actualizarPrecios: vi.fn(),
  catalogoVigente: vi.fn(),
  ConflictoDeEdicion: class ConflictoDeEdicion extends Error {
    constructor() {
      super("Alguien más guardó esta cotización mientras la editabas.");
      this.name = "ConflictoDeEdicion";
    }
  },
}));
vi.mock("@/src/lib/cotizaciones-flujos", () => ({ enviarARevision: vi.fn() }));
vi.mock("@/src/lib/banxico", () => ({ tipoDeCambioFix: vi.fn() }));

import { auth } from "@/src/auth";
/** `auth()` está sobrecargada en Auth.js v5; el cast deja usarla como mock simple. */
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

import {
  ConflictoDeEdicion,
  actualizarPrecios,
  catalogoVigente,
  congelarVersion,
  getArmado,
  guardarArmado,
} from "@/src/lib/cotizador-db";
import { enviarARevision } from "@/src/lib/cotizaciones-flujos";
import { tipoDeCambioFix } from "@/src/lib/banxico";
import { GET, PUT } from "@/app/api/erp/cotizaciones/[key]/armado/route";
import { POST as POST_REVISION } from "@/app/api/erp/cotizaciones/[key]/armado/revision/route";
import { POST as POST_PRECIOS } from "@/app/api/erp/cotizaciones/[key]/armado/precios/route";
import { GET as GET_TC } from "@/app/api/erp/tipo-cambio/route";
import { GET as GET_CATALOGO } from "@/app/api/erp/catalogo-servicios/route";

const KEY = "450-2026";
const params = { key: KEY };

const DUEÑA = { user: { email: "ana@proyinstelec.mx", rol: "campo", permisos: ["modulo.cotizaciones"] } };
const OTRO = { user: { email: "otro@proyinstelec.mx", rol: "campo", permisos: ["modulo.cotizaciones"], iniciales: "OTRO" } };
const GERENTE = {
  user: {
    email: "gerente@proyinstelec.mx",
    rol: "campo",
    permisos: ["modulo.cotizaciones", "cotizaciones.armar.todas"],
  },
};
const SIN_MODULO = { user: { email: "campo@proyinstelec.mx", rol: "campo", permisos: [] } };

const cotizacion = {
  numero: 450, anio: 2026, version: 0, folio: "PCOTOP-450-2026",
  cliente: "Cliente SA", titulo: "Pruebas", estatus: "PROCESO",
  elaboro: "EAOL", created_by: "ana@proyinstelec.mx",
};

const armado = {
  numero: 450, anio: 2026, version: 0,
  moneda: "MXN", monedaGastos: "MXN", reparto: "IGUAL",
  asesoriaPct: 10, ivaPct: 16, tipoCambio: null,
  condiciones: {}, documento: {},
  partidas: [{ id: "P1", orden: 1, titulo: "Una", bloques: [], cantidad: 1, unidad: "servicio", ajuste: 0, precioUnitarioFinal: null, recibeGastosGenerales: true, gastoManual: null, formato: "NORMAL", notas: "", conceptos: [] }],
  gastos: [],
};

const completo = {
  cotizacion,
  armado,
  resultado: { total: 1000, moneda: "MXN", avisos: [] },
  desfases: [],
  avisos: [],
  congelado: null,
  actualizadoEn: "2026-10-13T10:00:00.000Z",
};

const pedir = (cuerpo: unknown, metodo = "PUT", url = `http://localhost/api/erp/cotizaciones/${KEY}/armado`) =>
  // Un GET no lleva cuerpo: la plataforma lo rechaza antes de que llegue a la ruta.
  new NextRequest(url, metodo === "GET" ? { method: metodo } : { method: metodo, body: JSON.stringify(cuerpo) });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(DUEÑA);
  vi.mocked(getArmado).mockResolvedValue(completo as never);
  vi.mocked(catalogoVigente).mockResolvedValue([] as never);
  vi.mocked(guardarArmado).mockResolvedValue({ actualizadoEn: "2026-10-13T10:05:00.000Z" } as never);
});

// ── Autorización ─────────────────────────────────────────────────────────────

describe("autorización", () => {
  it("sin sesión, 401", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await GET(pedir(null, "GET"), { params });
    expect(r.status).toBe(401);
  });

  it("sin el permiso del módulo, 403", async () => {
    mockAuth.mockResolvedValue(SIN_MODULO);
    expect((await GET(pedir(null, "GET"), { params })).status).toBe(403);
    expect((await PUT(pedir({ armado }), { params })).status).toBe(403);
    expect((await POST_REVISION(pedir({ version: 0 }, "POST"), { params })).status).toBe(403);
  });

  /**
   * Quien no la dio de alta puede CONSULTARLA pero no guardarla. La pantalla ya
   * lo esconde; esto es lo que de verdad protege, porque el PUT se puede llamar
   * sin pasar por la pantalla.
   */
  it("alguien ajeno puede ver y no guardar", async () => {
    mockAuth.mockResolvedValue(OTRO);

    const lectura = await GET(pedir(null, "GET"), { params });
    expect(lectura.status).toBe(200);
    expect((await lectura.json()).acceso).toMatchObject({ puedeVer: true, puedeEditar: false });

    const escritura = await PUT(pedir({ armado }), { params });
    expect(escritura.status).toBe(403);
    expect(guardarArmado).not.toHaveBeenCalled();
  });

  it("el gerente de operaciones entra a la de cualquiera", async () => {
    mockAuth.mockResolvedValue(GERENTE);
    expect((await PUT(pedir({ armado, actualizadoEn: completo.actualizadoEn }), { params })).status).toBe(200);
  });

  // El estatus manda sobre el dueño: la congeló, ya no la toca.
  it("en revisión no se guarda ni siendo quien la elaboró", async () => {
    vi.mocked(getArmado).mockResolvedValue({
      ...completo,
      cotizacion: { ...cotizacion, estatus: "REVISION" },
    } as never);
    const r = await PUT(pedir({ armado }), { params });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain("congelaron");
  });
});

// ── GET ──────────────────────────────────────────────────────────────────────

describe("GET armado", () => {
  it("devuelve el armado con su catálogo y su marca de tiempo", async () => {
    const r = await GET(pedir(null, "GET"), { params });
    const cuerpo = await r.json();
    expect(r.status).toBe(200);
    expect(cuerpo.armado.numero).toBe(450);
    expect(cuerpo.actualizadoEn).toBe(completo.actualizadoEn);
    expect(cuerpo.catalogo).toEqual([]);
  });

  it("sin ?version lee la v0", async () => {
    await GET(pedir(null, "GET"), { params });
    expect(getArmado).toHaveBeenCalledWith(450, 2026, 0);
  });

  it("con ?version lee esa", async () => {
    await GET(
      pedir(null, "GET", `http://localhost/api/erp/cotizaciones/${KEY}/armado?version=2`),
      { params },
    );
    expect(getArmado).toHaveBeenCalledWith(450, 2026, 2);
  });

  it("una llave que no es llave, 400", async () => {
    const r = await GET(pedir(null, "GET"), { params: { key: "no-es" } });
    expect(r.status).toBe(400);
  });

  it("una versión negativa, 400", async () => {
    const r = await GET(
      pedir(null, "GET", `http://localhost/api/erp/cotizaciones/${KEY}/armado?version=-1`),
      { params },
    );
    expect(r.status).toBe(400);
  });

  it("una cotización que no existe, 404", async () => {
    vi.mocked(getArmado).mockResolvedValue(null as never);
    expect((await GET(pedir(null, "GET"), { params })).status).toBe(404);
  });
});

// ── PUT ──────────────────────────────────────────────────────────────────────

describe("PUT armado", () => {
  it("guarda y devuelve la marca nueva", async () => {
    const r = await PUT(pedir({ armado, actualizadoEn: completo.actualizadoEn }), { params });
    expect(r.status).toBe(200);
    expect((await r.json()).actualizadoEn).toBe("2026-10-13T10:05:00.000Z");
    expect(guardarArmado).toHaveBeenCalledWith(
      expect.objectContaining({ actualizadoEn: completo.actualizadoEn, usuario: "ana@proyinstelec.mx" }),
    );
  });

  /**
   * El bloqueo optimista, visto desde fuera: si alguien más guardó, se contesta
   * 409 con una marca para que la pantalla avise y recargue. Nunca se pisa en
   * silencio.
   */
  it("si alguien más guardó mientras tanto, 409", async () => {
    vi.mocked(guardarArmado).mockRejectedValue(new ConflictoDeEdicion());
    const r = await PUT(pedir({ armado, actualizadoEn: "viejo" }), { params });
    expect(r.status).toBe(409);
    expect((await r.json()).conflicto).toBe(true);
  });

  // Un dato que no cabe en la columna no es un fallo del servidor.
  it("un monto con demasiados decimales, 422 y dice cuál", async () => {
    const { MontoFueraDeEscala } = await import("@/src/lib/cotizador");
    vi.mocked(guardarArmado).mockRejectedValue(new MontoFueraDeEscala("El costo de SP001", 1.1234567));
    const r = await PUT(pedir({ armado, actualizadoEn: completo.actualizadoEn }), { params });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("SP001");
  });

  it("sin armado en el cuerpo, 400", async () => {
    expect((await PUT(pedir({}), { params })).status).toBe(400);
    expect(guardarArmado).not.toHaveBeenCalled();
  });

  // Si no se comprobara, se escribiría en una cotización distinta de la pedida.
  it("un armado de otra cotización, 400", async () => {
    const r = await PUT(pedir({ armado: { ...armado, numero: 999 } }), { params });
    expect(r.status).toBe(400);
    expect(guardarArmado).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON, 400", async () => {
    const req = new NextRequest(`http://localhost/api/erp/cotizaciones/${KEY}/armado`, {
      method: "PUT",
      body: "{no es json",
    });
    expect((await PUT(req, { params })).status).toBe(400);
  });
});

// ── Mandar a revisión ────────────────────────────────────────────────────────

describe("POST revisión", () => {
  beforeEach(() => {
    vi.mocked(congelarVersion).mockResolvedValue({
      resultado: { total: 65841.6 },
      letra: "SESENTA Y CINCO MIL…",
      avisos: [],
    } as never);
    vi.mocked(enviarARevision).mockResolvedValue({
      cotizacion: { ...cotizacion, estatus: "REVISION" },
      avisos: [],
    } as never);
  });

  /**
   * Primero congelar y después cambiar el estatus. Al revés, el revisor podría
   * estar viendo una cotización que todavía se recalcula sola.
   */
  it("congela antes de mandar", async () => {
    const r = await POST_REVISION(pedir({ version: 0 }, "POST"), { params });
    expect(r.status).toBe(200);
    expect(vi.mocked(congelarVersion).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(enviarARevision).mock.invocationCallOrder[0],
    );
    expect((await r.json()).total).toBe(65841.6);
  });

  it("junta los avisos del congelado y los del envío", async () => {
    vi.mocked(congelarVersion).mockResolvedValue({
      resultado: { total: 1 }, letra: "UN PESO", avisos: ["un concepto cuesta 0"],
    } as never);
    vi.mocked(enviarARevision).mockResolvedValue({
      cotizacion, avisos: ["no se localizó el PDF"],
    } as never);
    const cuerpo = await (await POST_REVISION(pedir({ version: 0 }, "POST"), { params })).json();
    expect(cuerpo.avisos).toEqual(["un concepto cuesta 0", "no se localizó el PDF"]);
  });

  // El revisor recibiría un documento sin nada que revisar.
  it("una cotización sin partidas no se manda", async () => {
    vi.mocked(getArmado).mockResolvedValue({ ...completo, armado: { ...armado, partidas: [] } } as never);
    const r = await POST_REVISION(pedir({ version: 0 }, "POST"), { params });
    expect(r.status).toBe(422);
    expect(congelarVersion).not.toHaveBeenCalled();
  });

  /**
   * La versión que se congela y la que pasa a REVISION tienen que ser la
   * misma. La ruta congelaba la que le pedían y el flujo mandó la vigente
   * mientras `enviarARevision` no recibió versión: con dos en PROCESO,
   * congelaba la v0 y mandaba la v1.
   */
  it.each([0, 1])("congela y manda la MISMA versión (v%i)", async (version) => {
    vi.mocked(getArmado).mockResolvedValue({
      ...completo,
      cotizacion: { ...cotizacion, version, folio: `PCOTOP-450-2026${version > 0 ? `-${version}` : ""}` },
      armado: { ...armado, version },
    } as never);

    expect((await POST_REVISION(pedir({ version }, "POST"), { params })).status).toBe(200);

    expect(congelarVersion).toHaveBeenCalledWith(expect.objectContaining({ version }));
    expect(enviarARevision).toHaveBeenCalledWith(expect.objectContaining({ version }));
  });

  it("una transición que el flujo no permite, 422", async () => {
    vi.mocked(enviarARevision).mockRejectedValue(new Error("Transición no permitida: ENVIADA → REVISION"));
    expect((await POST_REVISION(pedir({ version: 0 }, "POST"), { params })).status).toBe(422);
  });
});

// ── Actualizar precios ───────────────────────────────────────────────────────

describe("POST precios", () => {
  beforeEach(() => {
    vi.mocked(actualizarPrecios).mockResolvedValue({ actualizados: 2 } as never);
  });

  it("actualiza solo los ids que se mandan", async () => {
    const r = await POST_PRECIOS(pedir({ version: 0, ids: ["c1", "c2"] }, "POST"), { params });
    expect(r.status).toBe(200);
    expect(actualizarPrecios).toHaveBeenCalledWith(
      expect.objectContaining({ numero: 450, anio: 2026, version: 0, ids: ["c1", "c2"] }),
    );
  });

  it("sin ids no hace nada, 400", async () => {
    expect((await POST_PRECIOS(pedir({ ids: [] }, "POST"), { params })).status).toBe(400);
    expect(actualizarPrecios).not.toHaveBeenCalled();
  });

  it("los ids que no son texto se descartan", async () => {
    await POST_PRECIOS(pedir({ ids: ["c1", 42, null] }, "POST"), { params });
    expect(actualizarPrecios).toHaveBeenCalledWith(expect.objectContaining({ ids: ["c1"] }));
  });

  it("quien no puede editar tampoco puede actualizar precios", async () => {
    mockAuth.mockResolvedValue(OTRO);
    expect((await POST_PRECIOS(pedir({ ids: ["c1"] }, "POST"), { params })).status).toBe(403);
    expect(actualizarPrecios).not.toHaveBeenCalled();
  });
});

// ── Tipo de cambio y catálogo ────────────────────────────────────────────────

describe("GET tipo de cambio", () => {
  /**
   * Contesta 200 aunque Banxico falle: que un servicio externo esté caído no
   * es un error de quien cotiza, y la pantalla ofrece capturarlo a mano con
   * cualquiera de las dos respuestas.
   */
  it("con valor y sin valor, siempre 200", async () => {
    vi.mocked(tipoDeCambioFix).mockResolvedValue({ ok: true, valor: 18.45, fecha: "2026-10-13" });
    const bueno = await GET_TC();
    expect(bueno.status).toBe(200);
    expect(await bueno.json()).toMatchObject({ ok: true, valor: 18.45 });

    vi.mocked(tipoDeCambioFix).mockResolvedValue({ ok: false, motivo: "Banxico no contesta" });
    const malo = await GET_TC();
    expect(malo.status).toBe(200);
    expect(await malo.json()).toMatchObject({ ok: false });
  });

  it("sin permiso del módulo, no se consulta", async () => {
    mockAuth.mockResolvedValue(SIN_MODULO);
    expect((await GET_TC()).status).toBe(403);
    expect(tipoDeCambioFix).not.toHaveBeenCalled();
  });
});

describe("GET catálogo de servicios", () => {
  it("solo manda los activos", async () => {
    vi.mocked(catalogoVigente).mockResolvedValue([
      { codigo: "SP001", activo: true },
      { codigo: "SP999", activo: false },
    ] as never);
    const r = await GET_CATALOGO(pedir(null, "GET", "http://localhost/api/erp/catalogo-servicios"));
    expect((await r.json()).servicios.map((s: { codigo: string }) => s.codigo)).toEqual(["SP001"]);
  });

  it("sin permiso del módulo, 403", async () => {
    mockAuth.mockResolvedValue(SIN_MODULO);
    const r = await GET_CATALOGO(pedir(null, "GET", "http://localhost/api/erp/catalogo-servicios"));
    expect(r.status).toBe(403);
  });
});
