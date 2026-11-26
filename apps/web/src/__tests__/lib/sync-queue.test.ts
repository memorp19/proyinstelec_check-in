/**
 * La cola de la app de campo, contra un servidor falso que se porta como las
 * rutas de verdad: `/api/jornada` adopta la jornada abierta (409), el cierre
 * repetido da 409, y `/api/upload` pone cada foto una sola vez y la de salida
 * solo con la jornada cerrada.
 *
 * IndexedDB es el de `fake-indexeddb` (vitest.setup.ts). Todos los datos son
 * inventados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _resetDB, getAllItems } from "@/src/lib/idb";
import {
  EVENTO_JORNADA,
  contarCola,
  encolarFoto,
  esJornadaEnCola,
  faltanPorSubir,
  procesarCola,
  registrarCheckin,
  registrarCheckout,
  type PayloadCheckin,
} from "@/src/lib/sync-queue";

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

/** Un servidor con estado: jornadas, fotos en "Drive" y lo que se le pidió. */
function servidorFalso() {
  const jornadas = new Map<string, { abierta: boolean; fotos: Partial<Record<"checkin" | "checkout", string>> }>();
  const llamadas: Array<{ url: string; metodo: string; cuerpo: Record<string, unknown> }> = [];
  const estado = {
    /** Lo que pasa en el teléfono mientras el servidor atiende un cierre. */
    alCerrar: null as null | (() => Promise<void>),
    sinRed: false,
    /** La siguiente petición llega y se procesa, pero la respuesta se pierde. */
    perderRespuesta: false,
    /** Respuestas forzadas por ruta, para los rechazos. */
    forzar: new Map<string, () => Response>(),
    subidasADrive: 0,
  };
  let siguiente = 1;

  const responder = (url: string, metodo: string, cuerpo: Record<string, unknown>): Response => {
    const forzada = estado.forzar.get(`${metodo} ${url}`);
    if (forzada) return forzada();

    if (metodo === "POST" && url === "/api/jornada") {
      // Como getOpenJornada: con una abierta, 409 con su id.
      const abierta = [...jornadas].find(([, j]) => j.abierta);
      if (abierta) return json({ error: "Ya tienes una jornada abierta", jornadaId: abierta[0] }, 409);
      const id = `j-${siguiente++}`;
      jornadas.set(id, { abierta: true, fotos: {} });
      return json({ jornadaId: id }, 201);
    }
    const cierre = url.match(/^\/api\/jornada\/(.+)$/);
    if (metodo === "PATCH" && cierre) {
      const j = jornadas.get(decodeURIComponent(cierre[1]));
      if (!j) return json({ error: "Jornada no encontrada" }, 404);
      if (!j.abierta) return json({ error: "La jornada ya fue cerrada" }, 409);
      j.abierta = false;
      return json({ jornadaId: cierre[1], duracionMinutos: 480 });
    }
    if (metodo === "POST" && url === "/api/upload") {
      const momento = cuerpo.tipo as "checkin" | "checkout";
      const j = jornadas.get(String(cuerpo.jornadaId));
      if (!j) return json({ error: "Jornada no encontrada" }, 404);
      if (momento === "checkout" && j.abierta) return json({ error: "La jornada sigue abierta" }, 409);
      const ya = j.fotos[momento];
      if (ya) return json({ driveFileId: ya, webViewLink: "", hash: "", yaEstaba: true });
      estado.subidasADrive++;
      j.fotos[momento] = `f-${estado.subidasADrive}`;
      return json({ driveFileId: j.fotos[momento], webViewLink: "", hash: "" });
    }
    return json({ error: "Ruta desconocida" }, 404);
  };

  const enviar = vi.fn(async (url: string, init: RequestInit) => {
    const cuerpo = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const metodo = init.method ?? "GET";
    llamadas.push({ url, metodo, cuerpo });
    if (estado.sinRed) throw new TypeError("Failed to fetch");
    const r = responder(url, metodo, cuerpo);
    if (metodo === "PATCH" && estado.alCerrar) {
      const hacer = estado.alCerrar;
      estado.alCerrar = null;
      await hacer();
    }
    if (estado.perderRespuesta) {
      estado.perderRespuesta = false;
      throw new TypeError("Failed to fetch");
    }
    return r;
  });

  return { enviar, jornadas, llamadas, estado };
}

