import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso, errorDuplicado } from "../helpers/db-falso";
import {
  createOT,
  getOT,
  listOTDeAnio,
  listResponsables,
  registrarResponsable,
  responsablesActivosPorFolio,
  setCarpetaDriveOT,
} from "@/src/lib/ot";

function usarDb(resultados: unknown[] = []) {
  const falso = dbFalso(resultados);
  vi.mocked(getDb).mockImplementation(falso.getDb as never);
  return falso;
}

const fechas = {
  createdAt: new Date("2026-02-01T10:00:00Z"),
  updatedAt: new Date("2026-02-01T10:00:00Z"),
};

function filaOT(over: Record<string, unknown> = {}) {
  return {
    folio: "OT001260",
    numeroCotizacion: 1,
    anio: 2026,
    version: 0,
    ordenCompra: "OC-77",
    fechaOc: null,
    cliente: "Aceros del Norte",
    titulo: "Estudio de corto circuito",
    dirigidaA: "Ing. Juan Pérez",
    estatus: "PROCESO",
    areas: ["ESTUDIOS_ELECTRICOS"],
    driveFolderId: null,
    driveFolderUrl: null,
    tieneControlOperativo: false,
    createdBy: "ana@proyinstelec.mx",
    ...fechas,
    ...over,
  };
}

function filaResponsable(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    folioOt: "OT001260",
    correo: "juan@proyinstelec.mx",
    rol: "Responsable de la actividad",
    area: "Estudios Eléctricos",
    asignadoPor: "ana@proyinstelec.mx",
    fecha: new Date("2026-02-01T10:00:00Z"),
    activo: true,
    ...over,
  };
}

const paramsAlta = {
  numeroCotizacion: 1,
  anio: 2026,
  version: 0,
  ordenCompra: "OC-77",
  cliente: "Aceros del Norte",
  titulo: "Estudio de corto circuito",
  dirigidaA: "Ing. Juan Pérez",
  areas: ["ESTUDIOS_ELECTRICOS"],
  createdBy: "ana@proyinstelec.mx",
};

beforeEach(() => vi.clearAllMocks());

describe("createOT", () => {
  it("arma el folio con la convención del legacy (OT + NNN + AA + versión)", async () => {
    const db = usarDb([[filaOT()]]);

    const ot = await createOT(paramsAlta);

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.folio).toBe("OT001260");
    expect(ot.folio).toBe("OT001260");
  });

  it("el folio incluye la versión de la cotización que originó la OT", async () => {
    const db = usarDb([[filaOT({ folio: "OT012262", version: 2 })]]);

    await createOT({ ...paramsAlta, numeroCotizacion: 12, version: 2 });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.folio).toBe("OT012262");
  });

  it("nace en PROCESO y sin control operativo", async () => {
    const db = usarDb([[filaOT()]]);

    const ot = await createOT(paramsAlta);

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.estatus).toBe("PROCESO");
    expect(ot.tiene_control_operativo).toBe(false);
  });

  it("recorta los espacios de la orden de compra", async () => {
    const db = usarDb([[filaOT()]]);

    await createOT({ ...paramsAlta, ordenCompra: "  OC-77  " });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.ordenCompra).toBe("OC-77");
  });

  it("traduce la violación de llave primaria a un mensaje con el folio", async () => {
    usarDb([{ error: errorDuplicado() }]);

    await expect(createOT(paramsAlta)).rejects.toThrow("La OT OT001260 ya existe");
  });

  it("reconoce el 23505 aunque el driver de Neon lo envuelva en `cause`", async () => {
    usarDb([{ error: Object.assign(new Error("falló"), { cause: { code: "23505" } }) }]);

    await expect(createOT(paramsAlta)).rejects.toThrow("La OT OT001260 ya existe");
  });

  it("deja pasar los errores que no son de unicidad", async () => {
    usarDb([{ error: new Error("conexión perdida") }]);

    await expect(createOT(paramsAlta)).rejects.toThrow("conexión perdida");
  });
});

