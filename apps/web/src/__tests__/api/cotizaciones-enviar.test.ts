import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));

// Se doblan solo las funciones que tocan la base, Drive y el correo; las
// clases de error son las reales, porque la ruta decide el código con ellas.
vi.mock("@/src/lib/cotizaciones-flujos", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/cotizaciones-flujos")>()),
  enviarAlCliente: vi.fn(),
  datosParaEnvio: vi.fn(),
}));

import { auth } from "@/src/auth";
import {
  DestinatariosNoValidos,
  EnvioDesactualizado,
  EnvioNoPermitido,
  enviarAlCliente,
} from "@/src/lib/cotizaciones-flujos";
import { POST } from "@/app/api/erp/cotizaciones/[key]/enviar/route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const params = { key: "001-2026" };
const CON_PERMISO = {
  user: { email: "alguien@empresa.test", name: "Alguien", rol: "campo", permisos: ["cotizaciones.enviar"] },
};
const VISTO = { version: 0, estatus: "REVISION", fechaEnvio: null };

const pedir = (body: unknown) =>
  new NextRequest("http://localhost/api/erp/cotizaciones/001-2026/enviar", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(CON_PERMISO);
  vi.mocked(enviarAlCliente).mockResolvedValue({ cotizacion: { numero: 1 } } as never);
});

describe("POST /enviar — lo que acepta", () => {
  it("pasa el mensaje como texto y lo que vio la pantalla", async () => {
    const res = await POST(
      pedir({
        destinatarios: ["compras@cliente.test"],
        asunto: "Cotización",
        mensaje: "Estimado:\nva la propuesta",
        visto: VISTO,
      }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(enviarAlCliente).toHaveBeenCalledWith({
      numero: 1,
      anio: 2026,
      destinatarios: ["compras@cliente.test"],
      asunto: "Cotización",
      mensaje: "Estimado:\nva la propuesta",
      telefonoFirma: undefined,
      visto: VISTO,
      remitente: { email: "alguien@empresa.test", nombre: "Alguien" },
    });
  });

  // El campo de antes: marcado que armaba la pantalla. Una pantalla vieja en
  // caché que lo mande no puede colar HTML, ni perder su mensaje en silencio.
  it("rechaza mensajeHtml, y pide recargar", async () => {
    const res = await POST(
      pedir({ destinatarios: ["compras@cliente.test"], mensajeHtml: "<p>hola</p>", visto: VISTO }),
      { params },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Recarga la página");
    expect(enviarAlCliente).not.toHaveBeenCalled();
  });

  it("rechaza cualquier campo que no esté en la lista", async () => {
    const res = await POST(
      pedir({ destinatarios: ["compras@cliente.test"], visto: VISTO, cc: ["alguien@otra.test"] }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(enviarAlCliente).not.toHaveBeenCalled();
  });

  it.each([
    ["sin visto", undefined],
    ["con una versión que no es número", { ...VISTO, version: "0" }],
    ["con un estatus que no existe", { ...VISTO, estatus: "ENVIADISIMA" }],
    ["con una fecha que no es fecha", { ...VISTO, fechaEnvio: "ayer" }],
  ])("rechaza lo que vio la pantalla %s", async (_caso, visto) => {
    const res = await POST(pedir({ destinatarios: ["compras@cliente.test"], visto }), { params });

    expect(res.status).toBe(400);
    expect(enviarAlCliente).not.toHaveBeenCalled();
  });

  it("los destinatarios son una lista de textos", async () => {
    const res = await POST(pedir({ destinatarios: "compras@cliente.test", visto: VISTO }), { params });

    expect(res.status).toBe(400);
    expect(enviarAlCliente).not.toHaveBeenCalled();
  });

  it("el mensaje es texto, no un objeto", async () => {
    const res = await POST(
      pedir({ destinatarios: ["compras@cliente.test"], mensaje: { html: "<p>" }, visto: VISTO }),
      { params },
    );

    expect(res.status).toBe(400);
  });
});

describe("POST /enviar — qué contesta cuando no se envía", () => {
  const enviar = () => POST(pedir({ destinatarios: ["compras@cliente.test"], visto: VISTO }), { params });

  it("un destinatario que no cuadra: 422, con el mensaje que dice qué hacer", async () => {
    vi.mocked(enviarAlCliente).mockRejectedValueOnce(
      new DestinatariosNoValidos("No se envió nada: alguien@otra.test no es contacto…"),
    );

    const res = await enviar();

    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("No se envió nada");
  });

  it("el segundo clic: 409, «ya se envió»", async () => {
    vi.mocked(enviarAlCliente).mockRejectedValueOnce(
      new EnvioDesactualizado("Ya se envió: no se mandó otro correo."),
    );

    const res = await enviar();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Ya se envió");
  });

  it("todavía no se puede enviar (cualquier motivo, no solo la aprobación): 409", async () => {
    vi.mocked(enviarAlCliente).mockRejectedValueOnce(
      new EnvioNoPermitido("La cotización está en CANCELADA; debe pasar por revisión"),
    );

    expect((await enviar()).status).toBe(409);
  });

  it("sin permiso de enviar: 403, sin llegar al flujo", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { email: "alguien@empresa.test", rol: "campo", permisos: ["modulo.cotizaciones"] },
    });

    expect((await enviar()).status).toBe(403);
    expect(enviarAlCliente).not.toHaveBeenCalled();
  });
});
