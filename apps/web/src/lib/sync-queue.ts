import { addToQueue, getAllItems, removeItem, updateItem, type SyncItemType, type SyncQueueItem } from "./idb";
import { bytesABase64 } from "./foto-jornada";
import { cambiarJornadaLocal } from "./jornada-local";

/**
 * La cola de la app de campo: lo que se registró sin señal —o con la señal
 * cayéndose— espera en el teléfono y se manda solo al volver.
 *
 * Antes la cola guardaba, pero nadie la mandaba: un check-in sin señal nunca
 * llegaba al servidor, y sus fotos no se guardaban en ningún lado.
 *
 * **Tres cosas, en este orden:**
 * 1. el check-in → `POST /api/jornada`, que da el id de la jornada;
 * 2. el check-out → `PATCH /api/jornada/{id}`;
 * 3. las fotos → `POST /api/upload { tipo, jornadaId, base64 }`.
 *
 * Un check-in hecho sin señal todavía no tiene id del servidor: su check-out y
 * sus fotos lo nombran por el id de la cola, y se les cambia por el de verdad
 * en cuanto el check-in entra.
 *
 * **Sin duplicados:**
 * - check-in: si entró pero la respuesta se perdió, el reintento recibe 409
 *   con la jornada abierta, y esa se adopta;
 * - check-out: si ya estaba cerrada (409), cuenta como hecho;
 * - foto: el servidor la pone en su jornada una sola vez, y a un reintento le
 *   devuelve la que ya estaba;
 * - una sola pasada a la vez, también entre pestañas (Web Locks).
 *
 * **Qué se reintenta:**
 * - sin red, 5xx, 401, 408, 429, o «actualiza la aplicación»: se queda, sin
 *   límite de intentos, porque se puede pasar horas sin señal;
 * - la foto de salida con la jornada aún abierta (409): espera a su check-out;
 * - lo demás (400, 403, 404, 413, 415) no se arregla solo: se quita, junto con
 *   lo que depende de ello, y la pantalla lo avisa.
 */

export type Momento = "checkin" | "checkout";

export interface PayloadCheckin {
  proyectoId: string;
  checkIn: { timestamp: string; lat: number; lng: number; precision: number; deviceInfo?: unknown };
}

export interface PayloadCheckout {
  jornadaId: string;
  checkOut: {
    timestamp: string;
    lat: number;
    lng: number;
    precision: number;
    observaciones?: string;
    deviceInfo?: unknown;
  };
}

export interface PayloadFoto {
  momento: Momento;
  jornadaId: string;
  /** Ya comprimida. Como bytes y no como `Blob`: así la guarda bien cualquier navegador. */
  bytes: ArrayBuffer;
}

// ── Avisos a la pantalla ──────────────────────────────────────────────────────

/** Algo cambió en la cola: hay que volver a contar. */
export const EVENTO_COLA = "cola-campo";
/** Llegó algo nuevo: que se mande ya, si hay señal. */
export const EVENTO_DESPERTAR = "cola-campo:despertar";
/** Un check-in de la cola ya tiene id del servidor: `{ deCola, delServidor }`. */
export const EVENTO_JORNADA = "cola-campo:jornada";
/** Algo no se pudo mandar y se quitó: `{ mensaje }`. */
export const EVENTO_ERROR = "cola-campo:error";

function avisar(nombre: string, detalle?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(nombre, { detail: detalle }));
}

/** Pide que la cola se mande ya (si hay señal). */
export function despertarCola(): void {
  avisar(EVENTO_DESPERTAR);
}

/** Para que la pantalla diga algo que pasó fuera de la cola (no se pudo guardar la foto). */
export function avisarErrorDeCola(mensaje: string): void {
  avisar(EVENTO_ERROR, { mensaje });
}

/**
 * «Faltan 1 registro y 2 fotos por subir», para la pantalla. Vacío si no
 * falta nada.
 */
export function faltanPorSubir(c: { registros: number; fotos: number }): string {
  const partes = [
    c.registros > 0 ? `${c.registros} ${c.registros === 1 ? "registro" : "registros"}` : "",
    c.fotos > 0 ? `${c.fotos} ${c.fotos === 1 ? "foto" : "fotos"}` : "",
  ].filter(Boolean);
  if (partes.length === 0) return "";
  return `${c.registros + c.fotos === 1 ? "Falta" : "Faltan"} ${partes.join(" y ")} por subir`;
}

// ── Encolar y contar ──────────────────────────────────────────────────────────

