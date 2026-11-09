/**
 * Quitar del documento los renglones del bloque del destinatario que no salen.
 *
 * Se hace **antes** de sustituir los marcadores, porque el renglón se localiza
 * por el suyo: una vez sustituido ya no hay por dónde agarrarlo. Es el orden
 * del original (`COT_05:429-438`).
 *
 * ── Los índices, y por qué el orden importa ──
 *
 * `deleteContentRange` corre todos los índices posteriores, y la API aplica
 * las solicitudes en orden. Si se borrara de arriba hacia abajo, el segundo
 * rango —calculado sobre el documento original— apuntaría a otra cosa. Por eso
 * se emiten **de atrás hacia adelante**: lo que está antes no se mueve cuando
 * se borra lo de después.
 */
import type { DocumentoDocs, Rango, SolicitudBorrarRango } from "./tipos";
import { parrafos, segmentos, type ParrafoUbicado } from "./recorrido";
import type { RenglonOculto } from "./valores";

/** Cualquier marcador, para saber si el renglón todavía sirve para otro. */
const OTRO_MARCADOR = /\{+[A-Z_0-9]+\}+/;

/**
 * El último índice borrable de cada segmento.
 *
 * La API no deja borrar el salto de línea final de un segmento: el documento
 * se queda sin su último párrafo y la petición falla entera. Cuando el
 * renglón a quitar es el último, se borra su texto y se deja el salto.
 */
function finDeSegmento(doc: DocumentoDocs): Map<string, number> {
  const fuera = new Map<string, number>();
  for (const { segmentId, segmento } of segmentos(doc)) {
    const ultimo = (segmento.content ?? []).at(-1);
    if (ultimo?.endIndex !== undefined) fuera.set(segmentId, ultimo.endIndex);
  }
  return fuera;
}

/**
 * Dónde cae un marcador dentro de su párrafo, en índices del documento.
 *
 * El texto del párrafo y sus índices van uno a uno: cada carácter de un
 * `textRun` ocupa un índice, y los elementos que no son texto —una imagen
 * embebida— ocupan uno también. Para el bloque del destinatario, que es texto
 * corrido, la cuenta es exacta.
 */
function rangoDelMarcador(p: ParrafoUbicado, marcador: string): Rango | null {
  const m = new RegExp(`\\{+${marcador}\\}+`).exec(p.texto);
  if (!m) return null;
  return {
    startIndex: p.startIndex + m.index,
    endIndex: p.startIndex + m.index + m[0].length,
    ...(p.segmentId ? { segmentId: p.segmentId } : {}),
  };
}

export interface Ocultamientos {
  solicitudes: SolicitudBorrarRango[];
  /** Los que se pidieron quitar y no están en la plantilla. No es un error. */
  sinMarcador: string[];
}

/**
 * Las solicitudes para quitar los renglones que no salen.
 *
 * Dos casos, y la diferencia es del original (`COT_05:760-766`):
 *
 * - El renglón trae **solo** este marcador → se borra el párrafo entero, para
 *   que no quede un renglón en blanco en la carta.
 * - El renglón trae **otro** marcador —teléfono y correo juntos en la misma
 *   línea— → se borra solo el texto de este. El renglón se queda para el otro.
 */
export function ocultarRenglones(
  doc: DocumentoDocs,
  ocultos: RenglonOculto[],
): Ocultamientos {
  const todos = parrafos(doc);
  const fin = finDeSegmento(doc);
  const rangos: Rango[] = [];
  const sinMarcador: string[] = [];

  for (const { marcador } of ocultos) {
    const conEl = todos.filter((p) => new RegExp(`\\{+${marcador}\\}+`).test(p.texto));
    if (conEl.length === 0) {
      sinMarcador.push(marcador);
      continue;
    }

    for (const p of conEl) {
      const resto = p.texto.replace(new RegExp(`\\{+${marcador}\\}+`), "");
      if (OTRO_MARCADOR.test(resto)) {
        const r = rangoDelMarcador(p, marcador);
        if (r) rangos.push(r);
        continue;
      }

      // El párrafo entero, sin pasarse del final del segmento.
      const tope = fin.get(p.segmentId) ?? p.endIndex;
      const endIndex = Math.min(p.endIndex, tope - 1);
      if (endIndex <= p.startIndex) continue; // no queda nada que borrar
      rangos.push({
        startIndex: p.startIndex,
        endIndex,
        ...(p.segmentId ? { segmentId: p.segmentId } : {}),
      });
    }
  }

  // De atrás hacia adelante. Dentro del mismo segmento, el de índice más alto
  // primero; entre segmentos da igual, porque sus índices son independientes.
  rangos.sort((a, b) => b.startIndex - a.startIndex);

  return {
    solicitudes: rangos.map((range) => ({ deleteContentRange: { range } })),
    sinMarcador,
  };
}
