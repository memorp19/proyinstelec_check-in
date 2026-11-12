import { describe, it, expect } from "vitest";
import { CONDICIONES_POR_OMISION, documentoVacio } from "@/src/lib/cotizador/documento";
import {
  FALTA_DATO,
  faltantesDelDocumento,
  fechaDeDocumento,
  fechaFija,
  fraseDeEntrega,
  fraseDeLugar,
  valoresDeMarcadores,
  type DatosParaFaltantes,
  type DatosParaMarcadores,
} from "@/src/lib/cotizador/docs/valores";

/** Todos los datos son inventados. */

const base = (sobre: Partial<DatosParaMarcadores> = {}): DatosParaMarcadores => ({
  cliente: "Minera Sur",
  folio: "PCOTOP-001-2026",
  fecha: "2026-10-05",
  titulo: "Servicio de Mantenimiento",
  documento: documentoVacio(),
  condiciones: { ...CONDICIONES_POR_OMISION },
  ...sobre,
});

const conContacto = (
  contacto: Partial<ReturnType<typeof documentoVacio>["contacto"]>,
  ocultar: ReturnType<typeof documentoVacio>["ocultar"] = {},
) => {
  const d = documentoVacio();
  d.contacto = { ...d.contacto, ...contacto };
  d.ocultar = ocultar;
  return d;
};

describe("fechaDeDocumento", () => {
  it("escribe el mes con letra", () => {
    expect(fechaDeDocumento("2026-10-05")).toBe("05 de Octubre de 2026");
    expect(fechaDeDocumento("2026-01-31")).toBe("31 de Enero de 2026");
  });

  /**
   * `new Date("2026-10-05")` se interpreta como UTC y al imprimirlo en México
   * sale el día anterior: un documento generado por la tarde saldría con la
   * fecha de ayer.
   */
  it("no se corre un día: usa las partes del texto, no new Date(iso)", () => {
    expect(fechaDeDocumento("2026-10-01")).toBe("01 de Octubre de 2026");
    expect(fechaDeDocumento("2026-03-01")).toBe("01 de Marzo de 2026");
  });

  it("una fecha ilegible sale como falta, no como hoy", () => {
    expect(fechaDeDocumento("")).toBe(FALTA_DATO);
    expect(fechaDeDocumento("05/10/2026")).toBe(FALTA_DATO);
    expect(fechaDeDocumento("2026-13-01")).toBe(FALTA_DATO);
  });
});

describe("fechaFija", () => {
  // Dos PDF del mismo folio con fechas distintas y ninguna la buena.
  it("la guardada se respeta y no se mueve al regenerar", () => {
    expect(fechaFija("2026-10-05")).toEqual({ fecha: "2026-10-05", esNueva: false });
  });

  it("sin fecha guardada toma la de hoy y avisa que hay que guardarla", () => {
    const r = fechaFija("", () => new Date(2026, 10, 3));
    expect(r).toEqual({ fecha: "2026-11-03", esNueva: true });
  });

  it("una guardada con basura se trata como si no hubiera", () => {
    expect(fechaFija("ayer", () => new Date(2026, 0, 9)).fecha).toBe("2026-01-09");
  });
});

describe("frases de las condiciones", () => {
  it("la entrega se redacta a partir de lo capturado", () => {
    expect(fraseDeEntrega("4 semanas en sitio")).toBe(
      "El tiempo de entrega para las partidas será de 4 semanas en sitio",
    );
    expect(fraseDeEntrega("inmediata")).toBe(
      "El tiempo de entrega para las partidas será inmediata",
    );
  });

  it("si ya viene redactada no se redacta dos veces", () => {
    const ya = "El tiempo de entrega para las partidas será de 2 semanas.";
    expect(fraseDeEntrega(ya)).toBe(ya);
  });

  it("vacía tiene su propia frase, no sale un hueco", () => {
    expect(fraseDeEntrega("")).toContain("común acuerdo");
  });

  it("el lugar se antepone según cómo empiece", () => {
    expect(fraseDeLugar("la planta de Toluca")).toBe("En las instalaciones de la planta de Toluca");
    expect(fraseDeLugar("del Hotel Centro")).toBe("En las instalaciones del Hotel Centro");
    expect(fraseDeLugar("En la planta")).toBe("En la planta");
    expect(fraseDeLugar("")).toBe("");
  });
});

