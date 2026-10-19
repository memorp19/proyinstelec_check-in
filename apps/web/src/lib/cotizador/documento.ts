/**
 * Las condiciones comerciales y los datos del documento, como bloque
 * estructurado y validado.
 *
 * Van en `jsonb` —`cot_armado.condiciones` y `cot_armado.documento`— porque son
 * campos del documento y crecen con la plantilla, no con el modelo. Pero jsonb
 * sin validar es texto: cualquiera mete lo que sea y el error aparece meses
 * después, al reimprimir. Así que lo que entra pasa por aquí.
 *
 * Cada bloque lleva su **versión de esquema**. Cuando cambie la forma, las
 * cotizaciones viejas se van a seguir leyendo: el número dice cómo leerlas, y
 * un bloque de esquema desconocido se reporta en vez de malinterpretarse.
 */

/** Sube cuando cambie la forma del bloque, nunca cuando cambie un valor. */
export const ESQUEMA_CONDICIONES = 1;
export const ESQUEMA_DOCUMENTO = 1;

// ── Condiciones comerciales ───────────────────────────────────────────────────

export interface Condiciones {
  esquema: number;
  /** Forma de pago, tal como se imprime: `{{PAGO}}`. */
  pago: string;
  /** Tiempo de entrega: `{{ENTREGA}}`. */
  entrega: string;
  /** Lugar de entrega: `{{LUGAR}}`. Vacío es válido. */
  lugar: string;
  /** Días de vigencia de la oferta: `{{VIGENCIA}}`. */
  vigenciaDias: number;
}

/** Las del ERP viejo (`COT_04:75-81`), que es lo que la gente espera ver. */
export const CONDICIONES_POR_OMISION: Condiciones = {
  esquema: ESQUEMA_CONDICIONES,
  pago: "100% contra entrega de factura.",
  entrega:
    "de 4 semanas en sitio, salvo confirmación de tiempo de entrega de materiales.",
  lugar: "",
  vigenciaDias: 30,
};

/** Una vigencia de un año ya no es una oferta: es un error de captura. */
const VIGENCIA_MAXIMA = 365;

// ── Datos del documento ───────────────────────────────────────────────────────

export interface ContactoDocumento {
  nombre: string;
  telefono: string;
  email: string;
}

export interface DatosDocumento {
  esquema: number;
  /**
   * El contacto **de esta cotización**.
   *
   * Sale del catálogo de clientes, pero se corrige aquí sin tocar el catálogo:
   * que una cotización vaya dirigida a otra persona no cambia quién es el
   * contacto de la cuenta.
   */
  contacto: ContactoDocumento;
  /** Las dos líneas de dirección. La segunda, vacía, borra su renglón. */
  direccion: [string, string];
  /** Derivado del título y el cliente; corregible. `{{SITIO}}`. */
  sitio: string;
  /** Actividades generales, una por viñeta. */
  actividades: string[];
  /** Normas aplicables, una por viñeta. */
  normas: string[];
  /** Qué incluye el reporte que se entrega. */
  reporte: string;
  /** Notas al pie del documento. */
  notas: string;
}

export const DOCUMENTO_POR_OMISION: DatosDocumento = {
  esquema: ESQUEMA_DOCUMENTO,
  contacto: { nombre: "", telefono: "", email: "" },
  direccion: ["", ""],
  sitio: "",
  actividades: [],
  normas: [],
  reporte: "",
  notas: "",
};

// ── Validación ────────────────────────────────────────────────────────────────

export interface Validado<T> {
  valor: T;
  /** Lo que se corrigió o se ignoró. No bloquea: se reporta. */
  avisos: string[];
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Texto limpio. Lo que no sea texto no se convierte: se descarta y se avisa. */
function texto(v: unknown, campo: string, avisos: string[], porOmision = ""): string {
  if (v === undefined || v === null) return porOmision;
  if (typeof v === "string") return v.trim();
  avisos.push(`"${campo}" no es texto; se usa el valor por omisión.`);
  return porOmision;
}

function lista(v: unknown, campo: string, avisos: string[]): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    avisos.push(`"${campo}" no es una lista; se ignora.`);
    return [];
  }
  const fuera: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim()) fuera.push(x.trim());
    else if (typeof x !== "string") avisos.push(`"${campo}" trae un renglón que no es texto; se ignora.`);
  }
  return fuera;
}

