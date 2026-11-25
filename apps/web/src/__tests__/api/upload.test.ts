/**
 * La foto del check-in y del check-out (docs/seguridad-erp.md §3.4): quién
 * puede subir, a qué carpeta —la decide el servidor—, y qué tipo y tamaño.
 * Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/drive", () => ({ uploadPhoto: vi.fn() }));
vi.mock("@/src/lib/users", () => ({ getUserById: vi.fn() }));
vi.mock("@/src/lib/jornadas", () => ({ getJornada: vi.fn() }));
vi.mock("@/src/lib/proyectos", () => ({ getProyecto: vi.fn() }));

import { auth } from "@/src/auth";
import { uploadPhoto } from "@/src/lib/drive";
import { getUserById } from "@/src/lib/users";
import { getJornada } from "@/src/lib/jornadas";
import { getProyecto } from "@/src/lib/proyectos";
import { ACTUALIZA_LA_APP, TOPE_FOTO_BYTES } from "@/src/lib/fotos";
import { POST } from "@/app/api/upload/route";

/** `auth()` está sobrecargada en Auth.js v5; el cast deja usarla como mock simple. */
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const b64 = (b: Buffer) => b.toString("base64");

const TEMPORAL = {
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
const JORNADA = { id: "j-1", usuarioId: "u-1", proyectoId: "p-1", estado: "abierta" };
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

const CHECKIN = { tipo: "checkin", proyectoId: "p-1", base64: b64(JPEG) };
const CHECKOUT = { tipo: "checkout", jornadaId: "j-1", base64: b64(JPEG) };

/** Lo que mandaba la pantalla de antes de este PR. */
const PANTALLA_VIEJA = {
  base64: b64(JPEG),
  filename: "checkin_1530.jpg",
  mimeType: "image/jpeg",
  proyectoNombre: "Otro proyecto",
  fecha: "2026-11-25",
  trabajadorNombre: "Otra persona",
};

beforeEach(() => {
  vi.clearAllMocks();
  // 18:30 en México, 00:30 del día siguiente en UTC: el caso que antes fallaba.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T00:30:00Z"));
  mockAuth.mockResolvedValue({ user: { id: "u-1", tipo: "temporal" } });
  vi.mocked(getUserById).mockResolvedValue(TEMPORAL as never);
  vi.mocked(getProyecto).mockResolvedValue(PROYECTO as never);
  vi.mocked(getJornada).mockResolvedValue(JORNADA as never);
  vi.mocked(uploadPhoto).mockResolvedValue(SUBIDA);
});
afterEach(() => vi.useRealTimers());

const nadaTocado = () => {
  expect(uploadPhoto).not.toHaveBeenCalled();
};

describe("POST /api/upload — quién", () => {
  it("sin sesión: 401, sin tocar la base ni Drive", async () => {
    mockAuth.mockResolvedValue(null);

    expect((await POST(pedir(CHECKIN))).status).toBe(401);
    expect(getUserById).not.toHaveBeenCalled();
    nadaTocado();
  });

  // Cualquier cuenta de Google tiene sesión: así entran los temporales.
  it("un temporal con el perfil completo sí sube", async () => {
    expect((await POST(pedir(CHECKIN))).status).toBe(200);
  });

  it.each([
    ["con el perfil incompleto", { perfil_completo: false }, "Completa tu perfil"],
    ["inactivo", { activo: false }, "no está activa"],
    ["con rol cliente", { rol: "cliente" }, "no ficha en campo"],
  ])("%s: 403, sin subir", async (_caso, cambio, mensaje) => {
    vi.mocked(getUserById).mockResolvedValue({ ...TEMPORAL, ...cambio } as never);

    const r = await POST(pedir(CHECKIN));

    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain(mensaje);
    nadaTocado();
  });

  it("sin perfil en la base: 403", async () => {
    vi.mocked(getUserById).mockResolvedValue(null);

    expect((await POST(pedir(CHECKIN))).status).toBe(403);
    nadaTocado();
  });
});

describe("POST /api/upload — la carpeta la decide el servidor", () => {
  it("check-in: el proyecto y el nombre de la base, la fecha y la hora de México", async () => {
    const r = await POST(pedir(CHECKIN));

    expect(r.status).toBe(200);
    expect(uploadPhoto).toHaveBeenCalledWith({
      buffer: JPEG,
      filename: "checkin_1830.jpg",
      mimeType: "image/jpeg",
      proyectoNombre: "Subestación Norte",
      fecha: "2026-11-25",
      trabajadorNombre: "Persona de Prueba",
    });
    const cuerpo = await r.json();
    expect(cuerpo.driveFileId).toBe("drive-file-123");
    expect(cuerpo.thumbnailUrl).toContain("drive-file-123");
  });

  it("un temporal en un proyecto que no es suyo: 403, sin subir", async () => {
    const r = await POST(pedir({ ...CHECKIN, proyectoId: "p-2" }));

    expect(r.status).toBe(403);
    nadaTocado();
  });

  it("planta, en un proyecto sin asignar: sube, como en /api/jornada", async () => {
    vi.mocked(getUserById).mockResolvedValue({ ...TEMPORAL, tipo: "planta", proyectos_asignados: [] } as never);

    expect((await POST(pedir({ ...CHECKIN, proyectoId: "p-2" }))).status).toBe(200);
  });

  it("un proyecto que no existe: 404, sin subir", async () => {
    vi.mocked(getProyecto).mockResolvedValue(null);

    expect((await POST(pedir(CHECKIN))).status).toBe(404);
    nadaTocado();
  });

  it("check-out: el proyecto de su jornada, por su id", async () => {
    const r = await POST(pedir(CHECKOUT));

    expect(r.status).toBe(200);
    expect(getJornada).toHaveBeenCalledWith("j-1");
    expect(getProyecto).toHaveBeenCalledWith("p-1");
    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "checkout_1830.jpg", proyectoNombre: "Subestación Norte" }),
    );
  });

  it.each([
    ["de otra persona", { usuarioId: "u-2" }, 403],
    ["ya cerrada", { estado: "cerrada" }, 409],
  ])("check-out de una jornada %s: %i, sin subir", async (_caso, cambio, status) => {
    vi.mocked(getJornada).mockResolvedValue({ ...JORNADA, ...cambio } as never);

    expect((await POST(pedir(CHECKOUT))).status).toBe(status);
    nadaTocado();
  });

  it("check-out de una jornada que no existe: 404", async () => {
    vi.mocked(getJornada).mockResolvedValue(null);

    expect((await POST(pedir(CHECKOUT))).status).toBe(404);
    nadaTocado();
  });

  it("si Drive falla: 502", async () => {
    vi.mocked(uploadPhoto).mockRejectedValue(new Error("Drive caído"));

    const r = await POST(pedir(CHECKIN));

    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("No se pudo guardar la foto en Drive.");
  });
});

