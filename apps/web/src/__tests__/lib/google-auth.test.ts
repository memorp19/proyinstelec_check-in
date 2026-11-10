/**
 * Los dos modos de entrar a Google.
 *
 * La mitad de este archivo no prueba lo nuevo sino **lo que no debe cambiar**:
 * sin `GOOGLE_OAUTH_CLIENTE`, `getDriveClient()` tiene que construir el mismo
 * JWT de cuenta de servicio que construía antes de que existiera este módulo.
 * De esa ruta cuelgan las fotos de campo en producción, y un cambio de modo
 * ahí no se vería en ninguna otra prueba: el cliente se construye igual de
 * bien con la credencial equivocada y el fallo aparece en Drive, en caliente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

vi.mock("googleapis", () => {
  const JWT = vi.fn().mockImplementation((opts: unknown) => ({ tipo: "jwt", opts }));
  const OAuth2 = vi.fn().mockImplementation((opts: unknown) => ({
    tipo: "oauth2",
    opts,
    setCredentials: vi.fn(),
  }));
  const drive = vi.fn().mockImplementation((opts: unknown) => ({ opts, files: {} }));
  return { google: { auth: { JWT, OAuth2 }, drive } };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
}));

import { google } from "googleapis";
import * as fs from "node:fs/promises";
import {
  ALCANCES,
  autenticar,
  modoDeGoogle,
  _resetGoogleAuthCache,
} from "@/src/lib/google-auth";
import { getDriveClient, _resetDriveConfigCache } from "@/src/lib/drive";

const LLAVE = JSON.stringify({
  client_email: "erp@proyecto.iam.gserviceaccount.com",
  // Como viene de Vercel: con los saltos escapados.
  private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
});

const RUTA_CLIENTE = path.join(path.sep, "llaves", "oauth-cliente-erp.json");
const RUTA_TOKEN = path.join(path.sep, "llaves", "oauth-token-erp.json");

const CLIENTE_EN_DISCO = JSON.stringify({
  installed: { client_id: "id-de-escritorio", client_secret: "secreto-de-prueba" },
});

const tokenEnDisco = (scopes: string[] = [ALCANCES.DRIVE, ALCANCES.DOCUMENTOS]) =>
  JSON.stringify({
    refresh_token: "refresco-123",
    cuenta: "alguien@proyinstelec.mx",
    scopes,
    obtenido: "2026-11-09T12:00:00.000Z",
  });

/** Lo que haya en disco, por ruta. Lo que no esté, no existe. */
function enDisco(archivos: Record<string, string>) {
  vi.mocked(fs.readFile).mockImplementation(async (ruta) => {
    const contenido = archivos[String(ruta)];
    if (contenido === undefined) {
      const err = new Error(`ENOENT: ${String(ruta)}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return contenido;
  });
  vi.mocked(fs.access).mockImplementation(async (ruta) => {
    if (archivos[String(ruta)] === undefined) throw new Error("no está");
  });
}

const entornoOriginal = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  _resetDriveConfigCache();
  _resetGoogleAuthCache();
  process.env.DRIVE_SERVICE_ACCOUNT_KEY = LLAVE;
  process.env.DRIVE_ROOT_FOLDER_ID = "raiz-de-fotos";
  delete process.env.GOOGLE_OAUTH_CLIENTE;
  delete process.env.VERCEL;
});

afterEach(() => {
  process.env = { ...entornoOriginal };
});

// ── Lo que no debe cambiar ────────────────────────────────────────────────────

describe("sin GOOGLE_OAUTH_CLIENTE: la cuenta de servicio, como siempre", () => {
  it("el modo es el de cuenta de servicio", () => {
    expect(modoDeGoogle()).toBe("cuenta-de-servicio");
  });

  it("getDriveClient construye el JWT con el correo, la llave y el alcance de Drive", async () => {
    await getDriveClient();

    expect(google.auth.JWT).toHaveBeenCalledTimes(1);
    expect(vi.mocked(google.auth.JWT).mock.calls[0][0]).toEqual({
      email: "erp@proyecto.iam.gserviceaccount.com",
      // Los saltos escapados se restauran: con ellos escapados, la firma falla.
      key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  });

  it("le pasa ese mismo cliente a google.drive, y no toca OAuth2", async () => {
    await getDriveClient();

    const jwt = vi.mocked(google.auth.JWT).mock.results[0].value;
    expect(vi.mocked(google.drive).mock.calls[0][0]).toEqual({ version: "v3", auth: jwt });
    expect(google.auth.OAuth2).not.toHaveBeenCalled();
  });

  it("sigue exigiendo DRIVE_ROOT_FOLDER_ID, con el mensaje de siempre", async () => {
    delete process.env.DRIVE_ROOT_FOLDER_ID;
    await expect(getDriveClient()).rejects.toThrow(
      "Faltan DRIVE_SERVICE_ACCOUNT_KEY y/o DRIVE_ROOT_FOLDER_ID",
    );
    expect(google.auth.JWT).not.toHaveBeenCalled();
  });

  it("una llave que no es JSON se sigue diciendo igual", async () => {
    process.env.DRIVE_SERVICE_ACCOUNT_KEY = "esto no es json";
    await expect(getDriveClient()).rejects.toThrow("DRIVE_SERVICE_ACCOUNT_KEY no es un JSON válido");
  });

  it("no lee nada del disco: no hay archivos de credenciales en este modo", async () => {
    await getDriveClient();
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});

// ── El modo de desarrollo ─────────────────────────────────────────────────────

describe("con GOOGLE_OAUTH_CLIENTE: la cuenta de quien programa", () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENTE = RUTA_CLIENTE;
    enDisco({ [RUTA_CLIENTE]: CLIENTE_EN_DISCO, [RUTA_TOKEN]: tokenEnDisco() });
  });

  it("el modo cambia con la sola presencia de la variable", () => {
    expect(modoDeGoogle()).toBe("oauth-de-usuario");
  });

  it("usa OAuth2 con el cliente del disco y el refresh token, y nunca el JWT", async () => {
    const auth = (await autenticar([ALCANCES.DOCUMENTOS])) as unknown as {
      opts: unknown;
      setCredentials: ReturnType<typeof vi.fn>;
    };

    expect(auth.opts).toEqual({ clientId: "id-de-escritorio", clientSecret: "secreto-de-prueba" });
    // Solo el de refresco: el de acceso lo pide la librería y vive en memoria.
    expect(auth.setCredentials).toHaveBeenCalledWith({ refresh_token: "refresco-123" });
    expect(google.auth.JWT).not.toHaveBeenCalled();
  });

  it("el token se busca junto al cliente, sin variable propia", async () => {
    await autenticar([ALCANCES.DRIVE]);
    expect(vi.mocked(fs.readFile).mock.calls.map((c) => String(c[0]))).toContain(RUTA_TOKEN);
  });

  it("se niega en Vercel, y no se queda con la cuenta de servicio", async () => {
    process.env.VERCEL = "1";
    await expect(autenticar([ALCANCES.DRIVE])).rejects.toThrow(
      "GOOGLE_OAUTH_CLIENTE está definida en un entorno de producción",
    );
    expect(google.auth.JWT).not.toHaveBeenCalled();
    expect(google.auth.OAuth2).not.toHaveBeenCalled();
  });

  it("se niega con NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(autenticar([ALCANCES.DRIVE])).rejects.toThrow("entorno de producción");
    vi.unstubAllEnvs();
  });

  it("un token sin los alcances pedidos manda a hacer el login otra vez", async () => {
    enDisco({
      [RUTA_CLIENTE]: CLIENTE_EN_DISCO,
      [RUTA_TOKEN]: tokenEnDisco([ALCANCES.DRIVE]),
    });
    await expect(autenticar([ALCANCES.DRIVE, ALCANCES.DOCUMENTOS])).rejects.toThrow(
      /no incluye https:\/\/www\.googleapis\.com\/auth\/documents.+google:login/s,
    );
  });

  it("si el archivo tiene la extensión doble que esconde Windows, lo dice", async () => {
    enDisco({ [RUTA_CLIENTE + ".json"]: CLIENTE_EN_DISCO });
    await expect(autenticar([ALCANCES.DRIVE])).rejects.toThrow(
      /Sí existe .+oauth-cliente-erp\.json\.json.+renómbralo/s,
    );
  });

  it("sin token guardado, el error dice dónde se esperaba", async () => {
    enDisco({ [RUTA_CLIENTE]: CLIENTE_EN_DISCO });
    await expect(autenticar([ALCANCES.DRIVE])).rejects.toThrow(
      /No encontré el token de Google en .+oauth-token-erp\.json/,
    );
  });
});
