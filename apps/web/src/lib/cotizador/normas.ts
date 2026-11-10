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

/**
 * Para comparar dos nombres escritos por personas distintas: sin acentos, sin
 * puntuación y sin espacios. "S.A. de C.V." y "SA de CV" son lo mismo.
 *
 * No se reutiliza `normalizarRazonSocial` de `clientes.ts` —que además quita
 * los sufijos legales— porque ese módulo consulta la base, y éste acaba en el
 * bundle del navegador a través de las pantallas del cotizador. Aquí no hace
 * falta tanto: se compara la razón social **consigo misma**, escrita de otra
 * manera, no dos empresas parecidas.
 */
const paraComparar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/**
 * El título como se lee en el documento: **título + " - " + razón social**.
 *
 * Los documentos reales llevan el cliente al final del título —"Estudio de
 * Arco Eléctrico - Stellantis Motores - SC INGENIERIA, S.A. de C.V."— y hay
 * dos caminos para llegar ahí, según de dónde venga la cotización:
 *
 * - **Con `_`**: el título ya trae el cliente pegado, que es como lo guarda
 *   el sistema viejo y como llegaron las 331 importadas de 2026. Se convierte
 *   el `_` en " - " y no se añade nada: el cliente ya está.
 * - **Sin `_`**: la dio de alta el ERP, que guarda el título a secas. Se le
 *   pega la razón social, que es el dato que le falta para leerse igual.
 *
 * No se duplica si el título ya termina con la razón social: pasa en cuanto
 * alguien la escribe a mano al teclear el título.
 */
export function tituloParaDocumento(
  titulo: string | null | undefined,
  cliente?: string | null,
): string {
  const crudo = String(titulo ?? "");
  const leible = crudo.replace(/\s*_\s*/g, " - ").replace(/\s+/g, " ").trim();

  if (crudo.includes("_")) return leible;

  const razon = String(cliente ?? "").trim();
  if (!leible || !razon) return leible;
  if (paraComparar(leible).endsWith(paraComparar(razon))) return leible;

  return `${leible} - ${razon}`;
}

/** El servicio que se cotiza, sacado del título. */
function servicioDelTitulo(titulo: string | null | undefined): string {
  let t = tituloParaDocumento(titulo);
  // Lo que va después del guion suele ser el sitio, no el servicio. El guion
  // largo cuenta: los títulos se escriben a mano y Word lo pone solo.
  t = t.split(/\s+[-–]\s+/)[0].trim();
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
  // El mismo título que va a salir impreso, para que el sitio del párrafo y
  // el del documento no puedan discrepar.
  const sitio = sitioDelProyecto(tituloParaDocumento(titulo, cliente), cliente);
  // Sin punto si el sitio ya trae el suyo: casi todas las razones sociales
  // terminan en "S.A. de C.V." y el legacy imprime "C.V.." en todas.
  const sitioConPunto = /\.$/.test(sitio.trim()) ? sitio.trim() : `${sitio.trim()}.`;

  return {
    objeto:
      "El objeto de la presente propuesta técnica que ofrecemos consiste en contratar la " +
      `prestación del servicio de ${servicioMin}, así como la asesoría en diagnósticos ` +
      "requerida, con el fin de mantener el buen estado operativo de la(s) Subestación(es) " +
      `Eléctrica(s) propiedad del ${sitioConPunto}`,
    alcance:
      `El alcance principal del servicio de ${servicioMin} que se solicita contratar ` +
      "considera el logro del mejor rendimiento, disponibilidad y confiabilidad de los " +
      "sistemas de la Subestación Eléctrica.",
  };
}
