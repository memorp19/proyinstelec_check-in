import { describe, it, expect } from "vitest";
import {
  abortarEnsayo,
  borrarAnio,
  insertarBitacora,
  insertarCliente,
  insertarCotizacion,
  insertarOT,
  MARCA_ENSAYO,
} from "@/src/lib/importacion-2026";

/**
 * Doble de la función que devuelve `neon()`, que registra cómo se la invocó.
 *
 * Lo que de verdad vigila: si alguien vuelve a escribir `sql(\`...\`)` —llamada
 * con una cadena en vez de tagged template—, el template literal se interpola
 * ANTES de llegar aquí y lo que recibimos es un `string`, no un
 * `TemplateStringsArray`. Eso se marca como `interpolada` y revienta los tests.
 *
 * Es exactamente el fallo que tumbó la primera carga real: un cliente llamado
 * "GSM INDUSTRIAL" acabó dentro del SQL y Postgres respondió
 * `syntax error at or near "INDUSTRIAL"`.
 */
function espia() {
  const llamadas: Array<{ texto: string; valores: unknown[]; interpolada: boolean }> = [];

  const sql = ((plantilla: TemplateStringsArray | string, ...valores: unknown[]) => {
    const esTemplate = typeof plantilla !== "string" && Array.isArray(plantilla.raw);
    const registro = esTemplate
      ? { texto: (plantilla as TemplateStringsArray).join("$?"), valores, interpolada: false }
      : { texto: String(plantilla), valores: [], interpolada: true };
    llamadas.push(registro);
    return registro;
  }) as never;

  return { sql, llamadas };
}

/** Valores que rompen una consulta si viajan dentro del texto SQL. */
const VENENOS = {
  espacios: "GSM INDUSTRIAL",
  apostrofo: "O'BRIEN & CÍA",
  comillas: 'ACEROS "EL SOL"',
  acentos: "FÁBRICA DE JABÓN LA CORONA",
  enie: "PEÑOLES MUÑOZ",
  puntoYComa: "ALFA; DROP TABLE cotizaciones; --",
  ocDoble: "4501122596 / 4501153770",
  dolar: "COSTOS $$ 100",
};

const TODOS = Object.values(VENENOS);

/** Ningún valor peligroso puede aparecer en la parte estática de la consulta. */
function noViajaEnElTexto(texto: string) {
  for (const v of TODOS) expect(texto).not.toContain(v);
}

