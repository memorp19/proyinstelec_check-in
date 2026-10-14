import { describe, it, expect } from "vitest";
import {
  completarDocumento,
  CONDICIONES_POR_OMISION,
  lineasDeDireccion,
  ESQUEMA_CONDICIONES,
  ESQUEMA_DOCUMENTO,
  normalizarCondiciones,
  normalizarDocumento,
} from "@/src/lib/cotizador";

describe("normalizarCondiciones", () => {
  it("sin nada guardado, las de omisión del ERP viejo", () => {
    const { valor, avisos } = normalizarCondiciones(null);
    expect(valor).toEqual(CONDICIONES_POR_OMISION);
    expect(valor.vigenciaDias).toBe(30);
    expect(avisos).toEqual([]);
  });

  it("respeta lo capturado y lo deja limpio", () => {
    const { valor, avisos } = normalizarCondiciones({
      esquema: 1, pago: "  50% anticipo, 50% contra entrega.  ",
      entrega: "2 semanas", lugar: "Planta Monterrey", vigenciaDias: 15,
    });
    expect(valor).toEqual({
      esquema: 1, pago: "50% anticipo, 50% contra entrega.",
      entrega: "2 semanas", lugar: "Planta Monterrey", vigenciaDias: 15,
    });
    expect(avisos).toEqual([]);
  });

  // Una cotización a medio armar tiene que poder guardarse: lo que no se
  // entiende se sustituye y se avisa, nunca revienta.
  it("lo que no es texto no se convierte: se avisa y se usa lo de omisión", () => {
    const { valor, avisos } = normalizarCondiciones({ pago: { raro: true }, entrega: 42 });
    expect(valor.pago).toBe(CONDICIONES_POR_OMISION.pago);
    expect(valor.entrega).toBe(CONDICIONES_POR_OMISION.entrega);
    expect(avisos).toHaveLength(2);
  });

  it("un bloque que no es bloque no tira la cotización", () => {
    const { valor, avisos } = normalizarCondiciones("100% contra entrega");
    expect(valor).toEqual(CONDICIONES_POR_OMISION);
    expect(avisos[0]).toContain("no son un bloque");
  });

  it("una vigencia que no son días vuelve a 30, con aviso", () => {
    const { valor, avisos } = normalizarCondiciones({ vigenciaDias: "un mes" });
    expect(valor.vigenciaDias).toBe(30);
    expect(avisos[0]).toContain("no son días");
  });

  // Se respeta, pero se dice: puede ser un contrato largo o un cero de más.
  it("una vigencia de más de un año se avisa sin borrarla", () => {
    const { valor, avisos } = normalizarCondiciones({ vigenciaDias: 3650 });
    expect(valor.vigenciaDias).toBe(3650);
    expect(avisos[0]).toContain("pasa del año");
  });

  it("un lugar vacío es válido y no avisa", () => {
    const { valor, avisos } = normalizarCondiciones({ lugar: "" });
    expect(valor.lugar).toBe("");
    expect(avisos).toEqual([]);
  });

  /**
   * Un bloque escrito por una versión posterior se deja intacto y se avisa:
   * "arreglarlo" aquí sería perder lo que esa versión guardó.
   */
  it("un esquema más nuevo se reconoce y se avisa", () => {
    const { valor, avisos } = normalizarCondiciones({ esquema: ESQUEMA_CONDICIONES + 1, pago: "x" });
    expect(valor.esquema).toBe(ESQUEMA_CONDICIONES + 1);
    expect(avisos[0]).toContain("esquema");
  });
});

