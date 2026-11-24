import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";
import { registrarBitacora } from "./bitacora";
import { DEMO_MODE } from "../demo";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Adjunto {
  filename: string;
  mimeType: string;
  contenido: Buffer;
}

export interface EnvioCorreo {
  para: string[];
  cc?: string[];
  asunto: string;
  html: string;
  adjuntos?: Adjunto[];
  /** Quién dispara el envío; va a la bitácora. Default "sistema". */
  registradoPor?: string;
  /** Referencia de bitácora (p. ej. "COT#001-2026", "ACT-0007|-3"). */
  referencia?: string;
}

export interface ResultadoCorreo {
  enviado: boolean;
  motivo?: "demo" | "deshabilitado" | "sin_destinatarios" | "error";
  messageId?: string;
}

// ── Config (mismo patrón que drive.ts: env local o SSM) ───────────────────────

interface CorreoConfig {
  serviceAccountEmail: string;
  privateKey: string;
  /** Cuenta del dominio desde la que salen los correos (delegación de dominio). */
  remitente: string;
}

let _cachedConfig: CorreoConfig | null = null;

/**
 * Credenciales del envío de correo (Gmail API con delegación de dominio).
 * Reutiliza la llave del service account de Drive salvo que se defina una
 * propia en GMAIL_SERVICE_ACCOUNT_KEY.
 */
async function getCorreoConfig(): Promise<CorreoConfig> {
  if (_cachedConfig) return _cachedConfig;

  const keyEnv = process.env.GMAIL_SERVICE_ACCOUNT_KEY ?? process.env.DRIVE_SERVICE_ACCOUNT_KEY;
  const remitente = process.env.CORREO_REMITENTE;
  if (!keyEnv || !remitente) {
    throw new Error(
      "Faltan GMAIL_SERVICE_ACCOUNT_KEY (o DRIVE_SERVICE_ACCOUNT_KEY) y CORREO_REMITENTE",
    );
  }

  let parsed: { client_email: string; private_key: string };
  try {
    parsed = JSON.parse(keyEnv);
  } catch {
    throw new Error("La llave del service account para correo no es un JSON válido");
  }

  _cachedConfig = {
    serviceAccountEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    remitente,
  };
  return _cachedConfig;
}

export function _resetCorreoConfigCache() {
  _cachedConfig = null;
}

// ── MIME ──────────────────────────────────────────────────────────────────────

function codificarAsunto(asunto: string): string {
  // RFC 2047 encoded-word para acentos en el asunto
  return `=?UTF-8?B?${Buffer.from(asunto, "utf8").toString("base64")}?=`;
}

