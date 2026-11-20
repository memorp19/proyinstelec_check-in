/**
 * De qué se llena cada marcador, y qué se avisa cuando falta.
 *
 * Es la pieza puramente de dominio: no sabe nada de la API de Docs ni de la
 * plantilla. Recibe la cotización, lo armado y el contacto; devuelve los
 * catorce valores y la lista de huecos.
 *
 * ── `⟨falta⟩` en vez de dejarlo en blanco ──
 *
 * Es lo que hace el original (`COT_05:48`), y la razón es que un hueco en
 * blanco en el documento no se ve: el renglón queda corto y nadie lo nota
 * hasta que el cliente pregunta. Con la marca visible, quien revisa la
 * cotización lo ve antes de mandarla, y además sale en la lista de avisos.
 */
import type { Condiciones, DatosDocumento } from "../documento";
import { direccionParaLaCarta, lineasDeDireccion } from "../documento";
import { sitioDelProyecto, tituloParaDocumento } from "../normas";
import { telefonoParaDocumento } from "../presentacion";
import type { Marcador } from "./marcadores";

/** La marca de un dato que la cotización no trae. Visible a propósito. */
export const FALTA_DATO = "⟨falta⟩";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * «05 de Octubre de 2026» a partir de `aaaa-mm-dd`.
 *
 * Se construye con las partes del texto y no con `new Date(iso)`: el
 * constructor interpreta `"2026-10-05"` como UTC, y al imprimirlo en la zona
 * de México sale **el día anterior**. Es el error que hace que un documento
 * generado por la tarde salga con la fecha de ayer.
 */
export function fechaDeDocumento(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return FALTA_DATO;
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) return FALTA_DATO;
  return `${m[3]} de ${mes} de ${m[1]}`;
}

/** «4 semanas…» → «El tiempo de entrega para las partidas será de 4 semanas…» */
export function fraseDeEntrega(valor: string | null | undefined): string {
  const v = (valor ?? "").trim();
  if (!v) return "El tiempo de entrega para las partidas será definido de común acuerdo con el cliente.";
  if (/^el tiempo de entrega/i.test(v)) return v;
  return `El tiempo de entrega para las partidas será ${/^\d/.test(v) ? `de ${v}` : v}`;
}

/** «la Central…» → «En las instalaciones de la Central…» */
export function fraseDeLugar(valor: string | null | undefined): string {
  const v = (valor ?? "").trim();
  if (!v) return "";
  if (/^en\s/i.test(v)) return v;
  if (/^(del|de)\s/i.test(v)) return `En las instalaciones ${v}`;
  return `En las instalaciones de ${v}`;
}

// ── El bloque del destinatario ────────────────────────────────────────────────

/** Qué renglones del bloque del contacto no salen, y por qué. */
export interface RenglonOculto {
  marcador: Extract<Marcador, "DIRECCION_1" | "DIRECCION_2" | "TELEFONO" | "EMAIL">;
  /** `elegido` lo apagó una persona; `vacio` es la segunda dirección sin dato. */
  motivo: "elegido" | "vacio";
}

export interface DatosParaMarcadores {
  cliente: string;
  folio: string;
  /** `aaaa-mm-dd`. Ya resuelta: ver `fechaFija`. */
  fecha: string;
  titulo: string;
  documento: DatosDocumento;
  condiciones: Condiciones;
  /** La dirección del contacto; si no tiene, la del cliente. */
  direccionContacto?: string | null;
  direccionCliente?: string | null;
}

export interface Valores {
  valores: Record<Marcador, string>;
  /** Los renglones del bloque del contacto que hay que quitar del documento. */
  ocultos: RenglonOculto[];
  /** Lo que quedó con `⟨falta⟩`, en palabras, para la vista previa. */
  avisos: string[];
}

/** Nombre legible de cada marcador, para el aviso. */
const COMO_SE_LLAMA: Partial<Record<Marcador, string>> = {
  CLIENTE: "la razón social del cliente",
  CONTACTO: "el nombre del contacto",
  TELEFONO: "el teléfono del contacto",
  EMAIL: "el correo del contacto",
  DIRECCION_1: "la dirección del contacto",
  TITULO: "el título de la cotización",
  LUGAR: "el lugar de entrega",
};