export async function enqueue(type: SyncItemType, payload: unknown): Promise<string> {
  const id = crypto.randomUUID();
  await addToQueue({
    id,
    type,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
  });
  avisar(EVENTO_COLA);
  return id;
}

/** Deja la foto (ya comprimida) en la cola, para su jornada. */
export async function encolarFoto(p: { momento: Momento; jornadaId: string; foto: Blob }): Promise<string> {
  const payload: PayloadFoto = { momento: p.momento, jornadaId: p.jornadaId, bytes: await p.foto.arrayBuffer() };
  return enqueue("foto", payload);
}

/** Cuántos registros y cuántas fotos faltan por mandar. */
export async function contarCola(): Promise<{ registros: number; fotos: number }> {
  const items = await getAllItems();
  return {
    registros: items.filter((i) => i.type === "checkin" || i.type === "checkout").length,
    fotos: items.filter((i) => i.type === "foto").length,
  };
}

/** Si el id es el de un check-in que sigue en la cola: todavía no existe en el servidor. */
export async function esJornadaEnCola(jornadaId: string): Promise<boolean> {
  return (await getAllItems()).some((i) => i.type === "checkin" && i.id === jornadaId);
}

// ── Registrar con señal, o dejarlo en la cola ─────────────────────────────────

type Enviar = (url: string, init: RequestInit) => Promise<Response>;
const DE_VERDAD: Enviar = (url, init) => fetch(url, init);

/** Solo si el navegador dice que no hay red; sin `navigator` (pruebas) se intenta. */
const sinSenal = () => typeof navigator !== "undefined" && navigator.onLine === false;

const pedido = (method: string, cuerpo: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo),
});

const leer = async (r: Response): Promise<Record<string, unknown>> =>
  ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

/** Sin red, el servidor caído, la sesión vencida, demasiadas peticiones: vale volver a intentar. */
const seReintenta = (status: number) => status === 401 || status === 408 || status === 429 || status >= 500;

const textoDe = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const conPunto = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

/**
 * El check-in. Con señal va directo; sin ella, o si la red o el servidor
 * fallan, queda en la cola y se manda solo. Un rechazo del servidor (sin
 * acceso al proyecto, una jornada ya abierta) se lanza, para que la pantalla
 * lo diga: eso no se arregla esperando.
 */
export async function registrarCheckin(
  payload: PayloadCheckin,
  enviar: Enviar = DE_VERDAD,
): Promise<{ jornadaId: string; enCola: boolean }> {
  const aLaCola = async () => ({ jornadaId: await enqueue("checkin", payload), enCola: true });
  if (sinSenal()) return aLaCola();
  let r: Response;
  try {
    r = await enviar("/api/jornada", pedido("POST", payload));
  } catch {
    return aLaCola();
  }
  const cuerpo = await leer(r);
  if (r.ok && typeof cuerpo.jornadaId === "string") return { jornadaId: cuerpo.jornadaId, enCola: false };
  if (seReintenta(r.status)) return aLaCola();
  throw new Error(textoDe(cuerpo.error) ?? "Error al registrar el check-in");
}

/**
 * El check-out. Si su check-in sigue en la cola, el cierre también espera
 * ahí: el servidor todavía no conoce esa jornada.
 */
export async function registrarCheckout(
  payload: PayloadCheckout,
  enviar: Enviar = DE_VERDAD,
): Promise<{ duracionMinutos: number | null; enCola: boolean }> {
  const aLaCola = async () => {
    await enqueue("checkout", payload);
    return { duracionMinutos: null, enCola: true };
  };
  if (sinSenal() || (await esJornadaEnCola(payload.jornadaId))) return aLaCola();
  let r: Response;
  try {
    r = await enviar(
      `/api/jornada/${encodeURIComponent(payload.jornadaId)}`,
      pedido("PATCH", { checkOut: payload.checkOut }),
    );
  } catch {
    return aLaCola();
  }
  const cuerpo = await leer(r);
  if (r.ok) {
    return {
      duracionMinutos: typeof cuerpo.duracionMinutos === "number" ? cuerpo.duracionMinutos : null,
      enCola: false,
    };
  }
  if (seReintenta(r.status)) return aLaCola();
  throw new Error(textoDe(cuerpo.error) ?? "Error al registrar el check-out");
}

// ── Mandar la cola ────────────────────────────────────────────────────────────

export interface ResultadoDeCola {
  /** Lo que se mandó en esta pasada. */
  enviados: number;
  /** Lo que sigue en la cola. */
  pendientes: number;
  /** Lo que no se pudo mandar y se quitó, dicho para la persona. */
  errores: string[];
}

