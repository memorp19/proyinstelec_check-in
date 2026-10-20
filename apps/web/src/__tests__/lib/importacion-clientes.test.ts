import { describe, it, expect } from "vitest";
import {
  actualizarContacto,
  leerFilaCliente,
  planearCarga,
  sentenciasDelPlan,
  type ClienteEnErp,
  type FilaClienteExcel,
} from "@/src/lib/importacion-clientes";

/**
 * Todos los datos de este archivo son inventados. El catálogo real tiene
 * nombres y teléfonos de clientes, y no entra al repositorio ni como fixture.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Un renglón de la hoja: A=ID Emp, B=ID Cliente, C=Razón social, D..H. */
const renglon = (
  razon: string,
  contacto = "",
  puesto = "",
  telefono = "",
  correo = "",
  direccion = "",
) => ["E-1", "C-1", razon, contacto, puesto, telefono, correo, direccion];

const fila = (valores: string[], n = 2): FilaClienteExcel => leerFilaCliente(n, valores)!;

const empresa = (over: Partial<ClienteEnErp> = {}): ClienteEnErp => ({
  id: "cli-1",
  razonSocial: "Aceros del Norte S.A. de C.V.",
  razonNormalizada: "aceros del norte",
  direccion: null,
  contactos: [],
  ...over,
});

const persona = (over: Partial<ClienteEnErp["contactos"][number]> = {}) => ({
  id: "con-1",
  nombre: "Juana Pérez",
  nombreNormalizado: "juana perez",
  puesto: null,
  telefono: null,
  correo: null,
  ...over,
});

/** Ids predecibles: las pruebas no dependen de `crypto.randomUUID`. */
const idsEnOrden = () => {
  let n = 0;
  return () => `nuevo-${++n}`;
};

const planear = (
  filas: FilaClienteExcel[],
  clientes: ClienteEnErp[],
  sobrescribir = false,
) => planearCarga({ filas, clientes, sobrescribir, nuevoId: idsEnOrden() });

// ── Lectura de la hoja ───────────────────────────────────────────────────────

describe("leerFilaCliente", () => {
  it("lee las ocho columnas y recorta los espacios", () => {
    const f = leerFilaCliente(7, ["E-9 ", " C-3", "  Minera Sur S.A. ", " Ana Ruiz ", "Compras", "  555 123 4567", " ANA@sur.MX ", " Calle 1, Ciudad "]);
    expect(f).toMatchObject({
      fila: 7,
      idEmp: "E-9",
      idCliente: "C-3",
      razonSocial: "Minera Sur S.A.",
      contacto: "Ana Ruiz",
      puesto: "Compras",
      telefono: "555 123 4567",
      correo: "ANA@sur.MX",
      direccion: "Calle 1, Ciudad",
    });
  });

  it("sin razón social no hay renglón", () => {
    expect(leerFilaCliente(3, ["E-1", "C-1", "   ", "Ana Ruiz"])).toBeNull();
  });

  // Al revés que `import:erp`, que descarta el renglón sin contacto. Ese
  // renglón puede ser el único que traiga la dirección.
  it("un renglón sin contacto pero con dirección sí se lee", () => {
    const f = leerFilaCliente(4, ["", "", "Minera Sur", "", "", "", "", "Calle 2, Ciudad"]);
    expect(f).toMatchObject({ razonSocial: "Minera Sur", contacto: "", direccion: "Calle 2, Ciudad" });
  });

  it("las columnas que faltan al final quedan vacías, no undefined", () => {
    const f = leerFilaCliente(5, ["", "", "Minera Sur"])!;
    expect(f.telefono).toBe("");
    expect(f.direccion).toBe("");
  });
});

// ── Normalización y emparejado ───────────────────────────────────────────────