/**
 * Los catorce valores, los renglones a ocultar y los avisos.
 *
 * La dirección sale **del contacto** y, si no tiene, la del cliente — es la
 * regla de `datosDelCliente_`: una empresa puede atender desde varios sitios
 * y la carta va dirigida a una persona en uno de ellos. El dato llega como
 * parámetro; quien lo lee de `contactos.direccion` es `machoteDelDocumento`.
 */
export function valoresDeMarcadores(d: DatosParaMarcadores): Valores {
  const doc = d.documento;
  const c = doc.contacto;

  // La del contacto manda y la del cliente es el respaldo
  // (`direccionParaLaCarta`). Lo que el cotizador haya escrito a mano en
  // `contacto.direccion1` manda sobre las dos.
  const [auto1, auto2] = lineasDeDireccion(
    direccionParaLaCarta(d.direccionContacto, d.direccionCliente),
  );
  const direccion1 = c.direccion1.trim() || auto1;
  const direccion2 = c.direccion2.trim() || (c.direccion1.trim() ? "" : auto2);

  // Con la razón social: en el documento el título se lee "<título> - <cliente>".
  const titulo = tituloParaDocumento(d.titulo, d.cliente);
  const lugar = fraseDeLugar(d.condiciones.lugar);

  const valores: Record<Marcador, string> = {
    CLIENTE: d.cliente.trim() || FALTA_DATO,
    FOLIO: d.folio,
    FECHA: fechaDeDocumento(d.fecha),
    TITULO: titulo || FALTA_DATO,
    SITIO: sitioDelProyecto(titulo, d.cliente),
    CONTACTO: c.contacto.trim() || FALTA_DATO,
    TELEFONO: telefonoParaDocumento(c.telefono) || FALTA_DATO,
    EMAIL: c.correo.trim() || FALTA_DATO,
    DIRECCION_1: direccion1 || FALTA_DATO,
    // La segunda nunca lleva ⟨falta⟩: si no hay, se borra el renglón entero.
    DIRECCION_2: direccion2,
    PAGO: d.condiciones.pago.trim() || "Por definir.",
    ENTREGA: fraseDeEntrega(d.condiciones.entrega),
    LUGAR: lugar || FALTA_DATO,
    VIGENCIA: String(d.condiciones.vigenciaDias ?? 30),
  };

  // ── Los renglones que no salen ──
  const ocultos: RenglonOculto[] = [];
  const apagado = (campo: keyof typeof doc.ocultar) => doc.ocultar[campo] === true;
  if (apagado("direccion1")) ocultos.push({ marcador: "DIRECCION_1", motivo: "elegido" });
  if (apagado("direccion2") || !direccion2) {
    ocultos.push({ marcador: "DIRECCION_2", motivo: apagado("direccion2") ? "elegido" : "vacio" });
  }
  if (apagado("telefono")) ocultos.push({ marcador: "TELEFONO", motivo: "elegido" });
  if (apagado("correo")) ocultos.push({ marcador: "EMAIL", motivo: "elegido" });

  // ── Los avisos ──
  // Solo de lo que de verdad va a salir impreso: un renglón que se quitó a
  // propósito no es un hueco, es una decisión.
  const quitados = new Set(ocultos.map((o) => o.marcador));
  const avisos = (Object.keys(valores) as Marcador[])
    .filter((m) => valores[m] === FALTA_DATO && !quitados.has(m as never))
    .map((m) => `Falta ${COMO_SE_LLAMA[m] ?? m}: sale como ${FALTA_DATO} en el documento.`);

  return { valores, ocultos, avisos };
}

// ── La fecha, que se fija una vez ─────────────────────────────────────────────

/**
 * La fecha del documento: la guardada, o la de hoy si es la primera vez.
 *
 * **No cambia al regenerar.** Una cotización que se rehace una semana después
 * —porque se corrigió un precio— tiene que seguir diciendo la fecha con la
 * que el cliente la recibió; si se moviera, dos PDF del mismo folio dirían
 * fechas distintas y ninguna sería la buena.
 *
 * Devuelve también `esNueva` para que quien llame sepa que hay que guardarla.
 */
export function fechaFija(
  guardada: string | null | undefined,
  hoy: () => Date = () => new Date(),
): { fecha: string; esNueva: boolean } {
  const g = (guardada ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(g)) return { fecha: g, esNueva: false };

  const d = hoy();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return { fecha: iso, esNueva: true };
}