/** Construye el mensaje MIME (multipart si hay adjuntos). Exportado para tests. */
export function construirMime(params: {
  de: string;
  para: string[];
  cc?: string[];
  asunto: string;
  html: string;
  adjuntos?: Adjunto[];
}): string {
  const lineas: string[] = [
    `From: ERP PROYINSTELEC <${params.de}>`,
    `To: ${params.para.join(", ")}`,
  ];
  if (params.cc && params.cc.length > 0) lineas.push(`Cc: ${params.cc.join(", ")}`);
  lineas.push(`Subject: ${codificarAsunto(params.asunto)}`, "MIME-Version: 1.0");

  const htmlPart =
    'Content-Type: text/html; charset="UTF-8"\r\n' +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    Buffer.from(params.html, "utf8").toString("base64");

  if (!params.adjuntos || params.adjuntos.length === 0) {
    lineas.push(htmlPart.split("\r\n\r\n")[0], "", htmlPart.split("\r\n\r\n")[1]);
    return lineas.join("\r\n");
  }

  const boundary = "=_proyinstelec_" + Date.now().toString(36);
  lineas.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");
  lineas.push(`--${boundary}`, htmlPart);
  for (const adj of params.adjuntos) {
    lineas.push(
      `--${boundary}`,
      `Content-Type: ${adj.mimeType}; name="${adj.filename}"`,
      `Content-Disposition: attachment; filename="${adj.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      adj.contenido.toString("base64"),
    );
  }
  lineas.push(`--${boundary}--`);
  return lineas.join("\r\n");
}

// ── El correo que no se manda, para poder mirarlo ─────────────────────────────

/**
 * Si estamos en una máquina de desarrollo.
 *
 * Las dos condiciones, y las dos tienen que fallar para que se escriba algo:
 * `NODE_ENV` lo pone Next en cada build, y `VERCEL` la pone la plataforma en
 * todos sus entornos —incluidos los de vista previa—. Un despliegue no escribe
 * correos en disco ni aunque alguien dejara `CORREO_DESHABILITADO` puesto.
 */
const esDesarrollo = (): boolean =>
  process.env.NODE_ENV !== "production" && !process.env.VERCEL;

/** La carpeta del volcado: **fuera del repositorio**, en el temporal del sistema. */
export const carpetaDeVolcado = (): string =>
  process.env.CORREO_VOLCADO_DIR?.trim() || join(tmpdir(), "proyinstelec-correos");

/** `Lista para Revisión · PCOTOP-001-2026` → `Lista-para-Revision-PCOTOP-001-2026`. */
function nombreDeArchivo(asunto: string, cuando: Date): string {
  const marca = cuando.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const limpio = asunto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${marca}__${limpio || "sin-asunto"}.html`;
}

/**
 * Escribe en disco el correo que NO se mandó, para poder abrirlo y revisarlo.
 *
 * Con `CORREO_DESHABILITADO=true` el ERP solo dejaba una línea en la consola
 * con el destinatario y el asunto: para comprobar el cuerpo —que una nota
 * salga escapada, que el recuadro esté donde va— no había forma que no fuera
 * mandarse el correo a uno mismo.
 *
 * **Solo en desarrollo.** En producción no se llama, y si se llamara no haría
 * nada: `esDesarrollo()` es la única puerta.
 *
 * Los metadatos van en un comentario de HTML y no en un recuadro visible, para
 * que lo que se abre en el navegador se vea **exactamente** como el correo que
 * habría salido. Los adjuntos solo se nombran: no se escriben.
 *
 * Nunca lanza. Esto es una comodidad de desarrollo; si falla, el envío —o el
 * no-envío— sigue su curso y la consola lo dice.
 */
async function volcarCorreo(envio: EnvioCorreo, detalle: string): Promise<string | null> {
  if (!esDesarrollo()) return null;

  try {
    const carpeta = carpetaDeVolcado();
    await mkdir(carpeta, { recursive: true });
    const ruta = join(carpeta, nombreDeArchivo(envio.asunto, new Date()));

    const adjuntos = (envio.adjuntos ?? [])
      .map((a) => `${a.filename} (${a.mimeType}, ${a.contenido.length} bytes)`)
      .join(", ");
    // `--` dentro de un comentario de HTML lo cierra antes de tiempo.
    const sinGuiones = (t: string) => t.replace(/--+/g, "—");
    const cabecera =
      `<!--\n  ${sinGuiones(detalle)}\n` +
      (adjuntos ? `  Adjuntos: ${sinGuiones(adjuntos)}\n` : "") +
      `  Este correo NO se envió: CORREO_DESHABILITADO o DEMO_MODE.\n-->\n`;

    await writeFile(ruta, cabecera + envio.html, "utf8");
    return ruta;
  } catch (err) {
    console.error("[correo] no se pudo escribir el volcado:", (err as Error).message);
    return null;
  }
}

// ── Envío ─────────────────────────────────────────────────────────────────────

/**
 * Envía un correo vía Gmail API (service account con delegación de dominio;
 * el mensaje sale de la cuenta CORREO_REMITENTE).
 *
 * En DEMO_MODE o con CORREO_DESHABILITADO=true no envía: registra el intento
 * en consola y bitácora (CORREO_OMITIDO) y devuelve { enviado: false }. En
 * desarrollo, además, **escribe el cuerpo en disco** para poder revisarlo
 * (`volcarCorreo`), y dice en la consola dónde quedó.
 * Todo resultado queda en bitácora (CORREO_ENVIADO / CORREO_OMITIDO / CORREO_ERROR).
 */
export async function enviarCorreo(envio: EnvioCorreo): Promise<ResultadoCorreo> {
  const usuario = envio.registradoPor ?? "sistema";
  const destinatarios = envio.para.filter(Boolean);

  if (destinatarios.length === 0) {
    return { enviado: false, motivo: "sin_destinatarios" };
  }

  const detalle = `Para: ${destinatarios.join(", ")}${envio.cc?.length ? ` · CC: ${envio.cc.join(", ")}` : ""} · Asunto: ${envio.asunto}`;

  if (DEMO_MODE || process.env.CORREO_DESHABILITADO === "true") {
    console.log(`[correo omitido] ${detalle}`);
    const volcado = await volcarCorreo(envio, detalle);
    if (volcado) console.log(`[correo omitido] cuerpo en ${volcado}`);
    await registrarBitacora({
      accion: "CORREO_OMITIDO",
      usuario,
      detalle,
      referencia: envio.referencia,
    });
    return { enviado: false, motivo: DEMO_MODE ? "demo" : "deshabilitado" };
  }

  try {
    const config = await getCorreoConfig();
    const auth = new google.auth.JWT({
      email: config.serviceAccountEmail,
      key: config.privateKey,
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      subject: config.remitente, // delegación de dominio: enviar como esta cuenta
    });
    const gmail = google.gmail({ version: "v1", auth });

    const mime = construirMime({
      de: config.remitente,
      para: destinatarios,
      cc: envio.cc,
      asunto: envio.asunto,
      html: envio.html,
      adjuntos: envio.adjuntos,
    });

    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: Buffer.from(mime, "utf8").toString("base64url"),
      },
    });

    await registrarBitacora({
      accion: "CORREO_ENVIADO",
      usuario,
      detalle,
      referencia: envio.referencia,
    });
    return { enviado: true, messageId: res.data.id ?? undefined };
  } catch (err) {
    console.error("[correo]", (err as Error).message);
    await registrarBitacora({
      accion: "CORREO_ERROR",
      usuario,
      detalle: `${detalle} · Error: ${(err as Error).message}`,
      referencia: envio.referencia,
    });
    return { enviado: false, motivo: "error" };
  }
}

