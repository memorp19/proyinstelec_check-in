import { describe, it, expect } from "vitest";
import { conPuntoFinal, terminaEnPunto } from "@/src/lib/texto";

/**
 * La regla del punto final, con las razones sociales de verdad.
 *
 * El sistema viejo imprime "S.A. de C.V.." en todos sus documentos y en todos
 * sus correos. Estas pruebas son el seguro de que no la copiamos.
 */
describe("conPuntoFinal", () => {
  it("no agrega un segundo punto a una razón social que ya lo trae", () => {
    expect(conPuntoFinal("Industrias del Golfo S.A. de C.V.")).toBe(
      "Industrias del Golfo S.A. de C.V.",
    );
    expect(conPuntoFinal("Grupo Minero S.A.P.I de C.V.")).toBe("Grupo Minero S.A.P.I de C.V.");
  });

  it("lo pone cuando falta", () => {
    expect(conPuntoFinal("Aceros del Norte")).toBe("Aceros del Norte.");
  });

  it("no deja un punto suelto cuando no hay texto", () => {
    // Un punto solo no es una frase: en un correo se lee como renglón roto.
    expect(conPuntoFinal("")).toBe("");
    expect(conPuntoFinal("   ")).toBe("");
  });

  it("recorta los espacios de los lados antes de decidir", () => {
    expect(conPuntoFinal("  Aceros del Norte  ")).toBe("Aceros del Norte.");
    expect(conPuntoFinal("  Aceros del Norte.  ")).toBe("Aceros del Norte.");
  });

  it("los puntos suspensivos ya son punto final", () => {
    expect(conPuntoFinal("y lo demás...")).toBe("y lo demás...");
  });
});

describe("terminaEnPunto", () => {
  it("distingue el punto de cualquier otro cierre", () => {
    expect(terminaEnPunto("C.V.")).toBe(true);
    expect(terminaEnPunto("C.V. ")).toBe(true);
    expect(terminaEnPunto("Aceros del Norte")).toBe(false);
    expect(terminaEnPunto("Subestación (fase 2)")).toBe(false);
    expect(terminaEnPunto("")).toBe(false);
  });
});
