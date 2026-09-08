import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso, errorDuplicado } from "../helpers/db-falso";
import {
  parseCotKey,
  cotPk,
  transicionValida,
  createCotizacion,
  crearNuevaVersion,
  normalizarMonto,
  updateCotizacion,
  cambiarEstatus,
  puedeEnviarseAlCliente,
  buscarCotizaciones,
} from "@/src/lib/cotizaciones";

function usarDb(resultados: unknown[] = []) {
  const falso = dbFalso(resultados);
  vi.mocked(getDb).mockImplementation(falso.getDb as never);
  return falso;
}

/** Fila tal como la devuelve Postgres (camelCase, timestamps como Date). */
function fila(extra: Record<string, unknown> = {}) {
  return {
    numero: 1,
    anio: 2026,
    version: 0,
    folio: "PCOTOP-001-2026",
    cliente: "Aceros del Norte",
    clienteId: null,
    titulo: "Subestación_aceros",
    dirigidaA: "Ing. Juan Pérez",
    prioridad: "MEDIA",
    estatus: "PROCESO",
    elaboro: "EAOL",
    fechaSolicitud: new Date("2026-01-10T00:00:00Z"),
    fechaEntrega: null,
    fechaEnvio: null,
    montoMxn: null,
    montoUsd: null,
    ordenCompra: null,
    folioOt: null,
    driveFolderId: null,
    driveFolderUrl: null,
    createdBy: "maria@proyinstelec.mx",
    createdAt: new Date("2026-01-10T00:00:00Z"),
    updatedAt: new Date("2026-01-10T00:00:00Z"),
    ...extra,
  };
}

describe("parseCotKey / cotPk", () => {
  it("parsea NNN-AAAA", () => {
    expect(parseCotKey("001-2026")).toEqual({ numero: 1, anio: 2026 });
    expect(parseCotKey("45-2025")).toEqual({ numero: 45, anio: 2025 });
    expect(parseCotKey("abc")).toBeNull();
  });

  it("cotPk siempre con padding a 3", () => {
    expect(cotPk(1, 2026)).toBe("COT#001-2026");
    expect(cotPk(123, 2026)).toBe("COT#123-2026");
  });
});

describe("transicionValida (reglas del legacy)", () => {
  it("flujo feliz: PROCESO → REVISION → ENVIADA → ASIGNADA", () => {
    expect(transicionValida("PROCESO", "REVISION")).toBe(true);
    expect(transicionValida("REVISION", "ENVIADA")).toBe(true);
    expect(transicionValida("ENVIADA", "ASIGNADA")).toBe(true);
  });

  it("corrección: REVISION → PROCESO", () => {
    expect(transicionValida("REVISION", "PROCESO")).toBe(true);
  });

  it("bloqueos: no se salta la revisión ni se revive una cancelada", () => {
    expect(transicionValida("PROCESO", "ENVIADA")).toBe(false);
    expect(transicionValida("PROCESO", "ASIGNADA")).toBe(false);
    expect(transicionValida("CANCELADA", "PROCESO")).toBe(false);
    expect(transicionValida("ASIGNADA", "PROCESO")).toBe(false);
  });
});

describe("createCotizacion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea la versión 0 en PROCESO con el folio del legacy", async () => {
    const db = usarDb([[fila()]]);

    const c = await createCotizacion({
      numero: 1, anio: 2026, cliente: "Aceros", titulo: "Proyecto_aceros",
      dirigidaA: "Juan", elaboro: "EAOL", createdBy: "maria@proyinstelec.mx",
    });

    expect(c.folio).toBe("PCOTOP-001-2026");
    expect(c.estatus).toBe("PROCESO");
    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.version).toBe(0);
    expect(valores.folio).toBe("PCOTOP-001-2026");
  });

  it("el choque de número lo detecta la llave primaria y se traduce a un error claro", async () => {
    usarDb([{ error: errorDuplicado() }]);

    await expect(
      createCotizacion({
        numero: 1, anio: 2026, cliente: "Aceros", titulo: "T",
        dirigidaA: "Juan", elaboro: "EAOL", createdBy: "maria@proyinstelec.mx",
      }),
    ).rejects.toThrow('La cotización 001-2026 ya existe; usa "Nueva Versión"');
  });
});

