import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso } from "../helpers/db-falso";
import { registrarBitacora, listarBitacora, existeEvento } from "@/src/lib/bitacora";

function usarDb(resultados: unknown[] = []) {
  const falso = dbFalso(resultados);
  vi.mocked(getDb).mockImplementation(falso.getDb as never);
  return falso;
}

describe("registrarBitacora", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserta el evento con acción, usuario y referencia", async () => {
    const db = usarDb([[]]);

    await registrarBitacora({
      accion: "COTIZACION_CREADA",
      usuario: "maria@proyinstelec.mx",
      detalle: "PCOTOP-001-2026",
      referencia: "COT#001-2026",
    });

    expect(db.metodos()).toContain("insert");
    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.accion).toBe("COTIZACION_CREADA");
    expect(valores.usuario).toBe("maria@proyinstelec.mx");
    expect(valores.referencia).toBe("COT#001-2026");
  });

  it("nunca lanza aunque la base falle", async () => {
    usarDb([{ error: new Error("neon caído") }]);

    await expect(
      registrarBitacora({ accion: "X", usuario: "sistema" }),
    ).resolves.toBeUndefined();
  });
});

describe("listarBitacora", () => {
  beforeEach(() => vi.clearAllMocks());

  const fila = {
    id: "b1",
    accion: "CORREO_ENVIADO",
    usuario: "a@x.mx",
    detalle: null,
    referencia: "COT#001-2026",
    createdAt: new Date("2026-08-14T10:00:00Z"),
  };

  it("filtra el mes por rango de fechas en SQL y mapea el evento", async () => {
    const db = usarDb([[fila]]);

    const eventos = await listarBitacora("2026-08", { accion: "CORREO_ENVIADO" });

    expect(eventos).toHaveLength(1);
    expect(eventos[0].id).toBe("b1");
    expect(eventos[0].referencia).toBe("COT#001-2026");
    expect(eventos[0].created_at).toBe("2026-08-14T10:00:00.000Z");
    // el mes no se filtra en memoria: va en el WHERE
    expect(db.metodos()).toContain("where");
    expect(db.metodos()).toContain("limit");
  });
});

describe("existeEvento (memoria de avisos)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("true si el aviso ya se registró en el rango de meses", async () => {
    usarDb([[{ id: "b9" }]]);
    expect(await existeEvento("AVISO_VENCIMIENTO", "ACT-0007|-3")).toBe(true);
  });

  it("false si no hay registro, con una sola consulta", async () => {
    const db = usarDb([[]]);
    expect(await existeEvento("AVISO_VENCIMIENTO", "ACT-9999|-1")).toBe(false);
    expect(db.metodos().filter((m) => m === "select")).toHaveLength(1);
  });
});
