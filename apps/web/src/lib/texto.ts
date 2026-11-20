/**
 * Puntuación de los textos que alguien teclea.
 *
 * La regla de esta casa es una sola y está probada aquí: **si el texto ya
 * termina en punto, no se le pone otro**. Casi todas las razones sociales
 * acaban en "S.A. de C.V." y el sistema viejo imprime "C.V.." en todas —en el
 * documento, en los correos y en la pantalla—. Copiar esa errata a propósito
 * no tiene defensa.
 *
 * Vive aquí, suelta y sin dependencias, porque la usan el generador del
 * documento y los correos del ERP: tenerla escrita dos veces es tenerla
 * arreglada en una sola el día que cambie.
 */

/** ¿El texto ya trae su punto final? (También "etc..." o "C.V."). */
export function terminaEnPunto(texto: string): boolean {
  return /\.$/.test(texto.trim());
}

/**
 * El texto con su punto final, puesto una sola vez.
 *
 * Un texto vacío se queda vacío: un punto solo no es una frase, y en un correo
 * se leería como un renglón roto.
 */
export function conPuntoFinal(texto: string): string {
  const limpio = texto.trim();
  if (!limpio) return "";
  return terminaEnPunto(limpio) ? limpio : `${limpio}.`;
}
