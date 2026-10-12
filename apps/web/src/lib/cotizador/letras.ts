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

/** Un número menor a un millón, en letra. */
function milesEnLetra(n: number): string {
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  // "MIL" y no "UN MIL": el millar solo lleva número a partir de dos mil.
  if (miles) partes.push(miles === 1 ? "MIL" : centenaEnLetra(miles) + " MIL");
  if (resto) partes.push(centenaEnLetra(resto));
  return partes.join(" ");
}

/** Lo más alto que se puede decir: 999,999,999,999.99. */
export const MONTO_MAXIMO_EN_LETRA = 999_999_999_999.99;

/**
 * El importe completo en letra.
 *
 * Los centavos van en quebrado sobre cien, que es la convención de las
 * facturas: `… PESOS 08/100 M.N.`
 *
 * **Corrige tres defectos del sistema anterior.**
 *
 * 1. Cerraba con `M.N.` también en dólares (`… DÓLARES AMERICANOS 24/100 M.N.`,
 *    `COT_05:276`). *M.N.* es **moneda nacional**: decirlo de un importe en
 *    dólares afirma dos monedas distintas en el mismo renglón.
 * 2. Se rompía en los miles de millones: `Math.floor(entero / 1000000)` daba
 *    `1000` y producía "MIL MILLÓN". Se dice **MIL MILLONES**.
 * 3. Decía "UN MILLÓN PESOS". Un millón exacto pide la preposición:
 *    **UN MILLÓN DE PESOS**.
 *
 * Y se añade el singular, que el legacy no contemplaba: **UN PESO**, no "UN
 * PESOS".
 *
 * Por encima de `MONTO_MAXIMO_EN_LETRA` lanza. Un billón en una cotización es
 * un dedazo, y escribirlo mal en el documento es peor que no escribirlo.
 */
export function importeEnLetra(monto: number, moneda: Moneda = "MXN"): string {
  // Se redondea con la MISMA función que el cálculo. Si cada uno redondeara a
  // su manera, la letra podría decir 67 centavos debajo de una cifra que dice
  // 68 — y es el renglón que existe precisamente para detectar ese desacuerdo.
  const v = redondear(Math.abs(Number(monto) || 0));

  if (v > MONTO_MAXIMO_EN_LETRA) {
    throw new Error(
      `No se puede escribir ${v} en letra: el máximo es ${MONTO_MAXIMO_EN_LETRA.toLocaleString("es-MX")}. ` +
        "Revisa el importe antes de generar el documento.",
    );
  }

  const entero = Math.floor(v);
  const centavos = Math.round((v - entero) * 100);
  const cc = String(centavos).padStart(2, "0");

  // El sustantivo va en singular solo cuando el entero es exactamente uno.
  const unidad =
    moneda === "USD" ? (entero === 1 ? "DÓLAR" : "DÓLARES") : entero === 1 ? "PESO" : "PESOS";
  const cierre = moneda === "USD" ? "/100 USD" : "/100 M.N.";

  if (entero === 0) return `CERO ${unidad} ${cc}${cierre}`;

  const millones = Math.floor(entero / 1_000_000);
  const resto = entero % 1_000_000;

  const partes: string[] = [];
  if (millones) {
    partes.push(milesEnLetra(millones) + (millones === 1 ? " MILLÓN" : " MILLONES"));
  }
  if (resto) partes.push(milesEnLetra(resto));

  // "DE" solo cuando los millones son exactos y el sustantivo los sigue de
  // inmediato: UN MILLÓN DE PESOS, pero UN MILLÓN DOSCIENTOS MIL PESOS.
  const de = millones > 0 && resto === 0 ? " DE" : "";

  return `${partes.join(" ")}${de} ${unidad} ${cc}${cierre}`;
}
