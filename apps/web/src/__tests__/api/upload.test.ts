/**
 * La foto del check-in y del check-out (docs/seguridad-erp.md §3.4): siempre
 * de una jornada que ya existe, con la carpeta y la hora que salen de ella, y
 * una sola vez. Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/drive", () => ({ uploadPhoto: vi.fn(), mandarAPapelera: vi.fn() }));
vi.mock("@/src/lib/users", () => ({ getUserById: vi.fn() }));
vi.mock("@/src/lib/jornadas", () => ({ getJornada: vi.fn(), ponerFotoDeJornada: vi.fn() }));
vi.mock("@/src/lib/proyectos", () => ({ getProyecto: vi.fn() }));

import { auth } from "@/src/auth";
import { mandarAPapelera, uploadPhoto } from "@/src/lib/drive";
import { getUserById } from "@/src/lib/users";
import { getJornada, ponerFotoDeJornada } from "@/src/lib/jornadas";
import { getProyecto } from "@/src/lib/proyectos";
import { ACTUALIZA_LA_APP, TOPE_FOTO_BYTES } from "@/src/lib/fotos";
import { POST } from "@/app/api/upload/route";

/** `auth()` está sobrecargada en Auth.js v5; el cast deja usarla como mock simple. */
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const b64 = (b: Buffer) => b.toString("base64");

const PERSONA = {
  id: "u-1",
  email: "alguien@ejemplo.test",
  nombre: "Persona de Prueba",
  tipo: "temporal",
  rol: "campo",
  activo: true,
  perfil_completo: true,
  proyectos_asignados: ["p-1"],
};
const PROYECTO = { proyecto_id: "p-1", nombre: "Subestación Norte", estado: "activo" };
/** Abierta a las 9:05 de México del 25. */
const ABIERTA = {
  id: "j-1",
  usuarioId: "u-1",
  proyectoId: "p-1",
  estado: "abierta",
  checkIn: { timestamp: "2026-11-25T15:05:00.000Z" },
};
/** Cerrada a las 18:30 de México del 25, que en UTC ya es el 26. */
const CERRADA = {
  ...ABIERTA,
  estado: "cerrada",
  checkOut: { timestamp: "2026-11-26T00:30:00.000Z" },
};
const SUBIDA = {
  driveFileId: "drive-file-123",
  hash: "a".repeat(64),
  webViewLink: "https://drive.google.com/file/d/drive-file-123/view",
};

const pedir = (cuerpo: unknown) =>
  new NextRequest("http://localhost/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

const CHECKIN = { tipo: "checkin", jornadaId: "j-1", base64: b64(JPEG) };
const CHECKOUT = { tipo: "checkout", jornadaId: "j-1", base64: b64(JPEG) };

beforeEach(() => {
  vi.clearAllMocks();
  // Dos días después: la foto se sube tarde, como desde la cola.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T20:00:00Z"));
  mockAuth.mockResolvedValue({ user: { id: "u-1", tipo: "temporal" } });
  vi.mocked(getUserById).mockResolvedValue(PERSONA as never);
  vi.mocked(getProyecto).mockResolvedValue(PROYECTO as never);
  vi.mocked(getJornada).mockResolvedValue(ABIERTA as never);
  vi.mocked(ponerFotoDeJornada).mockResolvedValue(true);
  vi.mocked(uploadPhoto).mockResolvedValue(SUBIDA);
  vi.mocked(mandarAPapelera).mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

const sinSubir = () => {
  expect(uploadPhoto).not.toHaveBeenCalled();
  expect(ponerFotoDeJornada).not.toHaveBeenCalled();
};

describe("POST /api/upload — quién", () => {
  it("sin sesión: 401, sin tocar la base ni Drive", async () => {
    mockAuth.mockResolvedValue(null);

    expect((await POST(pedir(CHECKIN))).status).toBe(401);
    expect(getUserById).not.toHaveBeenCalled();
    sinSubir();
  });

  it.each([
    ["con el perfil incompleto", { perfil_completo: false }, "Completa tu perfil"],
    ["inactivo", { activo: false }, "no está activa"],
    ["con rol cliente", { rol: "cliente" }, "no ficha en campo"],
  ])("%s: 403, sin subir", async (_caso, cambio, mensaje) => {
    vi.mocked(getUserById).mockResolvedValue({ ...PERSONA, ...cambio } as never);

    const r = await POST(pedir(CHECKIN));

    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain(mensaje);
    sinSubir();
  });

  it("una jornada de otra persona: 403, sin subir", async () => {
    vi.mocked(getJornada).mockResolvedValue({ ...ABIERTA, usuarioId: "u-2" } as never);

    expect((await POST(pedir(CHECKIN))).status).toBe(403);
    sinSubir();
  });

  it("una jornada que no existe: 404", async () => {
    vi.mocked(getJornada).mockResolvedValue(null);

    expect((await POST(pedir(CHECKIN))).status).toBe(404);
    sinSubir();
  });
});

describe("POST /api/upload — la carpeta y la hora salen de la jornada", () => {
  it("check-in: el proyecto y el nombre de la base, la fecha y la hora del check-in en México", async () => {
    const r = await POST(pedir(CHECKIN));

    expect(r.status).toBe(200);
    expect(uploadPhoto).toHaveBeenCalledWith({
      buffer: JPEG,
      filename: "checkin_0905.jpg",
      mimeType: "image/jpeg",
      proyectoNombre: "Subestación Norte",
      fecha: "2026-11-25",
      trabajadorNombre: "Persona de Prueba",
    });
    expect(ponerFotoDeJornada).toHaveBeenCalledWith({ jornadaId: "j-1", momento: "checkin", foto: SUBIDA });
    expect((await r.json()).driveFileId).toBe("drive-file-123");
  });

  // Después de las 18:00 de México ya es el día siguiente en UTC.
  it("check-out: la hora del cierre, y el día de México aunque en UTC ya sea otro", async () => {
    vi.mocked(getJornada).mockResolvedValue(CERRADA as never);

    expect((await POST(pedir(CHECKOUT))).status).toBe(200);
    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "checkout_1830.jpg", fecha: "2026-11-25" }),
    );
    expect(ponerFotoDeJornada).toHaveBeenCalledWith(expect.objectContaining({ momento: "checkout" }));
  });

  it("la foto de salida con la jornada aún abierta: 409, sin subir", async () => {
    const r = await POST(pedir(CHECKOUT));

    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("sigue abierta");
    sinSubir();
  });

  it("un proyecto que no existe: 404, sin subir", async () => {
    vi.mocked(getProyecto).mockResolvedValue(null);

    expect((await POST(pedir(CHECKIN))).status).toBe(404);
    sinSubir();
  });

  it("si Drive falla: 502, y la jornada no se toca", async () => {
    vi.mocked(uploadPhoto).mockRejectedValue(new Error("Drive caído"));

    const r = await POST(pedir(CHECKIN));

    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("No se pudo guardar la foto en Drive.");
    expect(ponerFotoDeJornada).not.toHaveBeenCalled();
  });
});

