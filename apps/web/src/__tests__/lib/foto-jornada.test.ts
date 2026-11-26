/**
 * Las fotos de la app de campo, en el navegador: las medidas de la
 * compresión, la original cuando no se puede comprimir, y el base64.
 */
import { describe, it, expect } from "vitest";
import { aBase64, bytesABase64, medidasReducidas, prepararFoto } from "@/src/lib/foto-jornada";

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

describe("prepararFoto", () => {
  const ORIGINAL = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: "image/jpeg" });

  it("devuelve la comprimida", async () => {
    const comprimida = new Blob([new Uint8Array([9])]);
    expect(await prepararFoto(ORIGINAL, async () => comprimida)).toBe(comprimida);
  });

  // Un formato que el navegador no sabe abrir (HEIC en algunos Android).
  it("si no se pudo comprimir, la original", async () => {
    expect(
      await prepararFoto(ORIGINAL, async () => {
        throw new Error("no se pudo decodificar");
      }),
    ).toBe(ORIGINAL);
  });
});

describe("base64", () => {
  // Más de un trozo: una foto entera en un solo `apply` revienta la pila.
  it("igual que el de Node, también en fotos de varios trozos", async () => {
    const datos = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    const esperado = Buffer.from(datos).toString("base64");

    expect(bytesABase64(datos)).toBe(esperado);
    expect(await aBase64(new Blob([datos]))).toBe(esperado);
  });
});
