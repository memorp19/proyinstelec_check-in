import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock de bitácora (no queremos tocar la base aquí)
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
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registrarBitacora } from "@/src/lib/bitacora";
import {
  enviarCorreo,
  carpetaDeVolcado,
  construirMime,
  escaparHtml,
  plantillaCorreo,
  textoAHtml,
  _resetCorreoConfigCache,
} from "@/src/lib/correo";

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


// ── El escape del texto de una persona ────────────────────────────────────────

/** El «Mensaje» al cliente: se escribe en un textarea y llega como se escribió. */
describe("textoAHtml", () => {
  it("escapa como escaparHtml", () => {
    expect(textoAHtml('<b>urge</b> & "ya"')).toBe("&lt;b&gt;urge&lt;/b&gt; &amp; &quot;ya&quot;");
  });

  it("los saltos de línea, de cualquier sistema, son <br/>", () => {
    expect(textoAHtml("uno\ndos\r\ntres\rcuatro")).toBe("uno<br/>dos<br/>tres<br/>cuatro");
  });

  it("una línea en blanco queda como línea en blanco", () => {
    expect(textoAHtml("Estimado:\n\nSaludos")).toBe("Estimado:<br/><br/>Saludos");
  });

  it("sin espacios ni saltos sobrantes al principio y al final", () => {
    expect(textoAHtml("\n  hola  \n")).toBe("hola");
  });

  // El único marcado que agrega es el `<br/>`: no hay manera de que lo tecleado
  // lo produzca, porque su `<` ya salió escapado.
  it("un <br/> tecleado no es un salto de línea", () => {
    expect(textoAHtml("a<br/>b")).toBe("a&lt;br/&gt;b");
  });
});

describe("escaparHtml", () => {
  /** Un `<b>` tecleado por alguien tiene que verse, no aplicarse. */
  it("neutraliza las etiquetas", () => {
    expect(escaparHtml("Ojo con <b>esto</b>")).toBe("Ojo con &lt;b&gt;esto&lt;/b&gt;");
  });

  it("escapa el ampersand PRIMERO, para no escapar dos veces", () => {
    // Al revés, el "&" de "&lt;" que acaba de salir se volvería "&amp;lt;".
    expect(escaparHtml("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });

  it("escapa las comillas, que van dentro de atributos", () => {
    expect(escaparHtml(`dijo "hola" y 'adiós'`)).toBe("dijo &quot;hola&quot; y &#39;adiós&#39;");
  });

  it("el texto normal no se toca", () => {
    expect(escaparHtml("Revísame la partida 2, urge.")).toBe("Revísame la partida 2, urge.");
    expect(escaparHtml("Acentos y eñes: cotización, diseño.")).toBe(
      "Acentos y eñes: cotización, diseño.",
    );
  });

  it("lo que no es texto no lo rompe", () => {
    expect(escaparHtml(undefined as unknown as string)).toBe("");
    expect(escaparHtml(null as unknown as string)).toBe("");
  });
});

// ── El correo que no se manda, escrito en disco ───────────────────────────────

describe("volcado del correo en desarrollo", () => {
  let carpeta: string;
  const VERCEL = process.env.VERCEL;

  beforeEach(async () => {
    vi.clearAllMocks();
    carpeta = await mkdtemp(join(tmpdir(), "correos-prueba-"));
    process.env.CORREO_VOLCADO_DIR = carpeta;
    process.env.CORREO_DESHABILITADO = "true";
    delete process.env.VERCEL;
  });

  afterEach(async () => {
    delete process.env.CORREO_VOLCADO_DIR;
    delete process.env.CORREO_DESHABILITADO;
    if (VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = VERCEL;
    await rm(carpeta, { recursive: true, force: true });
  });

  const mandar = (html = "<p>Hola</p>", asunto = "Lista para Revisión · PCOTOP-001-2026") =>
    enviarCorreo({ para: ["revisor@proyinstelec.mx"], asunto, html });

  /**
   * Es el agujero que esto viene a tapar: con el correo deshabilitado solo
   * quedaba una línea en la consola con el destinatario y el asunto, así que
   * revisar el cuerpo obligaba a mandarse el correo a uno mismo.
   */
  it("escribe el cuerpo del correo que no se envió", async () => {
    const r = await mandar("<p>El <b>cuerpo</b></p>");
    expect(r).toEqual({ enviado: false, motivo: "deshabilitado" });

    const [archivo] = await readdir(carpeta);
    expect(archivo).toBeDefined();
    expect(await readFile(join(carpeta, archivo), "utf8")).toContain("<p>El <b>cuerpo</b></p>");
  });

  // Lo que se abre en el navegador tiene que verse como el correo de verdad:
  // los metadatos van en un comentario, no en un recuadro encima.
  it("los metadatos van en un comentario, no en el cuerpo", async () => {
    await mandar();
    const [archivo] = await readdir(carpeta);
    const contenido = await readFile(join(carpeta, archivo), "utf8");
    expect(contenido.startsWith("<!--")).toBe(true);
    expect(contenido).toContain("revisor@proyinstelec.mx");
    expect(contenido).toContain("NO se envió");
  });

  it("el nombre del archivo lleva la marca de tiempo y el asunto, sin acentos", async () => {
    await mandar();
    const [archivo] = await readdir(carpeta);
    expect(archivo).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+__Lista-para-Revision-PCOTOP-001-2026\.html$/);
  });

  /** Un correo por archivo: dos envíos no se pisan. */
  it("cada correo es un archivo", async () => {
    await mandar("<p>uno</p>", "Uno");
    await mandar("<p>dos</p>", "Dos");
    expect(await readdir(carpeta)).toHaveLength(2);
  });

  /**
   * La puerta es `esDesarrollo()`, y `VERCEL` la pone la plataforma en todos
   * sus entornos. Un despliegue no escribe correos en disco ni aunque alguien
   * dejara `CORREO_DESHABILITADO` puesto por error.
   */
  it("en un despliegue no escribe nada", async () => {
    process.env.VERCEL = "1";
    const r = await mandar();
    expect(r.enviado).toBe(false);
    expect(await readdir(carpeta)).toEqual([]);
  });

  /**
   * Una comodidad de desarrollo no puede cambiar lo que pasa con el correo.
   *
   * Para que falle de verdad, la carpeta cuelga de un **archivo**: `mkdir`
   * recursivo crea cualquier ruta que no exista, así que un nombre inventado
   * no probaría nada.
   */
  it("si la carpeta no se puede escribir, el no-envío sigue su curso", async () => {
    const estorbo = join(carpeta, "esto-es-un-archivo");
    await writeFile(estorbo, "no soy una carpeta", "utf8");
    process.env.CORREO_VOLCADO_DIR = join(estorbo, "dentro");

    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await enviarCorreo({ para: ["a@x.com"], asunto: "x", html: "<p>x</p>" });

    expect(r).toEqual({ enviado: false, motivo: "deshabilitado" });
    expect(errores).toHaveBeenCalledWith(
      "[correo] no se pudo escribir el volcado:",
      expect.any(String),
    );
    expect(registrarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "CORREO_OMITIDO" }),
    );
    errores.mockRestore();
  });

  it("sin CORREO_VOLCADO_DIR usa una carpeta fuera del repositorio", () => {
    delete process.env.CORREO_VOLCADO_DIR;
    expect(carpetaDeVolcado()).toBe(join(tmpdir(), "proyinstelec-correos"));
  });
});
