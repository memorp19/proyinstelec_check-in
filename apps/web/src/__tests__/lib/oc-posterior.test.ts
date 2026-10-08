import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/bitacora", () => ({ registrarBitacora: vi.fn() }));

import { getDb } from "@/src/db";
import { registrarBitacora } from "@/src/lib/bitacora";
import { registrarOcPosterior } from "@/src/lib/cotizaciones-flujos";
import { dbFalso } from "../helpers/db-falso";

function usarDb(resultados: unknown[] = []) {
  const falso = dbFalso(resultados);
  vi.mocked(getDb).mockImplementation(falso.getDb as never);
  return falso;
}

const ASIGNADA = { version: 1, folioOt: "OT224261", ordenCompra: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registrarOcPosterior", () => {
  it("escribe la OC en la cotización y en su OT, y deja rastro", async () => {
    const db = usarDb([[ASIGNADA], []]);

    const r = await registrarOcPosterior({
      numero: 224,
      anio: 2026,
      ordenCompra: "  4501122596  ",
      usuario: "ana@proyinstelec.mx",
    });

    expect(r).toEqual({ version: 1, folioOt: "OT224261", ordenCompra: "4501122596" });

    // Las dos escrituras van en un solo `batch`: dejar la OC en una tabla y no
    // en la otra deja las dos pantallas contradiciéndose.
    expect(db.metodos()).toContain("batch");
    const sets = db.llamadas.filter((l) => l.metodo === "set").map((l) => l.args[0]);
    expect(sets).toHaveLength(2);
    for (const s of sets) {
      expect((s as Record<string, unknown>).ordenCompra).toBe("4501122596");
      expect((s as Record<string, unknown>).updatedAt).toBeInstanceOf(Date);
    }
  });

  it("registra en bitácora quién la capturó y sobre qué", async () => {
    usarDb([[ASIGNADA], []]);

    await registrarOcPosterior({
      numero: 224,
      anio: 2026,
      ordenCompra: "4501122596",
      usuario: "ana@proyinstelec.mx",
    });

    const [arg] = vi.mocked(registrarBitacora).mock.calls[0];
    expect(arg.accion).toBe("COTIZACION_OC_POSTERIOR");
    expect(arg.usuario).toBe("ana@proyinstelec.mx");
    // Misma referencia que el resto de los flujos de cotización
    expect(arg.referencia).toBe("COT#224-2026");
    expect(arg.detalle).toContain("4501122596");
    expect(arg.detalle).toContain("v1");
    expect(arg.detalle).toContain("OT224261");
  });

  // Lo que distingue esta ruta del PATCH genérico: se puede aceptar la v0 y
  // levantar una v1 después, y entonces la vigente NO es la versión asignada.
  // Escribir en la vigente dejaría la OC en una versión que nadie aceptó.
  it("escribe en la versión que tiene la OT, aunque exista una posterior", async () => {
    const db = usarDb([[{ version: 0, folioOt: "OT224260", ordenCompra: null }], []]);

    const r = await registrarOcPosterior({
      numero: 224,
      anio: 2026,
      ordenCompra: "9140",
      usuario: "ana@x.mx",
    });

    expect(r.version).toBe(0);
    // La consulta filtra por ASIGNADA y folio_ot no nulo, no por "la vigente"
    const where = db.llamadas.find((l) => l.metodo === "where")!;
    expect(where).toBeDefined();
    expect(db.metodos()).toContain("orderBy");
    expect(db.metodos()).toContain("limit");
  });

  it("sin versión ASIGNADA con OT, avisa y no escribe", async () => {
    const db = usarDb([[]]);

    await expect(
      registrarOcPosterior({ numero: 44, anio: 2026, ordenCompra: "9140", usuario: "ana@x.mx" }),
    ).rejects.toThrow("no tiene una versión ASIGNADA con orden de trabajo");

    expect(db.metodos()).not.toContain("batch");
    expect(registrarBitacora).not.toHaveBeenCalled();
  });

  // No se pisa en silencio una OC ya registrada.
  it("si esa versión ya tiene OC, no la sobrescribe", async () => {
    const db = usarDb([[{ version: 1, folioOt: "OT224261", ordenCompra: "82043" }]]);

    await expect(
      registrarOcPosterior({ numero: 224, anio: 2026, ordenCompra: "9140", usuario: "ana@x.mx" }),
    ).rejects.toThrow("ya tiene la orden de compra 82043");

    expect(db.metodos()).not.toContain("batch");
  });

  it("una OC vacía o de solo espacios se rechaza antes de tocar la base", async () => {
    const db = usarDb([[ASIGNADA], []]);

    for (const oc of ["", "   ", "\t"]) {
      await expect(
        registrarOcPosterior({ numero: 224, anio: 2026, ordenCompra: oc, usuario: "ana@x.mx" }),
      ).rejects.toThrow("obligatoria");
    }
    expect(db.llamadas).toHaveLength(0);
  });
});