type Paso =
  | { tipo: "hecho"; jornadaId?: string }
  | { tipo: "esperar" }
  | { tipo: "reintentar" }
  | { tipo: "descartar"; motivo: string };

/** Lo que dice una respuesta que no fue un éxito ni un caso especial. */
function segunLaRespuesta(r: Response, cuerpo: Record<string, unknown>): Paso {
  // «Actualiza la aplicación»: lo guardado no tiene nada malo; cuando la app
  // se actualice, la versión nueva lo manda bien.
  if (seReintenta(r.status) || cuerpo.actualizar === true) return { tipo: "reintentar" };
  return { tipo: "descartar", motivo: textoDe(cuerpo.error) ?? `El servidor lo rechazó (${r.status})` };
}

async function mandarCheckin(item: SyncQueueItem, enviar: Enviar): Promise<Paso> {
  let r: Response;
  try {
    r = await enviar("/api/jornada", pedido("POST", item.payload));
  } catch {
    return { tipo: "reintentar" };
  }
  const cuerpo = await leer(r);
  if (r.ok && typeof cuerpo.jornadaId === "string") return { tipo: "hecho", jornadaId: cuerpo.jornadaId };
  // Ya había entrado y la respuesta se perdió: el servidor dice cuál está
  // abierta, y esa es. Volver a crearla sería una jornada repetida.
  if (r.status === 409 && typeof cuerpo.jornadaId === "string") {
    return { tipo: "hecho", jornadaId: cuerpo.jornadaId };
  }
  return segunLaRespuesta(r, cuerpo);
}

async function mandarCheckout(item: SyncQueueItem, enviar: Enviar): Promise<Paso> {
  const { jornadaId, checkOut } = item.payload as PayloadCheckout;
  let r: Response;
  try {
    r = await enviar(`/api/jornada/${encodeURIComponent(jornadaId)}`, pedido("PATCH", { checkOut }));
  } catch {
    return { tipo: "reintentar" };
  }
  // Ya estaba cerrada: este mismo cierre entró antes.
  if (r.ok || r.status === 409) return { tipo: "hecho" };
  return segunLaRespuesta(r, await leer(r));
}

async function mandarFoto(item: SyncQueueItem, enviar: Enviar): Promise<Paso> {
  const { momento, jornadaId, bytes } = item.payload as PayloadFoto;
  let r: Response;
  try {
    r = await enviar(
      "/api/upload",
      pedido("POST", { tipo: momento, jornadaId, base64: bytesABase64(new Uint8Array(bytes)) }),
    );
  } catch {
    return { tipo: "reintentar" };
  }
  if (r.ok) return { tipo: "hecho" };
  // La jornada sigue abierta (su cierre no ha entrado): la foto de salida espera.
  if (r.status === 409) return { tipo: "esperar" };
  return segunLaRespuesta(r, await leer(r));
}

const QUE: Record<string, string> = {
  checkin: "Un check-in hecho sin señal no se pudo registrar",
  checkout: "Un check-out hecho sin señal no se pudo registrar",
  foto: "Una foto no se pudo subir",
};