describe("emparejado por razón social normalizada", () => {
  it("ignora acentos, mayúsculas, puntuación y el sufijo legal", () => {
    const variantes = [
      "ACEROS DEL NORTE, S.A. DE C.V.",
      "Aceros del Nórte S.A de C.V",
      "  aceros   del   norte  ",
      "Aceros del Norte S. de R.L. de C.V.",
    ];
    for (const razon of variantes) {
      const plan = planear([fila(renglon(razon, "", "", "", "", "Calle 1, Ciudad"))], [empresa()]);
      expect(plan.sinCliente, razon).toEqual([]);
      expect(plan.direcciones, razon).toHaveLength(1);
    }
  });

  it("una razón social que no está en el ERP se reporta y NO se crea", () => {
    const plan = planear(
      [fila(renglon("Textiles del Bajío S.A. de C.V.", "Ana Ruiz"), 4)],
      [empresa()],
    );
    expect(plan.sinCliente).toEqual([
      { razonSocial: "Textiles del Bajío S.A. de C.V.", normalizada: "textiles del bajio", filas: [4] },
    ]);
    expect(plan.contactosNuevos).toEqual([]);
    expect(plan.direcciones).toEqual([]);
  });

  it("junta las filas de la misma razón social ausente en un solo renglón del reporte", () => {
    const plan = planear(
      [
        fila(renglon("Textiles del Bajío", "Ana Ruiz"), 4),
        fila(renglon("TEXTILES DEL BAJIO, S.A.", "Luis Soto"), 9),
      ],
      [empresa()],
    );
    expect(plan.sinCliente).toHaveLength(1);
    expect(plan.sinCliente[0].filas).toEqual([4, 9]);
  });

  it("el contacto se empareja sin título dentro de su empresa", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "ING. Juana Pérez", "Compras"))],
      [empresa({ contactos: [persona()] })],
    );
    expect(plan.contactosNuevos).toEqual([]);
    expect(plan.contactosActualizados).toEqual([
      { id: "con-1", cliente: "Aceros del Norte S.A. de C.V.", nombre: "Juana Pérez", puesto: "Compras" },
    ]);
  });

  it("el mismo nombre en otra empresa es otro contacto", () => {
    const otra = empresa({ id: "cli-2", razonSocial: "Minera Sur", razonNormalizada: "minera sur" });
    const plan = planear(
      [fila(renglon("Minera Sur", "Juana Pérez"))],
      [empresa({ contactos: [persona()] }), otra],
    );
    expect(plan.contactosNuevos).toHaveLength(1);
    expect(plan.contactosNuevos[0].clienteId).toBe("cli-2");
  });
});

// ── La regla: solo llenar vacíos ─────────────────────────────────────────────

describe("solo llena lo que está vacío", () => {
  it("llena la dirección vacía", () => {
    const plan = planear([fila(renglon("Aceros del Norte", "", "", "", "", "Calle 1, Ciudad"))], [empresa()]);
    expect(plan.direcciones).toEqual([
      { id: "cli-1", cliente: "Aceros del Norte S.A. de C.V.", direccion: "Calle 1, Ciudad" },
    ]);
    expect(plan.diferencias).toEqual([]);
  });

  it("llena puesto, teléfono y correo vacíos de un contacto que ya existe", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "Compras", "555 111 2222", "JUANA@norte.mx"))],
      [empresa({ contactos: [persona()] })],
    );
    expect(plan.contactosActualizados).toEqual([
      {
        id: "con-1",
        cliente: "Aceros del Norte S.A. de C.V.",
        nombre: "Juana Pérez",
        puesto: "Compras",
        telefono: "555 111 2222",
        correo: "juana@norte.mx", // se guarda en minúsculas
      },
    ]);
    expect(plan.diferencias).toEqual([]);
    expect(plan.llenos.map((l) => l.campo)).toEqual(["puesto", "teléfono", "correo"]);
  });

  it("un dato igual no genera escritura ni diferencia", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "Compras", "", "", "Calle 1, Ciudad"))],
      [
        empresa({
          direccion: "Calle 1, Ciudad",
          contactos: [persona({ puesto: "Compras" })],
        }),
      ],
    );
    expect(plan.direcciones).toEqual([]);
    expect(plan.contactosActualizados).toEqual([]);
    expect(plan.diferencias).toEqual([]);
  });

  it("una celda vacía nunca borra lo que el ERP ya tiene", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez"))],
      [empresa({ direccion: "Calle 1, Ciudad", contactos: [persona({ telefono: "555 111 2222" })] })],
    );
    expect(plan.direcciones).toEqual([]);
    expect(plan.contactosActualizados).toEqual([]);
    expect(plan.diferencias).toEqual([]);
  });
});

// ── Diferencias ──────────────────────────────────────────────────────────────

