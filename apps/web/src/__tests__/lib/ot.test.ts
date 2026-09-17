import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso, errorDuplicado } from "../helpers/db-falso";
import {
  createOT,
  getOT,
  getOTDeCotizacion,
  listOTDeAnio,
  listResponsables,
  agregarResponsable,
  desactivarResponsable,
  responsablesActivosPorFolio,
  setCarpetaDriveOT,
  transicionValidaOT,
  cambiarEstatusOT,
  MAX_RESPONSABLES,
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
    estatus: "",
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
    slot: 1,
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
  // La 1ª consulta es la comprobación "¿esta cotización ya tiene OT?"
  const sinOTPrevia = (...resto: unknown[]) => usarDb([[], ...resto]);

  it("arma el folio con la convención del legacy (OT + NNN + AA + versión)", async () => {
    const db = sinOTPrevia([filaOT()]);

    const ot = await createOT(paramsAlta);

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.folio).toBe("OT001260");
    expect(ot.folio).toBe("OT001260");
  });

  it("el folio incluye la versión de la cotización que originó la OT", async () => {
    const db = sinOTPrevia([filaOT({ folio: "OT012262", version: 2 })]);

    await createOT({ ...paramsAlta, numeroCotizacion: 12, version: 2 });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.folio).toBe("OT012262");
  });

  it("no escribe estatus al crear: lo pone el default de la columna", async () => {
    const db = sinOTPrevia([filaOT()]);

    const ot = await createOT(paramsAlta);

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    // "PROCESO" era un estatus de cotización colado a la tabla de OT
    expect(valores).not.toHaveProperty("estatus");
    expect(ot.estatus).toBe("");
    expect(ot.tiene_control_operativo).toBe(false);
  });

  it("recorta los espacios de la orden de compra", async () => {
    const db = sinOTPrevia([filaOT()]);

    await createOT({ ...paramsAlta, ordenCompra: "  OC-77  " });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.ordenCompra).toBe("OC-77");
  });

  it("acepta una OT sin orden de compra y la guarda como NULL, no como cadena vacía", async () => {
    const db = sinOTPrevia([filaOT({ ordenCompra: null })]);

    const ot = await createOT({ ...paramsAlta, ordenCompra: null });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.ordenCompra).toBeNull();
    expect(ot.orden_compra).toBeUndefined();
  });

  it("una OC con solo espacios equivale a no tener OC", async () => {
    const db = sinOTPrevia([filaOT({ ordenCompra: null })]);

    await createOT({ ...paramsAlta, ordenCompra: "   " });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.ordenCompra).toBeNull();
  });

  it("traduce la violación de llave primaria a un mensaje con el folio", async () => {
    sinOTPrevia({ error: errorDuplicado() });

    await expect(createOT(paramsAlta)).rejects.toThrow("La OT OT001260 ya existe");
  });

  it("reconoce el 23505 aunque el driver de Neon lo envuelva en `cause`", async () => {
    sinOTPrevia({ error: Object.assign(new Error("falló"), { cause: { code: "23505" } }) });

    await expect(createOT(paramsAlta)).rejects.toThrow("La OT OT001260 ya existe");
  });

  it("deja pasar los errores que no son de unicidad", async () => {
    sinOTPrevia({ error: new Error("conexión perdida") });

    await expect(createOT(paramsAlta)).rejects.toThrow("conexión perdida");
  });
});

describe("createOT — una cotización, una OT", () => {
  it("rechaza la segunda OT y dice que hay que levantar una cotización nueva", async () => {
    usarDb([[filaOT()]]); // la cotización ya tiene OT

    await expect(createOT(paramsAlta)).rejects.toThrow(
      /La cotización 001-2026 ya tiene la OT OT001260.*cotización nueva/s,
    );
  });

  it("bloquea aunque la versión sea distinta — es donde la llave primaria no alcanza", async () => {
    // La OT existente nació de la v0 (OT001260); ahora entra una OC sobre la v1,
    // cuyo folio sería OT001261 y por tanto NO chocaría con la llave primaria.
    const db = usarDb([[filaOT({ folio: "OT001260", version: 0 })]]);

    await expect(createOT({ ...paramsAlta, version: 1 })).rejects.toThrow("ya tiene la OT OT001260");

    // Lo importante: se rechazó antes de escribir nada
    expect(db.metodos()).not.toContain("insert");
  });

  it("no se deja engañar por la versión: busca por (numero, anio), no por folio", async () => {
    const db = usarDb([[]]);
    await createOT({ ...paramsAlta, version: 3 }).catch(() => {});

    // El WHERE de la comprobación no menciona el folio
    expect(db.llamadas.some((l) => l.metodo === "where")).toBe(true);
    expect(db.metodos().indexOf("select")).toBeLessThan(db.metodos().indexOf("insert"));
  });
});

