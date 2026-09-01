import { describe, it, expect } from "vitest";
import {
  PERMISOS,
  esPermisoValido,
  permisosEfectivos,
  tienePermiso,
  exigirPermiso,
  esInicialesValidas,
  GRUPOS_PERMISOS,
} from "@/src/lib/permisos";

describe("esPermisoValido", () => {
  it("acepta llaves del catálogo", () => {
    expect(esPermisoValido("cotizaciones.enviar")).toBe(true);
    expect(esPermisoValido("modulo.weekly")).toBe(true);
  });

  it("rechaza llaves desconocidas", () => {
    expect(esPermisoValido("usuarios.administrar")).toBe(false); // no migrado (D2)
    expect(esPermisoValido("")).toBe(false);
    expect(esPermisoValido("cotizaciones")).toBe(false);
  });
});

describe("permisosEfectivos", () => {
  it("rol admin tiene todos los permisos", () => {
    expect(permisosEfectivos({ rol: "admin" })).toEqual([...PERMISOS]);
  });

  it("super admin tiene todos los permisos aunque su rol no sea admin", () => {
    expect(permisosEfectivos({ rol: "campo", es_super_admin: true })).toEqual([...PERMISOS]);
  });

  it("usuario normal recibe solo los de su perfil", () => {
    const u = { rol: "campo", permisos: ["modulo.cotizaciones", "cotizaciones.enviar"] };
    expect(permisosEfectivos(u)).toEqual(["modulo.cotizaciones", "cotizaciones.enviar"]);
  });

  it("filtra llaves inválidas guardadas en el perfil", () => {
    const u = { rol: "campo", permisos: ["modulo.cotizaciones", "hackeo.total"] };
    expect(permisosEfectivos(u)).toEqual(["modulo.cotizaciones"]);
  });

  it("sin usuario o sin permisos devuelve lista vacía", () => {
    expect(permisosEfectivos(null)).toEqual([]);
    expect(permisosEfectivos({ rol: "campo" })).toEqual([]);
    expect(permisosEfectivos({ rol: "cliente", permisos: [] })).toEqual([]);
  });
});

describe("tienePermiso / exigirPermiso", () => {
  const comercial = { rol: "campo", permisos: ["cotizaciones.enviar"] };

  it("tienePermiso refleja la lista efectiva", () => {
    expect(tienePermiso(comercial, "cotizaciones.enviar")).toBe(true);
    expect(tienePermiso(comercial, "cotizaciones.aprobar")).toBe(false);
  });

  it("exigirPermiso devuelve null cuando está permitido", () => {
    expect(exigirPermiso(comercial, "cotizaciones.enviar")).toBeNull();
    expect(exigirPermiso({ rol: "admin" }, "kpi.administrar")).toBeNull();
  });

  it("exigirPermiso devuelve 401 sin usuario", () => {
    expect(exigirPermiso(null, "cotizaciones.enviar")).toEqual({
      error: "No autorizado",
      status: 401,
    });
  });

  it("exigirPermiso devuelve 403 sin el permiso", () => {
    const rechazo = exigirPermiso(comercial, "kpi.administrar");
    expect(rechazo?.status).toBe(403);
    expect(rechazo?.error).toContain("kpi.administrar");
  });
});

describe("esInicialesValidas", () => {
  it("acepta 2 a 5 mayúsculas", () => {
    expect(esInicialesValidas("EA")).toBe(true);
    expect(esInicialesValidas("EAOL")).toBe(true);
    expect(esInicialesValidas("MNAAX")).toBe(true);
  });

  it("rechaza formato incorrecto", () => {
    expect(esInicialesValidas("E")).toBe(false);
    expect(esInicialesValidas("eaol")).toBe(false);
    expect(esInicialesValidas("EAOLXX")).toBe(false);
    expect(esInicialesValidas("EA1")).toBe(false);
    expect(esInicialesValidas("")).toBe(false);
  });
});

describe("GRUPOS_PERMISOS", () => {
  it("cubre exactamente el catálogo, sin repetir", () => {
    const enGrupos = GRUPOS_PERMISOS.flatMap((g) => g.permisos);
    expect([...enGrupos].sort()).toEqual([...PERMISOS].sort());
    expect(new Set(enGrupos).size).toBe(enGrupos.length);
  });
});