describe("diferencias", () => {
  // El caso real que motivó el reporte: un dígito distinto en el teléfono.
  it("un dígito distinto en el teléfono es una diferencia, y no se escribe", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "", "555 110 4791"), 12)],
      [empresa({ contactos: [persona({ telefono: "556 110 4791" })] })],
    );
    expect(plan.diferencias).toEqual([
      {
        quien: "Aceros del Norte S.A. de C.V. · Juana Pérez",
        campo: "teléfono",
        enErp: "556 110 4791",
        enExcel: "555 110 4791",
        fila: 12,
        seEscribe: false,
      },
    ]);
    expect(plan.contactosActualizados).toEqual([]);
    expect(sentenciasDelPlan(() => "sql", plan)).toEqual([]);
  });

  // Sin esto, el reporte se llenaría de renglones que nadie puede accionar.
  // La lada del país la pone `presentacion.ts` al imprimir, no el dato.
  it.each([
    ["+ (52) 555 110 4791", "5551104791"],
    ["555 110 4791", "(555) 110-4791"],
    ["52 555 110 4791", "+52 555 110 4791"],
  ])("el mismo número escrito distinto NO es una diferencia (%s)", (enExcel, enErp) => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "", enExcel))],
      [empresa({ contactos: [persona({ telefono: enErp })] })],
    );
    expect(plan.diferencias).toEqual([]);
    expect(plan.contactosActualizados).toEqual([]);
  });

  // Y la lada no puede tapar un dígito cambiado: cae dentro de los diez.
  it("con lada y un dígito distinto SÍ es una diferencia", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "", "+ (52) 555 110 4791"))],
      [empresa({ contactos: [persona({ telefono: "556 110 4791" })] })],
    );
    expect(plan.diferencias).toMatchObject([{ campo: "teléfono" }]);
  });

  it("un teléfono corto se compara entero, no por los últimos diez", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "", "ext. 1234"))],
      [empresa({ contactos: [persona({ telefono: "ext. 5678" })] })],
    );
    expect(plan.diferencias).toMatchObject([{ campo: "teléfono" }]);
  });

  it("el correo se compara sin importar mayúsculas", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "", "", "JUANA@norte.mx"))],
      [empresa({ contactos: [persona({ correo: "juana@norte.mx" })] })],
    );
    expect(plan.diferencias).toEqual([]);
  });

  it("una dirección distinta se reporta y la vieja se queda", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "", "", "", "", "Calle 2, Otra Ciudad"), 5)],
      [empresa({ direccion: "Calle 1, Ciudad" })],
    );
    expect(plan.direcciones).toEqual([]);
    expect(plan.diferencias).toMatchObject([
      { campo: "dirección", enErp: "Calle 1, Ciudad", enExcel: "Calle 2, Otra Ciudad", fila: 5 },
    ]);
  });
});

// ── --sobrescribir ───────────────────────────────────────────────────────────

describe("--sobrescribir", () => {
  it("reemplaza el dato y lo reporta igual", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "", "555 110 4791", "", "Calle 2, Otra Ciudad"), 12)],
      [empresa({ direccion: "Calle 1, Ciudad", contactos: [persona({ telefono: "556 110 4791" })] })],
      true,
    );
    expect(plan.direcciones).toEqual([
      { id: "cli-1", cliente: "Aceros del Norte S.A. de C.V.", direccion: "Calle 2, Otra Ciudad" },
    ]);
    expect(plan.contactosActualizados).toEqual([
      {
        id: "con-1",
        cliente: "Aceros del Norte S.A. de C.V.",
        nombre: "Juana Pérez",
        telefono: "555 110 4791",
      },
    ]);
    // Se escribe, pero sigue apareciendo en el reporte: es un dato que alguien
    // había puesto y esta corrida acaba de cambiar.
    expect(plan.diferencias).toHaveLength(2);
    expect(plan.diferencias.every((d) => d.seEscribe)).toBe(true);
  });

  it("no inventa escrituras donde no hay diferencia", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "Compras"))],
      [empresa({ contactos: [persona({ puesto: "Compras" })] })],
      true,
    );
    expect(plan.contactosActualizados).toEqual([]);
    expect(plan.diferencias).toEqual([]);
  });
});

// ── Contactos nuevos ─────────────────────────────────────────────────────────

