/**
 * Lo que se le entrega a Drive al subir un archivo.
 *
 * ── El fallo que origina estas pruebas ──
 *
 * Las dos subidas hacían `const { Readable } = await import("stream")`. Con
 * la importación **dinámica**, webpack compila el módulo a
 * `__webpack_require__.t(…, "stream", 23)`, que devuelve un objeto sin la
 * exportación con nombre: `Readable` llega `undefined` y `Readable.from(…)`
 * revienta con «Cannot read properties of undefined (reading 'from')».
 *
 * Solo pasaba **dentro de Next**. El mismo código corrido con `tsx` —el
 * script que generó decenas de documentos— funcionaba, y por eso tardó en
 * verse: el documento se creaba, se llenaba y se exportaba, y reventaba justo
 * al subir el PDF.
 *
 * Por eso hay dos pruebas y no una. Ninguna sola basta:
 *
 * - La de **la forma del cuerpo** comprueba lo que la API necesita recibir,
 *   pero bajo vitest la importación dinámica funciona, así que habría pasado
 *   igual antes del arreglo.
 * - La de **cómo se importa** es la que de verdad reproduce la condición: es
 *   la diferencia que el empaquetador convierte en el fallo, y falla contra
 *   el código de antes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

const { getDriveClient } = vi.hoisted(() => ({ getDriveClient: vi.fn() }));

vi.mock("googleapis", () => ({
  google: { auth: { JWT: vi.fn(), OAuth2: vi.fn() }, drive: vi.fn() },
}));
vi.mock("@/src/lib/drive", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/drive")>()),
  getDriveClient,
}));

import { subirArchivoErp } from "@/src/lib/drive-erp";

const crear = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  crear.mockResolvedValue({ data: { id: "archivo-1", webViewLink: "https://drive/archivo-1" } });
  getDriveClient.mockResolvedValue({ files: { create: crear } });
});

describe("subirArchivoErp · la forma de lo que se envía", () => {
  it("el cuerpo es un stream de verdad, no un Buffer ni undefined", async () => {
    await subirArchivoErp({
      folderId: "carpeta-1",
      filename: "PCOTOP-000-2026 Prueba.pdf",
      mimeType: "application/pdf",
      contenido: Buffer.from("contenido de prueba"),
    });

    const media = crear.mock.calls[0][0].media;
    expect(media.mimeType).toBe("application/pdf");
    expect(media.body).toBeInstanceOf(Readable);
  });

  it("el stream entrega el contenido que se le dio", async () => {
    const contenido = Buffer.from("pdf de prueba");
    await subirArchivoErp({
      folderId: "carpeta-1",
      filename: "x.pdf",
      mimeType: "application/pdf",
      contenido,
    });

    const trozos: Buffer[] = [];
    for await (const t of crear.mock.calls[0][0].media.body) trozos.push(t as Buffer);
    expect(Buffer.concat(trozos).toString()).toBe("pdf de prueba");
  });

  it("devuelve el id y un enlace aunque Drive no mande webViewLink", async () => {
    crear.mockResolvedValue({ data: { id: "archivo-2" } });
    const r = await subirArchivoErp({
      folderId: "c", filename: "x.pdf", mimeType: "application/pdf", contenido: Buffer.from("x"),
    });
    expect(r.driveFileId).toBe("archivo-2");
    expect(r.webViewLink).toContain("archivo-2");
  });
});

/**
 * Esta es la que reproduce el fallo: con `await import("stream")` falla, con
 * la importación estática pasa. Mira el código fuente porque la diferencia no
 * se puede observar en tiempo de ejecución bajo vitest — solo la crea el
 * empaquetador de Next.
 */
describe("los módulos de servidor importan `stream` de forma estática", () => {
  const MODULOS = ["apps/web/src/lib/drive.ts", "apps/web/src/lib/drive-erp.ts"];

  /** Sin comentarios: la nota que explica el fallo nombra la forma mala. */
  const soloCodigo = (fuente: string) =>
    fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const modulo of MODULOS) {
    it(`${modulo} no usa la importación dinámica`, () => {
      const fuente = readFileSync(modulo.replace("apps/web/", ""), "utf8");
      expect(soloCodigo(fuente)).not.toMatch(/await\s+import\(\s*["']stream["']\s*\)/);
      expect(fuente).toMatch(/^import \{ Readable \} from "node:stream";$/m);
    });
  }
});
