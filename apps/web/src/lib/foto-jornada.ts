/**
 * La foto del check-in y del check-out, desde la pantalla de campo.
 *
 * - **Se comprime antes de mandarla:** lado mayor de 1600 px y JPEG al 85 %.
 *   La cámara del celular da fotos de 3 a 6 MB, y Vercel corta el cuerpo de
 *   la petición en 4.5 MB (en base64 pesa un tercio más): sin comprimir, esas
 *   fotos nunca llegaban a la ruta.
 * - **Nunca lanza.** Si la foto no sube, el check-in sigue, y lo que vuelve es
 *   el aviso para la persona: qué pasó y qué hacer, sin nada técnico.
 * - **El navegador solo dice qué es** (check-in a tal proyecto, o check-out de
 *   tal jornada). La carpeta, el nombre y la hora los pone el servidor.
 */

export const LADO_MAYOR = 1600;
export const CALIDAD_JPEG = 0.85;

export type DestinoDeFoto =
  | { tipo: "checkin"; proyectoId: string }
  | { tipo: "checkout"; jornadaId: string };

export interface FotoSubida {
  driveFileId: string;
  webViewLink: string;
  hash: string;
}

export type ResultadoDeFoto = { ok: true; foto: FotoSubida } | { ok: false; aviso: string };

type Momento = DestinoDeFoto["tipo"];
const NOMBRE: Record<Momento, string> = { checkin: "check-in", checkout: "check-out" };

const conPunto = (texto: string) => (/[.!?]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`);

/** El aviso que ve la persona cuando la foto no subió, pero lo demás sí. */
export function avisoDeFoto(momento: Momento, motivo: string): string {
  return `La foto no se subió. ${conPunto(motivo)} El ${NOMBRE[momento]} sí quedó registrado, con la foto pendiente.`;
}

/** Sin señal no se intenta: el registro espera en el teléfono y la foto no viaja. */
export function avisoSinConexion(momento: Momento): string {
  return `Sin conexión: la foto no se subió. El ${NOMBRE[momento]} se registrará al volver la señal, con la foto pendiente.`;
}

/** Lo que se dice cuando la respuesta no trae un motivo legible (p. ej. el 413 de Vercel). */
function motivoPorEstado(status: number): string {
  if (status === 413) return "La foto pesa demasiado.";
  if (status === 415) return "El archivo no es una foto JPEG, PNG o WebP.";
  if (status === 401) return "Tu sesión se cerró: vuelve a entrar.";
  if (status >= 500) return "El servidor no pudo guardarla; inténtalo más tarde.";
  return "No se pudo subir.";
}

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

/** Base64 sin `FileReader`, por trozos: una foto entera en un solo `apply` revienta la pila. */
export async function aBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = "";
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}

interface Dependencias {
  comprimir: (foto: Blob) => Promise<Blob>;
  enviar: (url: string, init: RequestInit) => Promise<Response>;
}

const DE_VERDAD: Dependencias = {
  comprimir: comprimirFoto,
  enviar: (url, init) => fetch(url, init),
};

/**
 * Comprime y sube la foto. Si no sube, devuelve el aviso; nunca lanza.
 *
 * Si no se pudo comprimir (un formato que el navegador no sabe abrir), va la
 * original, y el servidor dice si sirve.
 */
export async function subirFotoDeJornada(
  destino: DestinoDeFoto,
  foto: Blob,
  dependencias: Dependencias = DE_VERDAD,
): Promise<ResultadoDeFoto> {
  const momento = destino.tipo;
  try {
    let aSubir: Blob;
    try {
      aSubir = await dependencias.comprimir(foto);
    } catch {
      aSubir = foto;
    }

    // Fuera del `try` del envío: si esto falla, no fue la red.
    const base64 = await aBase64(aSubir);

    let respuesta: Response;
    try {
      respuesta = await dependencias.enviar("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...destino, base64 }),
      });
    } catch {
      return { ok: false, aviso: avisoDeFoto(momento, "No hubo conexión para subirla.") };
    }

    const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
    if (respuesta.ok && typeof cuerpo.driveFileId === "string") {
      return {
        ok: true,
        foto: {
          driveFileId: cuerpo.driveFileId,
          webViewLink: String(cuerpo.webViewLink ?? ""),
          hash: String(cuerpo.hash ?? ""),
        },
      };
    }
    // El motivo es el texto del servidor, ya escrito para la persona: para una
    // pantalla vieja, «Actualiza la aplicación (cierra y vuelve a abrirla).».
    const motivo =
      !respuesta.ok && typeof cuerpo.error === "string" && cuerpo.error.trim()
        ? cuerpo.error
        : motivoPorEstado(respuesta.status);
    return { ok: false, aviso: avisoDeFoto(momento, motivo) };
  } catch {
    return { ok: false, aviso: avisoDeFoto(momento, "No se pudo preparar la foto.") };
  }
}
