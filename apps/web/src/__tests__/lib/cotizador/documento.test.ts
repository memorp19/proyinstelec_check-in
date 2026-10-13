import { describe, it, expect } from "vitest";
import {
  CONDICIONES_POR_OMISION,
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
    expect(valor.contacto).toEqual({ nombre: "", telefono: "", email: "" });
    expect(valor.direccion).toEqual(["", ""]);
    expect(avisos).toEqual([]);
  });

  it("arma el contacto, la dirección y las listas", () => {
    const { valor, avisos } = normalizarDocumento({
      esquema: 1,
      contacto: { nombre: "Ing. Pérez", telefono: "81 1234 5678", email: "p@ejemplo.mx" },
      direccion: ["Av. Siempre Viva 742", "Col. Centro"],
      sitio: "Planta 2",
      actividades: ["Pruebas eléctricas", "  Limpieza  ", ""],
      normas: ["NMX-J-169"],
      reporte: "Reporte con resultados y recomendaciones.",
      notas: "Precios en pesos.",
    });
    expect(valor.contacto.nombre).toBe("Ing. Pérez");
    expect(valor.direccion).toEqual(["Av. Siempre Viva 742", "Col. Centro"]);
    // Los renglones vacíos se caen; los demás se recortan.
    expect(valor.actividades).toEqual(["Pruebas eléctricas", "Limpieza"]);
    expect(avisos).toEqual([]);
  });

  it("la segunda línea de dirección puede faltar", () => {
    const { valor } = normalizarDocumento({ direccion: ["Una sola línea"] });
    expect(valor.direccion).toEqual(["Una sola línea", ""]);
  });

  it("una lista que no es lista se ignora con aviso", () => {
    const { valor, avisos } = normalizarDocumento({ normas: "NMX-J-169" });
    expect(valor.normas).toEqual([]);
    expect(avisos[0]).toContain("no es una lista");
  });

  it("un contacto que no es bloque se deja vacío con aviso", () => {
    const { valor, avisos } = normalizarDocumento({ contacto: "Ing. Pérez" });
    expect(valor.contacto).toEqual({ nombre: "", telefono: "", email: "" });
    expect(avisos[0]).toContain("contacto");
  });

  it("sobrevive a la ida y vuelta por jsonb", () => {
    const { valor } = normalizarDocumento({
      contacto: { nombre: "A", telefono: "1", email: "a@b.mx" },
      actividades: ["Una"],
    });
    expect(normalizarDocumento(JSON.parse(JSON.stringify(valor))).valor).toEqual(valor);
  });
});
