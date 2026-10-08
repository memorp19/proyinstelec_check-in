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
    });

    const [c] = llamadas;
    expect(c.interpolada).toBe(false);
    noViajaEnElTexto(c.texto);
    expect(c.valores).toContain(VENENOS.puntoYComa);
    expect(c.valores).toContain(VENENOS.dolar);
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

  it("el borrado del año parametriza el año y el patrón del LIKE", () => {
    const { sql, llamadas } = espia();
    borrarAnio(sql, 2026);

    expect(llamadas).toHaveLength(5);
    for (const c of llamadas) {
      expect(c.interpolada).toBe(false);
      // Ni el año ni el patrón quedan escritos en el texto
      expect(c.texto).not.toContain("2026");
    }
    expect(llamadas.map((c) => c.valores)).toEqual([[2026], [2026], [2026], ["%-2026"], [2026]]);
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
