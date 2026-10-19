import { describe, it, expect } from "vitest";
import {
  bloquesDeDescripcion,
  bloquesVisibles,
  descripcionDeBloques,
  normasElegidas,
  normasSugeridas,
  sitioDelProyecto,
  textoDelReporte,
  textosSugeridos,
  tituloParaDocumento,
  type Bloque,
} from "@/src/lib/cotizador";

describe("bloquesDeDescripcion", () => {
  it("reconoce los seis tipos por su marca", () => {
    const texto = [
      "## Celdas SF6 Siemens 8DH10",
      ">> Ejecución de pruebas eléctricas.",
      "- Detección de Fuga en SF6",
      "-- Tensión",
      "Incluye:",
      "",
      "último",
    ].join("\n");

    expect(bloquesDeDescripcion(texto)).toEqual([
      { tipo: "subtitulo", texto: "Celdas SF6 Siemens 8DH10" },
      { tipo: "parrafo", texto: "Ejecución de pruebas eléctricas." },
      { tipo: "vineta", texto: "Detección de Fuga en SF6" },
      { tipo: "subvineta", texto: "Tensión" },
      { tipo: "texto", texto: "Incluye:" },
      { tipo: "espacio", texto: "" },
      { tipo: "texto", texto: "último" },
    ]);
  });

  /**
   * `--` tiene que mirarse antes que `-`, o cada sub-viñeta se leería como
   * viñeta con un guion de más al principio del texto.
   */
  it("la sub-viñeta no se confunde con una viñeta", () => {
    expect(bloquesDeDescripcion("-- Tensión")).toEqual([{ tipo: "subvineta", texto: "Tensión" }]);
    expect(bloquesDeDescripcion("- Tensión")).toEqual([{ tipo: "vineta", texto: "Tensión" }]);
  });

  // Las descripciones viejas se escribieron a mano, antes de que hubiera
  // bloques: tienen que abrirse como lo que quisieron decir.
  it("entiende lo que se escribía a mano", () => {
    expect(bloquesDeDescripcion("• Prueba de aislamiento")).toEqual([
      { tipo: "vineta", texto: "Prueba de aislamiento" },
    ]);
    expect(bloquesDeDescripcion("    - Tensión")).toEqual([{ tipo: "subvineta", texto: "Tensión" }]);
    expect(bloquesDeDescripcion("◦ Tensión")).toEqual([{ tipo: "subvineta", texto: "Tensión" }]);
  });

  it("un guion solo es una viñeta vacía, no un texto con un guion", () => {
    expect(bloquesDeDescripcion("-")).toEqual([{ tipo: "vineta", texto: "" }]);
  });

  it("los renglones vacíos del final no cuentan", () => {
    expect(bloquesDeDescripcion("Algo\n\n\n")).toEqual([{ tipo: "texto", texto: "Algo" }]);
  });

  it("una descripción vacía no da bloques", () => {
    expect(bloquesDeDescripcion("")).toEqual([]);
    expect(bloquesDeDescripcion(null)).toEqual([]);
  });

  it("los saltos de Windows no dejan basura", () => {
    expect(bloquesDeDescripcion("Uno\r\nDos")).toEqual([
      { tipo: "texto", texto: "Uno" },
      { tipo: "texto", texto: "Dos" },
    ]);
  });
});

describe("descripcionDeBloques", () => {
  it("escribe cada tipo con su marca", () => {
    const bloques: Bloque[] = [
      { tipo: "subtitulo", texto: "Título" },
      { tipo: "parrafo", texto: "Párrafo" },
      { tipo: "vineta", texto: "Viñeta" },
      { tipo: "subvineta", texto: "Sub" },
      { tipo: "texto", texto: "Normal" },
      { tipo: "espacio", texto: "" },
    ];
    expect(descripcionDeBloques(bloques)).toBe("## Título\n>> Párrafo\n- Viñeta\n-- Sub\nNormal\n");
  });

  /**
   * La prueba que de verdad importa: cada bloque es un renglón del documento,
   * y lo que se guarda tiene que volver a abrirse igual.
   */
  it("la ida y vuelta devuelve los mismos bloques", () => {
    const original = [
      "## Celdas SF6",
      ">> Ejecución de pruebas.",
      "- Fuga de SF6",
      "-- Tensión",
      "Incluye:",
      "",
      "Cierre",
    ].join("\n");
    expect(descripcionDeBloques(bloquesDeDescripcion(original))).toBe(original);
  });

  // Si se permitiera, al releer saldrían dos bloques donde había uno.
  it("un salto dentro de un bloque se vuelve espacio", () => {
    expect(descripcionDeBloques([{ tipo: "texto", texto: "Uno\nDos" }])).toBe("Uno Dos");
  });

  it("sin bloques, descripción vacía", () => {
    expect(descripcionDeBloques([])).toBe("");
    expect(descripcionDeBloques(null)).toBe("");
  });
});

