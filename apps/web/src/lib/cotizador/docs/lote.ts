/**
 * El lote del documento, partido en **contenido** y **formato**.
 *
 * ── Por qué se parte ──
 *
 * Todo va en un solo `batchUpdate`, y la API lo aplica como una unidad: si
 * rechaza una solicitud, no entra ninguna. Eso es bueno para el contenido
 * —una copia a medio llenar con el nombre bueno sería peor que nada— pero
 * convierte un detalle de formato en «no sale la cotización». Si Google
 * cambiara cómo acepta, digamos, el encabezado fijo de la tabla, el síntoma
 * sería que no sale ningún documento, y nadie lo relacionaría con eso.
 *
 * Por eso cada solicitud lleva la **parte** del documento a la que pertenece:
 *
 * - **Contenido**: lo que dice el documento. Marcadores, normas, párrafos,
 *   tabla, totales y letra. Sin esto no hay cotización.
 * - **Formato**: cómo se ve. Negro, salto de página, filas que no se parten,
 *   encabezado fijo, bordes y la celda unida de la letra. Sin esto el
 *   documento se lee igual, pero no se ve como los reales.
 *
 * Si el lote completo es rechazado, se reintenta **una vez** solo con el
 * contenido. Si entra, el documento sale y los avisos dicen qué formato le
 * falta y por qué. Si tampoco entra, no sale, y el error dice qué parte
 * rechazó Google.
 *
 * ── Por qué quitar el formato no descuadra el contenido ──
 *
 * Todas las solicitudes de formato son de **estilo**: no insertan ni borran
 * texto, así que no mueven ningún índice. La única que reorganiza algo es unir
 * la celda de la letra, y es lo último que toca la tabla: lo que va después en
 * el lote —normas, Actividades, destinatario— está **más arriba** en el
 * documento, y las sustituciones no usan índices. Hay pruebas que fijan las
 * dos cosas (`generar.test.ts` y `tabla.test.ts`).
 */
import type { Documentos } from "../../documentos-google";
import type { Solicitud } from "./tipos";

// ── Las partes ────────────────────────────────────────────────────────────────

export interface Parte {
  /** Cómo se nombra en un error o un aviso: «la tabla de partidas». */
  nombre: string;
  grupo: "contenido" | "formato";
  /**
   * Solo en formato: lo que se nota en el documento si no se aplica, dicho
   * para quien lo lee y no para quien lo programó.
   */
  siFalta?: string;
}

export const PARTES = {
  // ── Contenido ──
  marcadores: { nombre: "los datos de la carta (los marcadores)", grupo: "contenido" },
  destinatario: { nombre: "los renglones vacíos del destinatario", grupo: "contenido" },
  normas: { nombre: "las normas", grupo: "contenido" },
  actividades: { nombre: "los párrafos de Actividades Generales", grupo: "contenido" },
  tabla: { nombre: "la tabla de partidas", grupo: "contenido" },
  totales: { nombre: "los totales", grupo: "contenido" },
  letra: { nombre: "la cantidad en letra", grupo: "contenido" },

  // ── Formato ──
  negro: {
    nombre: "el color negro del texto",
    grupo: "formato",
    siFalta: "El texto que la plantilla marca en rojo sale en rojo.",
  },
  salto: {
    nombre: "el salto de página antes de los Términos",
    grupo: "formato",
    siFalta: "Los Términos no empiezan en hoja nueva.",
  },
  filasEnteras: {
    nombre: "las filas que no se parten entre páginas",
    grupo: "formato",
    siFalta: "Una partida larga puede quedar partida entre dos hojas.",
  },
  encabezadoFijo: {
    nombre: "el encabezado fijo de la tabla",
    grupo: "formato",
    siFalta: "El encabezado de la tabla no se repetirá entre páginas.",
  },
  bordes: {
    nombre: "los bordes de la tabla",
    grupo: "formato",
    siFalta: "La tabla sale con todas sus líneas, también entre una partida y otra.",
  },
  celdaUnida: {
    nombre: "la celda unida de la cantidad en letra",
    grupo: "formato",
    siFalta: "La cantidad en letra sale en la columna de Cantidad, sin su celda unida.",
  },
} as const satisfies Record<string, Parte>;

// ── Los tramos ────────────────────────────────────────────────────────────────

/** Solicitudes seguidas de una misma parte, en el orden en que van al lote. */
export interface Tramo {
  parte: Parte;
  solicitudes: Solicitud[];
}

/**
 * Agrega solicitudes al final del lote.
 *
 * Si son de la misma parte que el último tramo, se juntan con él: así una
 * parte que se emite celda por celda no deja cien tramos de una solicitud.
 */
export function agregar(tramos: Tramo[], parte: Parte, solicitudes: Solicitud[]): void {
  if (solicitudes.length === 0) return;
  const ultimo = tramos.at(-1);
  if (ultimo?.parte === parte) ultimo.solicitudes.push(...solicitudes);
  else tramos.push({ parte, solicitudes: [...solicitudes] });
}