const CHECKIN: PayloadCheckin = {
  proyectoId: "p-1",
  checkIn: { timestamp: "2026-11-26T14:00:00.000Z", lat: 19.4, lng: -99.1, precision: 10 },
};
const CHECKOUT = { timestamp: "2026-11-26T23:30:00.000Z", lat: 19.4, lng: -99.1, precision: 10 };
const FOTO = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: "image/jpeg" });

let srv: ReturnType<typeof servidorFalso>;
beforeEach(async () => {
  await _resetDB();
  srv = servidorFalso();
});
afterEach(() => vi.unstubAllGlobals());

/** Un día entero sin señal: check-in, su foto, check-out y su foto, todo a la cola. */
async function diaSinSenal() {
  srv.estado.sinRed = true;
  const { jornadaId } = await registrarCheckin(CHECKIN, srv.enviar);
  await encolarFoto({ momento: "checkin", jornadaId, foto: FOTO() });
  await registrarCheckout({ jornadaId, checkOut: CHECKOUT }, srv.enviar);
  await encolarFoto({ momento: "checkout", jornadaId, foto: FOTO() });
  srv.estado.sinRed = false;
  return jornadaId;
}

describe("registrar con señal, o dejarlo en la cola", () => {
  it("con señal, el check-in va directo y no deja nada en la cola", async () => {
    expect(await registrarCheckin(CHECKIN, srv.enviar)).toEqual({ jornadaId: "j-1", enCola: false });
    expect(await getAllItems()).toEqual([]);
  });

  it.each([
    ["sin red", () => { srv.estado.sinRed = true; }],
    ["con el servidor caído (500)", () => { srv.estado.forzar.set("POST /api/jornada", () => json({}, 500)); }],
  ])("%s, el check-in queda en la cola con su id", async (_caso, preparar) => {
    preparar();

    const r = await registrarCheckin(CHECKIN, srv.enviar);

    expect(r.enCola).toBe(true);
    expect(await esJornadaEnCola(r.jornadaId)).toBe(true);
  });

  // Eso no se arregla esperando: la pantalla tiene que decirlo.
  it("un rechazo del servidor se dice, y no se encola", async () => {
    srv.estado.forzar.set("POST /api/jornada", () => json({ error: "No tienes acceso a este proyecto" }, 403));

    await expect(registrarCheckin(CHECKIN, srv.enviar)).rejects.toThrow("No tienes acceso a este proyecto");
    expect(await getAllItems()).toEqual([]);
  });

  it("el check-out de un check-in que sigue en la cola espera ahí, sin preguntar al servidor", async () => {
    srv.estado.sinRed = true;
    const { jornadaId } = await registrarCheckin(CHECKIN, srv.enviar);
    srv.estado.sinRed = false;
    srv.enviar.mockClear();

    expect(await registrarCheckout({ jornadaId, checkOut: CHECKOUT }, srv.enviar)).toEqual({
      duracionMinutos: null,
      enCola: true,
    });
    expect(srv.enviar).not.toHaveBeenCalled();
  });

  it("con señal, el check-out va directo y da la duración", async () => {
    const { jornadaId } = await registrarCheckin(CHECKIN, srv.enviar);

    expect(await registrarCheckout({ jornadaId, checkOut: CHECKOUT }, srv.enviar)).toEqual({
      duracionMinutos: 480,
      enCola: false,
    });
  });
});