describe("crearNuevaVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hereda datos, arranca en PROCESO y limpia OC/OT/fechas — sin tocar la versión anterior", async () => {
    const vigente = fila({
      estatus: "ENVIADA",
      ordenCompra: "OC-9",
      folioOt: "OT001260",
      fechaEntrega: new Date("2026-08-01T00:00:00Z"),
      fechaEnvio: new Date("2026-08-02T00:00:00Z"),
    });
    const db = usarDb([
      [vigente], // getVigente
      [fila({ version: 1, folio: "PCOTOP-001-2026-1" })], // insert ... returning
    ]);

    const nueva = await crearNuevaVersion({ numero: 1, anio: 2026, createdBy: "x@x.mx" });

    expect(nueva.version).toBe(1);
    expect(nueva.folio).toBe("PCOTOP-001-2026-1");

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.version).toBe(1);
    expect(valores.estatus).toBe("PROCESO");
    expect(valores.cliente).toBe("Aceros del Norte"); // heredado
    expect(valores.ordenCompra).toBeUndefined();
    expect(valores.folioOt).toBeUndefined();
    expect(valores.fechaEntrega).toBeUndefined();
    // ya no hay índice espejo que mover: la vigente es la de versión más alta
    expect(db.metodos()).not.toContain("update");
  });
});

describe("cambiarEstatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza transiciones inválidas", async () => {
    usarDb([[fila()]]);
    await expect(cambiarEstatus(1, 2026, "ASIGNADA")).rejects.toThrow("Transición no permitida");
  });

  it("al reentrar a REVISION borra la aprobación de esa versión", async () => {
    const db = usarDb([
      [fila({ estatus: "PROCESO" })], // getVigente
      [], // update estatus
      [], // delete aprobación
    ]);

    await cambiarEstatus(1, 2026, "REVISION");

    expect(db.metodos()).toContain("delete");
    const cambios = db.llamadas.find((l) => l.metodo === "set")!.args[0] as { estatus: string };
    expect(cambios.estatus).toBe("REVISION");
  });

  it("un cambio normal no borra aprobaciones", async () => {
    const db = usarDb([[fila({ estatus: "ENVIADA" })], []]);
    await cambiarEstatus(1, 2026, "ASIGNADA");
    expect(db.metodos()).not.toContain("delete");
  });
});

describe("puedeEnviarseAlCliente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PROCESO → bloqueado", async () => {
    usarDb([[fila()]]);
    expect((await puedeEnviarseAlCliente(1, 2026)).puede).toBe(false);
  });

  it("REVISION sin aprobación → bloqueado con motivo", async () => {
    usarDb([[fila({ estatus: "REVISION" })], []]); // sin fila en aprobaciones
    const r = await puedeEnviarseAlCliente(1, 2026);
    expect(r.puede).toBe(false);
    expect(r.motivo).toContain("aprobación");
  });

  it("REVISION aprobada → permitido; ENVIADA → permitido (reenvío)", async () => {
    usarDb([[fila({ estatus: "REVISION" })], [{ numero: 1 }]]);
    expect((await puedeEnviarseAlCliente(1, 2026)).puede).toBe(true);

    usarDb([[fila({ estatus: "ENVIADA" })]]);
    expect((await puedeEnviarseAlCliente(1, 2026)).puede).toBe(true);
  });
});

describe("buscarCotizaciones", () => {
  beforeEach(() => vi.clearAllMocks());

  it("una sola consulta: filtros en SQL sobre las vigentes y aprobada por LEFT JOIN", async () => {
    const db = usarDb([
      [
        { ...fila({ numero: 2, cliente: "Constructora Gómez", estatus: "ENVIADA" }), aprobada: true },
      ],
    ]);

    const r = await buscarCotizaciones({ anio: 2026, empresa: "gómez", estatus: "ENVIADA" });

    expect(r).toHaveLength(1);
    expect(r[0].numero).toBe(2);
    expect(r[0].aprobada).toBe(true);
    // ni filtrado en memoria ni una lectura de aprobación por resultado
    expect(db.metodos()).toContain("leftJoin");
    expect(db.metodos().filter((m) => m === "leftJoin")).toHaveLength(1);
  });

  it("el flag aprobada es false cuando el JOIN no encuentra aprobación", async () => {
    usarDb([[{ ...fila(), aprobada: false }]]);
    const r = await buscarCotizaciones({ anio: 2026, mesEntrega: 9 });
    expect(r[0].aprobada).toBe(false);
  });
});

