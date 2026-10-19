/**
 * Las normas de "Documentos Aplicables" y los textos que se proponen solos.
 *
 * La lista es fija y vive en el código, no en la base: es el texto de la
 * plantilla del documento, cambia cada varios años y lo que importa es que
 * salga **idéntico** en todas las cotizaciones. Una tabla invitaría a que cada
 * quien escribiera su versión de la misma norma.
 *
 * Viene de `COT_06:28-90`, con las dos correcciones que ya traía ahí: "IEEC"
 * es IEEE, y la comilla que no cerraba en la C57.12.90.
 */

export type GrupoNorma = "CFE" | "NOM" | "NMX" | "IEEE" | "GEN";

export interface Norma {
  id: string;
  grupo: GrupoNorma;
  texto: string;
}

/** `GEN` son las cuatro generales: van en todas. */
export const NORMAS: Norma[] = [
  { id: "CFE-SOM-3531", grupo: "CFE", texto: "CFE-SOM-3531 Manual de procedimientos de prueba de campo para equipo primario" },
  { id: "CFE-SOM-3532", grupo: "CFE", texto: "CFE-SOM-3532 Manual de procedimientos de pruebas a esquemas de protección" },
  { id: "NOM-001-SEDE-2012", grupo: "NOM", texto: "NOM-001-SEDE-2012 Normas para instalaciones eléctricas" },
  { id: "NOM-002-SEDE-2012", grupo: "NOM", texto: "NOM-002-SEDE-2012 Requisitos de seguridad y eficiencia energética para transformadores" },
  { id: "NOM-022-STPS-2015", grupo: "NOM", texto: "NOM-022-STPS-2015 Electricidad estática en los centros de trabajo – condiciones de seguridad" },
  { id: "NOM-029-STPS-2011", grupo: "NOM", texto: "NOM-029-STPS-2011 Mantenimiento de las instalaciones eléctricas en los centros de trabajo – condiciones de seguridad" },
  { id: "NMX-J-109-ANCE", grupo: "NMX", texto: "NMX-J-109-ANCE Transformadores de Corriente – especificaciones y métodos de prueba" },
  { id: "NMX-J-116-ANCE", grupo: "NMX", texto: "NMX-J-116-ANCE Productos Eléctricos - Transformadores de distribución tipo poste, tipo subestación, especificaciones" },
  { id: "NMX-J-123-ANCE", grupo: "NMX", texto: "NMX-J-123-ANCE Productos Eléctricos - Aceites minerales aislantes para transformador – especificaciones, muestreo y métodos de prueba" },
  { id: "NMX-J-142-ANCE", grupo: "NMX", texto: "NMX-J-142-ANCE Productos Eléctricos - Cables de Energía con pantalla metálica - especificaciones y métodos de prueba" },
  { id: "NMX-J-169-ANCE", grupo: "NMX", texto: "NMX-J-169-ANCE Transformadores y Autotransformadores de Distribución y Potencia – métodos de prueba" },
  { id: "NMX-J-215-ANCE", grupo: "NMX", texto: "NMX-J-215-ANCE Resistencia, Resistividad y Conductividad Eléctrica de conductores – método de prueba" },
  { id: "NMX-J-351-ANCE", grupo: "NMX", texto: "NMX-J-351-ANCE Transformadores de Distribución y Potencia Tipo Seco – especificaciones" },
  { id: "NMX-J-294-ANCE", grupo: "NMX", texto: "NMX-J-294-ANCE Resistencia de Aislamiento de Conductores Eléctricos – método de prueba" },
  { id: "NMX-J-565/4-ANCE", grupo: "NMX", texto: "NMX-J-565/4-ANCE Corriente de Fuga – método de prueba" },
  { id: "IEEE-C57.12.90", grupo: "IEEE", texto: "IEEE C57.12.90-1999 “IEEE Standard code for liquid-immersed distribution power and regulating transformers”" },
  { id: "IEEE-RED-BOOK", grupo: "IEEE", texto: "IEEE Red Book – Recommended Practices for Electric Power Distribution for Industrial Plants" },
  { id: "IEEE-242", grupo: "IEEE", texto: "IEEE – Recommended Practice for Protection and Coordination of Industrial Plants and Commercial Power Systems ANSI/IEEE 242" },
  { id: "NETA-MTS-2011", grupo: "IEEE", texto: "ANSI NETA MTS-2011 Standard for Maintenance Testing Specifications for Electrical Power Equipment and Systems" },
  { id: "GEN-DIAGRAMAS", grupo: "GEN", texto: "Diagramas esquemáticos del fabricante y del proyecto" },
  { id: "GEN-MANUAL", grupo: "GEN", texto: "Manual de operación de equipo de medición y prueba" },
  { id: "GEN-INSTRUCTIVOS", grupo: "GEN", texto: "Instructivos del fabricante" },
  { id: "GEN-ESPECIFICACIONES", grupo: "GEN", texto: "Especificaciones técnicas del cliente" },
];

const sinAcentos = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const idsDelGrupo = (...grupos: GrupoNorma[]) =>
  NORMAS.filter((n) => grupos.includes(n.grupo)).map((n) => n.id);