/** El lote tal como se manda: todas las solicitudes, en orden. */
export const todas = (tramos: Tramo[]): Solicitud[] => tramos.flatMap((t) => t.solicitudes);

/** La parte de la solicitud número `indice` (desde 0) de ese lote. */
export function parteEn(tramos: Tramo[], indice: number): Parte | null {
  let resto = indice;
  for (const t of tramos) {
    if (resto < t.solicitudes.length) return t.parte;
    resto -= t.solicitudes.length;
  }
  return null;
}

// ── El rechazo de Google ──────────────────────────────────────────────────────

/**
 * Google rechazó una solicitud del lote.
 *
 * Lo levanta la implementación real de `Documentos` cuando la API contesta
 * 400, y solo entonces: un fallo de red, de permisos o de cuota no dice nada
 * de las solicitudes, y no se trata igual.
 *
 * Vive aquí y no junto a `googleapis` para que la lógica que lo interpreta se
 * pueda probar sin importar el cliente de Google.
 */
export class LoteRechazado extends Error {
  /** El número de la solicitud que Google señaló, desde 0; `null` si no lo dijo. */
  readonly indice: number | null;

  constructor(mensajeDeGoogle: string, opciones?: { cause?: unknown }) {
    super(mensajeDeGoogle, opciones);
    this.name = "LoteRechazado";
    this.indice = indiceRechazado(mensajeDeGoogle);
  }
}

/**
 * El número de solicitud que trae el mensaje de la API.
 *
 * Google lo dice así: «Invalid requests[52].pinTableHeaderRows: …». Es el
 * índice dentro de la lista que se le mandó, contando desde 0.
 */
export function indiceRechazado(mensaje: string): number | null {
  const m = /requests\[(\d+)\]/.exec(mensaje);
  return m ? Number(m[1]) : null;
}

/** «Google rechazó la tabla de partidas», o lo que se sepa. */
function queRechazo(err: LoteRechazado, tramos: Tramo[]): string {
  const parte = err.indice === null ? null : parteEn(tramos, err.indice);
  return parte
    ? `Google rechazó ${parte.nombre}`
    : "Google rechazó el lote sin decir qué solicitud";
}

/** El error que ve el usuario cuando no sale el documento. */
function errorConNombre(err: LoteRechazado, tramos: Tramo[]): Error {
  return new Error(
    `No se pudo generar el documento: ${queRechazo(err, tramos)}. ` +
      `Lo que contestó Google: «${err.message}».`,
    { cause: err },
  );
}

// ── Aplicar ───────────────────────────────────────────────────────────────────

export interface LoteAplicado {
  /** Cuántas solicitudes entraron. */
  aplicadas: number;
  /** Qué formato se quedó fuera y por qué. Vacío si entró todo. */
  avisos: string[];
}

/**
 * Aplica el lote. Si Google lo rechaza, reintenta una vez sin el formato.
 *
 * Solo se reintenta un **rechazo**. Un fallo de red o de cuota no dice nada
 * del formato: reintentar sin él sacaría un documento sin formato que habría
 * salido completo con solo volver a dar al botón.
 */
export async function aplicarLote(
  documentos: Documentos,
  docId: string,
  tramos: Tramo[],
): Promise<LoteAplicado> {
  const completo = todas(tramos);
  if (completo.length === 0) return { aplicadas: 0, avisos: [] };

  try {
    await documentos.aplicarCambios(docId, completo);
    return { aplicadas: completo.length, avisos: [] };
  } catch (err) {
    if (!(err instanceof LoteRechazado)) throw err;

    const formato = tramos.filter((t) => t.parte.grupo === "formato");
    // Sin formato que quitar, el reintento mandaría el mismo lote.
    if (formato.length === 0) throw errorConNombre(err, tramos);

    // Aquí y no al final: si el reintento también falla, este error es el
    // que dice qué rechazó Google la primera vez.
    console.error(
      "[cotizador/documento] Google rechazó el lote; se reintenta solo con el contenido.",
      { docId, solicitud: err.indice, parte: queRechazo(err, tramos), mensaje: err.message },
    );

    const contenido = tramos.filter((t) => t.parte.grupo === "contenido");
    const soloContenido = todas(contenido);
    try {
      if (soloContenido.length > 0) await documentos.aplicarCambios(docId, soloContenido);
    } catch (err2) {
      // El índice de este segundo rechazo es de la lista sin formato.
      if (err2 instanceof LoteRechazado) throw errorConNombre(err2, contenido);
      throw err2;
    }

    const faltan = [...new Set(formato.map((t) => t.parte))];
    return {
      aplicadas: soloContenido.length,
      avisos: [
        `${queRechazo(err, tramos)} y el documento salió sin formato: el contenido está ` +
          `completo, pero falta lo de abajo. Lo que contestó Google: «${err.message}».`,
        ...faltan.map((p) => p.siFalta ?? `Falta ${p.nombre}.`),
      ],
    };
  }
}
