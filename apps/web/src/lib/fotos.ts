/**
 * Las fotos que sube la app de campo (check-in, check-out y perfil): qué tipos
 * se aceptan, cuánto pueden pesar y cómo se llaman.
 *
 * Sin dependencias de Node ni del navegador: lo usan las rutas y la pantalla.
 */

/** Los tipos que se aceptan, reconocidos por sus bytes. */
export type TipoDeFoto = "image/jpeg" | "image/png" | "image/webp";

export const EXTENSION_DE_FOTO: Record<TipoDeFoto, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * El tope, ya decodificada.
 *
 * Vercel corta el cuerpo de una petición en 4.5 MB, y la foto viaja en base64,
 * que pesa un tercio más: 3 MB son unos 4 MB de texto. Con más, la petición ni
 * llega a la ruta. La pantalla comprime a 1600 px (unos 300 a 600 KB), así que
 * esto solo lo alcanza algo que no pasó por ella.
 */
export const TOPE_FOTO_BYTES = 3 * 1024 * 1024;

/** El largo máximo del base64 que puede caber en `TOPE_FOTO_BYTES`. */
export const TOPE_FOTO_BASE64 = Math.ceil(TOPE_FOTO_BYTES / 3) * 4;

/**
 * Lo que contesta el servidor a una pantalla vieja, y lo que ve la gente.
 * Sin nada técnico: lo que tiene que hacer y cómo.
 */
export const ACTUALIZA_LA_APP = "Actualiza la aplicación (cierra y vuelve a abrirla).";

const empiezaCon = (bytes: Uint8Array, firma: number[], desde = 0) =>
  bytes.length >= desde + firma.length && firma.every((b, i) => bytes[desde + i] === b);

/**
 * El tipo de una foto por sus primeros bytes, o `null` si no es JPEG, PNG ni
 * WebP.
 *
 * El navegador manda el tipo que él cree, y ese dato lo controla quien llama:
 * por eso no se usa. Un archivo que no empieza como imagen no se sube, diga lo
 * que diga.
 */
export function tipoDeFoto(bytes: Uint8Array): TipoDeFoto | null {
  if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF, cuatro bytes de tamaño, y WEBP.
  if (empiezaCon(bytes, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

/** `checkin_0915.jpg`: el momento, la hora de México y la extensión del tipo real. */
export function nombreDeFoto(momento: "checkin" | "checkout", hhmm: string, tipo: TipoDeFoto): string {
  return `${momento}_${hhmm}.${EXTENSION_DE_FOTO[tipo]}`;
}
