/**
 * A quién se le puede mandar una cotización.
 *
 * El correo al cliente sale de la empresa con el PDF adjunto, así que la lista
 * de destinatarios no es libre (el M7 de la revisión del 17 nov). Entran:
 *
 * - los contactos del cliente que están dados de alta en el catálogo, con su
 *   correo;
 * - correos del dominio de la empresa (el asesor, la gerencia).
 *
 * Y **al menos uno tiene que ser del cliente**: una cotización «enviada» solo a
 * gente de la casa no le llegó al cliente, y quedaría ENVIADA igual.
 *
 * Si uno solo no cuadra, no sale nada. Mandar a los que sí cuadran y callar el
 * resto haría creer que le llegó a quien se escribió a mano.
 *
 * Es pura —recibe ya leídos los correos del cliente y el dominio— para poder
 * probarla sin base, y la usan el servidor y la pantalla: el aviso que ve quien
 * envía es el mismo texto que la regla que lo rechaza.
 */

import { conPuntoFinal } from "./texto";

/** El dominio de Google Workspace de la empresa. Solo en el servidor. */
export function dominioEmpresa(): string {
  return (process.env.GOOGLE_WORKSPACE_DOMAIN ?? "proyinstelec.mx").trim().toLowerCase();
}

/** Como se guardan en `contactos` (`createContacto`): sin espacios y en minúsculas. */
export function normalizarCorreo(correo: string): string {
  return String(correo ?? "").trim().toLowerCase();
}

/**
 * Una sola dirección, sin nada que pueda abrir otra.
 *
 * Los destinatarios se escriben tal cual en la cabecera `To:` del correo, así
 * que una coma, un `;` o un salto de línea no son un error de captura sin más:
 * serían otro destinatario, u otra cabecera. Se piden ya en minúsculas.
 */
const UNA_DIRECCION = /^[^\s@<>,;:"()[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export type ResultadoDestinatarios =
  | { ok: true; para: string[] }
  | { ok: false; error: string; noCuadran: string[] };

function enLista(correos: string[]): string {
  if (correos.length === 1) return correos[0];
  return `${correos.slice(0, -1).join(", ")} y ${correos[correos.length - 1]}`;
}

export function validarDestinatarios(params: {
  destinatarios: string[];
  /** Los correos de los contactos del cliente, como los da `contactosParaEnvio`. */
  correosDelCliente: string[];
  dominio: string;
  /** La razón social, para el mensaje. */
  cliente: string;
}): ResultadoDestinatarios {
  const delCliente = new Set(params.correosDelCliente.map(normalizarCorreo).filter(Boolean));
  const arroba = `@${params.dominio.trim().toLowerCase()}`;
  const para = [...new Set(params.destinatarios.map(normalizarCorreo).filter(Boolean))];

  if (para.length === 0) {
    return { ok: false, noCuadran: [], error: conPuntoFinal(`Selecciona al menos un contacto de ${params.cliente}`) };
  }

  const malEscritos = para.filter((c) => !UNA_DIRECCION.test(c));
  const ajenos = para.filter(
    (c) => UNA_DIRECCION.test(c) && !delCliente.has(c) && !c.endsWith(arroba),
  );
  if (malEscritos.length > 0 || ajenos.length > 0) {
    const partes: string[] = [];
    if (ajenos.length > 0) {
      partes.push(
        `${enLista(ajenos)} no ${ajenos.length === 1 ? "es contacto" : "son contactos"} de ${params.cliente} ni ${ajenos.length === 1 ? "es" : "son"} de la empresa`,
      );
    }
    if (malEscritos.length > 0) {
      partes.push(
        `${enLista(malEscritos)} no ${malEscritos.length === 1 ? "es una dirección" : "son direcciones"} de correo válida${malEscritos.length === 1 ? "" : "s"}`,
      );
    }
    const pasos =
      ajenos.length > 0
        ? "Primero dalo de alta como contacto del cliente en Clientes, y vuelve a enviar."
        : "Corrígelo y vuelve a enviar; si es el correo de un contacto, se corrige en Clientes.";
    return {
      ok: false,
      noCuadran: [...ajenos, ...malEscritos],
      error: `No se envió nada: ${partes.join("; ")}. ${pasos}`,
    };
  }

  if (!para.some((c) => delCliente.has(c))) {
    return {
      ok: false,
      noCuadran: [],
      error: `${conPuntoFinal(`No se envió nada: falta al menos un contacto de ${params.cliente}`)} Si la persona no aparece en la lista, primero dala de alta como contacto del cliente en Clientes.`,
    };
  }

  return { ok: true, para };
}
