/**
 * Lo que el PDF definitivo guarda y lee en la base: el borrador frente al
 * definitivo, la fecha que se fija una vez, y la foto de lo congelado.
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
import { pdfDeLaVersion } from "@/src/lib/cotizaciones";
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
