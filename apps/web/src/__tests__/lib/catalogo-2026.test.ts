import { describe, it, expect } from "vitest";
import {
  costoDeEstudio,
  esDescarte,
  familiaDeFila,
  leerBloquesEstudio,
  leerFilaCatalogo,
  resumirPorFamilia,
  type FilaCatalogo,
} from "@/src/lib/catalogo-2026";
import { cabeEnEscala, decimalesDe } from "@/src/lib/cotizador";
import type { Celda, Fila } from "@/src/lib/excel";

const c = (valor: string, tipo = "s"): Celda => ({ valor, tipo, conFormatoDeFecha: false });

/** Un renglón de `ZI:ZK` tal como lo entrega el lector de Excel. */
const renglon = (codigo: string, descripcion: string, costo?: string): Fila => ({
  ZI: c(codigo),
  ZJ: c(descripcion),
  ...(costo === undefined ? {} : { ZK: c(costo, "n") }),
});

describe("leerFilaCatalogo", () => {
  it("convierte un servicio con su costo", () => {
    const r = leerFilaCatalogo(113, renglon("SP001", "Resistencia de Aislamiento a Transformador", "2000"));
    expect(r).toEqual({
      fila: 113,
      codigo: "SP001",
      descripcion: "Resistencia de Aislamiento a Transformador",
      costo: 2000,
      costoCrudo: "2000",
    });
  });

  /**
   * El texto de la celda se conserva para poder contar los decimales **de
   * verdad**. Sobre el número ya convertido no se distingue lo que traía la
   * celda de lo que el binario le haga, y ese conteo es lo que decide si la
   * columna lo guarda entero o lo redondea sin avisar.
   */
  it("conserva el texto de la celda, sin convertir", () => {
    const r = leerFilaCatalogo(1, renglon("X1", "Algo", "2671.885")) as FilaCatalogo;
    expect(r.costoCrudo).toBe("2671.885");
    expect(decimalesDe(r.costoCrudo)).toBe(3);
    expect(cabeEnEscala(r.costoCrudo)).toBe(true);
    // Es el valor que en numeric(14,2) se volvía 2,671.89.
    expect(cabeEnEscala(r.costoCrudo, 2)).toBe(false);
  });

  /**
   * El formato trae el catálogo preasignado: 176 códigos de los que solo 87
   * tienen servicio. Cargar los huecos llenaría el catálogo de códigos que no
   * significan nada y que alguien acabaría eligiendo en una cotización.
   */
  it("descarta los huecos del formato", () => {
    for (const fila of [
      renglon("BT001", "Disponible", "0"),
      renglon("BT002", "DISPONIBLE", "0"),
      renglon("SP054", "", "0"),
      renglon("COSTO_DISPONIBLE", "Lo que sea", "0"),
    ]) {
      const r = leerFilaCatalogo(1, fila);
      expect(r && esDescarte(r) && r.motivo).toBe("HUECO");
    }
  });

  it("descarta el separador de la cabecera", () => {
    const r = leerFilaCatalogo(1, { ZI: c("---"), ZK: c("---") });
    expect(r && esDescarte(r) && r.motivo).toBe("SEPARADOR");
  });

  // La hoja COSTOS tiene cientos de renglones que no son el catálogo. No son
  // un descarte: es que la columna ZI está vacía y la fila no viene al caso.
  it("una fila sin código no es del catálogo", () => {
    expect(leerFilaCatalogo(900, { A: c("otra cosa") })).toBeNull();
  });

  it("un costo que no es número queda en null y no en cero", () => {
    const r = leerFilaCatalogo(1, renglon("SP001", "Algo", "por definir")) as FilaCatalogo;
    expect(r.costo).toBeNull();
  });

  it("lee el costo aunque venga con signo y comas", () => {
    const r = leerFilaCatalogo(1, renglon("SP001", "Algo", "$ 15,000")) as FilaCatalogo;
    expect(r.costo).toBe(15000);
  });

  it("un costo 0 es 0, no null: el hueco se distingue por la descripción", () => {
    const r = leerFilaCatalogo(1, renglon("COSTO_TRANSPORTE_A", "Transporte Aéreo", "0")) as FilaCatalogo;
    expect(r.costo).toBe(0);
  });
});

// ── Los bloques de estudio ───────────────────────────────────────────────────

