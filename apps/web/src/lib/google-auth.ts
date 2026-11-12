/**
 * La única puerta por la que este código se autentica con Google.
 *
 * Hay dos modos y nunca conviven en la misma ejecución:
 *
 * - **Cuenta de servicio** (`DRIVE_SERVICE_ACCOUNT_KEY`). Es lo que corre en
 *   Vercel y lo que ha corrido siempre: las fotos de campo, las carpetas del
 *   ERP, los adjuntos. Sin `GOOGLE_OAUTH_CLIENTE` definida, este módulo hace
 *   exactamente lo que hacía `drive.ts` antes de existir.
 * - **OAuth de usuario** (`GOOGLE_OAUTH_CLIENTE`). Solo para desarrollo, con
 *   la cuenta de quien programa, mientras no haya llave de cuenta de servicio
 *   con acceso a Docs. El token se obtiene una vez con `pnpm google:login`.
 *
 * ── Por qué la precedencia es esa ──
 *
 * El modo lo decide **la presencia de `GOOGLE_OAUTH_CLIENTE`**, que es una
 * ruta de archivo en el disco de alguien: nadie la define en Vercel por
 * accidente. Así no hace falta una variable "modo" que se pueda dejar mal
 * puesta, y el valor que activa el camino peligroso es el que no puede existir
 * donde haría daño.
 *
 * Y si aun así apareciera en producción, esto **falla** en vez de caer de
 * vuelta a la cuenta de servicio. Un respaldo silencioso haría que una
 * producción mal configurada escribiera igual, con otra identidad, sin que
 * nadie se entere: es justo el fallo que no se quiere poder tener.
 */
import { google } from "googleapis";

/** Lo que `googleapis` acepta como `auth`, en cualquiera de los dos modos. */
export type ClienteDeGoogle =
  | InstanceType<typeof google.auth.JWT>
  | InstanceType<typeof google.auth.OAuth2>;

export type ModoGoogle = "cuenta-de-servicio" | "oauth-de-usuario";

export const ALCANCES = {
  DRIVE: "https://www.googleapis.com/auth/drive",
  DOCUMENTOS: "https://www.googleapis.com/auth/documents",
  /** Solo para que el login pueda decir con qué cuenta entraste. */
  CORREO: "https://www.googleapis.com/auth/userinfo.email",
} as const;

/** Lo que pide `pnpm google:login`: todo lo que el ERP necesita, de una vez. */
export const ALCANCES_DEL_ERP = [ALCANCES.DRIVE, ALCANCES.DOCUMENTOS, ALCANCES.CORREO];

// ── Dónde estamos ─────────────────────────────────────────────────────────────

/**
 * `VERCEL` la define la propia plataforma en todos sus entornos —producción,
 * preview y las compilaciones—, así que cubre más que `NODE_ENV`.
 */
