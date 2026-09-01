import { describe, it, expect } from "vitest";
import { SUPER_ADMINS, esSuperAdmin } from "@/src/lib/super-admins";

describe("esSuperAdmin", () => {
  it("reconoce a las cuentas de la lista", () => {
    for (const correo of SUPER_ADMINS) {
      expect(esSuperAdmin(correo)).toBe(true);
    }
  });

  it("incluye a Jorge Gutiérrez", () => {
    expect(esSuperAdmin("jorge.gutierrez@proyinstelec.mx")).toBe(true);
  });

  it("no distingue mayúsculas ni espacios sobrantes", () => {
    expect(esSuperAdmin("  Jorge.Gutierrez@Proyinstelec.MX ")).toBe(true);
  });

  it("rechaza cualquier otra cuenta", () => {
    expect(esSuperAdmin("carlos@proyinstelec.mx")).toBe(false);
    expect(esSuperAdmin("jorge.gutierrez@otrodominio.com")).toBe(false);
    expect(esSuperAdmin(null)).toBe(false);
    expect(esSuperAdmin(undefined)).toBe(false);
    expect(esSuperAdmin("")).toBe(false);
  });
});