describe("valoresDeMarcadores", () => {
  it("llena los catorce con lo que hay", () => {
    const r = valoresDeMarcadores(
      base({ documento: conContacto({ contacto: "Ana Ruiz", correo: "ana@sur.mx" }) }),
    );
    expect(r.valores.CLIENTE).toBe("Minera Sur");
    expect(r.valores.FOLIO).toBe("PCOTOP-001-2026");
    expect(r.valores.FECHA).toBe("05 de Octubre de 2026");
    expect(r.valores.CONTACTO).toBe("Ana Ruiz");
    expect(r.valores.EMAIL).toBe("ana@sur.mx");
    expect(r.valores.VIGENCIA).toBe("30");
  });

  // Las ladas de dos dígitos (55, 56, 33, 81) se agrupan 2+4+4; las demás 3+3+4.
  it.each([
    ["9991104791", "+ (52) 999 110 4791"],
    ["5551104791", "+ (52) 55 5110 4791"],
  ])("el teléfono sale con el formato del documento (%s)", (crudo, impreso) => {
    const r = valoresDeMarcadores(base({ documento: conContacto({ telefono: crudo }) }));
    expect(r.valores.TELEFONO).toBe(impreso);
  });

  // Un hueco en blanco no se ve: el renglón queda corto y nadie lo nota.
  it("lo que falta sale con la marca visible y en los avisos", () => {
    const r = valoresDeMarcadores(base({ cliente: "  " }));
    expect(r.valores.CLIENTE).toBe(FALTA_DATO);
    expect(r.valores.CONTACTO).toBe(FALTA_DATO);
    expect(r.avisos.join(" ")).toContain("la razón social del cliente");
    expect(r.avisos.join(" ")).toContain("el nombre del contacto");
  });

  it("la segunda dirección nunca lleva la marca: se borra el renglón", () => {
    const r = valoresDeMarcadores(base());
    expect(r.valores.DIRECCION_2).toBe("");
    expect(r.ocultos).toContainEqual({ marcador: "DIRECCION_2", motivo: "vacio" });
    expect(r.avisos.join(" ")).not.toContain("DIRECCION_2");
  });

  describe("la dirección", () => {
    // Una empresa puede atender desde varios sitios y la carta va dirigida a
    // una persona en uno de ellos.
    it("sale la del contacto cuando la tiene", () => {
      const r = valoresDeMarcadores(
        base({ direccionContacto: "Calle 1, Ciudad", direccionCliente: "Calle 9, Otra" }),
      );
      expect(r.valores.DIRECCION_1).toBe("Calle 1");
      expect(r.valores.DIRECCION_2).toBe("Ciudad");
    });

    it("y la del cliente cuando el contacto no tiene", () => {
      const r = valoresDeMarcadores(base({ direccionContacto: "", direccionCliente: "Calle 9, Otra" }));
      expect(r.valores.DIRECCION_1).toBe("Calle 9");
    });

    // Lo escrito a mano en el cotizador manda sobre las dos.
    it("lo capturado en el documento manda sobre las dos", () => {
      const r = valoresDeMarcadores(
        base({
          documento: conContacto({ direccion1: "Lo que escribió la cotizadora" }),
          direccionContacto: "Calle 1, Ciudad",
        }),
      );
      expect(r.valores.DIRECCION_1).toBe("Lo que escribió la cotizadora");
      expect(r.valores.DIRECCION_2).toBe("");
    });
  });

  describe("los renglones que no salen", () => {
    it("los apagados a mano se marcan como elegidos", () => {
      const r = valoresDeMarcadores(
        base({
          documento: conContacto(
            { telefono: "5551104791", correo: "ana@sur.mx" },
            { telefono: true, correo: true },
          ),
        }),
      );
      expect(r.ocultos).toContainEqual({ marcador: "TELEFONO", motivo: "elegido" });
      expect(r.ocultos).toContainEqual({ marcador: "EMAIL", motivo: "elegido" });
    });

    // Un renglón que se quitó a propósito no es un hueco, es una decisión.
    it("un renglón apagado no genera aviso aunque esté vacío", () => {
      const r = valoresDeMarcadores(
        base({ documento: conContacto({}, { telefono: true, correo: true }) }),
      );
      expect(r.avisos.join(" ")).not.toContain("teléfono");
      expect(r.avisos.join(" ")).not.toContain("correo");
    });
  });

  it("las condiciones vacías tienen respaldo, no huecos", () => {
    const r = valoresDeMarcadores(
      base({ condiciones: { ...CONDICIONES_POR_OMISION, pago: "", lugar: "" } }),
    );
    expect(r.valores.PAGO).toBe("Por definir.");
    expect(r.valores.LUGAR).toBe(FALTA_DATO);
    expect(r.avisos.join(" ")).toContain("el lugar de entrega");
  });
});


