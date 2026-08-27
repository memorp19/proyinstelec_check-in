import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock de bitácora (no queremos DynamoDB aquí)
vi.mock("@/src/lib/bitacora", () => ({
  registrarBitacora: vi.fn().mockResolvedValue(undefined),
}));

// Mock de googleapis
const mockSendGmail = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn().mockImplementation((opts) => ({ opts })) },
    gmail: vi.fn().mockReturnValue({
      users: { messages: { send: (...args: unknown[]) => mockSendGmail(...args) } },
    }),
  },
}));

import { google } from "googleapis";
import { registrarBitacora } from "@/src/lib/bitacora";
import { enviarCorreo, construirMime, plantillaCorreo, _resetCorreoConfigCache } from "@/src/lib/correo";

const FAKE_KEY = JSON.stringify({
  client_email: "erp@proyecto.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
});

describe("construirMime", () => {
  it("arma un mensaje HTML simple con remitente ERP", () => {
    const mime = construirMime({
      de: "erp@proyinstelec.mx",
      para: ["cliente@empresa.com"],
      asunto: "Cotización PCOTOP-001",
      html: "<p>Hola</p>",
    });
    expect(mime).toContain("From: ERP PROYINSTELEC <erp@proyinstelec.mx>");
    expect(mime).toContain("To: cliente@empresa.com");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(mime).toContain(Buffer.from("<p>Hola</p>", "utf8").toString("base64"));
  });

  it("incluye CC y adjuntos como multipart", () => {
    const mime = construirMime({
      de: "erp@proyinstelec.mx",
      para: ["a@x.com"],
      cc: ["b@x.com", "c@x.com"],
      asunto: "Con adjunto",
      html: "<p>Va el PDF</p>",
      adjuntos: [{ filename: "cotizacion.pdf", mimeType: "application/pdf", contenido: Buffer.from("PDF") }],
    });
    expect(mime).toContain("Cc: b@x.com, c@x.com");
    expect(mime).toContain("multipart/mixed");
    expect(mime).toContain('filename="cotizacion.pdf"');
    expect(mime).toContain(Buffer.from("PDF").toString("base64"));
  });
});

describe("enviarCorreo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCorreoConfigCache();
    process.env.GMAIL_SERVICE_ACCOUNT_KEY = FAKE_KEY;
    process.env.CORREO_REMITENTE = "erp@proyinstelec.mx";
    delete process.env.CORREO_DESHABILITADO;
  });

  afterEach(() => {
    delete process.env.GMAIL_SERVICE_ACCOUNT_KEY;
    delete process.env.CORREO_REMITENTE;
    delete process.env.CORREO_DESHABILITADO;
  });

  it("envía por Gmail API con delegación (subject = remitente) y registra bitácora", async () => {
    mockSendGmail.mockResolvedValue({ data: { id: "msg-123" } });

    const res = await enviarCorreo({
      para: ["cliente@empresa.com"],
      asunto: "Prueba",
      html: "<p>hola</p>",
      registradoPor: "maria@proyinstelec.mx",
      referencia: "COT#001-2026",
    });

    expect(res).toEqual({ enviado: true, messageId: "msg-123" });
    // Delegación de dominio: el JWT lleva subject = cuenta remitente
    const jwtOpts = vi.mocked(google.auth.JWT).mock.calls[0][0] as any;
    expect(jwtOpts.subject).toBe("erp@proyinstelec.mx");
    expect(jwtOpts.scopes).toContain("https://www.googleapis.com/auth/gmail.send");

    expect(registrarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "CORREO_ENVIADO", usuario: "maria@proyinstelec.mx", referencia: "COT#001-2026" }),
    );
  });

  it("no envía sin destinatarios", async () => {
    const res = await enviarCorreo({ para: ["", ""], asunto: "x", html: "y" });
    expect(res).toEqual({ enviado: false, motivo: "sin_destinatarios" });
    expect(mockSendGmail).not.toHaveBeenCalled();
  });

  it("con CORREO_DESHABILITADO omite el envío y lo registra", async () => {
    process.env.CORREO_DESHABILITADO = "true";

    const res = await enviarCorreo({ para: ["a@x.com"], asunto: "x", html: "y" });
    expect(res.enviado).toBe(false);
    expect(res.motivo).toBe("deshabilitado");
    expect(mockSendGmail).not.toHaveBeenCalled();
    expect(registrarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "CORREO_OMITIDO" }),
    );
  });

  it("un error de Gmail no lanza: registra CORREO_ERROR", async () => {
    mockSendGmail.mockRejectedValue(new Error("quota exceeded"));

    const res = await enviarCorreo({ para: ["a@x.com"], asunto: "x", html: "y" });
    expect(res).toEqual({ enviado: false, motivo: "error" });
    expect(registrarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "CORREO_ERROR" }),
    );
  });
});

describe("plantillaCorreo", () => {
  it("envuelve el contenido con encabezado del ERP y enlace al sistema", () => {
    const html = plantillaCorreo({
      titulo: "Nueva actividad",
      cuerpoHtml: "<p>Detalle</p>",
      urlSistema: "https://app.proyinstelec.mx",
    });
    expect(html).toContain("PROYINSTELEC · ERP");
    expect(html).toContain("Nueva actividad");
    expect(html).toContain("<p>Detalle</p>");
    expect(html).toContain("https://app.proyinstelec.mx/erp");
  });
});