describe("getOTDeCotizacion", () => {
  it("devuelve null cuando la cotización todavía no tiene OT", async () => {
    usarDb([[]]);
    expect(await getOTDeCotizacion(1, 2026)).toBeNull();
  });

  it("devuelve la OT existente sin importar de qué versión nació", async () => {
    usarDb([[filaOT({ folio: "OT001262", version: 2 })]]);
    const ot = await getOTDeCotizacion(1, 2026);
    expect(ot?.folio).toBe("OT001262");
  });
});

describe("agregarResponsable", () => {
  const alta = {
    folioOt: "OT001260",
    correo: "juan@proyinstelec.mx",
    area: "Estudios Eléctricos",
    asignadoPor: "ana@proyinstelec.mx",
  };

  it("NO desactiva a los que ya estaban: una OT admite tres a la vez", async () => {
    const db = usarDb([[{ slot: 1 }], [filaResponsable({ slot: 2 })]]);

    await agregarResponsable(alta);

    // El comportamiento viejo desactivaba a todos antes de insertar; eso era
    // justo lo que impedía tener más de uno.
    expect(db.metodos()).not.toContain("update");
  });

  it("ocupa el primer slot libre", async () => {
    const db = usarDb([[{ slot: 1 }, { slot: 3 }], [filaResponsable({ slot: 2 })]]);

    const r = await agregarResponsable(alta);

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.slot).toBe(2);
    expect(r.slot).toBe(2);
  });

  it("guarda el correo en minúsculas y el rol fijo del legacy", async () => {
    const db = usarDb([[], [filaResponsable()]]);

    await agregarResponsable({ ...alta, correo: "Juan@Proyinstelec.MX", area: undefined });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.correo).toBe("juan@proyinstelec.mx");
    expect(valores.rol).toBe("Responsable de la actividad");
    expect(valores.area).toBeNull();
    expect(valores.slot).toBe(1);
  });

  it("rechaza al cuarto responsable con un mensaje accionable", async () => {
    usarDb([[{ slot: 1 }, { slot: 2 }, { slot: 3 }]]);

    await expect(agregarResponsable(alta)).rejects.toThrow(
      `ya tiene ${MAX_RESPONSABLES} responsables activos`,
    );
  });

  // El tope lo impone el índice único parcial, no el conteo previo: bajo
  // READ COMMITTED dos altas concurrentes ven 2 ocupados y elegirían el mismo.
  it("si otro proceso gana el slot (23505), reintenta con el siguiente libre", async () => {
    const db = usarDb([
      [{ slot: 1 }],
      { error: errorDuplicado() },
      [{ slot: 1 }, { slot: 2 }],
      [filaResponsable({ slot: 3 })],
    ]);

    const r = await agregarResponsable(alta);

    expect(r.slot).toBe(3);
    const slotsIntentados = db.llamadas
      .filter((l) => l.metodo === "values")
      .map((l) => (l.args[0] as Record<string, unknown>).slot);
    expect(slotsIntentados).toEqual([2, 3]);
  });
});

describe("desactivarResponsable", () => {
  it("libera el slot conservando la fila como historial", async () => {
    const db = usarDb([[{ id: "r1" }]]);

    await desactivarResponsable("r1");

    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0];
    expect(set).toEqual({ activo: false });
    expect(db.metodos()).not.toContain("delete");
  });

  it("avisa si no existe o ya estaba inactivo", async () => {
    usarDb([[]]);
    await expect(desactivarResponsable("r9")).rejects.toThrow("no existe o ya estaba inactivo");
  });
});