export function enProduccion(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

export function modoDeGoogle(): ModoGoogle {
  return process.env.GOOGLE_OAUTH_CLIENTE?.trim() ? "oauth-de-usuario" : "cuenta-de-servicio";
}

/**
 * La negativa, en un solo sitio.
 *
 * La usan este módulo y el script de login: si algún día cambia la regla, no
 * puede cambiar en un lado y no en el otro.
 */
export function exigirQueNoSeaProduccion(): void {
  if (!enProduccion()) return;
  throw new Error(
    "GOOGLE_OAUTH_CLIENTE está definida en un entorno de producción. " +
      "El OAuth de usuario es solo para desarrollo: en producción se usa la cuenta " +
      "de servicio. Quita la variable del entorno — no se continúa con la cuenta " +
      "de servicio a propósito, porque sería escribir con una identidad distinta " +
      "de la que la configuración dice.",
  );
}

// ── Cuenta de servicio ────────────────────────────────────────────────────────

export interface CredencialesDeCuentaDeServicio {
  email: string;
  privateKey: string;
}

/**
 * La llave del service account, parseada.
 *
 * Vive aquí y no en `drive.ts` para que haya **un solo** sitio que entienda el
 * formato de esa variable; `getDriveConfig` la usa y conserva sus propios
 * mensajes, que son los que la gente ya conoce.
 */
export function credencialesDeCuentaDeServicio(): CredencialesDeCuentaDeServicio {
  const keyJson = process.env.DRIVE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error(
      "Falta DRIVE_SERVICE_ACCOUNT_KEY (ver docs/setup-google-drive.md). En desarrollo " +
        "puedes usar tu cuenta de Google con GOOGLE_OAUTH_CLIENTE y `pnpm google:login`.",
    );
  }

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(keyJson);
  } catch {
    throw new Error("DRIVE_SERVICE_ACCOUNT_KEY no es un JSON válido");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("DRIVE_SERVICE_ACCOUNT_KEY no trae client_email y private_key");
  }

  return {
    email: parsed.client_email,
    // Vercel guarda los saltos de línea escapados: hay que restaurarlos.
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

// ── OAuth de usuario ──────────────────────────────────────────────────────────

/** Lo que queda guardado después de `pnpm google:login`. */
export interface TokenGuardado {
  refresh_token: string;
  /** Con qué cuenta se entró. Para que un 403 pueda decir "ese token es de otro". */
  cuenta: string;
  scopes: string[];
  obtenido: string;
}

export function rutaDelClienteOAuth(): string {
  const ruta = process.env.GOOGLE_OAUTH_CLIENTE?.trim();
  if (!ruta) throw new Error("Falta GOOGLE_OAUTH_CLIENTE: la ruta al JSON del cliente OAuth.");
  return ruta;
}

/**
 * El token vive **junto al cliente**, fuera del repositorio.
 *
 * Se deduce de la ruta del cliente en vez de tener su propia variable: dos
 * variables son dos oportunidades de que apunten a sitios distintos, y el
 * segundo error de esos no se ve hasta que algo falla raro.
 */
export async function rutaDelTokenOAuth(rutaCliente = rutaDelClienteOAuth()): Promise<string> {
  const path = await import("node:path");
  return path.join(path.dirname(rutaCliente), "oauth-token-erp.json");
}

/**
 * Lee un JSON del disco con un error que se pueda arreglar sin adivinar.
 *
 * El caso de la extensión doble no es hipotético: Windows oculta las
 * extensiones conocidas, así que un archivo guardado como `cliente.json`
 * acaba llamándose `cliente.json.json` y el Explorador lo enseña bien. Si el
 * que falta está ahí al lado, el mensaje lo dice.
 */
async function leerJson<T>(ruta: string, queEs: string): Promise<T> {
  const fs = await import("node:fs/promises");
  let crudo: string;
  try {
    crudo = await fs.readFile(ruta, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      const gemelo = ruta + ".json";
      const sugerencia = await fs
        .access(gemelo)
        .then(
          () =>
            ` Sí existe "${gemelo}" — Windows oculta la extensión conocida: renómbralo o apunta la variable ahí.`,
        )
        .catch(() => "");
      throw new Error(`No encontré ${queEs} en "${ruta}".${sugerencia}`);
    }
    throw err;
  }
  try {
    return JSON.parse(crudo) as T;
  } catch {
    throw new Error(`${queEs} ("${ruta}") no es un JSON válido.`);
  }
}

interface ClienteOAuthEnDisco {
  installed?: { client_id?: string; client_secret?: string };
  web?: { client_id?: string; client_secret?: string };
}

export async function leerClienteOAuth(
  ruta = rutaDelClienteOAuth(),
): Promise<{ clientId: string; clientSecret: string }> {
  const json = await leerJson<ClienteOAuthEnDisco>(ruta, "el JSON del cliente OAuth");
  // "installed" es el cliente de escritorio, que es el que permite el loopback
  // con cualquier puerto; "web" se acepta por si alguien reutiliza otro, pero
  // entonces la URI de redirección tiene que estar registrada en Cloud.
  const datos = json.installed ?? json.web;
  if (!datos?.client_id || !datos.client_secret) {
    throw new Error(
      `El JSON del cliente OAuth ("${ruta}") no trae client_id y client_secret dentro de "installed" ni de "web".`,
    );
  }
  return { clientId: datos.client_id, clientSecret: datos.client_secret };
}

export async function leerTokenOAuth(ruta: string): Promise<TokenGuardado> {
  const token = await leerJson<Partial<TokenGuardado>>(ruta, "el token de Google");
  if (!token.refresh_token) {
    throw new Error(
      `El token de Google ("${ruta}") no trae refresh_token. Vuelve a correr \`pnpm google:login\`.`,
    );
  }
  return {
    refresh_token: token.refresh_token,
    cuenta: token.cuenta ?? "(desconocida)",
    scopes: token.scopes ?? [],
    obtenido: token.obtenido ?? "(sin fecha)",
  };
}

export async function guardarTokenOAuth(ruta: string, token: TokenGuardado): Promise<void> {
  const fs = await import("node:fs/promises");
  // 0600: en Windows no cambia gran cosa, pero el mismo archivo acaba en
  // máquinas donde sí, y pedirlo no cuesta nada.
  await fs.writeFile(ruta, JSON.stringify(token, null, 2) + "\n", { mode: 0o600 });
}

// ── El cliente ────────────────────────────────────────────────────────────────

let _oauthCacheado: ClienteDeGoogle | null = null;

/** Las pruebas cambian variables de entorno entre casos. */
export function _resetGoogleAuthCache(): void {
  _oauthCacheado = null;
}

async function clienteOAuth(scopes: string[]): Promise<ClienteDeGoogle> {
  exigirQueNoSeaProduccion();
  if (_oauthCacheado) return _oauthCacheado;

  const rutaCliente = rutaDelClienteOAuth();
  const { clientId, clientSecret } = await leerClienteOAuth(rutaCliente);
  const rutaToken = await rutaDelTokenOAuth(rutaCliente);
  const token = await leerTokenOAuth(rutaToken);

  const faltantes = scopes.filter((s) => !token.scopes.includes(s));
  if (faltantes.length > 0) {
    throw new Error(
      `El token guardado (cuenta ${token.cuenta}, ${token.obtenido}) no incluye ${faltantes.join(" ni ")}. ` +
        "Vuelve a correr `pnpm google:login`.",
    );
  }

  const cliente = new google.auth.OAuth2({ clientId, clientSecret });
  // Solo el refresh token: el de acceso lo pide la librería cuando hace falta
  // y se queda en memoria, que es donde debe estar.
  cliente.setCredentials({ refresh_token: token.refresh_token });

  _oauthCacheado = cliente;
  return cliente;
}

/**
 * El cliente autenticado para esos alcances.
 *
 * Perezoso a propósito, como `getDb()`: si falta configuración falla aquí, con
 * el nombre de lo que falta, y no al importar el módulo —que rompería el build.
 */
export async function autenticar(scopes: string[]): Promise<ClienteDeGoogle> {
  if (modoDeGoogle() === "oauth-de-usuario") return clienteOAuth(scopes);

  const { email, privateKey } = credencialesDeCuentaDeServicio();
  return new google.auth.JWT({ email, key: privateKey, scopes });
}
