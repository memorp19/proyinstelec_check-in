import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/bitacora", () => ({
  registrarBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from "@/src/db";
import { dbFalso, errorDuplicado } from "../helpers/db-falso";
import { registrarBitacora } from "@/src/lib/bitacora";
import {
  parseCotKey,
  cotPk,
  transicionValida,
  ESTATUS_COTIZACION,
  createCotizacion,
  crearNuevaVersion,
  normalizarMonto,
  updateCotizacion,
  cambiarEstatus,
  getVersion,
  marcarNoAsignadas,
  clasificarImportadas,
  getVigente,
  ultimaVersion,
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
      [{ maximo: 0 }], // ultimaVersion
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
    const db = usarDb([
      [vigente],
      [{ maximo: 0 }], // ultimaVersion
      [fila({ version: 1, montoMxn: "50000.00", montoUsd: "3000.00" })],
    ]);

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

// La OC puede registrarse en una versión que no es la vigente, así que las
// escrituras tienen que poder apuntar a una concreta. Si no, asignar la v0
// movería el estatus de la v1.
/**
 * Nombres de columna que aparecen en un WHERE de Drizzle. Se recorre el árbol
 * a mano porque `JSON.stringify` revienta: los nodos referencian la tabla y la
 * estructura es circular.
 */
function columnasDelWhere(where: unknown): string[] {
  const nombres: string[] = [];
  const vistos = new Set<unknown>();
  const recorrer = (nodo: unknown) => {
    if (!nodo || typeof nodo !== "object" || vistos.has(nodo)) return;
    vistos.add(nodo);
    const n = nodo as { name?: unknown; queryChunks?: unknown[] };
    if (typeof n.name === "string") nombres.push(n.name);
    for (const hijo of n.queryChunks ?? []) recorrer(hijo);
  };
  recorrer(where);
  return nombres;
}

/**
 * Texto crudo del WHERE. Drizzle guarda los literales de `sql` en StringChunk;
 * `JSON.stringify` no sirve porque el árbol referencia la tabla y es circular.
 */
function textoDeSql(nodo: unknown): string {
  const n = nodo as { queryChunks?: Array<{ value?: string[] }> };
  return (n?.queryChunks ?? []).flatMap((c) => c.value ?? []).join(" ");
}

function textoDelWhere(db: ReturnType<typeof usarDb>): string {
  return textoDeSql(db.llamadas.find((l) => l.metodo === "where")!.args[0]);
}

describe("escribir sobre una versión concreta", () => {
  // El fixture devuelve version 0 pase lo que pase, así que comprobar
  // `cot.version === 0` pasaba igual si la consulta ignoraba la versión.
  // Lo que hay que mirar es el WHERE que se construyó.
  it("getVersion filtra por las tres columnas, no solo por (numero, anio)", async () => {
    const db = usarDb([[fila({ version: 2 })]]);

    await getVersion(1, 2026, 2);

    const where = db.llamadas.find((l) => l.metodo === "where")!.args[0];
    const columnas = columnasDelWhere(where);
    expect(columnas).toContain("numero");
    expect(columnas).toContain("anio");
    expect(columnas).toContain("version");
  });

  it("getVersion devuelve null si esa versión no existe", async () => {
    usarDb([[]]);
    expect(await getVersion(1, 2026, 7)).toBeNull();
  });

  it("updateCotizacion sin versión sigue apuntando a la vigente", async () => {
    const db = usarDb([[{ numero: 1 }]]);

    await updateCotizacion(1, 2026, { folioOt: "OT001260" });

    // La vigente se resuelve con una subconsulta ordenada, no con MAX a secas
    expect(textoDelWhere(db)).toContain("ORDER BY");
  });

  it("updateCotizacion con versión NO usa el WHERE de la vigente", async () => {
    const db = usarDb([[{ numero: 1 }]]);

    await updateCotizacion(1, 2026, { folioOt: "OT002260" }, 0);

    // Sin MAX: apunta a la fila exacta, no a "la más alta"
    expect(textoDelWhere(db)).not.toContain("MAX");
  });

  // Igual que el anterior: el fixture decide la versión devuelta, así que la
  // aserción no distinguía getVersion de getVigente. Se mira la LECTURA.
  it("cambiarEstatus con versión lee esa versión, no la vigente", async () => {
    const db = usarDb([[fila({ version: 2, estatus: "ENVIADA" })], []]);

    await cambiarEstatus(1, 2026, "ASIGNADA", 2);

    // La lectura es la del `select`: su WHERE tiene que mencionar la versión
    const whereLectura = db.llamadas.filter((l) => l.metodo === "where")[0].args[0];
    expect(columnasDelWhere(whereLectura)).toContain("version");
    // Y getVigente ordena por estatus+version; esa lectura no debe ocurrir
    expect(db.metodos()).not.toContain("orderBy");
  });

  it("cambiarEstatus con versión rechaza la transición inválida de ESA versión", async () => {
    usarDb([[fila({ version: 0, estatus: "PROCESO" })]]);

    await expect(cambiarEstatus(1, 2026, "ASIGNADA", 0)).rejects.toThrow(
      "Transición no permitida",
    );
  });

  it("cambiarEstatus avisa si la versión pedida no existe", async () => {
    usarDb([[]]);
    await expect(cambiarEstatus(1, 2026, "ASIGNADA", 9)).rejects.toThrow(
      "Cotización no encontrada",
    );
  });
});

// Al asignar una versión, las demás que seguían en ENVIADA quedan descartadas.
// NO ASIGNADA es terminal: si el cliente cambia de opinión, cotización nueva.
describe("NO ASIGNADA", () => {
  it("ENVIADA puede pasar a NO ASIGNADA", () => {
    expect(transicionValida("ENVIADA", "NO ASIGNADA")).toBe(true);
  });

  it("es terminal: no se revive a ningún estado", () => {
    for (const destino of ESTATUS_COTIZACION) {
      expect(transicionValida("NO ASIGNADA", destino)).toBe(false);
    }
  });

  it("no se llega desde PROCESO ni desde REVISION", () => {
    expect(transicionValida("PROCESO", "NO ASIGNADA")).toBe(false);
    expect(transicionValida("REVISION", "NO ASIGNADA")).toBe(false);
  });

  it("marcarNoAsignadas toca solo las ENVIADA distintas de la asignada", async () => {
    const db = usarDb([[{ version: 1 }, { version: 2 }]]);

    const n = await marcarNoAsignadas(1, 2026, 0, "ana@x.mx");

    expect(n).toBe(2);
    const set = db.llamadas.find((l) => l.metodo === "set")!.args[0] as Record<string, unknown>;
    expect(set.estatus).toBe("NO ASIGNADA");
    // El WHERE menciona version (para excluir la asignada) y estatus
    const columnas = columnasDelWhere(db.llamadas.find((l) => l.metodo === "where")!.args[0]);
    expect(columnas).toContain("version");
    expect(columnas).toContain("estatus");
  });

  it("devuelve 0 cuando no había otras en ENVIADA", async () => {
    usarDb([[]]);
    expect(await marcarNoAsignadas(1, 2026, 0, "ana@x.mx")).toBe(0);
  });
});

// La vigente no puede ser "la de versión más alta" a secas: al asignar una
// versión anterior, la más alta es justo una descartada, y el listado y los
// filtros por OC y OT mirarían la fila equivocada.
describe("la vigente salta las NO ASIGNADA", () => {
  it("getVigente ordena por estatus antes que por versión", async () => {
    const db = usarDb([[fila({ version: 0, estatus: "ASIGNADA" })]]);

    await getVigente(1, 2026);

    const orden = db.llamadas.find((l) => l.metodo === "orderBy")!.args;
    // El primer criterio es el estatus, no la versión
    expect(textoDeSql(orden[0])).toContain("NO ASIGNADA");
  });

  it("el WHERE de la vigente ya no usa MAX(version) a secas", async () => {
    const db = usarDb([[{ numero: 1 }]]);

    await updateCotizacion(1, 2026, { folioOt: "OT001260" });

    const texto = textoDelWhere(db);
    expect(texto).toContain("NO ASIGNADA");
    expect(texto).not.toContain("MAX");
  });
});

// Regresión encontrada en revisión: al redefinir la vigente, crearNuevaVersion
// numeraba a partir de ella. Con la v0 asignada y la v1 descartada, la vigente
// es la v0 y la "nueva" se numeraba 1 — que ya existe. Choque con la PK, y
// alcanzable con un clic porque el botón no tiene guarda de estatus.
describe("numerar una versión nueva", () => {
  it("ultimaVersion mira TODAS las versiones, sin filtrar por estatus", async () => {
    const db = usarDb([[{ maximo: 3 }]]);

    expect(await ultimaVersion(1, 2026)).toBe(3);

    // El WHERE es solo (numero, anio): si filtrara por estatus, volvería el bug
    const columnas = columnasDelWhere(db.llamadas.find((l) => l.metodo === "where")!.args[0]);
    expect(columnas).toContain("numero");
    expect(columnas).toContain("anio");
    expect(columnas).not.toContain("estatus");
  });

  it("devuelve null si la cotización no tiene ninguna versión", async () => {
    usarDb([[{ maximo: null }]]);
    expect(await ultimaVersion(9, 2026)).toBeNull();
  });

  it("la versión nueva se numera sobre el máximo, no sobre la vigente", async () => {
    const db = usarDb([
      [fila({ version: 0, estatus: "ASIGNADA" })], // getVigente → la v0 asignada
      [{ maximo: 1 }], // ultimaVersion → existe una v1 descartada
      [fila({ version: 2 })], // el insert
    ]);

    await crearNuevaVersion({ numero: 1, anio: 2026, createdBy: "ana@x.mx" });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<
      string,
      unknown
    >;
    // vigente.version + 1 habría dado 1, que ya existe
    expect(valores.version).toBe(2);
    expect(valores.folio).toBe("PCOTOP-001-2026-2");
  });

  it("hereda los datos de la vigente aunque numere desde el máximo", async () => {
    const db = usarDb([
      [fila({ version: 0, estatus: "ASIGNADA", titulo: "El bueno" })],
      [{ maximo: 1 }],
      [fila({ version: 2 })],
    ]);

    await crearNuevaVersion({ numero: 1, anio: 2026, createdBy: "ana@x.mx" });

    const valores = db.llamadas.find((l) => l.metodo === "values")!.args[0] as Record<
      string,
      unknown
    >;
    expect(valores.titulo).toBe("El bueno");
  });
});

// Segundo hallazgo de la misma revisión: saltar solo NO ASIGNADA no basta.
// Camino real: se manda la v1, el cliente dice que no, se cancela, y después
// acepta la v0. Si la vigente fuera la v1 cancelada, el listado mostraría esa.
describe("la vigente salta también las CANCELADA", () => {
  it("el orden descarta NO ASIGNADA y CANCELADA", async () => {
    const db = usarDb([[fila({ version: 0, estatus: "ASIGNADA" })]]);

    await getVigente(1, 2026);

    const orden = db.llamadas.find((l) => l.metodo === "orderBy")!.args;
    const texto = textoDeSql(orden[0]);
    expect(texto).toContain("NO ASIGNADA");
    expect(texto).toContain("CANCELADA");
  });

  it("el WHERE de la vigente descarta los dos estados", async () => {
    const db = usarDb([[{ numero: 1 }]]);

    await updateCotizacion(1, 2026, { folioOt: "OT001260" });

    const texto = textoDelWhere(db);
    expect(texto).toContain("NO ASIGNADA");
    expect(texto).toContain("CANCELADA");
  });
});

describe("marcarNoAsignadas deja rastro", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registra en bitácora qué versiones cayeron y por cuál", async () => {
    usarDb([[{ version: 1 }, { version: 3 }]]);

    await marcarNoAsignadas(2, 2026, 0, "ana@proyinstelec.mx");

    const evento = vi.mocked(registrarBitacora).mock.calls[0][0];
    expect(evento.usuario).toBe("ana@proyinstelec.mx");
    expect(evento.detalle).toContain("v1");
    expect(evento.detalle).toContain("v3");
    expect(evento.detalle).toContain("v0");
  });

  it("no registra nada si no descartó ninguna", async () => {
    usarDb([[]]);

    await marcarNoAsignadas(2, 2026, 0, "ana@proyinstelec.mx");

    expect(registrarBitacora).not.toHaveBeenCalled();
  });
});

