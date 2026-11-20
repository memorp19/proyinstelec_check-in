import { describe, it, expect } from "vitest";
import { LARGO_MAXIMO_NOTA, notaParaRevisor } from "@/src/lib/nota-revision";

/** Todos los textos son inventados. */

describe("notaParaRevisor", () => {
  it("deja el texto como se escribió", () => {
    expect(notaParaRevisor("Revísame la partida 2.")).toBe("Revísame la partida 2.");
  });

  it("quita los espacios de los extremos", () => {
    expect(notaParaRevisor("  urge para el viernes  ")).toBe("urge para el viernes");
  });

  /**
   * Se recorta en vez de rechazarse: quien escribió de más no pierde el envío
   * a revisión por eso.
   */
  it("recorta a 1,500 caracteres", () => {
    const larga = "x".repeat(2000);
    expect(notaParaRevisor(larga)).toHaveLength(LARGO_MAXIMO_NOTA);
    expect(LARGO_MAXIMO_NOTA).toBe(1500);
  });

  it("recorta DESPUÉS de quitar los espacios", () => {
    // Si se recortara primero, los espacios de delante se llevarían texto bueno.
    const conEspacios = `   ${"y".repeat(1500)}   `;
    expect(notaParaRevisor(conEspacios)).toBe("y".repeat(1500));
  });

  it("una nota en blanco es ninguna nota", () => {
    expect(notaParaRevisor("")).toBe("");
    expect(notaParaRevisor("   ")).toBe("");
    expect(notaParaRevisor("\n\t ")).toBe("");
  });

  /** El cuerpo de la petición lo arma quien llama, y puede traer cualquier cosa. */
  it("lo que no es texto se trata como si no hubiera nota", () => {
    expect(notaParaRevisor(undefined)).toBe("");
    expect(notaParaRevisor(null)).toBe("");
    expect(notaParaRevisor(42)).toBe("");
    expect(notaParaRevisor({ nota: "hola" })).toBe("");
    expect(notaParaRevisor(["hola"])).toBe("");
    expect(notaParaRevisor(true)).toBe("");
  });

  // El marcado se neutraliza al escribir el correo (`escaparHtml`), no aquí:
  // la nota que se guarda en la bitácora es la que alguien tecleó.
  it("no toca el contenido: el escape es del correo, no de aquí", () => {
    expect(notaParaRevisor("Ojo con <b>esto</b>")).toBe("Ojo con <b>esto</b>");
  });
});