// ── Plantilla base ────────────────────────────────────────────────────────────

/**
 * Envuelve el contenido en la plantilla HTML estándar de los correos del ERP.
 */
/**
 * Texto de una persona dentro del HTML de un correo.
 *
 * Lo que alguien teclea no es marcado: un `<` en una nota tiene que verse como
 * un `<` y no abrir una etiqueta. Sin esto, un texto con `<b>` cambiaría el
 * resto del correo, y uno con `</div>` lo rompería a media plantilla.
 */
export function escaparHtml(texto: string): string {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plantillaCorreo(params: { titulo: string; cuerpoHtml: string; urlSistema?: string }): string {
  const url = params.urlSistema ?? process.env.NEXTAUTH_URL ?? "";
  return `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#0b1f3a;border-radius:12px 12px 0 0;padding:16px 24px;">
      <span style="color:#ffffff;font-size:14px;font-weight:bold;letter-spacing:2px;">PROYINSTELEC · ERP</span>
    </div>
    <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:24px;">
      <h2 style="margin:0 0 16px;color:#0b1f3a;font-size:18px;">${escaparHtml(params.titulo)}</h2>
      ${params.cuerpoHtml}
      ${url ? `<p style="margin:24px 0 0;"><a href="${url}/erp" style="color:#1d4ed8;">Abrir el sistema</a></p>` : ""}
    </div>
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:16px 0 0;">Correo automático del ERP de Proyinstelec — no responder a este mensaje.</p>
  </div>
</body></html>`;
}
