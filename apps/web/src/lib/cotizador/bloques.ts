/**
 * El contenido de una partida, por bloques.
 *
 * La descripción se guarda como **texto** en `cot_partidas.descripcion`, con
 * una marca al principio de cada renglón, igual que en Apps Script
 * (`COT_06:255-302`). Es a propósito: lo ya capturado sigue sirviendo, el
 * histórico se puede leer sin saber nada de bloques, y el día que alguien mire
 * la columna a mano ve algo legible.
 *
 *     ## Celdas SF6 Siemens 8DH10       subtítulo (negritas)
 *     >> Ejecución de pruebas…          párrafo justificado
 *     - Detección de Fuga en SF6        viñeta
 *     -- Tensión                        sub-viñeta
 *     Incluye:                          texto normal
 *     (renglón vacío)                   espacio
 *
 * Las descripciones viejas escritas a mano con "- " o "• " ya salen como
 * viñetas, que es la razón de que el lector acepte más marcas de las que
 * escribe.
 */

export type TipoBloque = "subtitulo" | "parrafo" | "vineta" | "subvineta" | "texto" | "espacio";

export interface Bloque {
  tipo: TipoBloque;
  texto: string;
}

/** Cómo se llama cada tipo en la pantalla. */
export const NOMBRE_BLOQUE: Record<TipoBloque, string> = {
  subtitulo: "Subtítulo",
  parrafo: "Párrafo",
  vineta: "Viñeta",
  subvineta: "Sub-viñeta",
  texto: "Texto",
  espacio: "Espacio",
};

/** La marca con la que se guarda cada tipo. El texto normal no lleva ninguna. */
const MARCA: Record<TipoBloque, string> = {
  subtitulo: "## ",
  parrafo: ">> ",
  vineta: "- ",
  subvineta: "-- ",
  texto: "",
  espacio: "",
};

/**
 * De la descripción guardada a los bloques que edita la pantalla.
 *
 * El orden de las pruebas importa: `--` es sub-viñeta y tiene que mirarse
 * antes que `-`, o toda sub-viñeta se leería como viñeta con un guion de más.
 */
export function bloquesDeDescripcion(descripcion: string | null | undefined): Bloque[] {
  const lineas = String(descripcion ?? "").replace(/\r/g, "").split("\n");
  while (lineas.length && !lineas[lineas.length - 1].trim()) lineas.pop();

  return lineas.map((linea) => {
    const s = linea.replace(/\s+$/, "");
    if (!s.trim()) return { tipo: "espacio" as const, texto: "" };
    // Un guion solo, sin texto: viñeta vacía. No sale en el documento, pero se
    // conserva porque alguien la dejó ahí mientras escribía.
    if (/^\s*(--|[-•·])\s*$/.test(s)) return { tipo: "vineta" as const, texto: "" };

    let m: RegExpMatchArray | null;
    if ((m = s.match(/^\s*##\s?(.*)$/))) return { tipo: "subtitulo" as const, texto: m[1] };
    if ((m = s.match(/^\s*>>\s?(.*)$/))) return { tipo: "parrafo" as const, texto: m[1] };
    if ((m = s.match(/^\s*(?:--|◦)\s*(.*)$/))) return { tipo: "subvineta" as const, texto: m[1] };
    // Sangría y guion: segundo nivel, como se escribía a mano antes de que
    // existieran los bloques.
    if ((m = s.match(/^(?:\s{2,}|\t+)[-•·]\s+(.*)$/))) return { tipo: "subvineta" as const, texto: m[1] };
    if ((m = s.match(/^\s*[-•·]\s+(.*)$/))) return { tipo: "vineta" as const, texto: m[1] };
    return { tipo: "texto" as const, texto: s.trim() };
  });
}

/**
 * De los bloques al texto que se guarda.
 *
 * Un salto de línea dentro de un bloque se vuelve espacio: cada bloque es un
 * renglón del documento, y permitir saltos dentro produciría al releer dos
 * bloques donde había uno.
 */
export function descripcionDeBloques(bloques: Bloque[] | null | undefined): string {
  return (bloques ?? [])
    .map((b) => {
      if (b.tipo === "espacio") return "";
      const texto = String(b.texto ?? "").replace(/\s*\n\s*/g, " ").trim();
      return MARCA[b.tipo] + texto;
    })
    .join("\n");
}

/**
 * Los bloques que de verdad salen en el documento.
 *
 * Una viñeta vacía y un espacio al final no se imprimen. Sirve para la vista
 * previa y para avisar de una partida que, con todo y renglones, no dice nada.
 */
export function bloquesVisibles(bloques: Bloque[]): Bloque[] {
  return bloques.filter((b) => b.tipo !== "espacio" && b.texto.trim() !== "");
}