// ── Montos: dos monedas independientes, y NULL ≠ 0 ────────────────────────────

describe("normalizarMonto", () => {
  it("un monto ausente o vacío es NULL, nunca 0", () => {
    // La diferencia entre "no lo hemos localizado" y "no cuesta nada" es real
    expect(normalizarMonto(undefined)).toBeNull();
    expect(normalizarMonto(null)).toBeNull();
    expect(normalizarMonto("")).toBeNull();
    expect(normalizarMonto("   ")).toBeNull();
  });

  it("cero explícito sí se guarda como cero", () => {
    expect(normalizarMonto(0)).toBe("0.00");
    expect(normalizarMonto("0")).toBe("0.00");
  });

  it("normaliza a dos decimales exactos", () => {
    expect(normalizarMonto("1234.5")).toBe("1234.50");
    expect(normalizarMonto(98765.4321)).toBe("98765.43");
    expect(normalizarMonto("1000")).toBe("1000.00");
  });

  it("tolera el formato con que la gente teclea importes", () => {
    expect(normalizarMonto("$1,234.50")).toBe("1234.50");
    expect(normalizarMonto(" 1 234.50 ")).toBe("1234.50");
  });

  it("rechaza importes negativos y basura", () => {
    expect(() => normalizarMonto("-100")).toThrow("no puede ser negativo");
    expect(() => normalizarMonto("mil pesos")).toThrow("Monto inválido");
  });
});

describe("createCotizacion — montos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda las dos monedas a la vez sin sumarlas", async () => {
    // Mano de obra nacional en pesos + equipo importado en dólares
    const db = usarDb([[fila({ montoMxn: "50000.00", montoUsd: "3000.00" })]]);

    const cot = await createCotizacion({
      numero: 1, anio: 2026, cliente: "Aceros", titulo: "Subestación",
      dirigidaA: "Ing. Pérez", elaboro: "EAOL", createdBy: "x@x.mx",
      montoMxn: "50000", montoUsd: "3000",
    });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.montoMxn).toBe("50000.00");
    expect(valores.montoUsd).toBe("3000.00");
    expect(cot.monto_mxn).toBe("50000.00");
    expect(cot.monto_usd).toBe("3000.00");
  });

  it("sin montos capturados las dos columnas quedan en NULL", async () => {
    const db = usarDb([[fila()]]);

    const cot = await createCotizacion({
      numero: 1, anio: 2026, cliente: "Aceros", titulo: "Subestación",
      dirigidaA: "Ing. Pérez", elaboro: "EAOL", createdBy: "x@x.mx",
    });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.montoMxn).toBeNull();
    expect(valores.montoUsd).toBeNull();
    expect(cot.monto_mxn).toBeUndefined();
  });
});

describe("crearNuevaVersion — montos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("la versión nueva hereda los importes de la vigente", async () => {
    const vigente = fila({ montoMxn: "50000.00", montoUsd: "3000.00" });
    const db = usarDb([[vigente], [fila({ version: 1, montoMxn: "50000.00", montoUsd: "3000.00" })]]);

    await crearNuevaVersion({ numero: 1, anio: 2026, createdBy: "x@x.mx" });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<string, unknown>;
    expect(valores.montoMxn).toBe("50000.00");
    expect(valores.montoUsd).toBe("3000.00");
  });
});

describe("updateCotizacion — montos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("omitir el campo no lo toca; mandarlo en null lo vacía", async () => {
    const db = usarDb([[{ numero: 1 }]]);
    await updateCotizacion(1, 2026, { montoUsd: null });

    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0] as Record<string, unknown>;
    expect(set.montoUsd).toBeNull();
    expect("montoMxn" in set).toBe(false);
  });

  it("un importe corregido se normaliza igual que en el alta", async () => {
    const db = usarDb([[{ numero: 1 }]]);
    await updateCotizacion(1, 2026, { montoMxn: "$72,500" });

    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0] as Record<string, unknown>;
    expect(set.montoMxn).toBe("72500.00");
  });
});
