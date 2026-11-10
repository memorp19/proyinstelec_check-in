/**
 * Las secciones de prosa: Actividades Generales y el salto de los Términos.
 *
 * Lo que se capturó en la pantalla tiene que llegar al documento. Antes no
 * llegaba: el PDF repetía el texto de ejemplo de la plantilla, con su
 * "mantenimiento preventivo" fijo, dijera lo que dijera la cotización.
 */
import { describe, it, expect } from "vitest";
import { documentoVacio, type DatosDocumento } from "@/src/lib/cotizador/documento";
import { ajustarActividades, saltoAntesDeTerminos } from "@/src/lib/cotizador/docs/secciones";
import { ArmaDocumento } from "../../../helpers/documentos-falso";

const DE_LA_PLANTILLA = {
  objeto: "El objeto de la presente propuesta técnica … del servicio de mantenimiento preventivo.",
  alcance: "El alcance principal del servicio de mantenimiento preventivo …",
};

/** La plantilla, con sus dos párrafos y el renglón en blanco de en medio. */
function plantilla() {
  return new ArmaDocumento()
    .parrafo("Actividades Generales")
    .parrafo("")
    .parrafo(DE_LA_PLANTILLA.objeto)
    .parrafo("")
    .parrafo(DE_LA_PLANTILLA.alcance)
    .parrafo("")
    .parrafo("Documentos Aplicables y/o Referencias.")
    .parrafo("Términos y Condiciones Comerciales")
    .parrafo("Atentamente.")
    .construir();
}

const documento = (cambios: Partial<DatosDocumento> = {}): DatosDocumento => ({
  ...documentoVacio(),
  objeto: "El objeto … del servicio de Estudio de Arco Eléctrico, propiedad del Cliente S.A.",
  alcance: "El alcance principal del servicio de Estudio de Arco Eléctrico …",
  ...cambios,
});

const insertados = (r: ReturnType<typeof ajustarActividades>) =>
  r.solicitudes.flatMap((s) => ("insertText" in s ? [s.insertText.text] : []));
const borrados = (r: ReturnType<typeof ajustarActividades>) =>
  r.solicitudes.flatMap((s) => ("deleteContentRange" in s ? [s.deleteContentRange.range] : []));

describe("ajustarActividades", () => {
  it("escribe lo capturado en los dos párrafos", () => {
    const d = documento();
    const textos = insertados(ajustarActividades(plantilla(), d));
    expect(textos).toContain(d.objeto);
    expect(textos).toContain(d.alcance);
  });

  it("lo de la plantilla se borra, no se deja debajo", () => {
    const r = ajustarActividades(plantilla(), documento());
    // Dos párrafos reescritos: un borrado y una inserción cada uno.
    expect(borrados(r)).toHaveLength(2);
    expect(insertados(r)).toHaveLength(2);
  });

  /** Todo lo que cambia longitudes se emite de abajo hacia arriba. */
  it("el alcance va antes que el objeto, porque está más abajo", () => {
    const r = ajustarActividades(plantilla(), documento());
    const inicios = r.solicitudes.map((s) =>
      "deleteContentRange" in s
        ? s.deleteContentRange.range.startIndex
        : "insertText" in s
          ? s.insertText.location.index
          : -1,
    );
    expect(inicios).toEqual([...inicios].sort((a, b) => b - a));
  });

  /**
   * La regla del legacy: el segundo párrafo se quita cuando no hay alcance
   * capturado. Es de captura, no del título — la 289 no lo trae y la 290 sí.
   */
  it("sin alcance capturado se quita el párrafo, con su renglón en blanco", () => {
    const r = ajustarActividades(plantilla(), documento({ alcance: "" }));
    expect(insertados(r)).not.toContain(DE_LA_PLANTILLA.alcance);

    const doc = plantilla();
    const alcance = doc.body!.content!.find((e) =>
      (e.paragraph?.elements?.[0]?.textRun?.content ?? "").startsWith("El alcance"),
    )!;
    const enBlanco = doc.body!.content![doc.body!.content!.indexOf(alcance) + 1];
    const borrado = borrados(r).find((rg) => rg.startIndex === alcance.startIndex)!;
    expect(borrado.endIndex).toBe(enBlanco.endIndex);
  });

  it("`sinAlcance` lo quita aunque haya texto guardado", () => {
    const r = ajustarActividades(plantilla(), documento({ sinAlcance: true }));
    expect(insertados(r).join(" ")).not.toContain("El alcance principal");
  });

  it("sin objeto capturado se deja lo que traiga la plantilla", () => {
    const r = ajustarActividades(plantilla(), documento({ objeto: "   " }));
    expect(insertados(r).join(" ")).not.toContain("El objeto");
  });

  it("si la plantilla no trae el párrafo, avisa en vez de fallar", () => {
    const doc = new ArmaDocumento().parrafo("Otra cosa").construir();
    const r = ajustarActividades(doc, documento());
    expect(r.solicitudes).toEqual([]);
    expect(r.avisos.join(" ")).toContain("objeto");
    expect(r.avisos.join(" ")).toContain("alcance");
  });

  /** Dos párrafos que empiezan igual: tocar el que no es sería peor. */
  it("con el párrafo repetido no toca ninguno", () => {
    const doc = new ArmaDocumento()
      .parrafo(DE_LA_PLANTILLA.objeto)
      .parrafo(DE_LA_PLANTILLA.objeto)
      .construir();
    const r = ajustarActividades(doc, documento());
    expect(insertados(r)).toEqual([]);
    expect(r.avisos.join(" ")).toContain("objeto");
  });
});

describe("saltoAntesDeTerminos", () => {
  it("pone el salto de página en el renglón de los Términos", () => {
    const r = saltoAntesDeTerminos(plantilla());
    expect(r.solicitudes).toHaveLength(1);
    const s = r.solicitudes[0];
    expect("updateParagraphStyle" in s && s.updateParagraphStyle.paragraphStyle).toEqual({
      pageBreakBefore: true,
    });
    expect("updateParagraphStyle" in s && s.updateParagraphStyle.fields).toBe("pageBreakBefore");
  });

  it("apunta al renglón de los Términos y no a otro", () => {
    const doc = plantilla();
    const terminos = doc.body!.content!.find((e) =>
      (e.paragraph?.elements?.[0]?.textRun?.content ?? "").startsWith("Términos"),
    )!;
    const s = saltoAntesDeTerminos(doc).solicitudes[0];
    expect("updateParagraphStyle" in s && s.updateParagraphStyle.range.startIndex).toBe(
      terminos.startIndex,
    );
  });

  it("si no está el renglón, avisa en vez de fallar", () => {
    const r = saltoAntesDeTerminos(new ArmaDocumento().parrafo("nada").construir());
    expect(r.solicitudes).toEqual([]);
    expect(r.avisos.join(" ")).toContain("hoja nueva");
  });
});