/**
 * Qué normas se proponen según el título. **Son sugerencias**: en la pantalla
 * se palomean o se quitan, y lo que se guarda es la lista elegida.
 *
 * | Servicio | Normas |
 * |---|---|
 * | Medición o protecciones | CFE-SOM-3532 + las generales |
 * | Pruebas sin mantenimiento | CFE + NOM + las generales |
 * | Mantenimiento y lo demás | todas |
 */
export function normasSugeridas(titulo: string | null | undefined): string[] {
  const t = sinAcentos(String(titulo ?? ""));
  const generales = idsDelGrupo("GEN");

  if (/medidor|medicion|calibracion|proteccion|relevador/.test(t)) {
    return ["CFE-SOM-3532", ...generales];
  }
  if (/prueba/.test(t) && !/mantenimiento/.test(t)) {
    return [...idsDelGrupo("CFE", "NOM"), ...generales];
  }
  return NORMAS.map((n) => n.id);
}

/**
 * Las normas elegidas, en el orden del catálogo.
 *
 * `null` significa "las sugeridas" y una lista vacía significa "ninguna". Son
 * cosas distintas: una cotización que todavía no tocó las normas no es lo
 * mismo que una donde alguien las quitó todas a propósito.
 */
export function normasElegidas(
  guardadas: string[] | null | undefined,
  titulo: string | null | undefined,
): Norma[] {
  const ids = guardadas ?? normasSugeridas(titulo);
  return NORMAS.filter((n) => ids.includes(n.id));
}

// ── El renglón del reporte ────────────────────────────────────────────────────

export type ModoReporte = "COMPLETO" | "CORTO" | "NINGUNO" | "OTRO";

/** Las tres versiones que aparecen en las cotizaciones reales (`COT_06:127`). */
export const TEXTO_REPORTE: Record<"COMPLETO" | "CORTO", string> = {
  COMPLETO:
    "Reporte con evidencia fotográfica de la ejecución de los trabajos con " +
    "diagnóstico de los resultados de las pruebas en sitio y en Laboratorio.",
  CORTO: "Reporte con evidencia fotográfica de la ejecución de los trabajos.",
};

export function textoDelReporte(modo: ModoReporte, propio: string): string {
  if (modo === "NINGUNO") return "";
  if (modo === "OTRO") return propio.trim();
  return TEXTO_REPORTE[modo];
}

// ── Los textos sugeridos de "Actividades Generales" ───────────────────────────

/** Título para leerse: el guion bajo del folio se lee como " - ". */
export function tituloParaDocumento(titulo: string | null | undefined): string {
  return String(titulo ?? "").replace(/\s*_\s*/g, " - ").replace(/\s+/g, " ").trim();
}

/** El servicio que se cotiza, sacado del título. */
function servicioDelTitulo(titulo: string | null | undefined): string {
  let t = tituloParaDocumento(titulo);
  // Lo que va después del guion suele ser el sitio, no el servicio.
  t = t.split(/\s+-\s+/)[0].trim();
  return t.replace(/^servicio\s+de\s+/i, "");
}

/**
 * El sitio del proyecto: lo que va después del último guion del título.
 *
 * "…Subestación Eléctrica_IGSA" → "IGSA". Si el título no lo trae, el cliente.
 */
export function sitioDelProyecto(
  titulo: string | null | undefined,
  cliente: string | null | undefined,
): string {
  const t = String(titulo ?? "").trim();
  if (!t) return cliente ?? "";

  const partes = t.split(/\s+[-–]\s+|_/);
  if (partes.length > 1) {
    const ultimo = partes[partes.length - 1].trim();
    if (ultimo.length > 2) return ultimo;
  }
  return cliente || t;
}

/**
 * Los dos párrafos de "Actividades Generales", redactados con lo que se sabe
 * del título y del cliente.
 *
 * Son un punto de partida que se edita en la pantalla, no un texto definitivo:
 * el documento sale igual si alguien los reescribe enteros.
 */
export function textosSugeridos(
  titulo: string | null | undefined,
  cliente: string | null | undefined,
): { objeto: string; alcance: string } {
  const servicio = servicioDelTitulo(titulo);
  const servicioMin =
    !servicio || /^mantenimiento\s+preventivo/i.test(servicio) ? "mantenimiento preventivo" : servicio;
  const sitio = sitioDelProyecto(tituloParaDocumento(titulo), cliente);

  return {
    objeto:
      "El objeto de la presente propuesta técnica que ofrecemos consiste en contratar la " +
      `prestación del servicio de ${servicioMin}, así como la asesoría en diagnósticos ` +
      "requerida, con el fin de mantener el buen estado operativo de la(s) Subestación(es) " +
      `Eléctrica(s) propiedad del ${sitio}.`,
    alcance:
      `El alcance principal del servicio de ${servicioMin} que se solicita contratar ` +
      "considera el logro del mejor rendimiento, disponibilidad y confiabilidad de los " +
      "sistemas de la Subestación Eléctrica.",
  };
}
