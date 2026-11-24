/**
 * Lo que el PDF definitivo guarda y lee en la base: el borrador frente al
 * definitivo, la fecha que se fija una vez, la foto de lo congelado, el
 * enlace que enseñan la tarjeta y la pantalla del armado, y qué versiones solo
 * van a revisión por la ruta del cotizador.
 * Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso } from "../helpers/db-falso";
import {
  guardarFoto,
  guardarIdsDeDocumento,
  guardarPdfDefinitivo,
  leerCongelado,
} from "@/src/lib/cotizador-db";
import {
  enlaceDelPdfDefinitivo,
  pdfDeLaVersion,
  pdfsDefinitivosDe,
  seArmoEnElCotizador,
} from "@/src/lib/cotizaciones";
import { documentoVacio } from "@/src/lib/cotizador";

function usarDb(resultados: unknown[] = []) {
  const falso = dbFalso(resultados);
  vi.mocked(getDb).mockImplementation(falso.getDb as never);
  return falso;
}

/** El texto de un `sql` de Drizzle, a todo lo hondo (los `and` anidan). */
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

const V = { numero: 454, anio: 2026, version: 0 };
const FOTO = {
  encabezado: { cliente: "Cliente SA", titulo: "Pruebas", dirigidaA: "Ing. Ruiz" },
  documento: documentoVacio(),
  direccionContacto: null,
  direccionCliente: null,
};

beforeEach(() => vi.clearAllMocks());

describe("guardarIdsDeDocumento (el borrador)", () => {
  it("guarda los ids, deja de ser definitivo y no toca la fecha", async () => {
    const db = usarDb([[]]);

    await guardarIdsDeDocumento({ ...V, docDriveId: "doc-b", pdfDriveId: "pdf-b" });

    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0] as Record<string, unknown>;
    expect(set).toMatchObject({ docDriveId: "doc-b", pdfDriveId: "pdf-b", pdfDefinitivoAt: null });
    expect(set).not.toHaveProperty("documento");
  });
});

describe("guardarPdfDefinitivo", () => {
  it("sin fecha nueva: una sola sentencia, con la marca de definitivo", async () => {
    const db = usarDb([[]]);

    await guardarPdfDefinitivo({ ...V, docDriveId: "doc-d", pdfDriveId: "pdf-d" });

    expect(db.metodos().filter((m) => m === "update")).toHaveLength(1);
    expect(db.metodos()).not.toContain("batch");
    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0] as Record<string, unknown>;
    expect(set).toMatchObject({ docDriveId: "doc-d", pdfDriveId: "pdf-d" });
    expect(set.pdfDefinitivoAt).toBeInstanceOf(Date);
  });

  // La pantalla la lee del armado; el siguiente PDF, de la foto.
  it("con fecha nueva: la escribe en el armado y en la foto, en un mismo lote", async () => {
    const db = usarDb([[]]);

    await guardarPdfDefinitivo({ ...V, docDriveId: "doc-d", pdfDriveId: "pdf-d", fecha: "2026-11-23" });

    expect(db.metodos()).toContain("batch");
    const sets = db.llamadas.filter((l) => l.metodo === "set").map((l) => l.args[0] as Record<string, unknown>);
    expect(sets).toHaveLength(2);
    expect(textoProfundo(sets[0].documento)).toContain("'{fecha}'");
    expect(textoProfundo(sets[1].foto)).toContain("'{documento,fecha}'");
  });
});

describe("leerCongelado", () => {
  it("sin congelado, null", async () => {
    usarDb([[]]);
    expect(await leerCongelado(V)).toBeNull();
  });

  it("con congelado, los importes y la foto leída", async () => {
    usarDb([[{ resultado: { total: 1000 }, letra: "MIL PESOS", foto: JSON.parse(JSON.stringify(FOTO)) }]]);

    const c = await leerCongelado(V);

    expect(c?.resultado).toEqual({ total: 1000 });
    expect(c?.foto?.encabezado).toEqual(FOTO.encabezado);
  });

  it("lo congelado antes de la foto trae foto null", async () => {
    usarDb([[{ resultado: { total: 1000 }, letra: "MIL PESOS", foto: null }]]);
    expect((await leerCongelado(V))?.foto).toBeNull();
  });
});

describe("guardarFoto", () => {
  // Si dos personas generan el PDF a la vez, la primera foto se queda.
  it("solo donde todavía no hay foto", async () => {
    const db = usarDb([[{ foto: FOTO }]]);

    expect(await guardarFoto({ ...V, foto: FOTO })).toEqual(FOTO);
    const where = db.llamadas.find((l) => l.metodo === "where")!.args[0];
    expect(textoProfundo(where)).toContain("foto");
    expect(textoProfundo(where)).toContain("is null");
  });

  it("si otro la guardó antes, devuelve la suya", async () => {
    const suya = { ...FOTO, encabezado: { ...FOTO.encabezado, titulo: "La primera" } };
    usarDb([[], [{ resultado: {}, letra: "", foto: suya }]]);

    expect((await guardarFoto({ ...V, foto: FOTO })).encabezado.titulo).toBe("La primera");
  });
});

