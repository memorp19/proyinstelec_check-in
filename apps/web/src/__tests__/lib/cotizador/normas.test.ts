/**
 * Lo que se saca del título: el servicio, el sitio y los textos sugeridos.
 *
 * Las reglas son las del ERP viejo, porque los documentos que ya tiene el
 * cliente salieron de ellas. Todos los datos de aquí son inventados.
 */
import { describe, it, expect } from "vitest";
import {
  sitioDelProyecto,
  textosSugeridos,
  tituloParaDocumento,
} from "@/src/lib/cotizador/normas";

describe("tituloParaDocumento", () => {
  it("convierte el guion bajo en guion con espacios", () => {
    expect(tituloParaDocumento("Mantenimiento_Prologis")).toBe("Mantenimiento - Prologis");
  });

  it("colapsa los espacios de más", () => {
    expect(tituloParaDocumento("  Mantenimiento   anual  ")).toBe("Mantenimiento anual");
  });
});

/**
 * La última parte del título, y el cliente como respaldo.
 *
 * El título guardado trae el cliente pegado con `_` —331 de los 348 de 2026
 * lo traen—, así que la última parte suele ser la razón social. Cuando el
 * título no trae separador, el respaldo es el cliente.
 */
describe("sitioDelProyecto", () => {
  it("toma la última parte cuando el título la trae", () => {
    expect(
      sitioDelProyecto(
        "Mantenimiento Anual a Subestación - Prologis Puente Grande - Diseños Acuario S.A. de C.V.",
        "Otro Cliente",
      ),
    ).toBe("Diseños Acuario S.A. de C.V.");
  });

  it("parte también por guion bajo", () => {
    expect(sitioDelProyecto("Mantenimiento a Subestación_IGSA", "Otro")).toBe("IGSA");
  });

  it("sin separador, el cliente", () => {
    expect(sitioDelProyecto("Mantenimiento Preventivo de Subestaciones", "IGSA S.A.P.I")).toBe(
      "IGSA S.A.P.I",
    );
  });

  /** Dos letras o menos no es el nombre de nadie: "…- 1" o "…- AB". */
  it("una última parte muy corta no cuenta como sitio", () => {
    expect(sitioDelProyecto("Subestación - 1", "IGSA")).toBe("IGSA");
  });
});

describe("textosSugeridos · el servicio sale del título", () => {
  /**
   * El servicio es la primera parte y el sitio la última: del mismo título
   * salen las dos, por los dos extremos.
   */
  it("toma lo que va antes del primer guion, y el sitio de lo que va después", () => {
    const { objeto } = textosSugeridos("Estudio de Arco Eléctrico - Stellantis", "Cliente S.A.");
    expect(objeto).toContain("del servicio de Estudio de Arco Eléctrico,");
    expect(objeto).toContain("propiedad del Stellantis.");
  });

  it('quita el "Servicio de" del principio', () => {
    const { alcance } = textosSugeridos("Servicio de Pruebas a Relevadores", "Cliente");
    expect(alcance).toContain("del servicio de Pruebas a Relevadores ");
  });

  /** Es lo que trae escrito la plantilla, y en minúsculas. */
  it("el mantenimiento preventivo se escribe en minúsculas", () => {
    const { objeto } = textosSugeridos("MANTENIMIENTO PREVENTIVO A SUBESTACIÓN", "Cliente");
    expect(objeto).toContain("del servicio de mantenimiento preventivo,");
  });
});

describe("textosSugeridos · sin el punto de más", () => {
  /**
   * La plantilla escribe "propiedad del {{SITIO}}." y casi todas las razones
   * sociales terminan en punto, así que el legacy imprime "C.V..". Nadie lo
   * arregló ahí; copiarlo a propósito no tiene defensa.
   */
  it("no duplica el punto cuando la razón social ya lo trae", () => {
    const { objeto } = textosSugeridos("Mantenimiento a Subestación", "IGSA S.A.P.I de C.V.");
    expect(objeto).toMatch(/IGSA S\.A\.P\.I de C\.V\.$/);
    expect(objeto).not.toContain("C.V..");
  });

  it("lo pone cuando falta", () => {
    const { objeto } = textosSugeridos("Mantenimiento a Subestación", "Sasco Arrendamiento");
    expect(objeto).toMatch(/Sasco Arrendamiento\.$/);
  });
});

describe("textosSugeridos · el guion largo", () => {
  /** Los títulos se escriben a mano y Word convierte el guion solo. */
  it("parte igual por guion largo que por guion normal", () => {
    const corto = textosSugeridos("Estudio de Arco Eléctrico - Stellantis", "Cliente");
    const largo = textosSugeridos("Estudio de Arco Eléctrico – Stellantis", "Cliente");
    expect(largo.alcance).toBe(corto.alcance);
    expect(largo.alcance).toContain("Estudio de Arco Eléctrico");
    expect(largo.alcance).not.toContain("Stellantis");
  });
});