const ordenados = async () =>
  (await getAllItems()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const jornadaDe = (item: SyncQueueItem) => (item.payload as { jornadaId?: string } | null)?.jornadaId;

/**
 * El check-in entró: a lo que lo esperaba se le pone el id del servidor, y
 * después se quita de la cola. En ese orden: si la app se cierra entre los
 * dos pasos, el reintento recibe 409 con el mismo id y no pasa nada.
 */
async function resolverJornada(deCola: string, delServidor: string): Promise<void> {
  for (const item of await getAllItems()) {
    if (item.id !== deCola && jornadaDe(item) === deCola) {
      await updateItem(item.id, { payload: { ...(item.payload as object), jornadaId: delServidor } });
    }
  }
  await removeItem(deCola);
  try {
    cambiarJornadaLocal(deCola, delServidor);
  } catch {
    // Sin almacenamiento local (pruebas, modo privado): no hay nada que cambiar.
  }
  avisar(EVENTO_JORNADA, { deCola, delServidor });
}

/** Lo que no se puede mandar se quita, con lo que depende de ello. */
async function descartar(item: SyncQueueItem, motivo: string, resultado: ResultadoDeCola): Promise<void> {
  const dependientes = (await getAllItems()).filter((otro) => {
    if (otro.id === item.id) return false;
    // Lo que esperaba el id de este check-in ya nunca lo va a tener.
    if (item.type === "checkin") return jornadaDe(otro) === item.id;
    // Sin cierre, la foto de salida no tiene dónde ponerse.
    if (item.type === "checkout") {
      return otro.type === "foto" && (otro.payload as PayloadFoto).momento === "checkout" && jornadaDe(otro) === jornadaDe(item);
    }
    return false;
  });
  for (const d of dependientes) await removeItem(d.id);
  await removeItem(item.id);
  resultado.errores.push(`${QUE[item.type] ?? "Algo no se pudo mandar"}: ${conPunto(motivo)}`);
}

async function pasada(enviar: Enviar): Promise<ResultadoDeCola> {
  const resultado: ResultadoDeCola = { enviados: 0, pendientes: 0, errores: [] };
  const terminar = async () => {
    resultado.pendientes = (await getAllItems()).length;
    avisar(EVENTO_COLA);
    for (const mensaje of resultado.errores) avisar(EVENTO_ERROR, { mensaje });
    return resultado;
  };

  // 1. Los check-in: dan el id que lo demás necesita.
  for (const item of (await ordenados()).filter((i) => i.type === "checkin")) {
    const paso = await mandarCheckin(item, enviar);
    if (paso.tipo === "reintentar") return terminar();
    if (paso.tipo === "hecho" && paso.jornadaId) {
      await resolverJornada(item.id, paso.jornadaId);
      resultado.enviados++;
    } else if (paso.tipo === "descartar") {
      await descartar(item, paso.motivo, resultado);
    }
  }

  // Lo que sigue esperando un check-in de la cola no se puede mandar todavía.
  let todo = await ordenados();
  const sinId = new Set(todo.filter((i) => i.type === "checkin").map((i) => i.id));

  // 2. Los check-out.
  for (const item of todo.filter((i) => i.type === "checkout")) {
    if (sinId.has(jornadaDe(item) ?? "")) continue;
    const paso = await mandarCheckout(item, enviar);
    if (paso.tipo === "reintentar") return terminar();
    if (paso.tipo === "hecho") {
      await removeItem(item.id);
      resultado.enviados++;
    } else if (paso.tipo === "descartar") {
      await descartar(item, paso.motivo, resultado);
    }
  }

  // 3. Las fotos. Lo que espera un check-in se vuelve a calcular con lo que
  // hay ahora: si mientras tanto se registró uno sin señal, su foto lleva el
  // id de la cola, y mandarla daría 404 y se perdería. Un cierre que siga en
  // la cola es de uno de esos, así que su foto también se salta; y si la
  // jornada sigue abierta por otra razón, el servidor contesta 409 y espera.
  todo = await ordenados();
  const sinIdAhora = new Set(todo.filter((i) => i.type === "checkin").map((i) => i.id));
  for (const item of todo.filter((i) => i.type === "foto")) {
    if (sinIdAhora.has(jornadaDe(item) ?? "")) continue;
    const paso = await mandarFoto(item, enviar);
    if (paso.tipo === "reintentar") return terminar();
    if (paso.tipo === "hecho") {
      await removeItem(item.id);
      resultado.enviados++;
    } else if (paso.tipo === "descartar") {
      await descartar(item, paso.motivo, resultado);
    }
  }

  return terminar();
}

const VACIO: ResultadoDeCola = { enviados: 0, pendientes: 0, errores: [] };

/** Una sola pasada a la vez entre pestañas. Si otra la tiene, esta no hace nada. */
async function conCandado(fn: () => Promise<ResultadoDeCola>): Promise<ResultadoDeCola> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  return locks.request("proyinstelec:cola-campo", { ifAvailable: true }, (candado) =>
    candado ? fn() : { ...VACIO },
  );
}

let enCurso: Promise<ResultadoDeCola> | null = null;
let otraVez = false;

/**
 * Manda lo que haya en la cola. Si ya hay una pasada en curso en esta
 * pestaña, no empieza otra: se une a ella, y al terminar da una vuelta más
 * por si llegó algo mientras tanto.
 */
export function procesarCola(enviar: Enviar = DE_VERDAD): Promise<ResultadoDeCola> {
  if (enCurso) {
    otraVez = true;
    return enCurso;
  }
  enCurso = (async () => {
    let resultado: ResultadoDeCola;
    do {
      otraVez = false;
      resultado = await conCandado(() => pasada(enviar));
    } while (otraVez);
    return resultado;
  })().finally(() => {
    enCurso = null;
  });
  return enCurso;
}