describe("contactos nuevos", () => {
  it("un contacto que no existe se agrega con todo lo que trae", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Luis Soto", "Mantenimiento", "555 999 8888", "LUIS@norte.mx"), 8)],
      [empresa({ contactos: [persona()] })],
    );
    expect(plan.contactosNuevos).toEqual([
      {
        id: "nuevo-1",
        clienteId: "cli-1",
        nombre: "Luis Soto",
        nombreNormalizado: "luis soto",
        puesto: "Mantenimiento",
        telefono: "555 999 8888",
        correo: "luis@norte.mx",
        cliente: "Aceros del Norte S.A. de C.V.",
        fila: 8,
      },
    ]);
  });

  it("los campos vacíos entran como null, no como cadena vacía", () => {
    const plan = planear([fila(renglon("Aceros del Norte", "Luis Soto"))], [empresa()]);
    expect(plan.contactosNuevos[0]).toMatchObject({ puesto: null, telefono: null, correo: null });
  });

  // La hoja trae un renglón por contacto: la misma empresa aparece muchas veces.
  it("varios contactos de la misma empresa entran todos", () => {
    const plan = planear(
      [
        fila(renglon("Aceros del Norte", "Luis Soto"), 3),
        fila(renglon("ACEROS DEL NORTE S.A. DE C.V.", "Ana Ruiz"), 4),
      ],
      [empresa()],
    );
    expect(plan.contactosNuevos.map((c) => c.nombre)).toEqual(["Luis Soto", "Ana Ruiz"]);
  });

  it("el mismo contacto dos veces en la hoja se agrega una sola vez y se reporta", () => {
    const plan = planear(
      [
        fila(renglon("Aceros del Norte", "Luis Soto", "Compras"), 3),
        fila(renglon("Aceros del Norte", "ING. Luis Soto", "Otro"), 9),
      ],
      [empresa()],
    );
    expect(plan.contactosNuevos).toHaveLength(1);
    expect(plan.duplicados).toEqual([
      { quien: "Aceros del Norte S.A. de C.V. · ING. Luis Soto", fila: 9, primeraFila: 3 },
    ]);
  });

  it("la dirección se toma del primer renglón que la traiga", () => {
    const plan = planear(
      [
        fila(renglon("Aceros del Norte", "Luis Soto"), 3),
        fila(renglon("Aceros del Norte", "Ana Ruiz", "", "", "", "Calle 1, Ciudad"), 4),
      ],
      [empresa()],
    );
    expect(plan.direcciones).toEqual([
      { id: "cli-1", cliente: "Aceros del Norte S.A. de C.V.", direccion: "Calle 1, Ciudad" },
    ]);
  });

  it("dos direcciones distintas para la misma empresa: la segunda es diferencia", () => {
    const plan = planear(
      [
        fila(renglon("Aceros del Norte", "Luis Soto", "", "", "", "Calle 1, Ciudad"), 3),
        fila(renglon("Aceros del Norte", "Ana Ruiz", "", "", "", "Calle 2, Otra"), 4),
      ],
      [empresa()],
    );
    expect(plan.direcciones).toHaveLength(1);
    expect(plan.diferencias).toMatchObject([
      { campo: "dirección", enErp: "Calle 1, Ciudad", enExcel: "Calle 2, Otra", fila: 4 },
    ]);
  });
});

// ── Las sentencias ───────────────────────────────────────────────────────────

describe("sentencias del plan", () => {
  /** Falso de la etiqueta de plantilla de Neon: devuelve el SQL ya armado. */
  const sqlFalso = (p: TemplateStringsArray, ...v: unknown[]) =>
    p.reduce((acc, parte, i) => acc + parte + (i < v.length ? JSON.stringify(v[i]) : ""), "");

  it("una por dirección, una por contacto nuevo y una por campo actualizado", () => {
    const plan = planear(
      [
        fila(renglon("Aceros del Norte", "Luis Soto", "Compras", "", "", "Calle 1, Ciudad"), 3),
        fila(renglon("Aceros del Norte", "Juana Pérez", "Dirección", "555 111 2222"), 4),
      ],
      [empresa({ contactos: [persona()] })],
    );

    const sentencias = sentenciasDelPlan(sqlFalso, plan);
    expect(sentencias).toHaveLength(4); // 1 dirección + 1 alta + 2 campos de Juana
    expect(sentencias[0]).toContain("UPDATE clientes SET direccion");
    expect(sentencias[1]).toContain("INSERT INTO contactos");
    // Repetible: si alguien agregó el contacto entre la lectura y la escritura,
    // la carga no se cae ni pisa lo que esa persona puso.
    expect(sentencias[1]).toContain("ON CONFLICT (cliente_id, nombre_normalizado) DO NOTHING");
    expect(sentencias[2]).toContain("UPDATE contactos SET puesto");
    expect(sentencias[3]).toContain("UPDATE contactos SET telefono");
  });

  it("un cambio sin campos no genera ninguna sentencia", () => {
    expect(actualizarContacto(sqlFalso, { id: "con-1" })).toEqual([]);
  });

  it("un plan vacío no genera nada", () => {
    const plan = planear([], [empresa()]);
    expect(sentenciasDelPlan(sqlFalso, plan)).toEqual([]);
  });
});
