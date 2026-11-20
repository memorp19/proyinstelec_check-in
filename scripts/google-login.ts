/**
 * `pnpm google:login` — entrar a Google con tu cuenta, una sola vez.
 *
 * Para desarrollo, mientras no haya una llave de cuenta de servicio con acceso
 * a la API de Docs. Pide permiso de Drive y de Docs, y guarda el **refresh
 * token** junto al JSON del cliente, **fuera del repositorio**.
 *
 * Uso, desde la raíz del repo:
 *   pnpm google:login
 *
 * Variables: GOOGLE_OAUTH_CLIENTE (ruta al JSON del cliente OAuth de
 * escritorio). El token se guarda en esa misma carpeta como
 * `oauth-token-erp.json`.
 *
 * ── Por qué el loopback ──
 *
 * El cliente es de tipo **escritorio** (`installed`), y para esos Google
 * acepta `http://127.0.0.1` en **cualquier puerto**: no hay URI de redirección
 * que registrar en Cloud, y el puerto se pide prestado al sistema. Con un
 * cliente "web" habría que registrarla a mano.
 *
 * No escribe nada en ninguna base ni en Drive. Lo único que toca es el archivo
 * del token.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { AddressInfo } from "node:net";
import { config } from "dotenv";
import { google } from "googleapis";
import {
  ALCANCES_DEL_ERP,
  exigirQueNoSeaProduccion,
  guardarTokenOAuth,
  leerClienteOAuth,
  rutaDelClienteOAuth,
  rutaDelTokenOAuth,
} from "../apps/web/src/lib/google-auth";

config({ path: "apps/web/.env.local" });

/** Si nadie termina de dar permiso, no se queda un servidor abierto para siempre. */
const ESPERA_MAXIMA_MS = 5 * 60 * 1000;

const pagina = (titulo: string, detalle: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
  `<title>${titulo}</title></head>` +
  `<body style="font-family:system-ui;background:#0A1628;color:#fff;padding:3rem">` +
  `<h1 style="font-weight:600">${titulo}</h1><p style="opacity:.7">${detalle}</p></body></html>`;

/** Abre el navegador. Si no puede, no pasa nada: la URL ya está impresa. */
async function abrirNavegador(url: string): Promise<void> {
  const { exec } = await import("node:child_process");
  // Las comillas dobles son necesarias en Windows: la URL lleva `&` y, sin
  // ellas, cmd lo toma como separador de comandos y abre media URL.
  const comando =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(comando, () => {
    /* si falla, se usa la URL impresa */
  });
}

/**
 * Levanta el loopback y espera el código.
 *
 * El `state` no es ceremonia: al puerto puede llegar cualquier petición del
 * propio equipo, y sin comprobarlo una petición perdida se confundiría con la
 * respuesta buena.
 */
function esperarElCodigo(
  servidor: ReturnType<typeof createServer>,
  state: string,
): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const reloj = setTimeout(() => {
      rechazar(new Error("Pasaron cinco minutos sin respuesta de Google. No se guardó nada."));
    }, ESPERA_MAXIMA_MS);

    servidor.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }

      const responder = (titulo: string, detalle: string) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(pagina(titulo, detalle));
      };

      const error = url.searchParams.get("error");
      const codigo = url.searchParams.get("code");

      if (error) {
        responder("No se dio el permiso", "Puedes cerrar esta pestaña y volver a la terminal.");
        clearTimeout(reloj);
        rechazar(new Error(`Google respondió "${error}": no se concedió el permiso.`));
        return;
      }
      if (url.searchParams.get("state") !== state) {
        // Ni se responde bonito ni se falla el login: no es la petición nuestra.
        res.writeHead(400).end();
        return;
      }
      if (!codigo) {
        res.writeHead(400).end();
        return;
      }

      responder("Listo", "Ya puedes cerrar esta pestaña y volver a la terminal.");
      clearTimeout(reloj);
      resolver(codigo);
    });
  });
}

async function main() {
  // La misma negativa que usa la app: el OAuth de usuario es de desarrollo.
  exigirQueNoSeaProduccion();

  const rutaCliente = rutaDelClienteOAuth();
  const { clientId, clientSecret } = await leerClienteOAuth(rutaCliente);
  const rutaToken = await rutaDelTokenOAuth(rutaCliente);

  const servidor = createServer();
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  const puerto = (servidor.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${puerto}`;

  const cliente = new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
  const state = randomBytes(16).toString("hex");

  const url = cliente.generateAuthUrl({
    // `offline` es lo que hace que Google mande un refresh token, y `consent`
    // lo que hace que lo mande TAMBIÉN cuando ya habías dado permiso antes:
    // sin él, un segundo login devuelve solo un token de acceso y el archivo
    // se guardaría sin lo único que sirve a largo plazo.
    access_type: "offline",
    prompt: "consent",
    scope: ALCANCES_DEL_ERP,
    state,
  });

  console.log("\n🔑  Entrando a Google con tu cuenta (solo para desarrollo).\n");
  console.log("    Se va a abrir el navegador. Si no abre, pega esta URL:\n");
  console.log(`    ${url}\n`);
  await abrirNavegador(url);

  try {
    const codigo = await esperarElCodigo(servidor, state);
    const { tokens } = await cliente.getToken(codigo);
    cliente.setCredentials(tokens);

    if (!tokens.refresh_token) {
      throw new Error(
        "Google no devolvió refresh_token. Quita el acceso de la app en " +
          "https://myaccount.google.com/permissions y vuelve a correr `pnpm google:login`.",
      );
    }

    // Preguntar quién entró, en vez de suponerlo: con varias cuentas abiertas
    // en el navegador es facilísimo conceder el permiso con la equivocada, y
    // el síntoma sería un 404 de Drive mucho después.
    const { data } = await google.oauth2({ version: "v2", auth: cliente }).userinfo.get();

    await guardarTokenOAuth(rutaToken, {
      refresh_token: tokens.refresh_token,
      cuenta: data.email ?? "(desconocida)",
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
      obtenido: new Date().toISOString(),
    });

    console.log(`✅  Entraste como ${data.email}`);
    console.log(`    Token guardado en ${rutaToken}`);
    console.log("    No lo copies al repositorio: está fuera a propósito.\n");
  } finally {
    servidor.close();
  }
}

main().catch((err) => {
  console.error(`\n❌  ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