describe("las escrituras parametrizan, nunca interpolan", () => {
  it("insertarCliente manda el nombre como parámetro", () => {
    const { sql, llamadas } = espia();
    insertarCliente(sql, {
      id: "id-1",
      razonSocial: VENENOS.espacios,
      razonNormalizada: VENENOS.apostrofo,
      createdBy: "importador",
    });

    const [c] = llamadas;
    expect(c.interpolada).toBe(false);
    noViajaEnElTexto(c.texto);
    expect(c.valores).toEqual(["id-1", VENENOS.espacios, VENENOS.apostrofo, "importador"]);
  });

  it("insertarCotizacion manda cliente, título y OC como parámetros", () => {
    const { sql, llamadas } = espia();
    insertarCotizacion(sql, {
      numero: 5,
      anio: 2026,
      version: 0,
      folio: "PCOTOP-005-2026",
      cliente: VENENOS.apostrofo,
      clienteId: null,
      titulo: VENENOS.comillas,
      dirigidaA: VENENOS.acentos,
      prioridad: "ALTA",
      estatus: "ASIGNADA",
      elaboro: "JGM",
      fechaSolicitud: "2026-01-05T12:00:00.000Z",
      fechaEntrega: null,
      ordenCompra: VENENOS.ocDoble,
      folioOt: "OT005260",
      createdBy: "importador",
    });

    const [c] = llamadas;
    expect(c.interpolada).toBe(false);
    noViajaEnElTexto(c.texto);
    expect(c.valores).toContain(VENENOS.apostrofo);
    expect(c.valores).toContain(VENENOS.comillas);
    expect(c.valores).toContain(VENENOS.ocDoble);
    // El NULL viaja como valor, no como la palabra NULL dentro del texto
    expect(c.valores).toContain(null);
  });

  it("insertarOT manda cliente y título como parámetros", () => {
    const { sql, llamadas } = espia();
    insertarOT(sql, {
      folio: "OT005260",
      numeroCotizacion: 5,
      anio: 2026,
      version: 0,
      ordenCompra: VENENOS.ocDoble,
      cliente: VENENOS.enie,
      titulo: VENENOS.puntoYComa,
      dirigidaA: VENENOS.dolar,
      estatus: "En Proceso",
      createdBy: "importador",
      createdAt: "2026-07-31T12:00:00.000Z",
    });

    const [c] = llamadas;
    expect(c.interpolada).toBe(false);
    noViajaEnElTexto(c.texto);
    expect(c.valores).toContain(VENENOS.puntoYComa);
    expect(c.valores).toContain(VENENOS.dolar);
    // La fecha de la OT se escribe explicitamente: sin ella, la columna usaria
    // su defaultNow() y todas las OT historicas quedarian fechadas el dia de
    // la carga.
    expect(c.texto).toContain("created_at");
    expect(c.valores).toContain("2026-07-31T12:00:00.000Z");
  });

  it("insertarBitacora manda el detalle como parámetro", () => {
    const { sql, llamadas } = espia();
    insertarBitacora(sql, {
      id: "b-1",
      usuario: "importador",
      referencia: "005-2026",
      detalle: VENENOS.puntoYComa,
    });

    const [c] = llamadas;
    expect(c.interpolada).toBe(false);
    noViajaEnElTexto(c.texto);
    expect(c.valores).toContain(VENENOS.puntoYComa);
  });

  it("el borrado del año parametriza el año", () => {
    const { sql, llamadas } = espia();
    borrarAnio(sql, 2026);

    expect(llamadas).toHaveLength(3);
    for (const c of llamadas) {
      expect(c.interpolada).toBe(false);
      expect(c.texto).not.toContain("2026");
      expect(c.valores).toEqual([2026]);
    }
  });

  // Son rastro humano que la carga no sabe reconstruir: la aprobación es por
  // versión exacta y la da una persona; la bitácora guarda envíos y correos que
  // ocurrieron de verdad. Y el filtro obvio se pasa de largo, porque `cotPk()`
  // genera `COT#002-2026` y un LIKE '%-2026' barre toda la historia de la app.
  it("NO borra bitácora ni aprobaciones", () => {
    const { sql, llamadas } = espia();
    borrarAnio(sql, 2026);

    const todo = llamadas.map((c) => c.texto).join(" ");
    expect(todo).not.toContain("bitacora");
    expect(todo).not.toContain("aprobaciones");
    expect(todo).not.toContain("LIKE");
  });

  it("borra en orden de dependencia: responsables, OT, cotizaciones", () => {
    const { sql, llamadas } = espia();
    borrarAnio(sql, 2026);

    const tablas = llamadas.map((c) => c.texto.match(/DELETE FROM (\w+)/)![1]);
    expect(tablas).toEqual(["ot_responsables", "ordenes_trabajo", "cotizaciones"]);
  });

  it("cada consulta declara tantos huecos como valores manda", () => {
    const { sql, llamadas } = espia();
    insertarCliente(sql, {
      id: "id-1",
      razonSocial: "X",
      razonNormalizada: "x",
      createdBy: "importador",
    });
    borrarAnio(sql, 2026);

    for (const c of llamadas) {
      expect(c.texto.split("$?")).toHaveLength(c.valores.length + 1);
    }
  });

  // Si alguien convierte un sql`...` en sql(`...`), esto es lo que lo atrapa.
  it("el espía detecta una llamada interpolada", () => {
    const { sql, llamadas } = espia();
    const comoFuncion = sql as unknown as (texto: string) => unknown;
    comoFuncion(`INSERT INTO clientes (razon_social) VALUES (${VENENOS.espacios})`);

    expect(llamadas[0].interpolada).toBe(true);
    expect(llamadas[0].texto).toContain("GSM INDUSTRIAL");
  });
});

describe("abortarEnsayo", () => {
  it("falla con un cast imposible y la marca viaja como parámetro", () => {
    const { sql, llamadas } = espia();
    abortarEnsayo(sql);

    const [c] = llamadas;
    expect(c.interpolada).toBe(false);
    expect(c.valores).toEqual([MARCA_ENSAYO]);
    expect(c.texto).toContain("AS integer");
  });

  // Dentro de un bloque DO el cuerpo va entre $$...$$, así que un $1 ahí es
  // texto literal: la sentencia declararía cero parámetros y el driver mandaría
  // uno. Por eso NO se usa RAISE EXCEPTION.
  it("no usa un bloque DO, donde el parámetro no sería tal", () => {
    const { sql, llamadas } = espia();
    abortarEnsayo(sql);

    expect(llamadas[0].texto).not.toContain("$$");
    expect(llamadas[0].texto).not.toContain("RAISE");
  });
});
