import { describe, it, expect } from "vitest";
import {
  moldeDeVineta,
  parrafos,
  segmentos,
  tablaDePartidas,
  tablas,
  textoDeCelda,
  textoDelDocumento,
} from "@/src/lib/cotizador/docs/recorrido";
import { ArmaDocumento } from "../../../helpers/documentos-falso";

/** Documentos inventados. La plantilla real no entra al repositorio. */

describe("segmentos", () => {
  it("el cuerpo primero, con id vacío, y después el encabezado", () => {
    const doc = new ArmaDocumento().parrafo("Cuerpo").conEncabezado("Arriba").construir();
    expect(segmentos(doc).map((s) => s.segmentId)).toEqual(["", "enc-1"]);
  });

  it("un documento sin encabezado solo trae el cuerpo", () => {
    const doc = new ArmaDocumento().parrafo("Cuerpo").construir();
    expect(segmentos(doc)).toHaveLength(1);
  });
});

describe("parrafos", () => {
  it("los índices avanzan como en Docs: desde 1 y con el salto de línea", () => {
    const doc = new ArmaDocumento().parrafo("Hola").parrafo("Adiós").construir();
    const p = parrafos(doc);
    // "Hola\n" son 5 caracteres: [1, 6)
    expect(p[0]).toMatchObject({ startIndex: 1, endIndex: 6, texto: "Hola\n" });
    expect(p[1]).toMatchObject({ startIndex: 6, endIndex: 12, texto: "Adiós\n" });
  });

  it("incluye los de dentro de una celda, y los marca", () => {
    const doc = new ArmaDocumento()
      .parrafo("Antes")
      .tabla([["PARTIDA", "CONCEPTO"]])
      .construir();
    const p = parrafos(doc);
    expect(p.map((x) => x.texto.trim())).toEqual(["Antes", "PARTIDA", "CONCEPTO"]);
    expect(p[0].dentroDeTabla).toBeUndefined();
    expect(p[1].dentroDeTabla).toMatchObject({ fila: 0, columna: 0 });
    expect(p[2].dentroDeTabla).toMatchObject({ fila: 0, columna: 1 });
  });

  it("los del encabezado traen su segmentId", () => {
    const doc = new ArmaDocumento().parrafo("Cuerpo").conEncabezado("Arriba").construir();
    const p = parrafos(doc);
    expect(p.find((x) => x.texto.trim() === "Arriba")!.segmentId).toBe("enc-1");
    expect(p.find((x) => x.texto.trim() === "Cuerpo")!.segmentId).toBe("");
  });

  it("textoDelDocumento junta todo, incluido lo de las tablas", () => {
    const doc = new ArmaDocumento().parrafo("A").tabla([["B"]]).construir();
    expect(textoDelDocumento(doc)).toContain("A");
    expect(textoDelDocumento(doc)).toContain("B");
  });
});

describe("tablas", () => {
  it("textoDeCelda recorta y lee la celda que se le pide", () => {
    const doc = new ArmaDocumento().tabla([["PARTIDA", "CONCEPTO"], ["1", "Algo"]]).construir();
    const t = tablas(doc)[0].tabla;
    expect(textoDeCelda(t, 0, 0)).toBe("PARTIDA");
    expect(textoDeCelda(t, 1, 1)).toBe("Algo");
  });

  it("una celda que no existe se lee como vacía, no revienta", () => {
    const doc = new ArmaDocumento().tabla([["PARTIDA"]]).construir();
    expect(textoDeCelda(tablas(doc)[0].tabla, 9, 9)).toBe("");
  });

  /**
   * Por contenido y no por posición: la plantilla se edita a mano y una tabla
   * de más arriba movería la posición sin que nadie se entere.
   */
  it("la tabla de partidas es la primera cuya celda (0,0) dice PARTIDA", () => {
    const doc = new ArmaDocumento()
      .tabla([["Datos del cliente", "x"]])
      .tabla([["PARTIDA", "CONCEPTO"]])
      .tabla([["PARTIDA", "otra igual"]])
      .construir();
    const t = tablaDePartidas(doc)!;
    expect(textoDeCelda(t.tabla, 0, 1)).toBe("CONCEPTO");
  });

  it("no distingue mayúsculas ni espacios de más", () => {
    const doc = new ArmaDocumento().tabla([["  partida  ", "CONCEPTO"]]).construir();
    expect(tablaDePartidas(doc)).not.toBeNull();
  });

  it("sin tabla de partidas devuelve null, para que quien llame decida", () => {
    const doc = new ArmaDocumento().parrafo("Sin tablas").construir();
    expect(tablaDePartidas(doc)).toBeNull();
  });

  it("el startIndex de la tabla es el del elemento, no el de su primera celda", () => {
    const doc = new ArmaDocumento().parrafo("Antes").tabla([["PARTIDA"]]).construir();
    const t = tablaDePartidas(doc)!;
    const celda = t.tabla.tableRows![0].tableCells![0];
    expect(t.startIndex).toBeLessThan(celda.startIndex!);
  });
});

describe("moldeDeVineta", () => {
  // No hace falta el estilo: la API de Docs no deja asignar un listId
  // existente a un párrafo nuevo. Lo que hace falta es DÓNDE está el molde.
  it("devuelve el párrafo con viñeta y su lista", () => {
    const doc = new ArmaDocumento().parrafo("Texto").vineta("Una viñeta", "lista-7").construir();
    const m = moldeDeVineta(doc)!;
    expect(m.texto.trim()).toBe("Una viñeta");
    expect(m.parrafo.bullet?.listId).toBe("lista-7");
  });

  // La de dentro de la tabla trae la letra y el color de la tabla; la de
  // "Documentos Aplicables" viene en rojo.
  it("prefiere la viñeta de dentro de una tabla", () => {
    const doc = new ArmaDocumento()
      .vineta("Documentos aplicables", "lista-roja")
      .tabla([["PARTIDA", { vineta: "Molde de la tabla", listId: "lista-tabla" }]])
      .construir();
    expect(moldeDeVineta(doc)!.parrafo.bullet?.listId).toBe("lista-tabla");
  });

  it("sin viñetas devuelve null", () => {
    expect(moldeDeVineta(new ArmaDocumento().parrafo("Nada").construir())).toBeNull();
  });
});
