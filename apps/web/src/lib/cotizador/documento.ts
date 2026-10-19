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
 *
 * Los campos del documento son los de Apps Script (`COT_06:136-152`), que se
 * armaron comparando las cotizaciones reales contra lo que generaba el sistema:
 * son exactamente lo que alguien corregía a mano en el Doc cada vez.
 */
import type { ModoReporte } from "./normas";

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

/**
 * Las formas de pago que se ofrecen de un clic (`COT_04:83-89`).
 *
 * No son un catálogo cerrado: el campo se escribe libre y estas solo ahorran
 * teclear las cinco de siempre.
 */
export const PAGOS_FRECUENTES: string[] = [
  "100% contra entrega de factura.",
  "50% de anticipo y 50% contra entrega de factura.",
  "30% de anticipo y 70% contra entrega de factura.",
  "100% de anticipo.",
  "Crédito a 30 días contra entrega de factura.",
];

/** Una vigencia de un año ya no es una oferta: es un error de captura. */
const VIGENCIA_MAXIMA = 365;

// ── Datos del documento ───────────────────────────────────────────────────────

/**
 * El contacto **de esta cotización**.
 *
 * Sale del catálogo de clientes, pero se corrige aquí sin tocar el catálogo:
 * que una cotización vaya dirigida a otra persona no cambia quién es el
 * contacto de la cuenta. Un campo vacío usa el del catálogo.
 */
export interface ContactoDocumento {
  contacto: string;
  direccion1: string;
  direccion2: string;
  telefono: string;
  correo: string;
}

/** Qué renglones del bloque del contacto no salen en la carta. */
export type RenglonesOcultos = Partial<Record<keyof ContactoDocumento, boolean>>;

export interface DatosDocumento {
  esquema: number;
  /** `aaaa-mm-dd`. Vacía = se fija al generar el documento y ya no se mueve. */
  fecha: string;
  contacto: ContactoDocumento;
  ocultar: RenglonesOcultos;
  /** Primer párrafo de "Actividades Generales". */
  objeto: string;
  /** Segundo párrafo. Se puede quitar con `sinAlcance`. */
  alcance: string;
  sinAlcance: boolean;
  /** `null` = las sugeridas por el título; `[]` = ninguna. Ver `normasElegidas`. */
  normas: string[] | null;
  /** Normas que no están en la lista, una por renglón. */
  normasExtra: string;
  reporte: ModoReporte;
  /** El texto del reporte cuando `reporte` es `OTRO`. */
  reporteTexto: string;
  /** Renglón sin número arriba de las partidas, como en la 256. */
  encabezadoTabla: string;
}

export const DOCUMENTO_POR_OMISION: DatosDocumento = {
  esquema: ESQUEMA_DOCUMENTO,
  fecha: "",
  contacto: { contacto: "", direccion1: "", direccion2: "", telefono: "", correo: "" },
  ocultar: {},
  objeto: "",
  alcance: "",
  sinAlcance: false,
  normas: null,
  normasExtra: "",
  reporte: "COMPLETO",
  reporteTexto: "",
  encabezadoTabla: "",
};

/** Una copia nueva, para no repartir referencias al mismo objeto. */
export const documentoVacio = (): DatosDocumento => ({
  ...DOCUMENTO_POR_OMISION,
  contacto: { ...DOCUMENTO_POR_OMISION.contacto },
  ocultar: {},
});

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

const MODOS_REPORTE: ModoReporte[] = ["COMPLETO", "CORTO", "NINGUNO", "OTRO"];

/** Lo mismo para los datos del documento. */
export function normalizarDocumento(crudo: unknown): Validado<DatosDocumento> {
  const avisos: string[] = [];
  if (crudo === null || crudo === undefined) return { valor: documentoVacio(), avisos };
  if (!esObjeto(crudo)) {
    avisos.push("Los datos del documento no son un bloque; se usan los de omisión.");
    return { valor: documentoVacio(), avisos };
  }

  const esquema = revisarEsquema(crudo.esquema, ESQUEMA_DOCUMENTO, avisos);

  const contactoCrudo = esObjeto(crudo.contacto) ? crudo.contacto : {};
  if (crudo.contacto !== undefined && !esObjeto(crudo.contacto)) {
    avisos.push('"contacto" no es un bloque; se deja vacío.');
  }

  const ocultarCrudo = esObjeto(crudo.ocultar) ? crudo.ocultar : {};
  const ocultar: RenglonesOcultos = {};
  for (const campo of ["contacto", "direccion1", "direccion2", "telefono", "correo"] as const) {
    if (ocultarCrudo[campo] === true) ocultar[campo] = true;
  }

  // `null` y `[]` NO son lo mismo: sin tocar (se sugieren) y vacía a propósito.
  let normas: string[] | null = null;
  if (Array.isArray(crudo.normas)) {
    normas = crudo.normas.filter((n): n is string => typeof n === "string");
    if (normas.length !== crudo.normas.length) {
      avisos.push('"normas" traía renglones que no son texto; se ignoran.');
    }
  } else if (crudo.normas !== undefined && crudo.normas !== null) {
    avisos.push('"normas" no es una lista; se usan las sugeridas.');
  }

  const reporteCrudo = texto(crudo.reporte, "reporte", avisos, "COMPLETO");
  const reporte = MODOS_REPORTE.includes(reporteCrudo as ModoReporte)
    ? (reporteCrudo as ModoReporte)
    : "COMPLETO";
  if (reporteCrudo && reporte !== reporteCrudo) {
    avisos.push(`"${reporteCrudo}" no es un modo de reporte; se usa COMPLETO.`);
  }

  const fecha = texto(crudo.fecha, "fecha", avisos);
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    avisos.push(`La fecha "${fecha}" no tiene la forma aaaa-mm-dd; se deja vacía.`);
  }

  return {
    valor: {
      esquema,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : "",
      contacto: {
        contacto: texto(contactoCrudo.contacto, "contacto.contacto", avisos),
        direccion1: texto(contactoCrudo.direccion1, "contacto.direccion1", avisos),
        direccion2: texto(contactoCrudo.direccion2, "contacto.direccion2", avisos),
        telefono: texto(contactoCrudo.telefono, "contacto.telefono", avisos),
        correo: texto(contactoCrudo.correo, "contacto.correo", avisos),
      },
      ocultar,
      objeto: texto(crudo.objeto, "objeto", avisos),
      alcance: texto(crudo.alcance, "alcance", avisos),
      sinAlcance: crudo.sinAlcance === true,
      normas,
      normasExtra: texto(crudo.normasExtra, "normasExtra", avisos),
      reporte,
      reporteTexto: texto(crudo.reporteTexto, "reporteTexto", avisos),
      encabezadoTabla: texto(crudo.encabezadoTabla, "encabezadoTabla", avisos),
    },
    avisos,
  };
}