// ── Lo que falta ──────────────────────────────────────────────────────────────

describe("faltantesDelDocumento", () => {
  /** Una cotización a la que no le falta nada de lo que se imprime. */
  const completa = (sobre: Partial<DatosParaFaltantes> = {}): DatosParaFaltantes => ({
    cliente: "Minera Sur",
    titulo: "Servicio de Mantenimiento",
    documento: conContacto({
      contacto: "Ing. Ruiz",
      direccion1: "Camino Real 12",
      telefono: "+ (52) 775 110 4791",
      correo: "ruiz@ejemplo.mx",
    }),
    condiciones: { ...CONDICIONES_POR_OMISION, lugar: "la planta" },
    ...sobre,
  });

  const marcadores = (d: DatosParaFaltantes) => faltantesDelDocumento(d).map((f) => f.marcador);

  it("con todo capturado no falta nada", () => {
    expect(faltantesDelDocumento(completa())).toEqual([]);
  });

  it("sin lugar de entrega, falta el lugar", () => {
    const d = completa({ condiciones: { ...CONDICIONES_POR_OMISION, lugar: "" } });
    expect(marcadores(d)).toEqual(["LUGAR"]);
  });

  /** El aviso sirve si dice dónde teclearlo; "faltan datos" no sirve. */
  it("cada hueco dice qué es y dónde se captura", () => {
    const d = completa({ condiciones: { ...CONDICIONES_POR_OMISION, lugar: "" } });
    expect(faltantesDelDocumento(d)[0]).toEqual({
      marcador: "LUGAR",
      que: "el lugar de entrega",
      donde: "en Condiciones comerciales → Lugar de entrega",
    });
  });

  it("un documento en blanco los lista todos", () => {
    const d = completa({ documento: documentoVacio(), condiciones: { ...CONDICIONES_POR_OMISION } });
    expect(marcadores(d)).toEqual([
      "CONTACTO",
      "TELEFONO",
      "EMAIL",
      "DIRECCION_1",
      "LUGAR",
    ]);
  });

  /**
   * La regla entera: solo bloquea lo que se **imprimiría** como ⟨falta⟩. Un
   * renglón que alguien apagó a propósito no es un hueco, es una decisión.
   */
  it("un renglón apagado a propósito no bloquea", () => {
    const d = completa({
      documento: conContacto(
        { contacto: "Ing. Ruiz", direccion1: "Camino Real 12", correo: "ruiz@ejemplo.mx" },
        { telefono: true },
      ),
    });
    expect(faltantesDelDocumento(d)).toEqual([]);
  });

  it("la segunda dirección nunca bloquea: si no hay, se borra el renglón", () => {
    expect(marcadores(completa())).not.toContain("DIRECCION_2");
  });

  /**
   * Sin esto no se podría mandar a revisión ninguna cotización antes de
   * generar su PDF: la fecha está vacía hasta que el documento se genera, y
   * entonces se fija sola con la de hoy.
   */
  it("la fecha vacía no bloquea, porque se fija al generar", () => {
    const d = completa();
    expect(d.documento.fecha).toBe("");
    expect(marcadores(d)).not.toContain("FECHA");
  });

  it("sin razón social ni título, los dos", () => {
    const d = completa({ cliente: "", titulo: "" });
    expect(marcadores(d)).toContain("CLIENTE");
    expect(marcadores(d)).toContain("TITULO");
  });

  /** Es la misma cuenta que los avisos de la vista previa, no otra lista. */
  it("son exactamente los avisos de valoresDeMarcadores", () => {
    const d = completa({ condiciones: { ...CONDICIONES_POR_OMISION, lugar: "" } });
    const { avisos } = valoresDeMarcadores({ ...d, folio: "PCOTOP-001-2026", fecha: "2026-10-05" });
    expect(faltantesDelDocumento(d)).toHaveLength(avisos.length);
  });
});
