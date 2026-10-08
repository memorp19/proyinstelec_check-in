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

/**
 * `informativo` no es un problema: es un hecho de la operación que el reporte
 * enumera para que se vea. "ASIGNADA sin orden de compra" son 22 cotizaciones
 * con el trabajo ejecutado y la OC todavía pendiente del cliente; mezclarlas
 * con los avisos haría ruido sobre lo que sí hay que mirar.
 */
export type Severidad = "bloqueante" | "aviso" | "informativo";

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

const informativo = (tipo: string, referencia: string, mensaje: string): Hallazgo => ({
  severidad: "informativo",
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
  /** Serial de Excel. Null si la celda viene vacía O si no es un número. */
  fechaSolicitud: number | null;
  fechaEntrega: number | null;
  /**
   * Lo que había escrito en las celdas de fecha, para poder distinguir "vacía"
   * de "capturada como texto". La 136 v2 trae `19/5/0226` —año 0226, un error
   * de dedo— y Excel nunca la convirtió en fecha porque es una cadena.
   */
  fechaSolicitudCruda: string;
  fechaEntregaCruda: string;
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
    fechaSolicitudCruda: texto(celdas.L),
    fechaEntregaCruda: texto(celdas.M),
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

// ── Ajustes de operación ──────────────────────────────────────────────────────

/**
 * Un cambio sobre una fila leída, decidido por la operación.
 *
 * El criterio es estrecho a propósito: un error de captura se corrige en el
 * Excel, donde lo ve quien lo mantiene. Esto es para lo contrario — filas donde
 * el Excel dice la verdad para su propio uso y aun así el ERP necesita otra
 * cosa. El caso que lo motiva: una cotización cuyo trabajo ya se ejecutó pero
 * que en el control sigue en ENVIADA porque la orden de compra del cliente no
 * ha llegado.
 *
 * `motivo` es obligatorio y es lo que se revisa en el PR: sin él esto sería una
 * lista de excepciones sin dueño.
 */
export interface Ajuste {
  cotizacion: number;
  anio: number;
  version: number;
  estatus?: string;
  ordenCompra?: string | null;
  folioOt?: string | null;
  /**
   * El folio con el que esa OT aparece en el Control de Proceso y en el de OT.
   *
   * La 178 trabaja con la v2, pero los controles conservan `OT178261` —el de la
   * v1— porque el reporte ya se emitió con ese folio. Sin la equivalencia, la
   * validación cruzada no encontraría la OT y su estatus se perdería.
   */
  equivalenciaOt?: string;
  motivo: string;
}

/** Los campos que un ajuste puede cambiar, para validar que cambie alguno. */
const CAMPOS_AJUSTABLES = ["estatus", "ordenCompra", "folioOt"] as const;

export interface LecturaAjustes {
  ajustes: Ajuste[];
  hallazgos: Hallazgo[];
}

/**
 * Valida el contenido del archivo de ajustes. Una entrada mal formada bloquea:
 * un ajuste silenciosamente ignorado dejaría la carga distinta de lo que su
 * autor cree, que es justo lo que este archivo viene a evitar.
 */
export function leerAjustes(crudo: unknown): LecturaAjustes {
  const hallazgos: Hallazgo[] = [];
  const lista = (crudo as { ajustes?: unknown })?.ajustes;

  if (!Array.isArray(lista)) {
    return {
      ajustes: [],
      hallazgos: [
        bloqueante("ajustes-ilegibles", "ajustes", 'El archivo no tiene un arreglo "ajustes"'),
      ],
    };
  }

  const ajustes: Ajuste[] = [];
  const vistos = new Set<string>();

  lista.forEach((item, i) => {
    const a = item as Record<string, unknown>;
    const ref = `ajuste #${i + 1}`;
    const enteros = ["cotizacion", "anio", "version"] as const;

    const falta = enteros.find((k) => !Number.isInteger(a[k]));
    if (falta) {
      hallazgos.push(bloqueante("ajuste-invalido", ref, `"${falta}" falta o no es un entero`));
      return;
    }

    if (typeof a.motivo !== "string" || a.motivo.trim() === "") {
      hallazgos.push(
        bloqueante(
          "ajuste-sin-motivo",
          `${a.cotizacion}-${a.anio} v${a.version}`,
          "Sin motivo. Un ajuste sin motivo es una excepción sin dueño",
        ),
      );
      return;
    }

    const clave = `${a.cotizacion}-${a.anio}-${a.version}`;
    if (vistos.has(clave)) {
      hallazgos.push(bloqueante("ajuste-duplicado", clave, "Dos ajustes para la misma versión"));
      return;
    }
    vistos.add(clave);

    const cambia = CAMPOS_AJUSTABLES.some((k) => k in a);
    if (!cambia && !("equivalenciaOt" in a)) {
      hallazgos.push(
        bloqueante("ajuste-vacio", clave, `No cambia ningún campo (${CAMPOS_AJUSTABLES.join(", ")})`),
      );
      return;
    }

    ajustes.push(a as unknown as Ajuste);
  });

  return { ajustes, hallazgos };
}

export interface AjusteAplicado {
  ajuste: Ajuste;
  /** Qué cambió, en texto, para el reporte: `estatus ENVIADA → ASIGNADA`. */
  cambios: string[];
}

export interface AplicacionAjustes {
  filas: FilaCotizacion[];
  /** `${cotizacion}-${version}` → folio con el que la OT vive en los controles. */
  equivalencias: Map<string, string>;
  aplicados: AjusteAplicado[];
  hallazgos: Hallazgo[];
}

/**
 * Aplica los ajustes sobre las filas leídas, antes de evaluar cualquier regla.
 *
 * Un ajuste que apunta a una fila inexistente, o que ya no cambia nada, se
 * avisa y no se aplica: significa que el Excel ya se corrigió y la entrada
 * sobra. Avisar y no bloquear es deliberado — la carga no se detiene por una
 * excepción que dejó de hacer falta, pero nadie se entera tarde de que el
 * archivo acumula entradas muertas.
 */
export function aplicarAjustes(filas: FilaCotizacion[], ajustes: Ajuste[]): AplicacionAjustes {
  const porClave = new Map(filas.map((f) => [`${f.numero}-${f.anio}-${f.version}`, f]));
  const equivalencias = new Map<string, string>();
  const aplicados: AjusteAplicado[] = [];
  const hallazgos: Hallazgo[] = [];

  for (const a of ajustes) {
    const clave = `${a.cotizacion}-${a.anio}-${a.version}`;
    const ref = `${String(a.cotizacion).padStart(3, "0")}-${a.anio} v${a.version}`;
    const fila = porClave.get(clave);

    if (!fila) {
      hallazgos.push(
        aviso(
          "ajuste-sin-fila",
          ref,
          "El ajuste apunta a una versión que no existe en el Control de Cotizaciones; no se aplica",
        ),
      );
      continue;
    }

    const cambios: string[] = [];
    if (a.estatus !== undefined && fila.estatus !== a.estatus) {
      cambios.push(`estatus ${fila.estatus} → ${a.estatus}`);
      fila.estatus = a.estatus;
    }
    if (a.ordenCompra !== undefined && fila.ordenCompra !== a.ordenCompra) {
      cambios.push(`OC ${fila.ordenCompra ?? "(ninguna)"} → ${a.ordenCompra ?? "(ninguna)"}`);
      fila.ordenCompra = a.ordenCompra;
    }
    if (a.folioOt !== undefined && fila.folioOt !== a.folioOt) {
      cambios.push(`OT ${fila.folioOt ?? "(ninguna)"} → ${a.folioOt ?? "(ninguna)"}`);
      fila.folioOt = a.folioOt;
    }
    if (a.equivalenciaOt) {
      equivalencias.set(`${a.cotizacion}-${a.version}`, a.equivalenciaOt.trim().toUpperCase());
      cambios.push(`en los controles aparece como ${a.equivalenciaOt}`);
    }

    if (cambios.length === 0) {
      hallazgos.push(
        aviso(
          "ajuste-innecesario",
          ref,
          "La fila ya está como pide el ajuste; probablemente el Excel ya se corrigió y la entrada sobra",
        ),
      );
      continue;
    }

    aplicados.push({ ajuste: a, cambios });
  }

  return { filas, equivalencias, aplicados, hallazgos };
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
  /**
   * Folio con el que esta OT vive en los controles, cuando no es el suyo. Un
   * control que traiga este folio se toma como confirmación, no como
   * desacuerdo: es una equivalencia decidida, no una discrepancia.
   */
  equivalenciaOt?: string | null;
}): ResultadoOT {
  const esperado = folioOT(params.numero, params.anio, params.version);
  const ref = `${String(params.numero).padStart(3, "0")}-${params.anio} v${params.version}`;
  const hallazgos: Hallazgo[] = [];

  const equivalente = (params.equivalenciaOt ?? "").trim().toUpperCase() || null;
  const norm = (v: string | null | undefined) => {
    const limpio = (v ?? "").trim().toUpperCase() || null;
    // La equivalencia se resuelve antes de comparar, para que el folio que los
    // controles conservan cuente como el folio bueno.
    return limpio !== null && limpio === equivalente ? esperado : limpio;
  };
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


// ── Consultas de escritura ────────────────────────────────────────────────────

/**
 * Una funcion de consulta en forma de *tagged template*, como la que devuelve
 * `neon()`.
 *
 * El tipo importa: `neon()` tambien se puede LLAMAR con una cadena
 * (`sql("SELECT 1")`), y entonces trata el argumento como texto de consulta ya
 * terminado. Si lo que se le pasa es un template literal de JavaScript, los
 * `${...}` ya se concatenaron antes de que la libreria vea nada, y el valor
 * viaja dentro del SQL. Un cliente llamado "GSM INDUSTRIAL" produce entonces
 * `... VALUES (GSM INDUSTRIAL)` y Postgres responde
 * `syntax error at or near "INDUSTRIAL"`.
 *
 * Declarar el parametro como tagged template obliga a escribir sql`...` en
 * todas las escrituras, que es la forma que SI parametriza.
 */
export type ConsultaSql<T = unknown> = (
  plantilla: TemplateStringsArray,
  ...valores: unknown[]
) => T;

/** Los campos de una cotizacion tal como se escriben. */
export interface FilaEscribible {
  numero: number;
  anio: number;
  version: number;
  folio: string;
  cliente: string;
  clienteId: string | null;
  titulo: string;
  dirigidaA: string;
  prioridad: string;
  estatus: string;
  elaboro: string;
  /** ISO 8601. La columna es NOT NULL. */
  fechaSolicitud: string;
  fechaEntrega: string | null;
  ordenCompra: string | null;
  folioOt: string | null;
  createdBy: string;
}

export function insertarCotizacion<T>(sql: ConsultaSql<T>, f: FilaEscribible): T {
  return sql`INSERT INTO cotizaciones
       (numero, anio, version, folio, cliente, cliente_id, titulo, dirigida_a,
        prioridad, estatus, elaboro, fecha_solicitud, fecha_entrega,
        orden_compra, folio_ot, created_by)
     VALUES (${f.numero}, ${f.anio}, ${f.version}, ${f.folio}, ${f.cliente}, ${f.clienteId},
             ${f.titulo}, ${f.dirigidaA}, ${f.prioridad}, ${f.estatus}, ${f.elaboro},
             ${f.fechaSolicitud}, ${f.fechaEntrega}, ${f.ordenCompra}, ${f.folioOt},
             ${f.createdBy})`;
}

export interface OtEscribible {
  folio: string;
  numeroCotizacion: number;
  anio: number;
  version: number;
  ordenCompra: string | null;
  cliente: string;
  titulo: string;
  dirigidaA: string;
  estatus: string;
  createdBy: string;
}

export function insertarOT<T>(sql: ConsultaSql<T>, o: OtEscribible): T {
  return sql`INSERT INTO ordenes_trabajo
       (folio, numero_cotizacion, anio, version, orden_compra, cliente, titulo,
        dirigida_a, estatus, created_by)
     VALUES (${o.folio}, ${o.numeroCotizacion}, ${o.anio}, ${o.version}, ${o.ordenCompra},
             ${o.cliente}, ${o.titulo}, ${o.dirigidaA}, ${o.estatus}, ${o.createdBy})`;
}

export interface ClienteEscribible {
  id: string;
  razonSocial: string;
  razonNormalizada: string;
  createdBy: string;
}

export function insertarCliente<T>(sql: ConsultaSql<T>, c: ClienteEscribible): T {
  return sql`INSERT INTO clientes (id, razon_social, razon_normalizada, created_by)
     VALUES (${c.id}, ${c.razonSocial}, ${c.razonNormalizada}, ${c.createdBy})
     ON CONFLICT DO NOTHING`;
}

export interface BitacoraEscribible {
  id: string;
  usuario: string;
  referencia: string;
  detalle: string;
}

export function insertarBitacora<T>(sql: ConsultaSql<T>, b: BitacoraEscribible): T {
  return sql`INSERT INTO bitacora (id, accion, usuario, referencia, detalle)
     VALUES (${b.id}, 'COTIZACION_IMPORTADA', ${b.usuario}, ${b.referencia}, ${b.detalle})`;
}

/**
 * El borrado del anio, en orden de dependencia: los responsables cuelgan de la
 * OT. `ot_responsables` caeria por ON CASCADE, pero se borra explicitamente
 * para que el orden quede escrito.
 */
export function borrarAnio<T>(sql: ConsultaSql<T>, anio: number): T[] {
  return [
    sql`DELETE FROM ot_responsables WHERE folio_ot IN (
          SELECT folio FROM ordenes_trabajo WHERE anio = ${anio})`,
    sql`DELETE FROM aprobaciones WHERE anio = ${anio}`,
    sql`DELETE FROM ordenes_trabajo WHERE anio = ${anio}`,
    sql`DELETE FROM bitacora WHERE referencia LIKE ${"%-" + anio}`,
    sql`DELETE FROM cotizaciones WHERE anio = ${anio}`,
  ];
}

export const MARCA_ENSAYO = "ENSAYO_ROLLBACK_DELIBERADO";

/**
 * Hace fallar la transaccion a proposito, para el modo de ensayo: todas las
 * escrituras se ejecutan de verdad —y sus restricciones se comprueban— pero el
 * lote revierte y no queda nada.
 *
 * Es un cast imposible y no un `RAISE EXCEPTION` dentro de un bloque `DO`
 * porque ahi el cuerpo va entre `$$...$$`: un `$1` dentro de esas comillas no
 * es un parametro sino texto literal, asi que la sentencia declararia cero
 * parametros y el driver mandaria uno. Postgres incluye el valor rechazado en
 * el mensaje (`invalid input syntax for type integer: "..."`), que es como se
 * reconoce que el fallo fue el deliberado y no uno de verdad.
 */
export function abortarEnsayo<T>(sql: ConsultaSql<T>): T {
  return sql`SELECT CAST(${MARCA_ENSAYO} AS integer)`;
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
  /**
   * Versiones que van a quedar NO ASIGNADA. Se pasan para no avisar de cosas
   * que la carga ya resuelve: una version descartada no recibe OT, asi que
   * "tiene OT pero no esta ASIGNADA" seria ruido sobre un dato que no se
   * escribe. La 178 v1 es el caso.
   */
  descartadas: readonly number[] = [],
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
    // el trabajo arrancó sin que el estatus lo refleje — salvo que la versión
    // vaya a quedar descartada, en cuyo caso su OT no se escribe y no hay nada
    // que avisar.
    if (f.folioOt && f.estatus !== "ASIGNADA" && !descartadas.includes(f.version)) {
      hallazgos.push(
        aviso("ot-sin-asignada", `${ref} v${f.version}`, `Tiene OT ${f.folioOt} pero está en ${f.estatus}`),
      );
    }

    // No es un problema: el trabajo se ejecuta y la OC del cliente llega
    // después. Se enumera para que se vea cuántas están en esa situación.
    if (f.estatus === "ASIGNADA" && !f.ordenCompra) {
      hallazgos.push(
        informativo("asignada-sin-oc", `${ref} v${f.version}`, "ASIGNADA sin orden de compra todavía"),
      );
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
          f.fechaSolicitudCruda ? "fecha-solicitud-ilegible" : "sin-fecha-solicitud",
          `${ref} v${f.version}`,
          f.fechaSolicitudCruda
            ? `La fecha de solicitud dice "${f.fechaSolicitudCruda}", capturada como texto: Excel nunca la convirtió en fecha. Corrígela en el Excel`
            : "Sin fecha de solicitud, y la columna es NOT NULL; captúrala en el Excel (no se inventa)",
        ),
      );
    }

    // La de entrega sí es nullable, así que un valor ilegible se iría como NULL
    // sin que nadie se entere. Se avisa.
    if (f.fechaEntrega === null && f.fechaEntregaCruda) {
      hallazgos.push(
        aviso(
          "fecha-entrega-ilegible",
          `${ref} v${f.version}`,
          `La fecha de entrega dice "${f.fechaEntregaCruda}", capturada como texto; se cargaría vacía`,
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
