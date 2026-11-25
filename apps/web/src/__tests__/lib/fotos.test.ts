/**
 * Las fotos de campo: el tipo por sus bytes, el tope que cabe en Vercel, y la
 * fecha y la hora de México en el nombre y la carpeta.
 */
import { describe, it, expect } from "vitest";
import {
  TOPE_FOTO_BASE64,
  ahoraEnMexico,
  nombreDeFoto,
  tipoDeFoto,
} from "@/src/lib/fotos";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("tipoDeFoto: por los bytes, no por lo que diga el navegador", () => {
  it("JPEG", () => expect(tipoDeFoto(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg"));
  it("PNG", () =>
    expect(tipoDeFoto(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png"));
  it("WebP", () => expect(tipoDeFoto(ascii("RIFF\x10\x00\x00\x00WEBPVP8 "))).toBe("image/webp"));

  it.each([
    ["GIF", ascii("GIF89a...")],
    ["un WAV (RIFF que no es WebP)", ascii("RIFF\x10\x00\x00\x00WAVEfmt ")],
    ["un SVG", ascii("<svg xmlns=")],
    ["un HTML", ascii("<!doctype html>")],
    ["un PDF", ascii("%PDF-1.7")],
    ["dos bytes de JPEG y nada más", bytes(0xff, 0xd8)],
    ["nada", bytes()],
  ])("%s: no", (_nombre, b) => expect(tipoDeFoto(b)).toBeNull());
});

describe("el tope", () => {
  // Vercel corta el cuerpo en 4.5 MB: el base64 más grande que se acepta,
  // con el resto del JSON, tiene que caber.
  it("el base64 más grande que se acepta cabe en el cuerpo que deja pasar Vercel", () => {
    expect(TOPE_FOTO_BASE64 + 200).toBeLessThan(4_500_000);
  });
});

describe("ahoraEnMexico", () => {
  it("de día: la misma fecha, seis horas menos", () => {
    expect(ahoraEnMexico(new Date("2026-11-25T15:09:00Z"))).toEqual({ fecha: "2026-11-25", hhmm: "0909" });
  });

  // El hueco de antes: en UTC ya es el día 26 y el archivo se llamaba _0030.
  it("después de las 18:00 sigue siendo el mismo día en México", () => {
    expect(ahoraEnMexico(new Date("2026-11-26T00:30:00Z"))).toEqual({ fecha: "2026-11-25", hhmm: "1830" });
  });

  // Desde 2022 México no cambia de horario: en verano también son seis horas.
  it("en verano también: sin horario de verano", () => {
    expect(ahoraEnMexico(new Date("2026-07-01T05:59:00Z"))).toEqual({ fecha: "2026-06-30", hhmm: "2359" });
  });

  it("la medianoche es 0000, no 2400", () => {
    expect(ahoraEnMexico(new Date("2026-11-25T06:00:00Z")).hhmm).toBe("0000");
  });
});

describe("nombreDeFoto", () => {
  it("el momento, la hora de México y la extensión del tipo real", () => {
    expect(nombreDeFoto("checkin", "0909", "image/jpeg")).toBe("checkin_0909.jpg");
    expect(nombreDeFoto("checkout", "1830", "image/png")).toBe("checkout_1830.png");
    expect(nombreDeFoto("checkin", "0700", "image/webp")).toBe("checkin_0700.webp");
  });
});
