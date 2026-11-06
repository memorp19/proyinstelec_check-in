import { describe, it, expect } from "vitest";
import {
  cantidadConUnidad,
  cantidadParaDocumento,
  lineasDeDireccion,
  telefonoParaDocumento,
  unidadParaDocumento,
} from "@/src/lib/cotizador";

/**
 * No es cosmética: un renglón que dice "2.0000 servicio" en un documento que va
 * a una dirección de compras se lee como un error del proveedor. Los PDF reales
 * dicen "2 Servicios".
 */
describe("cantidadParaDocumento", () => {
  // La columna guarda numeric(18,6): el 2 vuelve como "2.000000".
  it("una cantidad entera va sin decimales", () => {
    expect(cantidadParaDocumento(2)).toBe("2");
    expect(cantidadParaDocumento(57)).toBe("57");
    expect(cantidadParaDocumento(1)).toBe("1");
  });

  it("una fraccionaria conserva los suyos, no los seis de la columna", () => {
    expect(cantidadParaDocumento(1.5)).toBe("1.5");
    expect(cantidadParaDocumento(0.25)).toBe("0.25");
  });

  it("los miles se separan", () => {
    expect(cantidadParaDocumento(1500)).toBe("1,500");
  });
});

describe("unidadParaDocumento", () => {
  it("con mayúscula inicial, singular en 1 y plural en lo demás", () => {
    expect(unidadParaDocumento("servicio", 1)).toBe("Servicio");
    expect(unidadParaDocumento("servicio", 2)).toBe("Servicios");
    expect(unidadParaDocumento("servicio", 57)).toBe("Servicios");
    expect(unidadParaDocumento("lote", 1)).toBe("Lote");
    expect(unidadParaDocumento("mes", 6)).toBe("Meses");
    expect(unidadParaDocumento("mes", 1)).toBe("Mes");
  });

  /**
   * El catálogo y las cotizaciones viejas las guardan de las dos maneras —la
   * 068 dice "servicios"—, así que hay que entender las dos sin producir
   * "servicioss".
   */
  it("una unidad que ya viene en plural no se pluraliza dos veces", () => {
    expect(unidadParaDocumento("servicios", 2)).toBe("Servicios");
    expect(unidadParaDocumento("servicios", 1)).toBe("Servicio");
    expect(unidadParaDocumento("juegos", 5)).toBe("Juegos");
  });

  it("las terminadas en consonante hacen -es", () => {
    expect(unidadParaDocumento("unidad", 3)).toBe("Unidades");
    expect(unidadParaDocumento("unidades", 1)).toBe("Unidad");
  });

  // Una cantidad fraccionaria no es 1: va en plural.
  it("1.5 va en plural", () => {
    expect(unidadParaDocumento("servicio", 1.5)).toBe("Servicios");
  });

  it("sin unidad, nada", () => {
    expect(unidadParaDocumento("", 2)).toBe("");
    expect(unidadParaDocumento(null, 2)).toBe("");
  });

  it("respeta la mayúscula que ya traía", () => {
    expect(unidadParaDocumento("Servicio", 2)).toBe("Servicios");
  });
});

describe("cantidadConUnidad", () => {
  it("se lee como en el PDF", () => {
    expect(cantidadConUnidad(1, "servicio")).toBe("1 Servicio");
    expect(cantidadConUnidad(2, "servicio")).toBe("2 Servicios");
    expect(cantidadConUnidad(57, "servicios")).toBe("57 Servicios");
    expect(cantidadConUnidad(1, "lote")).toBe("1 Lote");
    expect(cantidadConUnidad(6, "mes")).toBe("6 Meses");
  });

  it("sin unidad, solo la cantidad", () => {
    expect(cantidadConUnidad(3, "")).toBe("3");
  });
});

describe("telefonoParaDocumento", () => {
  // El formato del ERP viejo, porque el documento tiene que salir igual.
  it("diez dígitos con lada de tres", () => {
    expect(telefonoParaDocumento("7751104791")).toBe("+ (52) 775 110 4791");
  });

  it("las cuatro ciudades con lada de dos", () => {
    expect(telefonoParaDocumento("5536598752")).toBe("+ (52) 55 3659 8752");
    expect(telefonoParaDocumento("8112345678")).toBe("+ (52) 81 1234 5678");
  });

  it("quita el 52 de doce dígitos", () => {
    expect(telefonoParaDocumento("527751104791")).toBe("+ (52) 775 110 4791");
  });

  it("ignora guiones, espacios y paréntesis", () => {
    expect(telefonoParaDocumento("(775) 110-4791")).toBe("+ (52) 775 110 4791");
  });

  // Alguien lo escribió así a propósito, y puede ser de otro país.
  it("lo que ya trae + se deja como está", () => {
    expect(telefonoParaDocumento("+1 305 555 0123")).toBe("+1 305 555 0123");
  });

  it("lo que no son diez dígitos se deja tal cual", () => {
    expect(telefonoParaDocumento("ext. 1234")).toBe("ext. 1234");
    expect(telefonoParaDocumento("")).toBe("");
  });
});

describe("lineasDeDireccion", () => {
  /**
   * Se corta por la primera coma, como el ERP viejo: es donde las direcciones
   * reales separan la calle del resto.
   */
  it("parte por la primera coma", () => {
    expect(
      lineasDeDireccion("Prol. Paseo de la Reforma No. 2977 Col. Cuajimalpa, C.P. 05000, Ciudad de México"),
    ).toEqual(["Prol. Paseo de la Reforma No. 2977 Col. Cuajimalpa", "C.P. 05000, Ciudad de México"]);
  });

  it("un salto de línea manda sobre la coma", () => {
    expect(lineasDeDireccion("Av. Siempre Viva 742, int. 3\nCol. Centro")).toEqual([
      "Av. Siempre Viva 742, int. 3",
      "Col. Centro",
    ]);
  });

  it("sin coma, entera en el primer renglón", () => {
    expect(lineasDeDireccion("Carretera federal km 14")).toEqual(["Carretera federal km 14", ""]);
  });

  it("sin dirección, dos renglones vacíos", () => {
    expect(lineasDeDireccion(null)).toEqual(["", ""]);
  });
});
