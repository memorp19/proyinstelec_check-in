/**
 * La nota para quien revisa una cotización.
 *
 * Un recado de quien manda la cotización a revisión: «el cliente pidió el
 * precio sin viáticos», «es la tercera versión, cambió solo la partida 2».
 *
 * ── Dónde vive, y dónde no ──
 *
 * **Solo en el correo y en la bitácora.** No se guarda en la cotización, no
 * entra al armado y no llega al documento ni al PDF. Es la regla del ERP viejo
 * (paquete del 13 nov 2026), y es lo que la hace útil: quien la escribe sabe
 * que el cliente no la va a leer, así que escribe lo que de verdad le quiere
 * decir al revisor.
 *
 * ── Por qué está en su propio archivo ──
 *
 * Lo necesitan las dos orillas: la pantalla, para no dejar teclear de más, y el
 * servidor, para recortar lo que llegue. `cotizaciones-flujos` no sirve de
 * casa común porque arrastra la base y el correo, y eso no puede entrar al
 * bundle del navegador.
 */

/**
 * Lo más largo que puede medir la nota.
 *
 * Es el límite del ERP viejo. No es una restricción técnica: una nota de tres
 * páginas no se lee, y lo que necesita tres páginas va en la cotización y no
 * en un recado que no queda en el documento.
 */
export const LARGO_MAXIMO_NOTA = 1500;

/**
 * La nota lista para usarse.
 *
 * Se recorta en vez de rechazarse: quien escribió de más no pierde el envío a
 * revisión por eso. Lo que no es texto —un número, o un objeto de un cuerpo
 * armado a mano— se trata como si no hubiera nota.
 */
export function notaParaRevisor(crudo: unknown): string {
  if (typeof crudo !== "string") return "";
  return crudo.trim().slice(0, LARGO_MAXIMO_NOTA);
}
