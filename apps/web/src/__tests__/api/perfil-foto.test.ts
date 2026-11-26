/**
 * La foto de perfil: el tipo sale de los bytes, no del `mimeType` que manda
 * el navegador. Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/drive", () => ({ uploadPhoto: vi.fn() }));
vi.mock("@/src/lib/users", () => ({ updatePerfil: vi.fn() }));

import { auth } from "@/src/auth";
import { uploadPhoto } from "@/src/lib/drive";
import { updatePerfil } from "@/src/lib/users";
import { POST } from "@/app/api/perfil/foto/route";
import { TOPE_FOTO_BYTES } from "@/src/lib/fotos";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const pedir = (cuerpo: unknown) =>
  new NextRequest("http://localhost/api/perfil/foto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u-1", name: "Persona de Prueba" } });
  vi.mocked(uploadPhoto).mockResolvedValue({ driveFileId: "f-1", webViewLink: "#", hash: "h" });
});

describe("POST /api/perfil/foto", () => {
  it("algo que no es foto, aunque diga image/jpeg: 415, sin subir ni guardar", async () => {
    const r = await POST(pedir({ base64: Buffer.from("<svg/>").toString("base64"), mimeType: "image/jpeg" }));

    expect(r.status).toBe(415);
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(updatePerfil).not.toHaveBeenCalled();
  });

  it("un PNG que dice ser JPEG se sube como PNG", async () => {
    const r = await POST(pedir({ base64: PNG.toString("base64"), mimeType: "image/jpeg" }));

    expect(r.status).toBe(200);
    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png", filename: expect.stringMatching(/\.png$/) }),
    );
  });

  it("sin mimeType también: el tipo sale de los bytes", async () => {
    await POST(pedir({ base64: PNG.toString("base64") }));

    expect(uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/png" }));
  });

  // El mismo tope que la del check-in: lo que cabe en Vercel en base64.
  it("3 MB y un byte: 413, sin subir; justo 3 MB, pasa", async () => {
    const pasada = Buffer.concat([PNG, Buffer.alloc(TOPE_FOTO_BYTES + 1 - PNG.length)]);
    expect((await POST(pedir({ base64: pasada.toString("base64") }))).status).toBe(413);
    expect(uploadPhoto).not.toHaveBeenCalled();

    const justa = Buffer.concat([PNG, Buffer.alloc(TOPE_FOTO_BYTES - PNG.length)]);
    expect((await POST(pedir({ base64: justa.toString("base64") }))).status).toBe(200);
  });

  // A las 18:30 de México, en UTC ya es el día siguiente.
  it("la carpeta y el nombre llevan la fecha de México", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T00:30:00Z"));
    try {
      await POST(pedir({ base64: PNG.toString("base64") }));
    } finally {
      vi.useRealTimers();
    }

    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ fecha: "2026-11-25", filename: "perfil-u-1-2026-11-25.png" }),
    );
  });
});