/**
 * Qué hacer con un bloque de esquema desconocido.
 *
 * Más nuevo que el que este código entiende se deja intacto y se avisa: lo
 * escribió una versión posterior y "arreglarlo" aquí sería perder datos.
 */
function revisarEsquema(valor: unknown, esperado: number, avisos: string[]): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return esperado;
  if (n > esperado) {
    avisos.push(
      `El bloque viene en esquema ${n} y este código entiende hasta el ${esperado}. ` +
        "Se lee lo que se reconoce; actualiza la aplicación antes de guardarlo.",
    );
  }
  return n;
}

/**
 * Deja las condiciones en forma válida, vengan como vengan de `jsonb`.
 *
 * Nunca falla: una cotización a medio armar tiene que poder guardarse (§2.9 del
 * plan). Lo que no se entiende se sustituye por lo de omisión y se avisa.
 */
export function normalizarCondiciones(crudo: unknown): Validado<Condiciones> {
  const avisos: string[] = [];
  if (crudo === null || crudo === undefined) {
    return { valor: { ...CONDICIONES_POR_OMISION }, avisos };
  }
  if (!esObjeto(crudo)) {
    avisos.push("Las condiciones guardadas no son un bloque; se usan las de omisión.");
    return { valor: { ...CONDICIONES_POR_OMISION }, avisos };
  }

  const esquema = revisarEsquema(crudo.esquema, ESQUEMA_CONDICIONES, avisos);
  const vigencia = Number(crudo.vigenciaDias);
  let vigenciaDias = CONDICIONES_POR_OMISION.vigenciaDias;
  if (crudo.vigenciaDias !== undefined && crudo.vigenciaDias !== null) {
    if (!Number.isFinite(vigencia) || vigencia <= 0) {
      avisos.push(`La vigencia "${String(crudo.vigenciaDias)}" no son días; se usan ${vigenciaDias}.`);
    } else if (vigencia > VIGENCIA_MAXIMA) {
      avisos.push(`La vigencia de ${vigencia} días pasa del año. Revísala.`);
      vigenciaDias = Math.trunc(vigencia);
    } else {
      vigenciaDias = Math.trunc(vigencia);
    }
  }

  return {
    valor: {
      esquema,
      pago: texto(crudo.pago, "pago", avisos, CONDICIONES_POR_OMISION.pago),
      entrega: texto(crudo.entrega, "entrega", avisos, CONDICIONES_POR_OMISION.entrega),
      lugar: texto(crudo.lugar, "lugar", avisos),
      vigenciaDias,
    },
    avisos,
  };
}

/** Lo mismo para los datos del documento. */
export function normalizarDocumento(crudo: unknown): Validado<DatosDocumento> {
  const avisos: string[] = [];
  if (crudo === null || crudo === undefined) {
    return { valor: { ...DOCUMENTO_POR_OMISION, direccion: ["", ""] }, avisos };
  }
  if (!esObjeto(crudo)) {
    avisos.push("Los datos del documento no son un bloque; se usan los de omisión.");
    return { valor: { ...DOCUMENTO_POR_OMISION, direccion: ["", ""] }, avisos };
  }

  const esquema = revisarEsquema(crudo.esquema, ESQUEMA_DOCUMENTO, avisos);
  const contactoCrudo = esObjeto(crudo.contacto) ? crudo.contacto : {};
  if (crudo.contacto !== undefined && !esObjeto(crudo.contacto)) {
    avisos.push('"contacto" no es un bloque; se deja vacío.');
  }

  const dir = Array.isArray(crudo.direccion) ? crudo.direccion : [];
  if (crudo.direccion !== undefined && !Array.isArray(crudo.direccion)) {
    avisos.push('"direccion" no es una lista de dos renglones; se deja vacía.');
  }

  return {
    valor: {
      esquema,
      contacto: {
        nombre: texto(contactoCrudo.nombre, "contacto.nombre", avisos),
        telefono: texto(contactoCrudo.telefono, "contacto.telefono", avisos),
        email: texto(contactoCrudo.email, "contacto.email", avisos),
      },
      direccion: [texto(dir[0], "direccion", avisos), texto(dir[1], "direccion", avisos)],
      sitio: texto(crudo.sitio, "sitio", avisos),
      actividades: lista(crudo.actividades, "actividades", avisos),
      normas: lista(crudo.normas, "normas", avisos),
      reporte: texto(crudo.reporte, "reporte", avisos),
      notas: texto(crudo.notas, "notas", avisos),
    },
    avisos,
  };
}