describe("transicionValidaOT", () => {
  it("flujo real: (vacío) → Asignado → En Ejecución → Cerrado", () => {
    expect(transicionValidaOT("", "Asignado")).toBe(true);
    expect(transicionValidaOT("Asignado", "En Ejecución")).toBe(true);
    expect(transicionValidaOT("En Ejecución", "Cerrado")).toBe(true);
  });

  it("no se salta pasos ni vuelve atrás", () => {
    expect(transicionValidaOT("", "En Ejecución")).toBe(false);
    expect(transicionValidaOT("", "Cerrado")).toBe(false);
    expect(transicionValidaOT("En Ejecución", "Asignado")).toBe(false);
    expect(transicionValidaOT("Cerrado", "En Ejecución")).toBe(false);
  });

  it("Cerrado es terminal y no hay cancelación", () => {
    expect(transicionValidaOT("Cerrado", "")).toBe(false);
    expect(transicionValidaOT("Asignado", "CANCELADO")).toBe(false);
  });

  it("no hay transición a sí mismo", () => {
    expect(transicionValidaOT("Asignado", "Asignado")).toBe(false);
  });

  // Los estatus del legacy que no existen en la operación real. Se rechazan
  // en vez de reventar: la base puede traerlos de datos viejos o importados.
  it("rechaza los estatus que no existen, sin lanzar", () => {
    expect(transicionValidaOT("PROCESO", "Asignado")).toBe(false);
    expect(transicionValidaOT("Asignado", "TERMINADO")).toBe(false);
    expect(transicionValidaOT("FACTURADO", "Cerrado")).toBe(false);
  });
});

describe("cambiarEstatusOT", () => {
  it("avanza y sella updated_at", async () => {
    const db = usarDb([[filaOT({ estatus: "" })], [filaOT({ estatus: "Asignado" })]]);

    const ot = await cambiarEstatusOT("OT001260", "Asignado");

    expect(ot.estatus).toBe("Asignado");
    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0] as Record<string, unknown>;
    expect(set.estatus).toBe("Asignado");
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it("rechaza la transición inválida sin tocar la base", async () => {
    const db = usarDb([[filaOT({ estatus: "" })]]);

    await expect(cambiarEstatusOT("OT001260", "Cerrado")).rejects.toThrow("Transición no permitida");
    expect(db.metodos()).not.toContain("update");
  });

  it("avisa si la OT no existe", async () => {
    usarDb([[]]);
    await expect(cambiarEstatusOT("OT999260", "Asignado")).rejects.toThrow("no existe");
  });

  // El WHERE incluye el estatus leído: si alguien lo movió entre la validación
  // y la escritura, no se pisa un estado que ya no es el que se validó.
  it("si alguien se adelantó, no pisa el cambio ajeno", async () => {
    usarDb([[filaOT({ estatus: "" })], []]);

    await expect(cambiarEstatusOT("OT001260", "Asignado")).rejects.toThrow(
      "cambió mientras se guardaba",
    );
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
    expect(porFolio["OT002260"][0].correo).toBe("ana@x.mx");
    expect(db.metodos().filter((m) => m === "select")).toHaveLength(1);
  });

  // El bug que motivó el cambio: el índice se armaba con Object.fromEntries,
  // que conserva solo la última fila de cada clave. Con tres responsables
  // activos, dos desaparecían y cuál sobrevivía dependía del orden de Postgres.
  it("conserva los TRES responsables de una OT, no solo el último", async () => {
    usarDb([
      [
        filaResponsable({ id: "r1", slot: 1, correo: "uno@x.mx" }),
        filaResponsable({ id: "r2", slot: 2, correo: "dos@x.mx" }),
        filaResponsable({ id: "r3", slot: 3, correo: "tres@x.mx" }),
      ],
    ]);

    const porFolio = await responsablesActivosPorFolio(["OT001260"]);

    expect(porFolio["OT001260"]).toHaveLength(3);
    expect(porFolio["OT001260"].map((r) => r.correo)).toEqual([
      "uno@x.mx",
      "dos@x.mx",
      "tres@x.mx",
    ]);
  });

  it("una OT sin responsables activos no aparece en el índice", async () => {
    usarDb([[filaResponsable({ folioOt: "OT001260" })]]);

    const porFolio = await responsablesActivosPorFolio(["OT001260", "OT002260"]);

    expect(porFolio["OT002260"]).toBeUndefined();
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
