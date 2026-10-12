/**
 * El importe en letra, como lo exige el documento.
 *
 * Nunca se escribe a mano: es el renglón que el cliente compara contra la cifra
 * y el que un revisor usa para detectar un dedazo. En los PDF reales hay al
 * menos dos con la letra equivocada —la 068 y la 269—, que es exactamente lo
 * que una función pura evita.
 */
import { redondear } from "./calculo";
import type { Moneda } from "./tipos";

const UNIDADES = [
  "", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS",
  "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE",
];

/** El hueco del veinte lo cubre `VEINTIS`, que va pegado. */
const DECENAS = [
  "", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA",
  "OCHENTA", "NOVENTA",
];

/**
 * Del veintiuno al veintinueve se escriben en una sola palabra, y cuatro llevan
 * acento: veintiún, veintidós, veintitrés y veintiséis.
 *
 * El sistema anterior los armaba con `'VEINTI' + UNIDADES[u]`, lo que daba
 * VEINTIUN y VEINTIDOS sin acento (`COT_05:243`, donde además hay un
 * `.toLowerCase().toUpperCase()` que no hace nada). Van escritos.
 */
const VEINTIS = [
  "", "VEINTIÚN", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO",
  "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];

const CENTENAS = [
  "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
];

/**
 * Un número de hasta tres cifras, en letra.
 *
 * `UNIDADES[1]` es "UN" y no "UNO" a propósito: el número siempre va pegado a
 * un sustantivo ("CUATROCIENTOS NOVENTA Y UN PESOS"), nunca suelto.
 */
export function centenaEnLetra(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";

  const c = Math.floor(n / 100);
  const resto = n % 100;
  let texto = CENTENAS[c] ?? "";

  if (resto) {
    if (texto) texto += " ";
    if (resto <= 20) {
      texto += UNIDADES[resto];
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      // El veintipico va pegado y con su acento; del treinta en adelante, con Y.
      texto += d === 2 ? (u ? VEINTIS[u] : "VEINTE") : DECENAS[d] + (u ? " Y " + UNIDADES[u] : "");
    }
  }
  return texto;
}

/**
 * El importe completo en letra.
 *
 * Los centavos van en quebrado sobre cien, que es la convención de las
 * facturas: `… PESOS 08/100 M.N.`
 *
 * **Corrige un defecto del sistema anterior**, que cerraba con `M.N.` también
 * en dólares (`… DÓLARES AMERICANOS 24/100 M.N.`, `COT_05:276`). M.N. es
 * *moneda nacional*: decirlo de un importe en dólares afirma dos monedas
 * distintas en el mismo renglón. Aquí los dólares cierran con `USD`.
 */
export function importeEnLetra(monto: number, moneda: Moneda = "MXN"): string {
  // Se redondea con la MISMA función que el cálculo. Si cada uno redondeara a
  // su manera, la letra podría decir 67 centavos debajo de una cifra que dice
  // 68 — y es el renglón que existe precisamente para detectar ese desacuerdo.
  const v = redondear(Math.abs(Number(monto) || 0));
  const entero = Math.floor(v);
  const centavos = Math.round((v - entero) * 100);
  const cc = String(centavos).padStart(2, "0");

  const sufijo =
    moneda === "USD" ? " DÓLARES " + cc + "/100 USD" : " PESOS " + cc + "/100 M.N.";

  if (entero === 0) return "CERO" + sufijo;

  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  const partes: string[] = [];
  // "UN MILLÓN" y no "UN MILLONES"; "MIL" y no "UN MIL".
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : centenaEnLetra(millones) + " MILLONES");
  if (miles) partes.push(miles === 1 ? "MIL" : centenaEnLetra(miles) + " MIL");
  if (resto) partes.push(centenaEnLetra(resto));

  return partes.join(" ") + sufijo;
}