describe("POST /api/upload — una sola vez", () => {
  // Un reintento de la cola cuya primera respuesta se perdió.
  it("si la jornada ya tiene la foto, devuelve esa y no sube otra", async () => {
    vi.mocked(getJornada).mockResolvedValue({
      ...ABIERTA,
      checkIn: { ...ABIERTA.checkIn, driveFileId: "ya-estaba", driveWebViewLink: "https://drive/ya", fotoHash: "h" },
    } as never);

    const r = await POST(pedir(CHECKIN));

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ driveFileId: "ya-estaba", yaEstaba: true });
    sinSubir();
  });

  // Dos subidas a la vez: la que no quedó en la jornada sobra.
  it("si otra subida ganó mientras tanto, la suya va a la papelera y se devuelve la ganadora", async () => {
    vi.mocked(ponerFotoDeJornada).mockResolvedValue(false);
    vi.mocked(getJornada)
      .mockResolvedValueOnce(ABIERTA as never)
      .mockResolvedValueOnce({
        ...ABIERTA,
        checkIn: { ...ABIERTA.checkIn, driveFileId: "la-ganadora", driveWebViewLink: "", fotoHash: "" },
      } as never);

    const r = await POST(pedir(CHECKIN));

    expect(mandarAPapelera).toHaveBeenCalledWith("drive-file-123");
    expect(await r.json()).toMatchObject({ driveFileId: "la-ganadora", yaEstaba: true });
  });
});

describe("POST /api/upload — una pantalla vieja", () => {
  it.each([
    [
      "la de antes del #35",
      { base64: b64(JPEG), filename: "a.jpg", mimeType: "image/jpeg", proyectoNombre: "X", fecha: "2026-11-25", trabajadorNombre: "Y" },
    ],
    ["la del #35, que subía antes de registrar", { tipo: "checkin", proyectoId: "p-1", base64: b64(JPEG) }],
    ["con un campo de más", { ...CHECKIN, carpeta: "Proyectos/otro" }],
    ["con mimeType (el tipo sale de los bytes)", { ...CHECKIN, mimeType: "image/jpeg" }],
    ["con un tipo que no existe", { ...CHECKIN, tipo: "foto" }],
    ["sin jornada", { tipo: "checkin", base64: b64(JPEG) }],
  ])("%s: 400, «Actualiza la aplicación», sin tocar nada", async (_caso, cuerpo) => {
    const r = await POST(pedir(cuerpo));

    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: ACTUALIZA_LA_APP, actualizar: true });
    expect(getUserById).not.toHaveBeenCalled();
    sinSubir();
  });
});

describe("POST /api/upload — tipo y tamaño", () => {
  it("el tipo sale de los bytes: un PNG se sube como PNG", async () => {
    await POST(pedir({ ...CHECKIN, base64: b64(PNG) }));

    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png", filename: "checkin_0905.png" }),
    );
  });

  it.each([
    ["un texto", Buffer.from("no soy una foto")],
    ["un SVG", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")],
  ])("%s: 415, sin consultar la base", async (_caso, archivo) => {
    expect((await POST(pedir({ ...CHECKIN, base64: b64(archivo) }))).status).toBe(415);
    expect(getUserById).not.toHaveBeenCalled();
    sinSubir();
  });

  it("3 MB y un byte: 413", async () => {
    const pasada = Buffer.concat([JPEG, Buffer.alloc(TOPE_FOTO_BYTES + 1 - JPEG.length)]);

    expect((await POST(pedir({ ...CHECKIN, base64: b64(pasada) }))).status).toBe(413);
    sinSubir();
  });

  it("justo 3 MB: pasa", async () => {
    const justa = Buffer.concat([JPEG, Buffer.alloc(TOPE_FOTO_BYTES - JPEG.length)]);

    expect((await POST(pedir({ ...CHECKIN, base64: b64(justa) }))).status).toBe(200);
  });

  it("sin foto: 400", async () => {
    expect((await POST(pedir({ ...CHECKIN, base64: "" }))).status).toBe(400);
    sinSubir();
  });
});
