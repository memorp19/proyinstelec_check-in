import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ejecutarLote,
  esAbortoDeEnsayo,
  leerBanderas,
  MARCA_ENSAYO,
  opcion,
  verificarDestino,
} from "../../../../../scripts/guardas";

/**
 * Las guardas de los scripts que escriben en la base — `importar:2026`,
 * `catalogo:importar`, `clientes:importar`—. No tenían prueba, y son lo único
 * que separa una corrida de reporte de una escritura en producción.
 *
 * Los hosts son inventados.
 */

const HOST = "ep-pruebas-000.neon.tech";
const PRODUCCION = "ep-produccion-999.neon.tech";

describe("leerBanderas", () => {
  it("sin banderas no escribe nada", () => {
    expect(leerBanderas(["node", "script"])).toEqual({
      aplicar: false,
      ensayo: false,
      destino: null,
      escribe: false,
    });
  });

  it("--aplicar y --ensayo escriben los dos (el ensayo revierte después)", () => {
    expect(leerBanderas(["--aplicar"]).escribe).toBe(true);
    expect(leerBanderas(["--ensayo"]).escribe).toBe(true);
  });

  it("lee el destino", () => {
    expect(leerBanderas([`--destino=${HOST}`]).destino).toBe(HOST);
  });

  it("--destino= sin valor es como no ponerlo", () => {
    expect(leerBanderas(["--destino="]).destino).toBeNull();
  });
});

describe("opcion", () => {
  it("devuelve el valor de --nombre=valor", () => {
    expect(opcion("hoja", ["--hoja=Clientes"])).toBe("Clientes");
  });

  it("conserva los signos de igual del valor", () => {
    expect(opcion("reporte", ["--reporte=C:/temp/a=b.json"])).toBe("C:/temp/a=b.json");
  });

  it("null si no está", () => {
    expect(opcion("hoja", ["--otra=1"])).toBeNull();
  });
});

describe("verificarDestino", () => {
  let salidas: number[];
  let errores: string[];

  beforeEach(() => {
    salidas = [];
    errores = [];
    // `process.exit` no corta el flujo dentro de la prueba: se registra y la
    // función sigue, así que cada caso afirma sobre la PRIMERA salida.
    vi.spyOn(process, "exit").mockImplementation(((codigo?: number) => {
      salidas.push(codigo ?? 0);
      return undefined as never;
    }) as never);
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errores.push(args.join(" "));
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.PRODUCTION_DATABASE_HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PRODUCTION_DATABASE_HOST;
  });

  const banderas = (over: Partial<ReturnType<typeof leerBanderas>> = {}) => ({
    aplicar: false,
    ensayo: false,
    destino: null,
    escribe: false,
    ...over,
  });

  it("un reporte pasa sin exigir nada", () => {
    verificarDestino(HOST, banderas(), "escribe cosas");
    expect(salidas).toEqual([]);
  });

  // Callar que la variable falta es peor que no tener la guarda: quien ejecuta
  // cree estar protegido.
  it("escribir sin PRODUCTION_DATABASE_HOST se detiene y lo dice", () => {
    verificarDestino(HOST, banderas({ aplicar: true, escribe: true, destino: HOST }), "escribe cosas");
    expect(salidas[0]).toBe(1);
    expect(errores.join(" ")).toContain("PRODUCTION_DATABASE_HOST");
  });

  it("un reporte NO exige PRODUCTION_DATABASE_HOST", () => {
    verificarDestino(HOST, banderas(), "escribe cosas");
    expect(salidas).toEqual([]);
  });

  it("contra el host de producción no se ejecuta, ni para reportar", () => {
    process.env.PRODUCTION_DATABASE_HOST = PRODUCCION;
    verificarDestino(PRODUCCION, banderas(), "Este script reescribe el catálogo");
    expect(salidas[0]).toBe(1);
    expect(errores.join(" ")).toContain("Este script reescribe el catálogo");
  });

  it("escribir sin --destino se detiene", () => {
    process.env.PRODUCTION_DATABASE_HOST = PRODUCCION;
    verificarDestino(HOST, banderas({ aplicar: true, escribe: true }), "escribe cosas");
    expect(salidas[0]).toBe(1);
    expect(errores.join(" ")).toContain(`--destino=${HOST}`);
  });

  // El error que la guarda existe para atrapar: creer que estás en una base y
  // estar en otra.
  it("un --destino que no es la base conectada se detiene", () => {
    process.env.PRODUCTION_DATABASE_HOST = PRODUCCION;
    verificarDestino(
      HOST,
      banderas({ aplicar: true, escribe: true, destino: "ep-otra-111.neon.tech" }),
      "escribe cosas",
    );
    expect(salidas[0]).toBe(1);
    expect(errores.join(" ")).toContain("No se escribe nada");
  });

  it("con todo en su lugar, deja pasar", () => {
    process.env.PRODUCTION_DATABASE_HOST = PRODUCCION;
    verificarDestino(HOST, banderas({ aplicar: true, escribe: true, destino: HOST }), "escribe cosas");
    expect(salidas).toEqual([]);
  });
});

