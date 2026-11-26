/**
 * Las fotos de la app de campo, en el navegador: comprimirlas y pasarlas a
 * base64.
 *
 * **Se comprimen antes de guardarlas o mandarlas:** lado mayor de 1600 px y
 * JPEG al 85 %, unos 300 a 600 KB. La cámara del celular da fotos de 3 a 6 MB,
 * y Vercel corta el cuerpo de la petición en 4.5 MB (en base64 pesa un tercio
 * más): sin comprimir, esas fotos nunca llegaban. Además, así ocupan poco en
 * la cola del teléfono mientras esperan señal.
 *
 * Lo usan la foto del check-in y del check-out (que viajan por la cola,
 * `sync-queue.ts`) y la foto de perfil.
 */

export const LADO_MAYOR = 1600;
export const CALIDAD_JPEG = 0.85;

/** Las medidas con el lado mayor en `ladoMayor`, sin agrandar nunca una foto chica. */
export function medidasReducidas(
  ancho: number,
  alto: number,
  ladoMayor: number = LADO_MAYOR,
): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= ladoMayor) return { ancho, alto };
  const factor = ladoMayor / mayor;
  return { ancho: Math.max(1, Math.round(ancho * factor)), alto: Math.max(1, Math.round(alto * factor)) };
}

/**
 * Comprime en el navegador. Se dibuja con un `<img>` porque los navegadores
 * de hoy aplican al dibujarlo la orientación que trae la foto (EXIF): así la
 * foto de un celular en vertical no sale acostada.
 */
export async function comprimirFoto(foto: Blob): Promise<Blob> {
  const url = URL.createObjectURL(foto);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const { ancho, alto } = medidasReducidas(img.naturalWidth, img.naturalHeight);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    if (!ctx) throw new Error("Sin lienzo");
    // Fondo blanco: un PNG con transparencia saldría negro en JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(img, 0, 0, ancho, alto);
    return await new Promise<Blob>((resolver, rechazar) =>
      lienzo.toBlob(
        (b) => (b ? resolver(b) : rechazar(new Error("No se pudo comprimir"))),
        "image/jpeg",
        CALIDAD_JPEG,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * La foto lista para guardar o mandar: comprimida, o la original si el
 * navegador no sabe abrir ese formato (el servidor dirá si sirve).
 */
export async function prepararFoto(
  foto: Blob,
  comprimir: (foto: Blob) => Promise<Blob> = comprimirFoto,
): Promise<Blob> {
  try {
    return await comprimir(foto);
  } catch {
    return foto;
  }
}

/** Base64 sin `FileReader`, por trozos: una foto entera en un solo `apply` revienta la pila. */
export function bytesABase64(bytes: Uint8Array): string {
  let binario = "";
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}

export async function aBase64(blob: Blob): Promise<string> {
  return bytesABase64(new Uint8Array(await blob.arrayBuffer()));
}
