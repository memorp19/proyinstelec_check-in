/**
 * Reglas de la recarga de 2026 desde los controles en Excel.
 *
 * Todo lo que hay aquí es puro: recibe celdas o filas ya leídas y devuelve
 * datos o hallazgos. No toca la base ni el sistema de archivos. Vive en
 * `src/lib` y no junto al script porque `scripts/` queda fuera de vitest, y
 * porque estas reglas son las del dominio: dónde vive la verdad de un folio, de
 * una orden de compra o de un estatus no depende de quién las ejecute.
 *
 * El reparto de fuentes, que es la decisión de fondo:
 *
 * - **Control de Cotizaciones** manda en cotizaciones, versión aceptada,
 *   estatus, OC y OT.
 * - **Control de Proceso** y **Control de Órdenes de Trabajo** solo validan: si
 *   discrepan, se carga lo que dice Cotizaciones y la diferencia se reporta.
 * - El **estatus de la OT** es la excepción: esa columna solo existe en el
 *   Control de Órdenes de Trabajo.
 */
import { type Celda, texto } from "./excel";
import { folioCotizacion, folioOT } from "./folios";

// ── Hallazgos ─────────────────────────────────────────────────────────────────

export type Severidad = "bloqueante" | "aviso";

export interface Hallazgo {
  severidad: Severidad;
  /** Para agrupar en el reporte: `oc-doble`, `ot-no-cuadra`, … */
  tipo: string;
  /** A qué se refiere: `141-2026 v1`, `OT225260`. */
  referencia: string;
  mensaje: string;
}

const aviso = (tipo: string, referencia: string, mensaje: string): Hallazgo => ({
  severidad: "aviso",
  tipo,
  referencia,
  mensaje,
});

const bloqueante = (tipo: string, referencia: string, mensaje: string): Hallazgo => ({
  severidad: "bloqueante",
  tipo,
  referencia,
  mensaje,
});

// ── Lectura de una fila de cotización ─────────────────────────────────────────

export interface FilaCotizacion {
  /** Fila del Excel, para poder señalarla en el reporte. */
  fila: number;
  numero: number;
  anio: number;
  version: number;
  folio: string;
  cliente: string;
  titulo: string;
  dirigidaA: string;
  prioridad: "BAJA" | "MEDIA" | "ALTA";
  estatus: string;
  elaboro: string;
  /** Serial de Excel. Null si la celda viene vacía. */
  fechaSolicitud: number | null;
  fechaEntrega: number | null;
  ordenCompra: string | null;
  folioOt: string | null;
}

/** El estatus que marca una fila sin cotización real (números reservados). */
export const ESTATUS_VACIO = "Elegir";

/** La 450 es la cotización de prueba del equipo; nunca se carga. */
export const NUMERO_DE_PRUEBA = 450;

export const PRIORIDADES = ["BAJA", "MEDIA", "ALTA"] as const;

/**
 * ¿Esta fila del Control de Cotizaciones es una cotización real?
 *
 * Las filas con estatus "Elegir" son números reservados sin capturar (268-449)
 * y la 450 es la de prueba. Ninguna de las dos se carga.
 */
export function esFilaCargable(numero: number, estatus: string): boolean {
  return estatus !== ESTATUS_VACIO && estatus !== "" && numero !== NUMERO_DE_PRUEBA;
}

/**
 * Convierte una fila del Control de Cotizaciones. Devuelve null si no es una
 * fila de datos — el marcador de la columna B es lo que las distingue del
 * encabezado y de los renglones de formato.
 */