describe("ejecutarLote", () => {
  /** Falso del cliente de Neon: registra lo que se le manda a `transaction`. */
  function sqlFalso(fallaCon?: Error) {
    const recibidas: unknown[][] = [];
    const sql = ((plantilla: TemplateStringsArray, ...v: unknown[]) =>
      `${plantilla.join("?")}|${JSON.stringify(v)}`) as never as {
      (p: TemplateStringsArray, ...v: unknown[]): string;
      transaction: (consultas: unknown[]) => Promise<void>;
    };
    sql.transaction = async (consultas: unknown[]) => {
      recibidas.push(consultas);
      if (fallaCon) throw fallaCon;
    };
    return { sql, recibidas };
  }

  const banderas = (over: Record<string, unknown> = {}) =>
    ({ aplicar: true, ensayo: false, destino: null, escribe: true, ...over }) as never;

  it("manda el lote completo en una sola transacción", async () => {
    const { sql, recibidas } = sqlFalso();
    const { aplicado } = await ejecutarLote(sql as never, ["a", "b", "c"], banderas());
    expect(aplicado).toBe(true);
    expect(recibidas).toHaveLength(1);
    expect(recibidas[0]).toEqual(["a", "b", "c"]);
  });

  // El ensayo ejecuta de verdad —tipos y restricciones se comprueban— y revierte.
  it("en ensayo añade el aborto al final y devuelve que no aplicó", async () => {
    const { sql, recibidas } = sqlFalso(new Error(`invalid input syntax: "${MARCA_ENSAYO}"`));
    const { aplicado } = await ejecutarLote(sql as never, ["a"], banderas({ ensayo: true }));
    expect(aplicado).toBe(false);
    expect(recibidas[0]).toHaveLength(2); // la sentencia + el aborto
  });

  it("un error de verdad en ensayo sí se propaga", async () => {
    const { sql } = sqlFalso(new Error('null value in column "nombre" violates not-null'));
    await expect(ejecutarLote(sql as never, ["a"], banderas({ ensayo: true }))).rejects.toThrow(
      "violates not-null",
    );
  });

  it("un error fuera de ensayo se propaga", async () => {
    const { sql } = sqlFalso(new Error("se cayó la red"));
    await expect(ejecutarLote(sql as never, ["a"], banderas())).rejects.toThrow("se cayó la red");
  });

  it("esAbortoDeEnsayo reconoce la marca y nada más", () => {
    expect(esAbortoDeEnsayo(new Error(`algo ${MARCA_ENSAYO} algo`))).toBe(true);
    expect(esAbortoDeEnsayo(new Error("duplicate key"))).toBe(false);
  });
});
