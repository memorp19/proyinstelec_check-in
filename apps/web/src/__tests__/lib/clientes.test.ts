import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso, errorDuplicado } from "../helpers/db-falso";
import {
  normalizarRazonSocial,
  normalizarNombreContacto,
  compararRazones,
  createContacto,
  contactosParaEnvio,
} from "@/src/lib/clientes";

function usarDb(resultados: unknown[] = []) {
  const falso = dbFalso(resultados);
  vi.mocked(getDb).mockImplementation(falso.getDb as never);
  return falso;
}

const fechas = { createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };

describe("normalizarRazonSocial", () => {
  it("quita sufijos legales y puntuación", () => {
    expect(normalizarRazonSocial("Aceros del Norte, S.A. de C.V.")).toBe("aceros del norte");
    expect(normalizarRazonSocial("ACEROS DEL NORTE SA DE CV")).toBe("aceros del norte");
    expect(normalizarRazonSocial("Constructora Gómez S. de R.L.")).toBe("constructora gomez");
  });

  it("normaliza acentos y espacios", () => {
    expect(normalizarRazonSocial("  Eléctrica   Ramírez  ")).toBe("electrica ramirez");
  });
});

describe("normalizarNombreContacto", () => {
  it("quita títulos personales (LIC./ING./ARQ./...)", () => {
    expect(normalizarNombreContacto("ING. Juan Pérez")).toBe("juan perez");
    expect(normalizarNombreContacto("Lic. María López")).toBe("maria lopez");
    expect(normalizarNombreContacto("C.P. Pedro Díaz")).toBe("pedro diaz");
  });
});

describe("compararRazones", () => {
  it("exacta cuando solo difieren sufijos legales", () => {
    expect(compararRazones("Aceros del Norte S.A. de C.V.", "ACEROS DEL NORTE")).toBe("exacta");
  });

  it("parcial con contains bidireccional", () => {
    expect(compararRazones("Aceros del Norte", "Aceros del Norte Planta 2")).toBe("parcial");
    expect(compararRazones("Aceros del Norte Planta 2", "Aceros del Norte")).toBe("parcial");
  });

  it("ninguna cuando no hay relación", () => {
    expect(compararRazones("Aceros del Norte", "Constructora Gómez")).toBe("ninguna");
  });
});

describe("createContacto — anti-duplicado", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda el nombre normalizado (base del índice único por empresa)", async () => {
    const db = usarDb([
      [{ id: "c1", clienteId: "abc", nombre: "ING. Juan Pérez", nombreNormalizado: "juan perez", puesto: null, telefono: null, correo: null, ...fechas }],
    ]);

    await createContacto({ clienteId: "abc", nombre: "ING. Juan Pérez" });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.nombreNormalizado).toBe("juan perez");
  });

  it("traduce el conflicto del índice único al mensaje del legacy", async () => {
    usarDb([{ error: errorDuplicado() }]);

    await expect(
      createContacto({ clienteId: "abc", nombre: "Juan Perez" }),
    ).rejects.toThrow('El contacto "Juan Perez" ya existe en esta empresa');
  });
});

describe("contactosParaEnvio — sugerencia de contacto", () => {
  beforeEach(() => vi.clearAllMocks());

  const empresa = {
    id: "e1",
    razonSocial: "Aceros del Norte S.A. de C.V.",
    razonNormalizada: "aceros del norte",
    direccion: null,
    createdBy: "x@x.mx",
    ...fechas,
  };
  const contacto = (id: string, nombre: string, correo: string | null) => ({
    id,
    clienteId: "e1",
    nombre,
    nombreNormalizado: normalizarNombreContacto(nombre),
    puesto: null,
    telefono: null,
    correo,
    ...fechas,
  });

  function mockDatos() {
    // 1ª consulta: candidatas por ILIKE; 2ª: contactos de la empresa
    usarDb([
      [empresa],
      [
        contacto("c1", "ING. Juan Pérez", "juan@aceros.mx"),
        contacto("c2", "María López", "maria@aceros.mx"),
        contacto("c3", "Sin Correo", null),
      ],
    ]);
  }

  it("sugiere el contacto que corresponde a 'Dirigida a' quitando títulos", async () => {
    mockDatos();
    const r = await contactosParaEnvio({
      razonSocial: "ACEROS DEL NORTE",
      dirigidaA: "Ing. Juan Pérez",
    });
    expect(r.empresa?.cliente_id).toBe("e1");
    expect(r.contactos).toHaveLength(2); // solo con correo
    expect(r.sugeridoId).toBe("c1");
  });

  it("match por palabra cuando el nombre no coincide completo", async () => {
    mockDatos();
    const r = await contactosParaEnvio({ razonSocial: "Aceros del Norte", dirigidaA: "Sra. López" });
    expect(r.sugeridoId).toBe("c2");
  });

  it("sin empresa localizada devuelve vacío y no consulta contactos", async () => {
    const db = usarDb([[]]);
    const r = await contactosParaEnvio({ razonSocial: "Desconocida SA" });
    expect(r.empresa).toBeNull();
    expect(r.sugeridoId).toBeNull();
    expect(db.metodos().filter((m) => m === "select")).toHaveLength(1);
  });
});