/** Un bloque de 10 renglones como los que el Excel apila en YZ y ZD. */
function bloque(
  inicio: number,
  colCodigo: string,
  colValores: string,
  p: { codigo: string; horas: number; dias: number; ings: number; semanas: number; tarifa: number },
): Array<{ numero: number; celdas: Fila }> {
  const n = (v: number) => c(String(v), "n");
  return [
    { numero: inicio, celdas: { [colCodigo]: c(p.codigo) } },
    { numero: inicio + 1, celdas: { [colCodigo]: c("HORAS"), [colValores]: c("DIAS") } },
    { numero: inicio + 2, celdas: { [colCodigo]: n(p.horas), [colValores]: n(p.dias) } },
    { numero: inicio + 3, celdas: { [colCodigo]: c("HR/SEM"), [colValores]: c("NO. INGS") } },
    { numero: inicio + 4, celdas: { [colCodigo]: n(p.horas * p.dias), [colValores]: n(p.ings) } },
    { numero: inicio + 5, celdas: { [colCodigo]: c("HR/SEM"), [colValores]: c("NO. SEM") } },
    { numero: inicio + 6, celdas: { [colCodigo]: n(p.horas * p.dias * p.ings), [colValores]: n(p.semanas) } },
    { numero: inicio + 7, celdas: { [colCodigo]: c("TOTAL 3"), [colValores]: c("$ HR/H") } },
    { numero: inicio + 8, celdas: { [colCodigo]: n(p.horas * p.dias * p.ings * p.semanas), [colValores]: n(p.tarifa) } },
  ];
}

describe("leerBloquesEstudio", () => {
  // Las cifras son las del formato real: AR001 sale en 9,600 y AR002 en 80,000.
  const AR001 = { codigo: "AR001", horas: 8, dias: 5, ings: 2, semanas: 10, tarifa: 12 };
  const AR002 = { codigo: "AR002", horas: 8, dias: 5, ings: 1, semanas: 4, tarifa: 500 };

  it("lee los dos bloques de un mismo renglón de arranque", () => {
    const filas = [...bloque(2, "YZ", "ZA", AR001), ...bloque(2, "ZD", "ZE", AR002)];
    // Mismo número de renglón en ambas columnas: hay que fundir las celdas.
    const fundidas = new Map<number, Fila>();
    for (const f of filas) fundidas.set(f.numero, { ...(fundidas.get(f.numero) ?? {}), ...f.celdas });
    const bloques = leerBloquesEstudio([...fundidas].map(([numero, celdas]) => ({ numero, celdas })));

    expect([...bloques.keys()]).toEqual(["AR001", "AR002"]);
    expect(bloques.get("AR001")).toEqual({
      codigo: "AR001", horasPorDia: 8, diasPorSemana: 5, ingenieros: 2, semanas: 10, tarifaHora: 12,
    });
  });

  it("el costo del bloque es el de la columna del catálogo", () => {
    expect(costoDeEstudio({ codigo: "AR001", horasPorDia: 8, diasPorSemana: 5, ingenieros: 2, semanas: 10, tarifaHora: 12 })).toBe(9600);
    expect(costoDeEstudio({ codigo: "AR002", horasPorDia: 8, diasPorSemana: 5, ingenieros: 1, semanas: 4, tarifaHora: 500 })).toBe(80000);
  });

  it("encuentra los bloques de más abajo, que se repiten cada diez renglones", () => {
    const bloques = leerBloquesEstudio([
      ...bloque(2, "YZ", "ZA", AR001),
      ...bloque(12, "YZ", "ZA", { ...AR002, codigo: "AR003" }),
      ...bloque(22, "YZ", "ZA", { ...AR002, codigo: "AR005" }),
    ]);
    expect([...bloques.keys()]).toEqual(["AR001", "AR003", "AR005"]);
  });

  // Un renglón de etiquetas no abre un bloque: si el formato se desalinea, se
  // lee de menos en vez de inventar un estudio con números de otra fila.
  it("solo un código con forma de servicio abre un bloque", () => {
    const filas = bloque(2, "YZ", "ZA", AR001);
    filas[0].celdas.YZ = c("TOTAL 1");
    expect(leerBloquesEstudio(filas).size).toBe(0);
  });

  it("un bloque al que le falta un número no se lee a medias", () => {
    const filas = bloque(2, "YZ", "ZA", AR001);
    delete filas[8].celdas.ZA; // la tarifa por hora
    expect(leerBloquesEstudio(filas).size).toBe(0);
  });
});

describe("resumen", () => {
  it("la familia es el prefijo, y los gastos llevan todos el mismo", () => {
    expect(familiaDeFila("SP001")).toBe("SP");
    expect(familiaDeFila("AR002")).toBe("AR");
    expect(familiaDeFila("COSTO_ALIMENTOS CENTRO")).toBe("COSTO");
  });

  it("cuenta por familia y señala lo que se cargaría en cero", () => {
    const filas: Array<Pick<FilaCatalogo, "codigo" | "costo">> = [
      { codigo: "AR001", costo: 9600 },
      { codigo: "AR002", costo: 80000 },
      { codigo: "COSTO_TRANSPORTE_A", costo: 0 },
      { codigo: "COSTO_HOSPEDAJE", costo: 2000 },
      { codigo: "SP001", costo: null },
    ];
    expect(resumirPorFamilia(filas)).toEqual([
      { familia: "AR", total: 2, sinCosto: [] },
      { familia: "COSTO", total: 2, sinCosto: ["COSTO_TRANSPORTE_A"] },
      { familia: "SP", total: 1, sinCosto: ["SP001"] },
    ]);
  });
});
