/**
 * Poner en negro lo que la plantilla trae en rojo.
 *
 * ── Por qué hace falta ──
 *
 * La plantilla marca en **rojo** todo lo que hay que llenar: la carta, el
 * destinatario, el título, los dos párrafos de Actividades Generales y las 23
 * normas. Son 41 tramos de texto y 26 viñetas. Es una convención del
 * documento, no un descuido.
 *
 * Apps Script lo pone todo en negro al generar, así que **ningún documento
 * real tiene rojo**. Nosotros heredábamos el de la plantilla en todo lo que
 * está fuera del cuadro de partidas —el cuadro sí se pinta—, de modo que el
 * PDF salía casi entero en rojo.
 *
 * ── Por qué tramo por tramo y no de un brochazo ──
 *
 * Un `updateTextStyle` sobre el documento entero sería una sola solicitud,
 * pero pintaría también lo que está en azul a propósito —los enlaces—, que en
 * los documentos reales **sí** se quedan azules. Se buscan los tramos rojos y
 * se pintan esos.
 *
 * Son solicitudes de estilo: no mueven un solo índice. Van **al principio del
 * lote**, cuando los índices del JSON original siguen siendo válidos; lo que
 * se inserte después hereda el color de lo que tiene al lado, que para
 * entonces ya es negro.
 */
import { parrafos, type ParrafoUbicado } from "./recorrido";
import { segmentos } from "./recorrido";
import type { DocumentoDocs, EstiloTexto, Rango, SolicitudEstiloTexto } from "./tipos";

const NEGRO = { color: { rgbColor: { red: 0, green: 0, blue: 0 } } };

/**
 * Si un color es "rojo" para esto.
 *
 * Por umbral y no por igualdad exacta con `#FF0000`: la plantilla usa ese
 * tono hoy, pero quien edite un renglón a mano acabará eligiendo otro rojo
 * del selector, y un rojo distinto saldría impreso igual de mal.
 */
export function esRojo(estilo: EstiloTexto | undefined): boolean {
  const c = estilo?.foregroundColor?.color?.rgbColor;
  if (!c) return false;
  const { red = 0, green = 0, blue = 0 } = c;
  return red >= 0.5 && green <= 0.3 && blue <= 0.3;
}

/** El último índice al que se puede llegar en cada segmento. */
function topeDeSegmento(doc: DocumentoDocs): Map<string, number> {
  const fuera = new Map<string, number>();
  for (const { segmentId, segmento } of segmentos(doc)) {
    const ultimo = (segmento.content ?? []).at(-1);
    if (ultimo?.endIndex !== undefined) fuera.set(segmentId, ultimo.endIndex);
  }
  return fuera;
}

const conSegmento = (r: Rango, segmentId: string): Rango =>
  segmentId ? { ...r, segmentId } : r;

/**
 * Los tramos rojos del documento, ya en negro.
 *
 * Incluye el párrafo completo cuando la **viñeta** es la que está en rojo: el
 * glifo toma su color de `bullet.textStyle`, y la API no tiene una solicitud
 * para cambiarlo. Pintar el párrafo entero es lo único que se puede intentar
 * desde aquí; si alguna viñeta se resiste, se arregla en la plantilla.
 */
export function solicitudesDeNegro(doc: DocumentoDocs): SolicitudEstiloTexto[] {
  const tope = topeDeSegmento(doc);
  const fuera: SolicitudEstiloTexto[] = [];

  const pintar = (rango: Rango) => {
    if (rango.endIndex <= rango.startIndex) return;
    fuera.push({
      updateTextStyle: {
        range: rango,
        textStyle: { foregroundColor: NEGRO },
        fields: "foregroundColor",
      },
    });
  };

  const limite = (p: ParrafoUbicado) => Math.min(p.endIndex, (tope.get(p.segmentId) ?? p.endIndex) - 1);

  for (const p of parrafos(doc)) {
    if (esRojo(p.parrafo.bullet?.textStyle)) {
      // El párrafo entero, con su marca de fin: es donde vive la viñeta.
      pintar(conSegmento({ startIndex: p.startIndex, endIndex: limite(p) }, p.segmentId));
      continue;
    }
    for (const el of p.parrafo.elements ?? []) {
      if (!el.textRun || !esRojo(el.textRun.textStyle)) continue;
      const startIndex = el.startIndex ?? 0;
      const endIndex = Math.min(el.endIndex ?? 0, (tope.get(p.segmentId) ?? 0) - 1);
      pintar(conSegmento({ startIndex, endIndex }, p.segmentId));
    }
  }

  return fuera;
}