describe("POST /api/upload — una pantalla vieja", () => {
  it.each([
    ["la de antes de este PR", PANTALLA_VIEJA],
    ["con un campo de más", { ...CHECKIN, carpeta: "Proyectos/otro" }],
    ["con mimeType (el tipo sale de los bytes)", { ...CHECKIN, mimeType: "image/jpeg" }],
    ["con un tipo que no existe", { ...CHECKIN, tipo: "foto" }],
    ["check-in sin proyecto", { tipo: "checkin", base64: b64(JPEG) }],
    ["check-in con jornada", { ...CHECKIN, jornadaId: "j-1" }],
    ["check-out con proyecto", { ...CHECKOUT, proyectoId: "p-1" }],
    ["check-out sin jornada", { tipo: "checkout", base64: b64(JPEG) }],
  ])("%s: 400, «Actualiza la aplicación», sin tocar nada", async (_caso, cuerpo) => {
    const r = await POST(pedir(cuerpo));

    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: ACTUALIZA_LA_APP, actualizar: true });
    expect(getUserById).not.toHaveBeenCalled();
    nadaTocado();
  });

  it("el aviso dice qué hacer y cómo, sin nada técnico", () => {
    expect(ACTUALIZA_LA_APP).toBe("Actualiza la aplicación (cierra y vuelve a abrirla).");
  });
});

describe("POST /api/upload — tipo y tamaño", () => {
  it("el tipo sale de los bytes: un PNG se sube como PNG", async () => {
    await POST(pedir({ ...CHECKIN, base64: b64(PNG) }));

    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png", filename: "checkin_1830.png" }),
    );
  });

  it.each([
    ["un texto", Buffer.from("no soy una foto")],
    ["un SVG", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")],
    ["un GIF", Buffer.from("GIF89a\x01\x00")],
  ])("%s: 415, sin consultar la base", async (_caso, archivo) => {
    const r = await POST(pedir({ ...CHECKIN, base64: b64(archivo) }));

    expect(r.status).toBe(415);
    expect(getUserById).not.toHaveBeenCalled();
    nadaTocado();
  });

  it("más de 3 MB: 413, sin consultar la base", async () => {
    const grande = Buffer.concat([JPEG, Buffer.alloc(TOPE_FOTO_BYTES)]);

    const r = await POST(pedir({ ...CHECKIN, base64: b64(grande) }));

    expect(r.status).toBe(413);
    expect((await r.json()).error).toBe("La foto pesa más de 3 MB.");
    expect(getUserById).not.toHaveBeenCalled();
    nadaTocado();
  });

  // El base64 de 3 MB y un byte mide lo mismo que el de 3 MB: solo se nota
  // al decodificar.
  it("3 MB y un byte: 413", async () => {
    const pasada = Buffer.concat([JPEG, Buffer.alloc(TOPE_FOTO_BYTES + 1 - JPEG.length)]);

    expect((await POST(pedir({ ...CHECKIN, base64: b64(pasada) }))).status).toBe(413);
    nadaTocado();
  });

  it("justo 3 MB: pasa", async () => {
    const justa = Buffer.concat([JPEG, Buffer.alloc(TOPE_FOTO_BYTES - JPEG.length)]);

    expect((await POST(pedir({ ...CHECKIN, base64: b64(justa) }))).status).toBe(200);
  });

  it("sin foto: 400", async () => {
    expect((await POST(pedir({ ...CHECKIN, base64: "" }))).status).toBe(400);
    nadaTocado();
  });
});