describe("registrarResponsable", () => {
  it("desactiva al anterior ANTES de insertar al nuevo (historial del legacy)", async () => {
    const db = usarDb([[], [filaResponsable()]]);

    await registrarResponsable({
      folioOt: "OT001260",
      correo: "juan@proyinstelec.mx",
      area: "Estudios Eléctricos",
      asignadoPor: "ana@proyinstelec.mx",
    });

    const metodos = db.metodos();
    expect(metodos.indexOf("update")).toBeGreaterThanOrEqual(0);
    expect(metodos.indexOf("update")).toBeLessThan(metodos.indexOf("insert"));

    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0];
    expect(set).toEqual({ activo: false });
  });

  it("guarda el correo en minúsculas y el rol fijo del legacy", async () => {
    const db = usarDb([[], [filaResponsable()]]);

    await registrarResponsable({
      folioOt: "OT001260",
      correo: "Juan@Proyinstelec.MX",
      asignadoPor: "ana@proyinstelec.mx",
    });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.correo).toBe("juan@proyinstelec.mx");
    expect(valores.rol).toBe("Responsable de la actividad");
    expect(valores.area).toBeNull();
  });
});

describe("lecturas", () => {
  it("getOT devuelve null cuando el folio no existe", async () => {
    usarDb([[]]);
    expect(await getOT("OT999260")).toBeNull();
  });

  it("getOT mapea la fila a la forma pública, con fechas ISO", async () => {
    usarDb([[filaOT({ fechaOc: new Date("2026-01-20T00:00:00Z"), driveFolderUrl: "https://drive/x" })]]);

    const ot = await getOT("OT001260");

    expect(ot).toMatchObject({
      folio: "OT001260",
      numero_cotizacion: 1,
      orden_compra: "OC-77",
      fecha_oc: "2026-01-20T00:00:00.000Z",
      drive_folder_url: "https://drive/x",
      created_at: "2026-02-01T10:00:00.000Z",
    });
  });

  it("una OT sin áreas se mapea a lista vacía, no a null", async () => {
    usarDb([[filaOT({ areas: null })]]);
    const ot = await getOT("OT001260");
    expect(ot!.areas).toEqual([]);
  });

  it("listOTDeAnio filtra por año y ordena de la más reciente a la más vieja", async () => {
    const db = usarDb([[filaOT({ folio: "OT002260" }), filaOT()]]);

    const lista = await listOTDeAnio(2026);

    expect(lista.map((o) => o.folio)).toEqual(["OT002260", "OT001260"]);
    expect(db.metodos()).toContain("orderBy");
  });

  it("responsablesActivosPorFolio no consulta nada con la lista vacía", async () => {
    const db = usarDb([]);
    expect(await responsablesActivosPorFolio([])).toEqual({});
    expect(db.metodos()).toEqual([]);
  });

  it("responsablesActivosPorFolio indexa por folio en una sola consulta", async () => {
    const db = usarDb([
      [filaResponsable(), filaResponsable({ id: "r2", folioOt: "OT002260", correo: "ana@x.mx" })],
    ]);

    const porFolio = await responsablesActivosPorFolio(["OT001260", "OT002260"]);

    expect(Object.keys(porFolio)).toEqual(["OT001260", "OT002260"]);
    expect(porFolio["OT002260"].correo).toBe("ana@x.mx");
    expect(db.metodos().filter((m) => m === "select")).toHaveLength(1);
  });

  it("listResponsables incluye el historial completo (activos e inactivos)", async () => {
    usarDb([[filaResponsable(), filaResponsable({ id: "r0", activo: false })]]);

    const lista = await listResponsables("OT001260");

    expect(lista).toHaveLength(2);
    expect(lista[0].activo).toBe(true);
    expect(lista[1].activo).toBe(false);
  });
});

describe("setCarpetaDriveOT", () => {
  it("guarda id y url de la carpeta y refresca updated_at", async () => {
    const db = usarDb([[]]);

    await setCarpetaDriveOT("OT001260", { folderId: "f1", folderUrl: "https://drive/f1" });

    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0] as Record<string, unknown>;
    expect(set.driveFolderId).toBe("f1");
    expect(set.driveFolderUrl).toBe("https://drive/f1");
    expect(set.updatedAt).toBeInstanceOf(Date);
  });
});
