import { describe, it, expect, afterEach, vi } from "vitest";
import { dominioEmpresa, normalizarCorreo, validarDestinatarios } from "@/src/lib/destinatarios";

/**
 * A quién se le puede mandar una cotización (el M7 de la revisión del 17 nov).
 * La regla es pura: la aplican igual el servidor y la pantalla.
 */

const CONTACTOS = ["compras@cliente.test", "Ingenieria@Cliente.test"];
const revisar = (destinatarios: string[], correosDelCliente = CONTACTOS) =>
  validarDestinatarios({
    destinatarios,
    correosDelCliente,
    dominio: "empresa.test",
    cliente: "Aceros del Norte",
  });

describe("validarDestinatarios", () => {
  it("un contacto del cliente: sale", () => {
    expect(revisar(["compras@cliente.test"])).toEqual({ ok: true, para: ["compras@cliente.test"] });
  });

  it("un contacto más gente de la empresa: sale, a todos", () => {
    expect(revisar(["compras@cliente.test", "gerencia@empresa.test"])).toEqual({
      ok: true,
      para: ["compras@cliente.test", "gerencia@empresa.test"],
    });
  });

  it("compara sin mayúsculas ni espacios, y no repite", () => {
    expect(revisar([" COMPRAS@cliente.test", "compras@cliente.test", "ingenieria@cliente.test"])).toEqual({
      ok: true,
      para: ["compras@cliente.test", "ingenieria@cliente.test"],
    });
  });

  it("nadie: pide un contacto", () => {
    const r = revisar(["", "  "]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Selecciona al menos un contacto de Aceros del Norte.");
  });

  describe("si uno no cuadra, no sale nada", () => {
    it("un correo que no es contacto: lo nombra y dice que primero se dé de alta", () => {
      const r = revisar(["compras@cliente.test", "alguien@otra.test"]);
      expect(r).toEqual({
        ok: false,
        noCuadran: ["alguien@otra.test"],
        error:
          "No se envió nada: alguien@otra.test no es contacto de Aceros del Norte ni es de la empresa. " +
          "Primero dalo de alta como contacto del cliente en Clientes, y vuelve a enviar.",
      });
    });

    it("varios: los nombra a todos", () => {
      const r = revisar(["compras@cliente.test", "a@otra.test", "b@otra.test"]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.noCuadran).toEqual(["a@otra.test", "b@otra.test"]);
        expect(r.error).toContain("a@otra.test y b@otra.test no son contactos");
      }
    });

    it("solo gente de la empresa: falta un contacto del cliente", () => {
      const r = revisar(["gerencia@empresa.test"]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.noCuadran).toEqual([]);
        expect(r.error).toContain("falta al menos un contacto de Aceros del Norte");
        expect(r.error).toContain("dala de alta como contacto del cliente en Clientes");
      }
    });

    it("un cliente sin contactos: tampoco", () => {
      expect(revisar(["compras@cliente.test"], []).ok).toBe(false);
    });
  });

  describe("el dominio de la empresa es exactamente ese", () => {
    it.each([
      ["un subdominio", "alguien@correo.empresa.test"],
      ["un dominio que lo contiene", "alguien@empresa.test.otra.test"],
      ["uno que termina igual", "alguien@miempresa.test"],
    ])("%s no cuenta", (_caso, correo) => {
      expect(revisar(["compras@cliente.test", correo]).ok).toBe(false);
    });
  });

  // Los destinatarios van tal cual en la cabecera `To:`: una coma o un salto de
  // línea serían otro destinatario, u otra cabecera.
  describe("una sola dirección por destinatario", () => {
    it.each([
      ["un salto de línea", "compras@cliente.test\r\nBcc: alguien@otra.test"],
      ["una coma", "compras@cliente.test, alguien@otra.test"],
      ["un punto y coma", "compras@cliente.test;alguien@otra.test"],
      ["un nombre con <>", "Compras <compras@cliente.test>"],
      ["sin arroba", "compras"],
      ["sin dominio", "compras@"],
    ])("%s no pasa", (_caso, correo) => {
      const r = revisar(["compras@cliente.test", correo]);
      expect(r.ok).toBe(false);
    });

    // Aunque esté así guardado en el contacto: no es una dirección.
    it("tampoco si así está escrito en el contacto, y dice que se corrija", () => {
      const doble = "compras@cliente.test, pagos@cliente.test";
      const r = revisar([doble], [doble]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain("no es una dirección de correo válida");
        expect(r.error).toContain("se corrige en Clientes");
      }
    });
  });
});

describe("dominioEmpresa", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sale de GOOGLE_WORKSPACE_DOMAIN, en minúsculas", () => {
    vi.stubEnv("GOOGLE_WORKSPACE_DOMAIN", " Empresa.TEST ");
    expect(dominioEmpresa()).toBe("empresa.test");
  });
});

describe("normalizarCorreo", () => {
  it("como lo guarda createContacto", () => {
    expect(normalizarCorreo("  Compras@Cliente.TEST ")).toBe("compras@cliente.test");
  });
});
