import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso } from "../helpers/db-falso";
import {
  aJornada,
  createJornada,
  closeJornada,
  getJornada,
  getOpenJornada,
  ponerFotoDeJornada,
} from "@/src/lib/jornadas";

/** Encadenado falso de Drizzle: el `await` final entrega el siguiente resultado. */
function fakeDb(resultados: unknown[][]) {
  const cola = [...resultados];
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          const filas = cola.shift() ?? [];
          return (resolve: (v: unknown) => void) => resolve(filas);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

const DEVICE_INFO = {
  userAgent: "test-agent",
  platform: "test",
  screenWidth: 390,
  screenHeight: 844,
  language: "es-MX",
};

const CHECK_IN = {
  timestamp: "2026-05-14T09:41:00.000Z",
  lat: 19.4284,
  lng: -99.1946,
  precision: 8,
  deviceInfo: DEVICE_INFO,
};

function filaAbierta(over: Record<string, unknown> = {}) {
  return {
    id: "jornada-001",
    usuarioId: "user-001",
    proyectoId: "proyecto-001",
    tipo: "planta",
    estado: "abierta",
    checkinTs: new Date(CHECK_IN.timestamp),
    checkinLat: CHECK_IN.lat,
    checkinLng: CHECK_IN.lng,
    checkinPrecision: 8,
    checkinDriveFileId: "file-in",
    checkinDriveUrl: "https://drive/in",
    checkinFotoHash: "hash-in",
    checkinUploadStatus: "ok",
    checkinDevice: DEVICE_INFO,
    checkoutTs: null,
    checkoutLat: null,
    checkoutLng: null,
    checkoutPrecision: null,
    checkoutDriveFileId: null,
    checkoutDriveUrl: null,
    checkoutFotoHash: null,
    checkoutUploadStatus: null,
    checkoutDevice: null,
    observaciones: null,
    duracionMinutos: null,
    createdAt: new Date(CHECK_IN.timestamp),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

// ── Mapeo fila → Jornada ──────────────────────────────────────────────────────

describe("aJornada", () => {
  it("anida las columnas planas de check-in", () => {
    const j = aJornada(filaAbierta() as any);
    expect(j.checkIn).toEqual({
      timestamp: "2026-05-14T09:41:00.000Z",
      lat: 19.4284,
      lng: -99.1946,
      precision: 8,
      driveFileId: "file-in",
      driveWebViewLink: "https://drive/in",
      fotoHash: "hash-in",
      uploadStatus: "ok",
      deviceInfo: DEVICE_INFO,
    });
    expect(j.checkOut).toBeUndefined();
    expect(j.duracionMinutos).toBeUndefined();
  });

  it("arma checkOut sólo cuando hay checkoutTs", () => {
    const j = aJornada(
      filaAbierta({
        estado: "cerrada",
        checkoutTs: new Date("2026-05-14T17:41:00.000Z"),
        checkoutLat: 19.43,
        checkoutLng: -99.19,
        checkoutPrecision: 10,
        observaciones: "Se entregó el tablero",
        duracionMinutos: 480,
      }) as any,
    );
    expect(j.checkOut?.timestamp).toBe("2026-05-14T17:41:00.000Z");
    expect(j.checkOut?.observaciones).toBe("Se entregó el tablero");
    expect(j.duracionMinutos).toBe(480);
  });

  it("no expone llaves de la tabla anterior", () => {
    const j = aJornada(filaAbierta() as any);
    expect(j).not.toHaveProperty("pk");
    expect(j).not.toHaveProperty("gsi1pk");
  });
});

// ── Escrituras ────────────────────────────────────────────────────────────────

describe("createJornada", () => {
  it("devuelve la jornada abierta con el check-in anidado", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[filaAbierta()]]));

    const jornada = await createJornada({
      usuarioId: "user-001",
      proyectoId: "proyecto-001",
      tipo: "planta",
      checkIn: CHECK_IN,
    });

    expect(jornada.id).toBe("jornada-001");
    expect(jornada.estado).toBe("abierta");
    expect(jornada.checkIn.timestamp).toBe(CHECK_IN.timestamp);
  });
});

describe("closeJornada", () => {
  const checkOut = {
    timestamp: "2026-05-14T17:41:00.000Z", // 8 horas después del check-in
    lat: 19.4284,
    lng: -99.1946,
    precision: 10,
    deviceInfo: DEVICE_INFO,
  };

  it("calcula la duración en minutos", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[{ id: "jornada-001" }]]));
    expect(await closeJornada("jornada-001", checkOut, CHECK_IN.timestamp)).toBe(480);
  });

  it("redondea los segundos sueltos al minuto más cercano", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[{ id: "jornada-001" }]]));
    const minutos = await closeJornada(
      "jornada-001",
      { ...checkOut, timestamp: "2026-05-14T10:11:40.000Z" }, // 30m 40s
      CHECK_IN.timestamp,
    );
    expect(minutos).toBe(31);
  });

  it("lanza cuando la jornada ya estaba cerrada (guarda de estado)", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[]]));
    await expect(closeJornada("jornada-001", checkOut, CHECK_IN.timestamp)).rejects.toThrow(
      /ya fue cerrada/,
    );
  });
});