// ── El machote: lo que se propone al abrir ────────────────────────────────────

/**
 * La dirección de una empresa, partida en los dos renglones de la carta.
 *
 * El catálogo guarda **una** dirección y el documento tiene **dos** renglones.
 * Se corta por la **primera coma**, igual que el ERP viejo (`partirDireccion_`,
 * `COT_05:177`), porque es donde las direcciones reales separan la calle del
 * resto:
 *
 *     Prol. Paseo de la Reforma No. 2977 Col. Cuajimalpa, C.P. 05000, Ciudad de México
 *     → "Prol. Paseo de la Reforma No. 2977 Col. Cuajimalpa"
 *       "C.P. 05000, Ciudad de México"
 *
 * Un salto de línea manda sobre la coma: si quien capturó la dirección la
 * partió a mano, ahí quiso partirla.
 */
export function lineasDeDireccion(direccion: string | null | undefined): [string, string] {
  const texto = String(direccion ?? "").trim();
  if (!texto) return ["", ""];

  const limpio = (t: string) => t.trim().replace(/\s+/g, " ");
  const salto = texto.indexOf("\n");
  if (salto >= 0) return [limpio(texto.slice(0, salto)), limpio(texto.slice(salto + 1))];

  const coma = texto.indexOf(",");
  if (coma < 0) return [limpio(texto), ""];
  return [limpio(texto.slice(0, coma)), limpio(texto.slice(coma + 1))];
}

/** Lo que se propone, venga del catálogo de clientes o del título. */
export interface SugerenciasDocumento {
  contacto?: Partial<ContactoDocumento>;
  objeto?: string;
  alcance?: string;
}

/** Qué campos se llenaron solos, para que la pantalla lo pueda decir. */
export interface Completado {
  valor: DatosDocumento;
  /** `contacto` si vino del catálogo de clientes; `textos` si del título. */
  llenados: Array<"contacto" | "textos">;
}

/**
 * Llena lo que esté vacío, y **solo** lo que esté vacío.
 *
 * El cotizador viejo escribe el machote al abrir y deja editar encima; eso es
 * lo que la gente espera, y empezar frente a cinco campos en blanco es el
 * motivo de que el documento acabe corrigiéndose a mano después de generarlo.
 *
 * La regla que lo hace seguro es la otra mitad: **lo escrito no se pisa**. Al
 * recargar, un campo con texto se queda como está, venga de donde venga. Un
 * campo que alguien vació a propósito se vuelve a proponer — es el precio de
 * no guardar un "esto lo borré yo", y es el comportamiento del original.
 */
export function completarDocumento(d: DatosDocumento, s: SugerenciasDocumento): Completado {
  const valor: DatosDocumento = { ...d, contacto: { ...d.contacto }, ocultar: { ...d.ocultar } };
  const llenados: Completado["llenados"] = [];

  let tocoContacto = false;
  for (const campo of ["contacto", "direccion1", "direccion2", "telefono", "correo"] as const) {
    const propuesto = (s.contacto?.[campo] ?? "").trim();
    if (propuesto && !valor.contacto[campo]) {
      valor.contacto[campo] = propuesto;
      tocoContacto = true;
    }
  }
  if (tocoContacto) llenados.push("contacto");

  let tocoTextos = false;
  if (s.objeto?.trim() && !valor.objeto) {
    valor.objeto = s.objeto.trim();
    tocoTextos = true;
  }
  if (s.alcance?.trim() && !valor.alcance) {
    valor.alcance = s.alcance.trim();
    tocoTextos = true;
  }
  if (tocoTextos) llenados.push("textos");

  return { valor, llenados };
}
