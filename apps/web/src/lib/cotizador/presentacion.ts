/**
 * Cómo se escriben las cosas en lo que ve el cliente.
 *
 * No es cosmética: un renglón que dice "2.0000 servicio" en un documento que
 * va a una dirección de compras se lee como un error del proveedor. Los PDF
 * reales dicen "2 Servicios", y aquí está esa regla, en un solo lugar y
 * probada, para que la vista previa y el PDF digan lo mismo.
 */

/**
 * La cantidad como se imprime.
 *
 * Entera, sin decimales: la columna guarda `numeric(18,6)` y `2` vuelve como
 * `2.000000`. Fraccionaria, con los decimales que de verdad tenga y no con los
 * seis de la columna.
 */
export function cantidadParaDocumento(cantidad: number): string {
  if (!Number.isFinite(cantidad)) return "0";
  if (Number.isInteger(cantidad)) return cantidad.toLocaleString("es-MX");
  return cantidad.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 4 });
}

/** Las que no siguen la regla general. Son pocas y conviene tenerlas a la vista. */
const PLURALES: Record<string, string> = {
  mes: "meses",
  lote: "lotes",
  pza: "pzas",
  pz: "pzs",
};
const SINGULARES: Record<string, string> = Object.fromEntries(
  Object.entries(PLURALES).map(([uno, varios]) => [varios, uno]),
);

const VOCALES = /[aeiouáéíóú]$/i;

/**
 * El plural de una unidad en español, para las palabras que se usan aquí:
 * servicio, pieza, juego, estudio, lote, mes, nodo, unidad.
 *
 * Termina en vocal, se le suma `s`; en consonante, `es`. No pretende cubrir el
 * idioma —"lunes" no cambia, "lápiz" hace "lápices"— y por eso las excepciones
 * que de verdad aparecen están arriba, en una tabla que se lee.
 */
function enPlural(unidad: string): string {
  const u = unidad.trim();
  if (!u) return u;
  const excepcion = PLURALES[u.toLowerCase()];
  if (excepcion) return excepcion;
  if (yaEsPlural(u)) return u;
  return VOCALES.test(u) ? `${u}s` : `${u}es`;
}

function enSingular(unidad: string): string {
  const u = unidad.trim();
  const excepcion = SINGULARES[u.toLowerCase()];
  if (excepcion) return excepcion;
  if (!yaEsPlural(u)) return u;
  // "servicios" → "servicio"; "unidades" → "unidad".
  if (/[^aeiouáéíóú]es$/i.test(u)) return u.slice(0, -2);
  return u.slice(0, -1);
}

/**
 * Si la unidad ya viene en plural.
 *
 * Importa porque el catálogo y las cotizaciones viejas las guardan de las dos
 * maneras —la 068 dice "servicios"— y pluralizar lo ya plural daría
 * "servicioss". Una palabra corta terminada en `s` (mes, lunes) no cuenta: no
 * hay forma de distinguirlas sin un diccionario, así que se dejan quietas.
 */
function yaEsPlural(unidad: string): boolean {
  const u = unidad.toLowerCase();
  if (u.length <= 3) return false;
  return u.endsWith("s");
}

const conMayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/**
 * La unidad como sale en el documento: con mayúscula inicial, en singular si la
 * cantidad es 1 y en plural si no.
 *
 * "1 Servicio", "2 Servicios", "57 Servicios", "1 Lote", "6 Meses". Una
 * cantidad fraccionaria va en plural: "1.5 Servicios".
 */
export function unidadParaDocumento(unidad: string | null | undefined, cantidad: number): string {
  const u = String(unidad ?? "").trim();
  if (!u) return "";
  return conMayuscula(cantidad === 1 ? enSingular(u) : enPlural(u));
}

/** Cantidad y unidad juntas, que es como se leen: "57 Servicios". */
export function cantidadConUnidad(cantidad: number, unidad: string | null | undefined): string {
  const u = unidadParaDocumento(unidad, cantidad);
  return u ? `${cantidadParaDocumento(cantidad)} ${u}` : cantidadParaDocumento(cantidad);
}

/**
 * El teléfono como va en la carta: `7751104791` → `+ (52) 775 110 4791`.
 *
 * Es el formato del ERP viejo (`COT_06:305`), y se respeta porque el documento
 * tiene que salir igual. Lo que ya trae `+` se deja como está: alguien lo
 * escribió a propósito, y puede ser de otro país.
 */
export function telefonoParaDocumento(telefono: string | null | undefined): string {
  const s = String(telefono ?? "").trim();
  if (!s || s.includes("+")) return s;

  let d = s.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  if (d.length !== 10) return s;

  // Las cuatro ciudades con lada de dos dígitos; el resto la tiene de tres.
  if (/^(55|56|33|81)/.test(d)) {
    return `+ (52) ${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  }
  return `+ (52) ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
