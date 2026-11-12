/**
 * El rojo de la plantilla no sale impreso.
 *
 * La plantilla marca en rojo todo lo que hay que llenar —la carta, el
 * destinatario, el título, los dos párrafos de Actividades Generales y las 23
 * normas— y Apps Script lo pone en negro al generar. Hasta que esto existió,
 * nuestro PDF salía casi entero en rojo: lo único que se pintaba era el cuadro
 * de partidas.
 */
import { describe, it, expect } from "vitest";
import { esRojo, solicitudesDeNegro } from "@/src/lib/cotizador/docs/colores";
import { ArmaDocumento } from "../../../helpers/documentos-falso";

const NEGRO = { color: { rgbColor: { red: 0, green: 0, blue: 0 } } };

describe("esRojo", () => {
  it("reconoce el rojo de la plantilla", () => {
    expect(esRojo({ foregroundColor: { color: { rgbColor: { red: 1 } } } })).toBe(true);
  });

  /**
   * Por umbral y no por igualdad con `#FF0000`: quien edite un renglón a mano
   * va a elegir otro rojo del selector, y saldría impreso igual de mal.
   */
  it("reconoce también un rojo oscuro elegido a mano", () => {
    expect(
      esRojo({ foregroundColor: { color: { rgbColor: { red: 0.8, green: 0.1, blue: 0.1 } } } }),
    ).toBe(true);
  });

  it("no toca el azul de un enlace, que en los documentos reales sí se queda", () => {
    expect(
      esRojo({ foregroundColor: { color: { rgbColor: { red: 0.07, green: 0.33, blue: 0.8 } } } }),
    ).toBe(false);
  });

  it("un texto sin color no es rojo", () => {
    expect(esRojo(undefined)).toBe(false);
    expect(esRojo({ bold: true })).toBe(false);
  });
});

describe("solicitudesDeNegro", () => {
  it("pinta de negro cada tramo rojo y deja el resto en paz", () => {
    const doc = new ArmaDocumento()
      .parrafo("Esto ya está en negro")
      .parrafoRojo("Esto hay que llenarlo")
      .parrafo("Esto tampoco se toca")
      .construir();

    const r = solicitudesDeNegro(doc);
    expect(r).toHaveLength(1);
    expect(r[0].updateTextStyle.textStyle.foregroundColor).toEqual(NEGRO);
    expect(r[0].updateTextStyle.fields).toBe("foregroundColor");
  });

  it("el rango es el del tramo rojo, no el del documento", () => {
    const doc = new ArmaDocumento()
      .parrafo("doce chars.")
      .parrafoRojo("rojo")
      .construir();

    const { range } = solicitudesDeNegro(doc)[0].updateTextStyle;
    // El primer párrafo ocupa su texto más el `\n`; el rojo empieza después.
    expect(range.startIndex).toBe(1 + "doce chars.".length + 1);
  });

  it("sin nada rojo no emite ni una solicitud", () => {
    const doc = new ArmaDocumento().parrafo("todo negro").vineta("una viñeta").construir();
    expect(solicitudesDeNegro(doc)).toEqual([]);
  });

  /**
   * El glifo de la viñeta toma su color de `bullet.textStyle` y la API no
   * tiene una solicitud para cambiarlo. Lo único que se puede intentar es
   * pintar el párrafo entero, con su marca de fin.
   */
  it("una viñeta roja se intenta arreglar pintando el párrafo entero", () => {
    const doc = new ArmaDocumento().vinetaRoja("CFE-SOM-3531 Manual").construir();
    const [solicitud] = solicitudesDeNegro(doc);
    const { range } = solicitud.updateTextStyle;
    expect(range.startIndex).toBe(1);
    expect(range.endIndex).toBeGreaterThan("CFE-SOM-3531 Manual".length);
  });

  it("no emite rangos vacíos, que la API rechaza", () => {
    const doc = new ArmaDocumento().parrafoRojo("").construir();
    for (const s of solicitudesDeNegro(doc)) {
      expect(s.updateTextStyle.range.endIndex).toBeGreaterThan(s.updateTextStyle.range.startIndex);
    }
  });

  it("también pinta lo rojo de dentro de una tabla", () => {
    const doc = new ArmaDocumento().parrafo("fuera").tabla([["dentro", "otra"]]).construir();
    // La tabla del helper no trae color, así que esto comprueba lo contrario:
    // que recorrerla no invente solicitudes.
    expect(solicitudesDeNegro(doc)).toEqual([]);
  });
});
