/**
 * Los marcadores de la plantilla: `{{CLIENTE}}`, `{{FOLIO}}`, …
 *
 * ── Por qué esto se escanea en vez de usar una expresión regular ──
 *
 * El original sustituye con `replaceText('\\{+CLIENTE\\}+', v)`: una regex que
 * acepta **cualquier número de llaves**, para que una plantilla con
 * `{{{{CLIENTE}}}}` no deje llaves a la vista (`COT_05:438-453`).
 *
 * La API de Docs no tiene eso: `replaceAllText` solo compara **texto
 * literal**. Pero como aquí tenemos el documento entero en JSON, se puede
 * hacer algo mejor que imitar la regex: **mirar qué formas existen de verdad**
 * en la plantilla y emitir una sustitución literal por cada una.
 *
 * Sale más simple, y de paso el aviso de "este marcador no está en la
 * plantilla" deja de ser una comprobación aparte: es lo que no encontró el
 * mismo barrido.
 */
import type { DocumentoDocs, SolicitudReemplazarTexto } from "./tipos";
import { textoDelDocumento } from "./recorrido";

/** Los marcadores que la plantilla puede traer, y de dónde sale cada uno. */
export const MARCADORES = [
  "CLIENTE",
  "FOLIO",
  "FECHA",
  "TITULO",
  "SITIO",
  "CONTACTO",
  "TELEFONO",
  "EMAIL",
  "DIRECCION_1",
  "DIRECCION_2",
  "PAGO",
  "ENTREGA",
  "LUGAR",
  "VIGENCIA",
] as const;

export type Marcador = (typeof MARCADORES)[number];

/**
 * Los que se avisan si faltan.
 *
 * No todos: `DIRECCION_2` puede no estar y no pasa nada, y `SITIO` el
 * original ni siquiera lo exige —tiene un respaldo por texto—. Avisar de los
 * catorce llenaría la vista previa de ruido que nadie puede accionar.
 */
export const MARCADORES_EXIGIDOS: readonly Marcador[] = [
  "CLIENTE",
  "FOLIO",
  "FECHA",
  "TITULO",
  "CONTACTO",
  "PAGO",
  "ENTREGA",
  "LUGAR",
];

/** Las formas literales de un marcador que hay en el texto, de más llaves a menos. */
export function formasEnTexto(texto: string, marcador: string): string[] {
  const re = new RegExp(`\\{+${marcador}\\}+`, "g");
  const vistas = new Set<string>();
  for (const m of texto.matchAll(re)) vistas.add(m[0]);
  // De más llaves a menos: si en el mismo documento conviven `{{{{X}}}}` y
  // `{{X}}`, sustituir primero la corta dejaría llaves sueltas de la larga.
  return [...vistas].sort((a, b) => b.length - a.length);
}

export interface Sustituciones {
  solicitudes: SolicitudReemplazarTexto[];
  /** Marcadores exigidos que la plantilla no trae. */
  faltantes: Marcador[];
  /** Marcadores que sí están, para poder afirmarlo en una prueba. */
  encontrados: Marcador[];
}

/**
 * Las sustituciones de todos los marcadores, con sus avisos.
 *
 * `replaceAllText` aplica a **todos los segmentos** del documento —cuerpo,
 * encabezado y pie— sin que haya que pedirlo, que es justo lo que el original
 * tiene que hacer a mano para el encabezado (`COT_05:470-477`).
 *
 * Lo que la plantilla no trae **no es un error**: se avisa y se sigue
 * (`COT_05:456-458`). Un hueco se descubre cuando el cliente ya la tiene, así
 * que se dice antes, pero no vale la pena no generar el documento por eso.
 */
export function sustituciones(
  doc: DocumentoDocs,
  valores: Record<Marcador, string>,
): Sustituciones {
  const texto = textoDelDocumento(doc);
  const solicitudes: SolicitudReemplazarTexto[] = [];
  const faltantes: Marcador[] = [];
  const encontrados: Marcador[] = [];

  // De nombre más largo a más corto. Hoy ningún marcador es prefijo de otro,
  // pero el día que alguien agregue `{{FECHA_ENTREGA}}` junto a `{{FECHA}}`,
  // sustituir `FECHA` primero dejaría `{{<fecha>_ENTREGA}}` en el documento.
  for (const marcador of [...MARCADORES].sort((a, b) => b.length - a.length)) {
    const formas = formasEnTexto(texto, marcador);
    if (formas.length === 0) {
      if (MARCADORES_EXIGIDOS.includes(marcador)) faltantes.push(marcador);
      continue;
    }
    encontrados.push(marcador);
    for (const forma of formas) {
      solicitudes.push({
        replaceAllText: {
          containsText: { text: forma, matchCase: true },
          replaceText: valores[marcador] ?? "",
        },
      });
    }
  }

  return { solicitudes, faltantes, encontrados };
}