describe("procesarCola", () => {
  it("un día sin señal: al volver se manda todo, en orden, y la cola queda vacía", async () => {
    await diaSinSenal();
    expect(await contarCola()).toEqual({ registros: 2, fotos: 2 });
    srv.llamadas.length = 0;

    const r = await procesarCola(srv.enviar);

    expect(r).toEqual({ enviados: 4, pendientes: 0, errores: [] });
    expect(srv.llamadas.map((l) => `${l.metodo} ${l.url} ${l.cuerpo.tipo ?? ""}`.trim())).toEqual([
      "POST /api/jornada",
      "PATCH /api/jornada/j-1",
      "POST /api/upload checkin",
      "POST /api/upload checkout",
    ]);
    // Con el id del servidor, no el de la cola.
    expect(srv.llamadas[2].cuerpo.jornadaId).toBe("j-1");
    expect(srv.jornadas.get("j-1")).toEqual({ abierta: false, fotos: { checkin: "f-1", checkout: "f-2" } });
    expect(await contarCola()).toEqual({ registros: 0, fotos: 0 });
  });

  it("sin señal no pierde nada, por más veces que lo intente", async () => {
    await diaSinSenal();
    srv.estado.sinRed = true;

    for (let i = 0; i < 6; i++) await procesarCola(srv.enviar);

    expect(await contarCola()).toEqual({ registros: 2, fotos: 2 });
    srv.estado.sinRed = false;
    expect((await procesarCola(srv.enviar)).pendientes).toBe(0);
  });

  // El POST entró, pero la respuesta se perdió: reintentarlo no puede crear otra.
  it("sin jornadas repetidas: si la respuesta del check-in se perdió, adopta la que quedó abierta", async () => {
    await diaSinSenal();
    srv.estado.perderRespuesta = true;

    await procesarCola(srv.enviar); // entró, pero no se enteró
    await procesarCola(srv.enviar);

    expect([...srv.jornadas.keys()]).toEqual(["j-1"]);
    expect(srv.jornadas.get("j-1")?.fotos).toEqual({ checkin: "f-1", checkout: "f-2" });
    expect(await contarCola()).toEqual({ registros: 0, fotos: 0 });
  });

  it("sin fotos repetidas: si la respuesta de la subida se perdió, el reintento no sube otra", async () => {
    const { jornadaId } = await registrarCheckin(CHECKIN, srv.enviar);
    await encolarFoto({ momento: "checkin", jornadaId, foto: FOTO() });
    srv.estado.perderRespuesta = true;

    await procesarCola(srv.enviar);
    await procesarCola(srv.enviar);

    expect(srv.estado.subidasADrive).toBe(1);
    expect(await contarCola()).toEqual({ registros: 0, fotos: 0 });
  });

  it("un cierre que ya había entrado cuenta como hecho", async () => {
    const { jornadaId } = await registrarCheckin(CHECKIN, srv.enviar);
    srv.estado.sinRed = true;
    await registrarCheckout({ jornadaId, checkOut: CHECKOUT }, srv.enviar);
    srv.estado.sinRed = false;
    srv.jornadas.get(jornadaId)!.abierta = false; // entró por otro lado

    expect(await procesarCola(srv.enviar)).toMatchObject({ pendientes: 0, errores: [] });
  });

  it("la foto de salida espera mientras la jornada siga abierta", async () => {
    const { jornadaId } = await registrarCheckin(CHECKIN, srv.enviar);
    await encolarFoto({ momento: "checkout", jornadaId, foto: FOTO() });

    expect(await procesarCola(srv.enviar)).toMatchObject({ pendientes: 1, errores: [] });
    expect(await contarCola()).toEqual({ registros: 0, fotos: 1 });
  });

  // Si mientras la cola se manda se hace otro check-in sin señal, su foto
  // lleva el id de la cola: mandarla ahora daría 404 y se perdería.
  it("la foto de un check-in que llegó a media pasada espera a su check-in", async () => {
    await diaSinSenal();
    srv.estado.alCerrar = async () => {
      srv.estado.sinRed = true;
      const { jornadaId } = await registrarCheckin(CHECKIN, srv.enviar);
      await encolarFoto({ momento: "checkin", jornadaId, foto: FOTO() });
      srv.estado.sinRed = false;
    };

    expect(await procesarCola(srv.enviar)).toMatchObject({ errores: [] });
    expect(await contarCola()).toEqual({ registros: 1, fotos: 1 });

    expect(await procesarCola(srv.enviar)).toMatchObject({ pendientes: 0, errores: [] });
    expect(srv.jornadas.get("j-2")?.fotos).toEqual({ checkin: "f-3" });
  });

  // Safari anterior a 15.4 no tiene Web Locks: queda la bandera de la pestaña.
  it("sin Web Locks, dos pasadas a la vez en la misma pestaña no mandan nada dos veces", async () => {
    vi.stubGlobal("navigator", {});
    await diaSinSenal();
    srv.llamadas.length = 0;

    await Promise.all([procesarCola(srv.enviar), procesarCola(srv.enviar)]);

    expect(srv.llamadas.filter((l) => l.metodo === "POST" && l.url === "/api/jornada")).toHaveLength(1);
    expect(srv.llamadas.filter((l) => l.url === "/api/upload")).toHaveLength(2);
  });

  it("si otra pestaña tiene el candado, esta no manda nada", async () => {
    await diaSinSenal();
    srv.llamadas.length = 0;
    vi.stubGlobal("navigator", {
      locks: { request: (_n: string, _o: unknown, fn: (candado: null) => unknown) => Promise.resolve(fn(null)) },
    });

    await procesarCola(srv.enviar);

    expect(srv.llamadas).toEqual([]);
    expect(await contarCola()).toEqual({ registros: 2, fotos: 2 });
  });

  it("dos pasadas a la vez no mandan nada dos veces", async () => {
    await diaSinSenal();
    srv.llamadas.length = 0;

    await Promise.all([procesarCola(srv.enviar), procesarCola(srv.enviar)]);

    const veces = (metodo: string, url: string) =>
      srv.llamadas.filter((l) => l.metodo === metodo && l.url === url).length;
    expect(veces("POST", "/api/jornada")).toBe(1);
    expect(veces("PATCH", "/api/jornada/j-1")).toBe(1);
    expect(veces("POST", "/api/upload")).toBe(2);
    expect([...srv.jornadas.keys()]).toEqual(["j-1"]);
  });

  describe("lo que no se arregla solo", () => {
    it("un check-in rechazado se quita con todo lo que dependía de él, y se avisa", async () => {
      await diaSinSenal();
      srv.estado.forzar.set("POST /api/jornada", () => json({ error: "No tienes acceso a este proyecto" }, 403));

      const r = await procesarCola(srv.enviar);

      expect(r.errores).toEqual([
        "Un check-in hecho sin señal no se pudo registrar: No tienes acceso a este proyecto.",
      ]);
      expect(await contarCola()).toEqual({ registros: 0, fotos: 0 });
    });

    it("una foto que no es foto se quita y se avisa; lo demás sigue", async () => {
      await diaSinSenal();
      let primera = true;
      srv.estado.forzar.set("POST /api/upload", () => {
        if (!primera) {
          srv.estado.forzar.delete("POST /api/upload");
          return json({ driveFileId: "f-x", webViewLink: "", hash: "" });
        }
        primera = false;
        return json({ error: "La foto tiene que ser JPEG, PNG o WebP." }, 415);
      });

      const r = await procesarCola(srv.enviar);

      expect(r.errores).toEqual(["Una foto no se pudo subir: La foto tiene que ser JPEG, PNG o WebP."]);
      expect(r.pendientes).toBe(0);
    });

    // Lo guardado está bien: cuando la app se actualice, la versión nueva lo manda.
    it("«actualiza la aplicación» no tira nada", async () => {
      const { jornadaId } = await registrarCheckin(CHECKIN, srv.enviar);
      await encolarFoto({ momento: "checkin", jornadaId, foto: FOTO() });
      srv.estado.forzar.set("POST /api/upload", () =>
        json({ error: "Actualiza la aplicación (cierra y vuelve a abrirla).", actualizar: true }, 400),
      );

      expect(await procesarCola(srv.enviar)).toMatchObject({ pendientes: 1, errores: [] });
    });

    it("con la sesión vencida (401) espera, no tira nada", async () => {
      await diaSinSenal();
      srv.estado.forzar.set("POST /api/jornada", () => json({ error: "No autorizado" }, 401));

      expect(await procesarCola(srv.enviar)).toMatchObject({ pendientes: 4, errores: [] });
    });
  });

  it("avisa a la pantalla el id del servidor del check-in que esperaba", async () => {
    const pantalla = new EventTarget();
    vi.stubGlobal("window", pantalla);
    const avisos: unknown[] = [];
    pantalla.addEventListener(EVENTO_JORNADA, (e) => avisos.push((e as CustomEvent).detail));
    const deCola = await diaSinSenal();

    await procesarCola(srv.enviar);

    expect(avisos).toEqual([{ deCola, delServidor: "j-1" }]);
  });
});

describe("faltanPorSubir", () => {
  it.each([
    [{ registros: 0, fotos: 0 }, ""],
    [{ registros: 0, fotos: 1 }, "Falta 1 foto por subir"],
    [{ registros: 0, fotos: 3 }, "Faltan 3 fotos por subir"],
    [{ registros: 1, fotos: 0 }, "Falta 1 registro por subir"],
    [{ registros: 1, fotos: 2 }, "Faltan 1 registro y 2 fotos por subir"],
    [{ registros: 2, fotos: 1 }, "Faltan 2 registros y 1 foto por subir"],
  ])("%o → «%s»", (cuenta, texto) => {
    expect(faltanPorSubir(cuenta)).toBe(texto);
  });
});
