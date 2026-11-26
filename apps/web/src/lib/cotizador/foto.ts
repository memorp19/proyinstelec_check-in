/**
 * La foto del documento: lo que imprime el PDF además de los importes.
 *
 * Al mandar a revisión se congelan los importes (`cot_importes`) **y** esto:
 * el cliente, el título y a quién va dirigida, el bloque del documento ya
 * completado con el machote, y las direcciones del catálogo. El PDF
 * definitivo —al mandar o con «Generar PDF»— sale siempre de aquí.
 *
 * ── Por qué hace falta ──
 *
 * El encabezado de la cotización lo edita cualquiera con `modulo.cotizaciones`
 * (decisión del 20 nov), y las direcciones las edita quien tenga Clientes. Si
 * el PDF se armara con lo vivo, regenerarlo después de aprobado podría
 * imprimir un título o un cliente que nadie revisó. Con la foto, lo aprobado
 * no cambia; y si lo vivo ya no coincide, se avisa (`avisoDeEncabezado`).
 *
 * Es pura: la arma quien congela, y se lee de `jsonb` con `leerFoto`.
 */
import { conPuntoFinal } from "../texto";
import { normalizarDocumento, type DatosDocumento } from "./documento";

/** Los tres campos de la cotización que imprime el documento. */
export interface EncabezadoImpreso {
  cliente: string;
  titulo: string;
  dirigidaA: string;
}

export interface FotoDelDocumento {
  encabezado: EncabezadoImpreso;
  /** Ya completado con el machote: lo que salió impreso, no lo que se tecleó. */
  documento: DatosDocumento;
  direccionContacto: string | null;
  direccionCliente: string | null;
}

/** La foto, a partir de la cotización y lo que se va a imprimir. */
export function fotoDelDocumento(params: {
  cotizacion: { cliente: string; titulo: string; dirigida_a: string };
  documento: DatosDocumento;
  direccionContacto?: string | null;
  direccionCliente?: string | null;
}): FotoDelDocumento {
  return {
    encabezado: {
      cliente: params.cotizacion.cliente,
      titulo: params.cotizacion.titulo,
      dirigidaA: params.cotizacion.dirigida_a,
    },
    documento: params.documento,
    direccionContacto: params.direccionContacto ?? null,
    direccionCliente: params.direccionCliente ?? null,
  };
}

const esTexto = (v: unknown): v is string => typeof v === "string";

/**
 * La foto tal como viene de `jsonb`, o `null` si no la hay o no tiene forma.
 *
 * `null` no es un error: lo congelado antes de que existiera la foto no la
 * trae, y quien genera el PDF la toma en ese momento.
 */
export function leerFoto(crudo: unknown): FotoDelDocumento | null {
  if (!crudo || typeof crudo !== "object") return null;
  const f = crudo as Record<string, unknown>;
  const e = f.encabezado as Record<string, unknown> | undefined;
  if (!e || !esTexto(e.cliente) || !esTexto(e.titulo) || !esTexto(e.dirigidaA)) return null;
  if (!f.documento || typeof f.documento !== "object") return null;
  return {
    encabezado: { cliente: e.cliente, titulo: e.titulo, dirigidaA: e.dirigidaA },
    documento: normalizarDocumento(f.documento).valor,
    direccionContacto: esTexto(f.direccionContacto) ? f.direccionContacto : null,
    direccionCliente: esTexto(f.direccionCliente) ? f.direccionCliente : null,
  };
}

// ── Lo vivo contra lo congelado ───────────────────────────────────────────────

export interface CambioDeEncabezado {
  campo: keyof EncabezadoImpreso;
  /** Como se llama en la pantalla. */
  etiqueta: string;
  enElPdf: string;
  ahora: string;
}

const ETIQUETAS: Record<keyof EncabezadoImpreso, string> = {
  cliente: "el cliente",
  titulo: "el título",
  dirigidaA: "dirigida a",
};

/** Qué campos del encabezado cambiaron desde que se congeló. */
export function cambiosDeEncabezado(
  foto: EncabezadoImpreso,
  actual: { cliente: string; titulo: string; dirigida_a: string },
): CambioDeEncabezado[] {
  const vivo: EncabezadoImpreso = {
    cliente: actual.cliente,
    titulo: actual.titulo,
    dirigidaA: actual.dirigida_a,
  };
  return (Object.keys(ETIQUETAS) as Array<keyof EncabezadoImpreso>)
    .filter((campo) => (foto[campo] ?? "").trim() !== (vivo[campo] ?? "").trim())
    .map((campo) => ({
      campo,
      etiqueta: ETIQUETAS[campo],
      enElPdf: foto[campo],
      ahora: vivo[campo],
    }));
}

/**
 * El aviso para el revisor y para quien envía, o `null` si todo coincide.
 *
 * No bloquea nada: el PDF lleva lo que se revisó, que es lo correcto. Lo que
 * dice es que la pantalla ya muestra otra cosa, para que nadie se sorprenda
 * cuando el cliente cite el título del PDF.
 */
export function avisoDeEncabezado(cambios: CambioDeEncabezado[]): string | null {
  if (cambios.length === 0) return null;
  const partes = cambios.map((c) => `${c.etiqueta} ahora dice «${c.ahora}» y el PDF lleva «${c.enElPdf}»`);
  return conPuntoFinal(
    `El encabezado cambió después de mandarla a revisión: ${partes.join("; ")}. ` +
      "El PDF sale de lo que se congeló, que es lo que se revisó",
  );
}

// ── Cuando no hay PDF ─────────────────────────────────────────────────────────

/**
 * Qué decir cuando no hay PDF que enviar.
 *
 * Tres casos distintos, y cada uno tiene su salida:
 *
 * - **Armada en el ERP y en REVISION:** el PDF definitivo se genera desde lo
 *   congelado con «Generar PDF».
 * - **Armada en el ERP y ya enviada:** no se regenera, porque es el que tiene
 *   el cliente. Si falta, alguien lo movió en Drive.
 * - **Importada** (nunca pasó por el cotizador): su documento no se puede
 *   generar aquí; lo hace el Apps Script.
 *
 * El mismo texto lo usan el servidor, al rechazar el envío, y la pantalla, al
 * avisar antes.
 */
export function avisoSinPdf(params: {
  delCotizador: boolean;
  estatus: string;
  /** El folio con que el Apps Script nombra el archivo. */
  folio: string;
}): string {
  if (params.delCotizador && params.estatus === "REVISION") {
    return (
      "Esta versión no tiene su PDF definitivo. Genéralo con «Generar PDF»: sale de lo que " +
      "se congeló al mandarla a revisión, así que no cambia nada de lo que se revisó."
    );
  }
  if (params.delCotizador) {
    return (
      "No se encontró el PDF con el que se envió esta versión; puede que lo hayan movido a la " +
      "papelera de Drive. Una versión ya enviada no se regenera, porque ese PDF es el que tiene " +
      "el cliente: recupéralo de la papelera."
    );
  }
  return (
    "Esta cotización no se armó en el ERP, así que su PDF no se genera aquí: lo hace el Apps " +
    `Script, y tiene que estar en la carpeta de la cotización con el nombre «${params.folio} …».`
  );
}
