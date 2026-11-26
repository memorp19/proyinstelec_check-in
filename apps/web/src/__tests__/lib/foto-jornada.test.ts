/**
 * La foto desde la pantalla de campo: se comprime, viaja solo con lo que el
 * servidor pide, y si no sube vuelve un aviso legible. Nunca tumba el check-in.
 */
import { describe, it, expect, vi } from "vitest";
import {
  aBase64,
  avisoSinConexion,
  medidasReducidas,
  subirFotoDeJornada,
} from "@/src/lib/foto-jornada";

const ORIGINAL = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: "image/jpeg" });
const COMPRIMIDA = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9])], { type: "image/jpeg" });
const SUBIDA = { driveFileId: "f-1", webViewLink: "https://drive/f-1", hash: "h" };

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

function dependencias(respuesta: Response | Error, comprimir?: (b: Blob) => Promise<Blob>) {
  const enviar = vi.fn(async () => {
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  });
  return { comprimir: comprimir ?? (async () => COMPRIMIDA), enviar };
}

const cuerpoEnviado = (enviar: ReturnType<typeof vi.fn>) =>
  JSON.parse((enviar.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

describe("medidasReducidas", () => {
  it("horizontal y vertical: el lado mayor a 1600", () => {
    expect(medidasReducidas(4000, 3000)).toEqual({ ancho: 1600, alto: 1200 });
    expect(medidasReducidas(3000, 4000)).toEqual({ ancho: 1200, alto: 1600 });
  });

  it("una chica no se agranda", () => {
    expect(medidasReducidas(800, 600)).toEqual({ ancho: 800, alto: 600 });
    expect(medidasReducidas(1600, 900)).toEqual({ ancho: 1600, alto: 900 });
  });
});

describe("aBase64", () => {
  // Más de un trozo: una foto entera en un solo `apply` revienta la pila.
  it("igual que el de Node, también en fotos de varios trozos", async () => {
    const datos = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(await aBase64(new Blob([datos]))).toBe(Buffer.from(datos).toString("base64"));
  });
});

describe("subirFotoDeJornada", () => {
  it("check-in: manda la comprimida, solo con el tipo y el proyecto", async () => {
    const d = dependencias(json(SUBIDA));

    const r = await subirFotoDeJornada({ tipo: "checkin", proyectoId: "p-1" }, ORIGINAL, d);

    expect(r).toEqual({ ok: true, foto: SUBIDA });
    expect(d.enviar).toHaveBeenCalledWith("/api/upload", expect.objectContaining({ method: "POST" }));
    expect(cuerpoEnviado(d.enviar)).toEqual({
      tipo: "checkin",
      proyectoId: "p-1",
      base64: Buffer.from([0xff, 0xd8, 0xff, 9]).toString("base64"),
    });
  });

  it("check-out: la jornada, no el proyecto", async () => {
    const d = dependencias(json(SUBIDA));

    await subirFotoDeJornada({ tipo: "checkout", jornadaId: "j-1" }, ORIGINAL, d);

    expect(Object.keys(cuerpoEnviado(d.enviar)).sort()).toEqual(["base64", "jornadaId", "tipo"]);
  });

  it("si no se pudo comprimir, va la original", async () => {
    const d = dependencias(json(SUBIDA), async () => {
      throw new Error("el navegador no abre HEIC");
    });

    await subirFotoDeJornada({ tipo: "checkin", proyectoId: "p-1" }, ORIGINAL, d);

    expect(cuerpoEnviado(d.enviar).base64).toBe(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]).toString("base64"));
  });

  it("pantalla vieja: el aviso pide actualizar, sin nada técnico", async () => {
    const d = dependencias(json({ error: "Actualiza la aplicación (cierra y vuelve a abrirla).", actualizar: true }, 400));

    const r = await subirFotoDeJornada({ tipo: "checkin", proyectoId: "p-1" }, ORIGINAL, d);

    expect(r).toEqual({
      ok: false,
      aviso:
        "La foto no se subió. Actualiza la aplicación (cierra y vuelve a abrirla). " +
        "El check-in sí quedó registrado, con la foto pendiente.",
    });
  });

  it("un rechazo del servidor: su motivo, con punto, y que el registro sí quedó", async () => {
    const d = dependencias(json({ error: "No tienes acceso a este proyecto" }, 403));

    const r = await subirFotoDeJornada({ tipo: "checkout", jornadaId: "j-1" }, ORIGINAL, d);

    expect(r).toEqual({
      ok: false,
      aviso:
        "La foto no se subió. No tienes acceso a este proyecto. " +
        "El check-out sí quedó registrado, con la foto pendiente.",
    });
  });

  // El 413 de Vercel no trae JSON: la petición ni llegó a la ruta.
  it("una respuesta sin JSON: el motivo por el código", async () => {
    const d = dependencias(new Response("Request Entity Too Large", { status: 413 }));

    const r = await subirFotoDeJornada({ tipo: "checkin", proyectoId: "p-1" }, ORIGINAL, d);

    expect(r.ok).toBe(false);
    expect(!r.ok && r.aviso).toContain("La foto pesa demasiado.");
  });

  it("sin red a la mitad: no lanza, avisa", async () => {
    const d = dependencias(new TypeError("Failed to fetch"));

    const r = await subirFotoDeJornada({ tipo: "checkin", proyectoId: "p-1" }, ORIGINAL, d);

    expect(!r.ok && r.aviso).toContain("No hubo conexión para subirla.");
  });

  it("aunque todo falle al prepararla, no lanza", async () => {
    const d = dependencias(json(SUBIDA), async () => ({}) as Blob);

    const r = await subirFotoDeJornada({ tipo: "checkin", proyectoId: "p-1" }, ORIGINAL, d);

    expect(!r.ok && r.aviso).toContain("No se pudo preparar la foto.");
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it("un 200 sin el id de Drive no cuenta como subida", async () => {
    const d = dependencias(json({}));

    expect((await subirFotoDeJornada({ tipo: "checkin", proyectoId: "p-1" }, ORIGINAL, d)).ok).toBe(false);
  });
});

describe("avisoSinConexion", () => {
  it("dice que el registro espera a la señal y la foto queda pendiente", () => {
    expect(avisoSinConexion("checkin")).toBe(
      "Sin conexión: la foto no se subió. El check-in se registrará al volver la señal, con la foto pendiente.",
    );
  });
});