describe("normalizarDocumento", () => {
  it("sin nada guardado, el bloque vacío con su esquema", () => {
    const { valor, avisos } = normalizarDocumento(undefined);
    expect(valor.esquema).toBe(ESQUEMA_DOCUMENTO);
    expect(valor.contacto).toEqual({ contacto: "", direccion1: "", direccion2: "", telefono: "", correo: "" });
    expect(valor.normas).toBeNull();
    expect(valor.reporte).toBe("COMPLETO");
    expect(avisos).toEqual([]);
  });

  it("arma el contacto, los párrafos y el encabezado de la tabla", () => {
    const { valor, avisos } = normalizarDocumento({
      esquema: 1,
      fecha: "2026-10-13",
      contacto: {
        contacto: "Ing. Pérez", direccion1: "Av. Siempre Viva 742",
        direccion2: "Col. Centro", telefono: "81 1234 5678", correo: "p@ejemplo.mx",
      },
      ocultar: { direccion2: true },
      objeto: "  El objeto de la propuesta…  ",
      alcance: "El alcance principal…",
      encabezadoTabla: "Subestación principal",
    });
    expect(valor.fecha).toBe("2026-10-13");
    expect(valor.contacto.contacto).toBe("Ing. Pérez");
    expect(valor.ocultar).toEqual({ direccion2: true });
    expect(valor.objeto).toBe("El objeto de la propuesta…");
    expect(valor.encabezadoTabla).toBe("Subestación principal");
    expect(avisos).toEqual([]);
  });

  /**
   * `null` y `[]` no son lo mismo: una cotización que no tocó las normas no es
   * igual que una donde alguien las quitó todas a propósito.
   */
  it("distingue las normas sin tocar de las vaciadas a propósito", () => {
    expect(normalizarDocumento({}).valor.normas).toBeNull();
    expect(normalizarDocumento({ normas: [] }).valor.normas).toEqual([]);
    expect(normalizarDocumento({ normas: ["NOM-001-SEDE-2012"] }).valor.normas).toEqual(["NOM-001-SEDE-2012"]);
  });

  it("una lista de normas que no es lista vuelve a las sugeridas, con aviso", () => {
    const { valor, avisos } = normalizarDocumento({ normas: "NMX-J-169" });
    expect(valor.normas).toBeNull();
    expect(avisos[0]).toContain("no es una lista");
  });

  it("solo se ocultan los renglones que existen, y solo con true", () => {
    const { valor } = normalizarDocumento({
      ocultar: { direccion1: true, telefono: "sí", inventado: true },
    });
    expect(valor.ocultar).toEqual({ direccion1: true });
  });

  it("un modo de reporte desconocido vuelve a COMPLETO, con aviso", () => {
    const { valor, avisos } = normalizarDocumento({ reporte: "LARGO" });
    expect(valor.reporte).toBe("COMPLETO");
    expect(avisos[0]).toContain("no es un modo de reporte");
  });

  it("acepta los cuatro modos buenos", () => {
    for (const modo of ["COMPLETO", "CORTO", "NINGUNO", "OTRO"]) {
      expect(normalizarDocumento({ reporte: modo }).valor.reporte).toBe(modo);
    }
  });

  // La fija el generador del documento y no se mueve al regenerar; una fecha
  // con otra forma no se intenta interpretar.
  it("una fecha que no es aaaa-mm-dd se deja vacía y se avisa", () => {
    const { valor, avisos } = normalizarDocumento({ fecha: "13/10/2026" });
    expect(valor.fecha).toBe("");
    expect(avisos[0]).toContain("aaaa-mm-dd");
  });

  it("un contacto que no es bloque se deja vacío con aviso", () => {
    const { valor, avisos } = normalizarDocumento({ contacto: "Ing. Pérez" });
    expect(valor.contacto.contacto).toBe("");
    expect(avisos[0]).toContain("contacto");
  });

  it("sobrevive a la ida y vuelta por jsonb", () => {
    const { valor } = normalizarDocumento({
      fecha: "2026-01-02",
      contacto: { contacto: "A", telefono: "1", correo: "a@b.mx" },
      ocultar: { direccion1: true },
      normas: ["GEN-MANUAL"],
      reporte: "OTRO",
      reporteTexto: "Reporte a la medida.",
    });
    expect(normalizarDocumento(JSON.parse(JSON.stringify(valor))).valor).toEqual(valor);
  });

  // Dos cotizaciones no pueden terminar compartiendo el mismo objeto.
  it("cada documento vacío es suyo", () => {
    const a = normalizarDocumento(null).valor;
    const b = normalizarDocumento(null).valor;
    a.contacto.contacto = "Alguien";
    a.ocultar.telefono = true;
    expect(b.contacto.contacto).toBe("");
    expect(b.ocultar).toEqual({});
  });
});