export function leerFilaCotizacion(
  fila: number,
  celdas: Record<string, Celda>,
): FilaCotizacion | null {
  if (texto(celdas.B).toUpperCase() !== "PCOTOP") return null;

  const numero = parseInt(texto(celdas.C), 10);
  const anio = parseInt(texto(celdas.D), 10);
  if (!Number.isInteger(numero) || !Number.isInteger(anio)) return null;

  const version = parseInt(texto(celdas.E) || "0", 10) || 0;
  const prioridadCruda = texto(celdas.I).toUpperCase();

  return {
    fila,
    numero,
    anio,
    version,
    folio: folioCotizacion(numero, anio, version),
    cliente: texto(celdas.F),
    titulo: texto(celdas.G),
    dirigidaA: texto(celdas.H),
    prioridad: (PRIORIDADES as readonly string[]).includes(prioridadCruda)
      ? (prioridadCruda as FilaCotizacion["prioridad"])
      : "MEDIA",
    estatus: texto(celdas.J),
    elaboro: texto(celdas.K),
    fechaSolicitud: serialOpcional(celdas.L),
    fechaEntrega: serialOpcional(celdas.M),
    ordenCompra: ordenCompraCruda(celdas.N),
    folioOt: texto(celdas.O) || null,
  };
}

function serialOpcional(celda: Celda | undefined): number | null {
  const v = texto(celda);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Orden de compra ───────────────────────────────────────────────────────────

/**
 * La OC tal como está capturada, o null.
 *
 * El guion es la forma del equipo de decir "no hay OC"; se guarda como NULL y
 * no como el texto "-", que después nadie sabría si es un dato o una marca.
 *
 * Nunca se interpreta como número ni como fecha: hay OC que son `78627`, otras
 * `MEX01-0000230798` y otras `Co0001/150/26/255492`. Es un identificador.
 */
export function ordenCompraCruda(celda: Celda | undefined): string | null {
  const v = texto(celda);
  if (!v || v === "-") return null;
  return v;
}

/**
 * ¿La celda trae DOS órdenes de compra?
 *
 * Se exige el separador con espacios (` / `). Es lo que distingue
 * `4501122596 / 4501153770`, que son dos OC de SYMRISE, de
 * `Co0001/150/26/255492`, que es UNA sola OC con diagonales dentro del código.
 * Partir por "/" a secas convertiría las de la 185 y la 234 en cuatro OC
 * inventadas.
 */
export function esOrdenCompraDoble(oc: string | null): boolean {
  return oc !== null && / \/ /.test(oc);
}

// ── Folio de la orden de trabajo ──────────────────────────────────────────────

export interface ResultadoOT {
  /** El folio que se va a cargar, o null si ninguna fuente da uno válido. */
  folio: string | null;
  hallazgos: Hallazgo[];
}

/**
 * Decide el folio de OT de una cotización confrontando las tres fuentes.
 *
 * La regla dura: el folio tiene que ser el de SU propia fila,
 * `OT{NNN}{AA}{version}`. Un folio que pertenece a otra cotización no es un
 * detalle de captura — es el identificador con el que después se buscan
 * reportes, gastos y facturas. La 225 traía `OT226260`, que es la OT de la 226.
 *
 * Si Cotizaciones trae uno que no cuadra pero otra fuente trae el correcto, se
 * usa el correcto y se reporta. Si ninguna cuadra, no se carga OT y se reporta:
 * inventarla sería peor que no tenerla.
 */
export function resolverFolioOT(params: {
  numero: number;
  anio: number;
  version: number;
  deCotizaciones: string | null;
  deProceso?: string | null;
  deControlOT?: string | null;
}): ResultadoOT {
  const esperado = folioOT(params.numero, params.anio, params.version);
  const ref = `${String(params.numero).padStart(3, "0")}-${params.anio} v${params.version}`;
  const hallazgos: Hallazgo[] = [];

  const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase() || null;
  const cot = norm(params.deCotizaciones);
  const proc = norm(params.deProceso);
  const ctrl = norm(params.deControlOT);

  // Desacuerdos entre fuentes: se reportan aunque al final se cargue el bueno.
  for (const [nombre, valor] of [
    ["Control de Proceso", proc],
    ["Control de OT", ctrl],
  ] as const) {
    if (valor && cot && valor !== cot) {
      hallazgos.push(
        aviso("ot-desacuerdo", ref, `Cotizaciones dice ${cot} y ${nombre} dice ${valor}`),
      );
    }
  }

  if (cot === esperado) return { folio: esperado, hallazgos };

  // Cotizaciones no cuadra. ¿Alguna otra fuente trae el folio correcto?
  const respaldo = [
    ["Control de Proceso", proc],
    ["Control de OT", ctrl],
  ].find(([, v]) => v === esperado);

  if (respaldo) {
    hallazgos.push(
      aviso(
        "ot-corregida",
        ref,
        `Cotizaciones trae ${cot ?? "(vacío)"}, que no es de esta cotización; se usa ${esperado}, que confirma ${respaldo[0]}`,
      ),
    );
    return { folio: esperado, hallazgos };
  }

  if (cot) {
    hallazgos.push(
      bloqueante(
        "ot-no-cuadra",
        ref,
        `El folio ${cot} no corresponde a esta cotización (debería ser ${esperado}) y ninguna otra fuente lo confirma; no se carga OT`,
      ),
    );
  }
  return { folio: null, hallazgos };
}

// ── Estatus de la orden de trabajo ────────────────────────────────────────────

/**
 * Del catálogo del Control de OT al de la app.
 *
 * Son dos vocabularios distintos para lo mismo: el equipo escribe TERMINADO y
 * la app guarda "Cerrado". El guion significa que la cotización todavía no
 * tiene OT.
 */
export const MAPEO_ESTATUS_OT: Record<string, string> = {
  PROCESO: "En Proceso",
  "REVISIÓN": "Revisión",
  TERMINADO: "Cerrado",
};

export interface EstatusOTResuelto {
  estatus: string | null;
  hallazgos: Hallazgo[];
}

/**
 * Traduce el estatus del Control de OT. Un valor fuera del catálogo no se
 * adivina: la OT no se carga y se reporta, porque cargarla con un estatus
 * inventado la dejaría inmovilizable desde la app.
 */
export function mapearEstatusOT(crudo: string, referencia: string): EstatusOTResuelto {
  const v = crudo.trim();
  if (v === "" || v === "-") return { estatus: "", hallazgos: [] };

  const mapeado = MAPEO_ESTATUS_OT[v.toUpperCase()];
  if (mapeado !== undefined) return { estatus: mapeado, hallazgos: [] };

  return {
    estatus: null,
    hallazgos: [
      bloqueante(
        "estatus-ot-desconocido",
        referencia,
        `"${crudo}" no está en el catálogo del Control de OT (PROCESO, REVISIÓN, TERMINADO); no se carga esta OT`,
      ),
    ],
  };
}

// ── NO ASIGNADA ───────────────────────────────────────────────────────────────

/**
 * Las versiones que deben quedar en NO ASIGNADA.
 *
 * Cuando el cliente acepta una versión, las demás que seguían en ENVIADA ya
 * están descartadas de hecho. Importa aplicarlo en la carga y no después
 * porque `ORDEN_VIGENTE` salta NO ASIGNADA y CANCELADA pero **no** ENVIADA:
 * mientras una ENVIADA tenga la versión más alta, es ella la que representa a
 * la cotización, y el listado muestra una fila sin OC ni OT mientras esos datos
 * viven en la versión que sí se asignó.
 *
 * Solo toca las ENVIADA. Una versión en PROCESO, REVISION o DEPENDIENTE por
 * encima de la asignada también la tapa, pero descartarla no sería cierto —
 * sigue viva— así que se reporta como bloqueante y se deja quieta.
 */
export interface ResultadoDescarte {
  /** Versiones que pasan a NO ASIGNADA. */
  descartadas: number[];
  hallazgos: Hallazgo[];
}

export function versionesNoAsignadas(
  versiones: Array<{ version: number; estatus: string }>,
  referencia: string,
): ResultadoDescarte {
  const asignadas = versiones.filter((v) => v.estatus === "ASIGNADA");
  if (asignadas.length === 0) return { descartadas: [], hallazgos: [] };

  if (asignadas.length > 1) {
    return {
      descartadas: [],
      hallazgos: [
        bloqueante(
          "varias-asignadas",
          referencia,
          `${asignadas.length} versiones en ASIGNADA (v${asignadas
            .map((a) => a.version)
            .sort((x, y) => x - y)
            .join(", v")}); viola "una cotización, una OT"`,
        ),
      ],
    };
  }

  const referenciaVersion = asignadas[0].version;
  const descartadas = versiones
    .filter((v) => v.estatus === "ENVIADA")
    .map((v) => v.version)
    .sort((a, b) => a - b);

  // Las que tapan a la asignada sin ser ENVIADA: no se tocan, se avisan.
  const tapan = versiones
    .filter(
      (v) =>
        v.version > referenciaVersion &&
        !["ASIGNADA", "ENVIADA", "NO ASIGNADA", "CANCELADA"].includes(v.estatus),
    )
    .map((v) => `v${v.version} (${v.estatus})`);

  const hallazgos: Hallazgo[] = [];
  if (tapan.length > 0) {
    hallazgos.push(
      bloqueante(
        "tapan-la-asignada",
        referencia,
        `${tapan.join(", ")} está por encima de la v${referenciaVersion} ASIGNADA y no es descartable; la vigente no será la asignada`,
      ),
    );
  }
  return { descartadas, hallazgos };
}

// ── Clientes ──────────────────────────────────────────────────────────────────

/**
 * Razón social sin sufijos legales ni acentos. Misma regla que usa
 * `scripts/importar-erp.ts`, para que las dos entradas al catálogo coincidan.
 */
export function normalizarRazon(razon: string): string {
  return razon
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(
      /\b(s\.?\s?a\.?\s?p\.?\s?i\.?|s\.?\s?a\.?\s?b?\.?|de\s+c\.?\s?v\.?|s\.?\s+de\s+r\.?\s?l\.?|s\.?\s?c\.?|a\.?\s?c\.?)\b/gi,
      " ",
    )
    .replace(/[.,;:()\-&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ClienteResuelto {
  /** Id del catálogo, o null si hay que darlo de alta. */
  clienteId: string | null;
  /** Razón social con la que se daría de alta, si no existe. */
  altaComo: string | null;
  hallazgos: Hallazgo[];
}

/**
 * Empareja el nombre corto del Excel con el catálogo de `clientes`.
 *
 * Nunca descarta la fila. La carga anterior sí lo hacía: las 327 filas que
 * entraron tienen `cliente_id` no nulo, y las nueve cuyo cliente no se pudo
 * resolver —GSM INDUSTRIAL, AIFA, SEEISA, EQUIPO DE PRUEBAS, ACEROS CAMESA,
 * ELECTRICAL GLOBAL y JORGE EDUARDO UBALDO ZAVALA— desaparecieron sin aviso.
 * Son clientes reales, no basura: se dan de alta.
 *
 * El `alias` cubre los renombres que no salen de normalizar texto, porque son
 * decisiones humanas: CENTRO SANTA FE es ADMINISTRADORA DE CENTROS COMERCIALES
 * SANTA FE, y UVM HISPANO es un plantel de Universidad del Valle de México.
 */
export function resolverCliente(params: {
  nombreExcel: string;
  catalogo: Array<{ id: string; razonNormalizada: string }>;
  alias: Record<string, string>;
}): ClienteResuelto {
  const nombre = params.nombreExcel.trim();
  if (!nombre) {
    return {
      clienteId: null,
      altaComo: null,
      hallazgos: [bloqueante("cliente-vacio", "(sin cliente)", "La fila no trae cliente")],
    };
  }

  // El alias manda sobre la normalización: es una decisión tomada a mano.
  const porAlias = params.alias[nombre.toUpperCase()];
  const buscado = porAlias ?? nombre;

  const norm = normalizarRazon(buscado);
  const hit = params.catalogo.find((c) => normalizarRazon(c.razonNormalizada) === norm);
  if (hit) return { clienteId: hit.id, altaComo: null, hallazgos: [] };

  return {
    clienteId: null,
    altaComo: buscado,
    hallazgos: [
      aviso(
        "cliente-nuevo",
        nombre,
        porAlias
          ? `El alias apunta a "${porAlias}", que tampoco está en el catálogo; se da de alta`
          : `No está en el catálogo ni tiene alias; se da de alta como "${nombre}"`,
      ),
    ],
  };
}

// ── Inconsistencias que se reportan y no se resuelven ─────────────────────────

/**
 * Revisa el conjunto de filas de una cotización y devuelve lo que no cuadra.
 *
 * Ninguno de estos hallazgos detiene la carga por sí mismo: se carga lo que
 * dice el Control de Cotizaciones y la diferencia queda escrita. Los
 * bloqueantes sí impiden cargar **esa** cotización.
 */
export function revisarCotizacion(
  numero: number,
  anio: number,
  filas: FilaCotizacion[],
  estatusValidos: readonly string[],
): Hallazgo[] {
  const ref = `${String(numero).padStart(3, "0")}-${anio}`;
  const hallazgos: Hallazgo[] = [];

  // (numero, version) es la llave primaria: dos filas con la misma versión no
  // se pueden cargar las dos, y elegir cuál sería inventar.
  const porVersion = new Map<number, FilaCotizacion[]>();
  for (const f of filas) {
    const lista = porVersion.get(f.version) ?? [];
    lista.push(f);
    porVersion.set(f.version, lista);
  }
  for (const [version, lista] of porVersion) {
    if (lista.length > 1) {
      hallazgos.push(
        bloqueante(
          "version-duplicada",
          `${ref} v${version}`,
          `${lista.length} filas con la misma versión (filas ${lista
            .map((l) => l.fila)
            .join(", ")}: ${lista.map((l) => l.estatus).join(" / ")})`,
        ),
      );
    }
  }

  for (const f of filas) {
    if (!estatusValidos.includes(f.estatus)) {
      hallazgos.push(
        bloqueante("estatus-desconocido", `${ref} v${f.version}`, `Estatus "${f.estatus}" fuera del catálogo`),
      );
    }

    // La OT nace al aceptar la cotización. Una OT en otro estatus significa que
    // el trabajo arrancó sin que el estatus lo refleje.
    if (f.folioOt && f.estatus !== "ASIGNADA") {
      hallazgos.push(
        aviso("ot-sin-asignada", `${ref} v${f.version}`, `Tiene OT ${f.folioOt} pero está en ${f.estatus}`),
      );
    }

    if (f.estatus === "ASIGNADA" && !f.ordenCompra) {
      hallazgos.push(aviso("asignada-sin-oc", `${ref} v${f.version}`, "ASIGNADA sin orden de compra"));
    }

    if (esOrdenCompraDoble(f.ordenCompra)) {
      hallazgos.push(
        aviso("oc-doble", `${ref} v${f.version}`, `Dos órdenes de compra en una celda: ${f.ordenCompra}`),
      );
    }

    // `fecha_solicitud` es NOT NULL. Rellenarla con la fecha de hoy es lo que
    // hizo la carga anterior con la 002 v0, y dejó un dato falso que parece
    // bueno. Antes que eso, la carga se detiene.
    if (f.fechaSolicitud === null) {
      hallazgos.push(
        bloqueante(
          "sin-fecha-solicitud",
          `${ref} v${f.version}`,
          "Sin fecha de solicitud, y la columna es NOT NULL; captúrala en el Excel (no se inventa)",
        ),
      );
    }
  }

  // Una misma OT en dos cotizaciones distintas rompe "una cotización, una OT".
  return hallazgos;
}

/** Folios de OT repetidos entre cotizaciones distintas. */
export function otRepetidas(filas: FilaCotizacion[]): Hallazgo[] {
  const porFolio = new Map<string, FilaCotizacion[]>();
  for (const f of filas) {
    if (!f.folioOt) continue;
    const k = f.folioOt.trim().toUpperCase();
    const lista = porFolio.get(k) ?? [];
    lista.push(f);
    porFolio.set(k, lista);
  }

  const fuera: Hallazgo[] = [];
  for (const [folio, lista] of porFolio) {
    const cotizaciones = new Set(lista.map((l) => `${l.numero}-${l.anio}`));
    if (cotizaciones.size > 1) {
      fuera.push(
        bloqueante(
          "ot-compartida",
          folio,
          `El mismo folio de OT en ${[...cotizaciones].join(" y ")}`,
        ),
      );
    }
  }
  return fuera;
}