// ── Lecturas ──────────────────────────────────────────────────────────────────

describe("getJornada", () => {
  it("devuelve la jornada mapeada cuando existe", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[filaAbierta()]]));
    const result = await getJornada("jornada-001");
    expect(result?.id).toBe("jornada-001");
    expect(result?.checkIn.lat).toBe(19.4284);
  });

  it("devuelve null cuando no existe", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[]]));
    expect(await getJornada("fantasma")).toBeNull();
  });
});

describe("getOpenJornada", () => {
  it("devuelve la jornada abierta del día", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[filaAbierta()]]));
    const result = await getOpenJornada("user-001");
    expect(result?.estado).toBe("abierta");
  });

  it("devuelve null cuando no hay jornada abierta hoy", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[]]));
    expect(await getOpenJornada("user-001")).toBeNull();
  });

  // Vercel corre en UTC: a las 18:30 de México ya es el día siguiente allá, y
  // la jornada de la mañana dejaba de encontrarse.
  // Con el reloj en UTC, como Vercel: en una máquina en México, una
  // medianoche local daría la respuesta correcta por casualidad.
  it("«hoy» empieza a las 00:00 de México, no del servidor", async () => {
    const db = dbFalso([[filaAbierta()]]);
    vi.mocked(getDb).mockImplementation(db.getDb as never);
    const zona = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      await getOpenJornada("user-001", new Date("2026-11-26T00:30:00Z"));
    } finally {
      if (zona === undefined) delete process.env.TZ;
      else process.env.TZ = zona;
    }

    const where = db.llamadas.find((l) => l.metodo === "where")!.args[0];
    const fechas = parametros(where).filter((p): p is Date => p instanceof Date);
    expect(fechas.map((f) => f.toISOString())).toEqual(["2026-11-25T06:00:00.000Z"]);
  });
});

/** Los valores que viajan como parámetros en un `sql` de Drizzle. */
function parametros(nodo: unknown): unknown[] {
  const fuera: unknown[] = [];
  const vistos = new Set<unknown>();
  const juntar = (n: unknown) => {
    if (!n || typeof n !== "object" || vistos.has(n)) return;
    vistos.add(n);
    if (n.constructor?.name === "Param") fuera.push((n as { value: unknown }).value);
    for (const hijo of (n as { queryChunks?: unknown[] }).queryChunks ?? []) juntar(hijo);
  };
  juntar(nodo);
  return fuera;
}

/** El texto de un `sql` de Drizzle, con los nombres de las columnas. */
function textoProfundo(nodo: unknown): string {
  const texto: string[] = [];
  const vistos = new Set<unknown>();
  const juntar = (n: unknown) => {
    if (!n || typeof n !== "object" || vistos.has(n)) return;
    vistos.add(n);
    const x = n as { value?: unknown; queryChunks?: unknown[]; name?: unknown };
    if (Array.isArray(x.value)) texto.push(...x.value.filter((v): v is string => typeof v === "string"));
    if (typeof x.name === "string") texto.push(x.name);
    for (const hijo of x.queryChunks ?? []) juntar(hijo);
  };
  juntar(nodo);
  return texto.join(" ");
}

/**
 * La foto va a su jornada una sola vez: si dos subidas llegan a la vez, solo
 * una encuentra el lugar vacío.
 */
describe("ponerFotoDeJornada", () => {
  const FOTO = { driveFileId: "f-1", webViewLink: "https://drive/f-1", hash: "h-1" };

  it("check-in: una sola sentencia, solo si el lugar sigue vacío", async () => {
    const db = dbFalso([[{ id: "jornada-001" }]]);
    vi.mocked(getDb).mockImplementation(db.getDb as never);

    expect(await ponerFotoDeJornada({ jornadaId: "jornada-001", momento: "checkin", foto: FOTO })).toBe(true);

    expect(db.metodos().filter((m) => m === "update")).toHaveLength(1);
    expect(db.llamadas.find((l) => l.metodo === "set")!.args[0]).toEqual({
      checkinDriveFileId: "f-1",
      checkinDriveUrl: "https://drive/f-1",
      checkinFotoHash: "h-1",
      checkinUploadStatus: "ok",
    });
    const where = textoProfundo(db.llamadas.find((l) => l.metodo === "where")!.args[0]);
    expect(where).toContain("checkin_drive_file_id");
    expect(where).toContain("is null");
  });

  it("check-out: además, con la jornada cerrada", async () => {
    const db = dbFalso([[{ id: "jornada-001" }]]);
    vi.mocked(getDb).mockImplementation(db.getDb as never);

    await ponerFotoDeJornada({ jornadaId: "jornada-001", momento: "checkout", foto: FOTO });

    const where = db.llamadas.find((l) => l.metodo === "where")!.args[0];
    expect(textoProfundo(where)).toContain("checkout_drive_file_id");
    expect(textoProfundo(where)).toContain("is null");
    expect(parametros(where)).toContain("cerrada");
  });

  it("si otra subida ganó (sin fila), dice que no la puso", async () => {
    vi.mocked(getDb).mockImplementation(dbFalso([[]]).getDb as never);

    expect(await ponerFotoDeJornada({ jornadaId: "jornada-001", momento: "checkin", foto: FOTO })).toBe(false);
  });
});