describe("pdfDeLaVersion", () => {
  it("armada con PDF definitivo: delCotizador y su id", async () => {
    usarDb([[{ pdfDriveId: "pdf-d", pdfDefinitivoAt: new Date() }], [{ foto: FOTO }]]);

    expect(await pdfDeLaVersion(V)).toMatchObject({ delCotizador: true, pdfDriveId: "pdf-d" });
  });

  // Un borrador pudo salir antes del último cambio: no es el que se envía.
  it("armada con solo un borrador: sin PDF", async () => {
    usarDb([[{ pdfDriveId: "pdf-borrador", pdfDefinitivoAt: null }], [{ foto: FOTO }]]);

    expect(await pdfDeLaVersion(V)).toMatchObject({ delCotizador: true, pdfDriveId: null });
  });

  it("importada (sin nada congelado): no es del cotizador", async () => {
    usarDb([[], []]);

    expect(await pdfDeLaVersion(V)).toEqual({ delCotizador: false, pdfDriveId: null, foto: null });
  });
});

/**
 * El enlace que enseñan la tarjeta y la pantalla del armado: «Ver PDF» tiene
 * que abrir lo que se revisa y se envía, y nada más.
 */
describe("enlaceDelPdfDefinitivo", () => {
  const DEFINITIVO = { pdfDriveId: "pdf-d", pdfDefinitivoAt: new Date("2026-11-24T16:00:00Z") };

  it.each(["REVISION", "ENVIADA", "ASIGNADA", "NO ASIGNADA"])("en %s: el enlace de Drive", (estatus) => {
    expect(enlaceDelPdfDefinitivo({ estatus, ...DEFINITIVO })).toBe(
      "https://drive.google.com/file/d/pdf-d/view",
    );
  });

  // PROCESO: el revisor pidió corregirla, y su PDF es el que se rechazó.
  // CANCELADA y las DEPENDIENTE pueden venir de ahí mismo.
  it.each(["PROCESO", "CANCELADA", "DEPENDIENTE CLIENTE", "DEPENDIENTE PROVEEDOR"])(
    "en %s: nada, aunque siga marcado como definitivo",
    (estatus) => {
      expect(enlaceDelPdfDefinitivo({ estatus, ...DEFINITIVO })).toBeNull();
    },
  );

  it("con solo un borrador de «Ver cotización»: nada", () => {
    expect(
      enlaceDelPdfDefinitivo({ estatus: "REVISION", pdfDriveId: "pdf-borrador", pdfDefinitivoAt: null }),
    ).toBeNull();
  });

  it("sin id de PDF: nada", () => {
    expect(
      enlaceDelPdfDefinitivo({ estatus: "REVISION", pdfDriveId: null, pdfDefinitivoAt: new Date() }),
    ).toBeNull();
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

describe("pdfsDefinitivosDe (la lista)", () => {
  const LISTA = [
    { numero: 453, anio: 2026, version: 0, estatus: "REVISION" },
    { numero: 452, anio: 2026, version: 0, estatus: "PROCESO" },
    { numero: 451, anio: 2026, version: 1, estatus: "ENVIADA" },
  ];

  it("una sola consulta, solo por los definitivos de las que pueden tenerlo", async () => {
    const db = usarDb([
      [
        { numero: 453, anio: 2026, version: 0, pdfDriveId: "pdf-453", pdfDefinitivoAt: new Date() },
        { numero: 451, anio: 2026, version: 1, pdfDriveId: "pdf-451", pdfDefinitivoAt: new Date() },
      ],
    ]);

    const enlaces = await pdfsDefinitivosDe(LISTA);

    expect(db.metodos().filter((m) => m === "select")).toHaveLength(1);
    const where = db.llamadas.find((l) => l.metodo === "where")!.args[0];
    expect(textoProfundo(where)).toContain("pdf_definitivo_at");
    expect(textoProfundo(where)).toContain("is not null");
    // La que está en PROCESO ni se pregunta.
    expect(parametros(where)).toEqual(expect.arrayContaining([453, 451]));
    expect(parametros(where)).not.toContain(452);
    expect([...enlaces]).toEqual([
      ["PCOTOP-453-2026", "https://drive.google.com/file/d/pdf-453/view"],
      ["PCOTOP-451-2026-1", "https://drive.google.com/file/d/pdf-451/view"],
    ]);
  });

  it("si la base trajera una que no está en un estatus con PDF, no la enseña", async () => {
    usarDb([[{ numero: 452, anio: 2026, version: 0, pdfDriveId: "pdf-452", pdfDefinitivoAt: new Date() }]]);

    expect((await pdfsDefinitivosDe(LISTA)).size).toBe(0);
  });

  it("si ninguna puede tenerlo, no consulta", async () => {
    const db = usarDb([]);

    expect((await pdfsDefinitivosDe([LISTA[1]])).size).toBe(0);
    expect(db.metodos()).toEqual([]);
  });
});

/**
 * Qué versiones no pueden ir a revisión por la ruta de las importadas: las que
 * se armaron en el cotizador. Las consultas van en el orden partidas, congelado.
 */
describe("seArmoEnElCotizador", () => {
  const V2 = { numero: 453, anio: 2026, version: 2 };

  it("con partidas: sí, y pregunta por esa versión", async () => {
    const db = usarDb([[{ id: "p-1" }], []]);

    expect(await seArmoEnElCotizador(V2)).toBe(true);
    const wheres = db.llamadas.filter((l) => l.metodo === "where");
    expect(wheres).toHaveLength(2);
    for (const w of wheres) expect(parametros(w.args[0])).toEqual([453, 2026, 2]);
  });

  // Regresó de una corrección y le quitaron todas las partidas: lo congelado
  // y su PDF siguen siendo los que el revisor rechazó.
  it("sin partidas pero congelada alguna vez: sí", async () => {
    usarDb([[], [{ numero: 453 }]]);

    expect(await seArmoEnElCotizador(V2)).toBe(true);
  });

  it("sin partidas y sin nada congelado (importada): no", async () => {
    usarDb([[], []]);

    expect(await seArmoEnElCotizador(V2)).toBe(false);
  });
});