describe("bloquesVisibles", () => {
  it("deja fuera los espacios y las viñetas sin texto", () => {
    const bloques: Bloque[] = [
      { tipo: "texto", texto: "Sí" },
      { tipo: "espacio", texto: "" },
      { tipo: "vineta", texto: "" },
      { tipo: "vineta", texto: "También" },
    ];
    expect(bloquesVisibles(bloques).map((b) => b.texto)).toEqual(["Sí", "También"]);
  });
});

// ── Normas y textos del documento ────────────────────────────────────────────

describe("normasSugeridas", () => {
  it("medición y protecciones: la de esquemas de protección y las generales", () => {
    expect(normasSugeridas("Calibración de medidores multifunción")).toEqual([
      "CFE-SOM-3532", "GEN-DIAGRAMAS", "GEN-MANUAL", "GEN-INSTRUCTIVOS", "GEN-ESPECIFICACIONES",
    ]);
  });

  it("pruebas sin mantenimiento: CFE, NOM y las generales", () => {
    const ids = normasSugeridas("Pruebas eléctricas a transformador");
    expect(ids).toContain("CFE-SOM-3531");
    expect(ids).toContain("NOM-001-SEDE-2012");
    expect(ids).not.toContain("NMX-J-169-ANCE");
  });

  it("mantenimiento: todas", () => {
    expect(normasSugeridas("Mantenimiento preventivo a subestación")).toHaveLength(23);
  });

  // El título real trae acentos y mayúsculas mezcladas.
  it("los acentos no cambian la sugerencia", () => {
    expect(normasSugeridas("CALIBRACIÓN DE MEDICIÓN")).toEqual(normasSugeridas("calibracion de medicion"));
  });
});

describe("normasElegidas", () => {
  it("sin nada guardado, las sugeridas por el título", () => {
    const normas = normasElegidas(null, "Calibración de medidores");
    expect(normas.map((n) => n.id)).toEqual(normasSugeridas("Calibración de medidores"));
  });

  it("una lista vacía es ninguna, no las sugeridas", () => {
    expect(normasElegidas([], "Mantenimiento")).toEqual([]);
  });

  // Las normas salen en el documento en el orden del catálogo, no en el que
  // alguien las haya palomeado.
  it("respeta el orden del catálogo", () => {
    const normas = normasElegidas(["GEN-MANUAL", "CFE-SOM-3531"], "x");
    expect(normas.map((n) => n.id)).toEqual(["CFE-SOM-3531", "GEN-MANUAL"]);
  });

  it("un id que ya no existe se ignora", () => {
    expect(normasElegidas(["INVENTADA"], "x")).toEqual([]);
  });
});

describe("textoDelReporte", () => {
  it("cada modo da su texto", () => {
    expect(textoDelReporte("COMPLETO", "")).toContain("Laboratorio");
    expect(textoDelReporte("CORTO", "")).toBe("Reporte con evidencia fotográfica de la ejecución de los trabajos.");
    expect(textoDelReporte("NINGUNO", "lo que sea")).toBe("");
    expect(textoDelReporte("OTRO", "  A la medida.  ")).toBe("A la medida.");
  });
});

describe("textos del documento", () => {
  it("el guion bajo del folio se lee como guion", () => {
    expect(tituloParaDocumento("Pruebas_IGSA")).toBe("Pruebas - IGSA");
  });

  it("el sitio es lo que va después del último guion", () => {
    expect(sitioDelProyecto("Mantenimiento a Subestación_IGSA", "Cliente SA")).toBe("IGSA");
  });

  it("sin sitio en el título, el cliente", () => {
    expect(sitioDelProyecto("Mantenimiento preventivo", "Cliente SA")).toBe("Cliente SA");
  });

  // Dos letras no son un sitio: es más probable que sea un resto del título.
  it("un resto muy corto no se toma por sitio", () => {
    expect(sitioDelProyecto("Pruebas - SA", "Cliente SA")).toBe("Cliente SA");
  });

  it("los párrafos nombran el servicio y el sitio", () => {
    const { objeto, alcance } = textosSugeridos("Mantenimiento preventivo_IGSA", "Cliente SA");
    expect(objeto).toContain("mantenimiento preventivo");
    expect(objeto).toContain("IGSA");
    expect(alcance).toContain("mantenimiento preventivo");
  });

  it("un servicio que no es mantenimiento se nombra como viene en el título", () => {
    const { objeto } = textosSugeridos("Pruebas Eléctricas a Transformador - IGSA", "Cliente SA");
    expect(objeto).toContain("Pruebas Eléctricas a Transformador");
  });
});
