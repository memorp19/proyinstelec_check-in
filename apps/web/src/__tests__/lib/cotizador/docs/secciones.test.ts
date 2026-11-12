/**
 * Las secciones de prosa: Actividades Generales y el salto de los Términos.
 *
 * Lo que se capturó en la pantalla tiene que llegar al documento. Antes no
 * llegaba: el PDF repetía el texto de ejemplo de la plantilla, con su
 * "mantenimiento preventivo" fijo, dijera lo que dijera la cotización.
 */
import { describe, it, expect } from "vitest";
import { documentoVacio, type DatosDocumento } from "@/src/lib/cotizador/documento";
import {
  ajustarActividades,
  ajustarMoneda,
  NOMBRE_DE_MONEDA,
  saltoAntesDeTerminos,
} from "@/src/lib/cotizador/docs/secciones";
import type { Solicitud } from "@/src/lib/cotizador/docs/tipos";
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
    // El renglón en blanco que la plantilla trae antes de los Términos: es el
    // que se lleva el salto de página.
    .parrafo("")
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

  /**
   * En el renglón en blanco de antes, no en el título. El membrete es una
   * imagen de página completa detrás del texto y su leyenda cae a la altura
   * del margen superior: un título que empieza arriba del todo sale encima.
   * Así lo hace el documento real.
   */
  it("lo pone en el renglón en blanco de antes, no en el título", () => {
    const doc = plantilla();
    const sueltos = doc.body!.content!.filter((e) => e.paragraph);
    const i = sueltos.findIndex((e) =>
      (e.paragraph?.elements?.[0]?.textRun?.content ?? "").startsWith("Términos"),
    );
    const s = saltoAntesDeTerminos(doc).solicitudes[0];

    expect("updateParagraphStyle" in s && s.updateParagraphStyle.range.startIndex).toBe(
      sueltos[i - 1].startIndex,
    );
    expect("updateParagraphStyle" in s && s.updateParagraphStyle.range.startIndex).not.toBe(
      sueltos[i].startIndex,
    );
  });

  it("sin renglón en blanco antes, lo pone en el título y avisa", () => {
    const doc = new ArmaDocumento()
      .parrafo("Documentos Aplicables y/o Referencias.")
      .parrafo("Términos y Condiciones Comerciales")
      .construir();
    const r = saltoAntesDeTerminos(doc);

    const titulo = doc.body!.content!.find((e) =>
      (e.paragraph?.elements?.[0]?.textRun?.content ?? "").startsWith("Términos"),
    )!;
    const s = r.solicitudes[0];
    expect("updateParagraphStyle" in s && s.updateParagraphStyle.range.startIndex).toBe(
      titulo.startIndex,
    );
    expect(r.avisos.join(" ")).toContain("encima del membrete");
  });

  it("si no está el renglón, avisa en vez de fallar", () => {
    const r = saltoAntesDeTerminos(new ArmaDocumento().parrafo("nada").construir());
    expect(r.solicitudes).toEqual([]);
    expect(r.avisos.join(" ")).toContain("hoja nueva");
  });
});


// ── La moneda de los Términos ─────────────────────────────────────────────────

/**
 * El renglón de los precios tal como está en la plantilla: dos corridas, y la
 * segunda —el nombre de la moneda— en negritas.
 */
function plantillaConPrecios() {
  return new ArmaDocumento()
    .parrafo("Términos y Condiciones Comerciales")
    .parrafo("CONDICIONES DE PAGO:")
    .corridas([
      { texto: "Nuestros precios son firmes en " },
      { texto: "Moneda Nacional", negrita: true },
    ])
    .parrafo("La vigencia de esta propuesta es de {{VIGENCIA}} días.")
    .construir();
}

const rangosBorrados = (s: Solicitud[]) =>
  s.flatMap((x) => ("deleteContentRange" in x ? [x.deleteContentRange.range] : []));
const inserciones = (s: Solicitud[]) =>
  s.flatMap((x) => ("insertText" in x ? [x.insertText] : []));
const estilosDeTexto = (s: Solicitud[]) =>
  s.flatMap((x) => ("updateTextStyle" in x ? [x.updateTextStyle] : []));

describe("ajustarMoneda", () => {
  // La plantilla ya está escrita en pesos: el caso normal no toca el documento.
  it("en pesos no emite ni una solicitud", () => {
    const r = ajustarMoneda(plantillaConPrecios(), "MXN");
    expect(r.solicitudes).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("en dólares cambia el nombre de la moneda", () => {
    const { solicitudes, avisos } = ajustarMoneda(plantillaConPrecios(), "USD");
    expect(avisos).toEqual([]);
    expect(inserciones(solicitudes).map((i) => i.text)).toEqual(["Dólares Americanos"]);
  });

  /** El resto del renglón es texto legal: se borra la moneda y nada más. */
  it("borra exactamente «Moneda Nacional», no el párrafo", () => {
    const { solicitudes } = ajustarMoneda(plantillaConPrecios(), "USD");
    const [rango] = rangosBorrados(solicitudes);
    expect(rango.endIndex - rango.startIndex).toBe(NOMBRE_DE_MONEDA.MXN.length);
    // Y se inserta justo donde estaba.
    expect(inserciones(solicitudes)[0].location.index).toBe(rango.startIndex);
  });

  /**
   * `insertText` hereda el estilo del carácter de **delante** —el "en " sin
   * negritas—, no el del texto que se borró. Sin volver a ponerlas, "Dólares
   * Americanos" saldría en redonda debajo de un renglón que iba en negritas.
   */
  it("conserva las negritas", () => {
    const { solicitudes } = ajustarMoneda(plantillaConPrecios(), "USD");
    const [estilo] = estilosDeTexto(solicitudes);
    expect(estilo.textStyle).toEqual({ bold: true });
    expect(estilo.fields).toBe("bold");
  });

  it("el estilo se aplica al texto nuevo, no al viejo", () => {
    const { solicitudes } = ajustarMoneda(plantillaConPrecios(), "USD");
    const [rango] = rangosBorrados(solicitudes);
    expect(estilosDeTexto(solicitudes)[0].range).toEqual({
      startIndex: rango.startIndex,
      endIndex: rango.startIndex + "Dólares Americanos".length,
    });
  });

  it("y va después de borrar e insertar, que es cuando el rango ya es el nuevo", () => {
    const { solicitudes } = ajustarMoneda(plantillaConPrecios(), "USD");
    expect(solicitudes.map((s) => Object.keys(s)[0])).toEqual([
      "deleteContentRange",
      "insertText",
      "updateTextStyle",
    ]);
  });

  // Tocar un renglón que no se reconoce es peor que no tocar ninguno.
  it("sin el renglón de los precios, avisa y no toca nada", () => {
    const sinPrecios = new ArmaDocumento().parrafo("Términos y Condiciones Comerciales").construir();
    const r = ajustarMoneda(sinPrecios, "USD");
    expect(r.solicitudes).toEqual([]);
    expect(r.avisos[0]).toContain("Nuestros precios son firmes en");
  });

  it("si el renglón ya no dice «Moneda Nacional», avisa y no reescribe", () => {
    const otro = new ArmaDocumento()
      .parrafo("Nuestros precios son firmes en la divisa que se pacte")
      .construir();
    const r = ajustarMoneda(otro, "USD");
    expect(r.solicitudes).toEqual([]);
    expect(r.avisos[0]).toContain("Moneda Nacional");
  });
});