// Los datos importados nunca pasaron por marcarNoAsignadas, así que conservan
// en ENVIADA versiones que ya estaban descartadas de hecho. Esta clasificación
// decide qué REPORTAR; quién cambia el estatus sigue siendo marcarNoAsignadas.
describe("clasificarImportadas", () => {
  /** Versión mínima con lo que la clasificación mira. */
  const v = (version: number, estatus: string) =>
    ({ numero: 2, anio: 2026, version, estatus }) as never;

  it("separa las ENVIADA por encima y por debajo de la asignada", () => {
    const r = clasificarImportadas([
      v(0, "ENVIADA"),
      v(1, "ASIGNADA"),
      v(2, "ENVIADA"),
      v(3, "ENVIADA"),
    ]);

    expect(r.asignadas.map((c) => c.version)).toEqual([1]);
    expect(r.enviadasMayores.map((c) => c.version)).toEqual([2, 3]);
    expect(r.enviadasMenores.map((c) => c.version)).toEqual([0]);
  });

  // Son las que tapan a la asignada: ORDEN_VIGENTE prefiere la versión más alta
  // que no esté descartada, y ENVIADA no se descarta.
  it("el caso que rompe el listado: una ENVIADA mayor que la asignada", () => {
    const r = clasificarImportadas([v(0, "ASIGNADA"), v(1, "ENVIADA")]);

    expect(r.enviadasMayores.map((c) => c.version)).toEqual([1]);
    expect(r.enviadasMenores).toEqual([]);
  });

  it("una ENVIADA menor no tapa, pero se reporta aparte", () => {
    const r = clasificarImportadas([v(0, "ENVIADA"), v(1, "ASIGNADA")]);

    expect(r.enviadasMayores).toEqual([]);
    expect(r.enviadasMenores.map((c) => c.version)).toEqual([0]);
  });

  it("ignora los estatus que no son ENVIADA ni ASIGNADA", () => {
    const r = clasificarImportadas([
      v(0, "ASIGNADA"),
      v(1, "CANCELADA"),
      v(2, "NO ASIGNADA"),
      v(3, "PROCESO"),
      v(4, "ENVIADA"),
    ]);

    expect(r.enviadasMayores.map((c) => c.version)).toEqual([4]);
    expect(r.enviadasMenores).toEqual([]);
  });

  // Violan "una cotización, una OT": sin referencia única no se puede decidir
  // cuál descartar, así que el script las reporta y no las toca.
  it("con dos ASIGNADA no elige referencia", () => {
    const r = clasificarImportadas([v(0, "ASIGNADA"), v(1, "ASIGNADA"), v(2, "ENVIADA")]);

    expect(r.asignadas.map((c) => c.version)).toEqual([0, 1]);
    // Todas las ENVIADA se listan juntas; no hay "mayor que" con dos referencias
    expect(r.enviadasMayores.map((c) => c.version)).toEqual([2]);
    expect(r.enviadasMenores).toEqual([]);
  });

  it("sin ninguna ASIGNADA tampoco elige referencia", () => {
    const r = clasificarImportadas([v(0, "ENVIADA"), v(1, "ENVIADA")]);

    expect(r.asignadas).toEqual([]);
    expect(r.enviadasMayores.map((c) => c.version)).toEqual([0, 1]);
  });

  it("devuelve las versiones ordenadas, venga como venga la lista", () => {
    const r = clasificarImportadas([v(3, "ENVIADA"), v(1, "ASIGNADA"), v(2, "ENVIADA")]);

    expect(r.enviadasMayores.map((c) => c.version)).toEqual([2, 3]);
  });

  it("una cotización ya corregida no deja nada que descartar", () => {
    const r = clasificarImportadas([v(0, "ASIGNADA"), v(1, "NO ASIGNADA")]);

    expect(r.enviadasMayores).toEqual([]);
    expect(r.enviadasMenores).toEqual([]);
  });
});