// ── El machote del documento ─────────────────────────────────────────────────

describe("lineasDeDireccion", () => {
  /**
   * El catálogo guarda UNA dirección y la carta tiene DOS renglones. Donde hay
   * salto de línea es donde quien la capturó quiso partirla.
   */
  it("parte donde hay salto de línea", () => {
    expect(lineasDeDireccion("Av. Siempre Viva 742\nCol. Centro, Monterrey")).toEqual([
      "Av. Siempre Viva 742",
      "Col. Centro, Monterrey",
    ]);
  });

  // Inventar un corte por la coma más cercana produce renglones raros.
  it("de corrido se queda entera en el primero", () => {
    expect(lineasDeDireccion("Av. Siempre Viva 742, Col. Centro, Monterrey")).toEqual([
      "Av. Siempre Viva 742, Col. Centro, Monterrey",
      "",
    ]);
  });

  it("sin dirección, dos renglones vacíos", () => {
    expect(lineasDeDireccion(null)).toEqual(["", ""]);
    expect(lineasDeDireccion("   ")).toEqual(["", ""]);
  });

  it("limpia los espacios de sobra", () => {
    expect(lineasDeDireccion("  Av.   Siempre  Viva 742  ")[0]).toBe("Av. Siempre Viva 742");
  });
});

describe("completarDocumento", () => {
  const machote = {
    contacto: {
      contacto: "Ing. Pérez",
      direccion1: "Av. Siempre Viva 742",
      direccion2: "Col. Centro",
      telefono: "81 1234 5678",
      correo: "perez@cliente.mx",
    },
    objeto: "El objeto de la presente propuesta…",
    alcance: "El alcance principal…",
  };

  it("llena un documento en blanco y dice qué llenó", () => {
    const { valor, llenados } = completarDocumento(normalizarDocumento(null).valor, machote);
    expect(valor.contacto.contacto).toBe("Ing. Pérez");
    expect(valor.objeto).toBe("El objeto de la presente propuesta…");
    expect(llenados).toEqual(["contacto", "textos"]);
  });

  /**
   * La regla que lo hace seguro: lo escrito no se pisa. Si no, cada recarga
   * borraría la corrección de quien se tomó el trabajo de hacerla.
   */
  it("NO pisa lo que alguien escribió", () => {
    const previo = normalizarDocumento({
      contacto: { contacto: "Lic. Gómez", telefono: "55 0000 0000" },
      objeto: "Un objeto escrito a mano.",
    }).valor;

    const { valor, llenados } = completarDocumento(previo, machote);
    expect(valor.contacto.contacto).toBe("Lic. Gómez");
    expect(valor.contacto.telefono).toBe("55 0000 0000");
    expect(valor.objeto).toBe("Un objeto escrito a mano.");
    // Lo que sí estaba vacío se llena igual: el correo y el segundo párrafo.
    expect(valor.contacto.correo).toBe("perez@cliente.mx");
    expect(valor.alcance).toBe("El alcance principal…");
    expect(llenados).toEqual(["contacto", "textos"]);
  });

  it("si no hay nada que llenar, no dice que llenó", () => {
    const lleno = normalizarDocumento({
      contacto: {
        contacto: "A", direccion1: "B", direccion2: "C", telefono: "D", correo: "E",
      },
      objeto: "F",
      alcance: "G",
    }).valor;
    expect(completarDocumento(lleno, machote).llenados).toEqual([]);
  });

  it("sin contacto en el catálogo, solo se propone lo que haya", () => {
    const { valor, llenados } = completarDocumento(normalizarDocumento(null).valor, {
      contacto: { direccion1: "Av. Siempre Viva 742" },
      objeto: "Un objeto",
      alcance: "Un alcance",
    });
    expect(valor.contacto.contacto).toBe("");
    expect(valor.contacto.direccion1).toBe("Av. Siempre Viva 742");
    expect(llenados).toEqual(["contacto", "textos"]);
  });

  it("no comparte el objeto con el que recibió", () => {
    const previo = normalizarDocumento(null).valor;
    const { valor } = completarDocumento(previo, machote);
    valor.contacto.contacto = "Otro";
    expect(previo.contacto.contacto).toBe("");
  });
});
