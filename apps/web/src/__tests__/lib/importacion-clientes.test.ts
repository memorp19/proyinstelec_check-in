import { describe, it, expect } from "vitest";
import {
  actualizarContacto,
  filaDesdeCeldas,
  leerFilaCliente,
  leerFilas,
  planearCarga,
  sentenciasDelPlan,
  type ClienteEnErp,
  type FilaClienteExcel,
} from "@/src/lib/importacion-clientes";
import type { Fila } from "@/src/lib/excel";

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
  direccion: null,
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

// ── El .xlsx y la hoja de Google, por el mismo sitio ─────────────────────────

describe("filaDesdeCeldas", () => {
  /** Una celda de texto como la devuelve `LibroExcel`. */
  const txt = (valor: string): Fila[string] => ({ valor, tipo: "s", conFormatoDeFecha: false });

  it("aplana las columnas A..H en el mismo orden que entrega Sheets", () => {
    const celdas: Fila = {
      A: txt("E-1"), B: txt("C-1"), C: txt("Minera Sur"), D: txt("Ana Ruiz"),
      E: txt("Compras"), F: txt("555 123 4567"), G: txt("ana@sur.mx"), H: txt("Calle 1, Ciudad"),
    };
    expect(filaDesdeCeldas(celdas)).toEqual([
      "E-1", "C-1", "Minera Sur", "Ana Ruiz", "Compras", "555 123 4567", "ana@sur.mx", "Calle 1, Ciudad",
    ]);
  });

  // Recorrer solo las celdas con valor correría las demás de lugar: el puesto
  // acabaría leyéndose como teléfono.
  it("una celda vacía en medio no corre a las demás de su columna", () => {
    const celdas: Fila = { C: txt("Minera Sur"), D: txt("Ana Ruiz"), H: txt("Calle 1, Ciudad") };
    const valores = filaDesdeCeldas(celdas);
    expect(valores).toEqual(["", "", "Minera Sur", "Ana Ruiz", "", "", "", "Calle 1, Ciudad"]);
    expect(leerFilaCliente(2, valores)).toMatchObject({
      razonSocial: "Minera Sur",
      contacto: "Ana Ruiz",
      puesto: "",
      telefono: "",
      direccion: "Calle 1, Ciudad",
    });
  });

  // La columna I es de quién atiende la cuenta, no del cliente.
  it("la columna I (ASESORIA) no se lee", () => {
    const celdas: Fila = { C: txt("Minera Sur"), I: txt("EAOL"), J: txt("nota suelta") };
    expect(filaDesdeCeldas(celdas)).toHaveLength(8);
    expect(filaDesdeCeldas(celdas)).not.toContain("EAOL");
  });
});

describe("leerFilas", () => {
  it("numera desde la fila 2, porque la 1 es el encabezado", () => {
    const { filas } = leerFilas([renglon("Minera Sur", "Ana Ruiz"), renglon("Aceros", "Luis Soto")]);
    expect(filas.map((f) => f.fila)).toEqual([2, 3]);
  });

  // Antes se contaban; nombrarlos es lo que permite arreglarlos.
  it("nombra los renglones que descarta por no traer razón social", () => {
    const { filas, ignoradas } = leerFilas([
      renglon("Minera Sur", "Ana Ruiz"),
      ["", "", "", "Luis Soto", "", "555 111 2222"], // tiene datos, no tiene empresa
      renglon("Aceros", "Jorge Díaz"),
    ]);
    expect(filas).toHaveLength(2);
    expect(ignoradas).toEqual([3]);
  });

  // Las hojas traen cientos de renglones vacíos al final.
  it("un renglón enteramente vacío no se reporta como descarte", () => {
    const { ignoradas } = leerFilas([renglon("Minera Sur", "Ana Ruiz"), [], ["", "  ", ""]]);
    expect(ignoradas).toEqual([]);
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

  /**
   * `clientes.razon_normalizada` no está limpia: una carga anterior dejó filas
   * con la razón social en mayúsculas, con su puntuación y su sufijo legal.
   * Comparar la columna tal cual no encontraba a NADIE —85 renglones contra 55
   * clientes, cero coincidencias—. Se vuelve a normalizar, igual que hace
   * `resolverCliente` en el importador de 2026.
   */
  it("encuentra al cliente aunque la columna normalizada esté sucia", () => {
    const sucia = empresa({
      razonSocial: "ADMINISTRADORA DE CENTROS COMERCIALES SANTA FE S.A. de C.V.",
      razonNormalizada: "ADMINISTRADORA DE CENTROS COMERCIALES SANTA FE S.A. DE C.V.",
    });
    const plan = planear(
      [fila(renglon("Administradora de Centros Comerciales Santa Fe S.A. de C.V.", "Ana Ruiz"))],
      [sucia],
    );
    expect(plan.sinCliente).toEqual([]);
    expect(plan.contactosNuevos).toHaveLength(1);
  });

  it("y también si la columna normalizada viene vacía", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte S.A. de C.V.", "Ana Ruiz"))],
      [empresa({ razonNormalizada: "" })],
    );
    expect(plan.sinCliente).toEqual([]);
    expect(plan.contactosNuevos).toHaveLength(1);
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
  it("llena la dirección de respaldo vacía del cliente", () => {
    const plan = planear([fila(renglon("Aceros del Norte", "", "", "", "", "Calle 1, Ciudad"))], [empresa()]);
    expect(plan.direcciones).toEqual([
      { id: "cli-1", cliente: "Aceros del Norte S.A. de C.V.", direccion: "Calle 1, Ciudad", deCuantos: 1 },
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
          contactos: [persona({ puesto: "Compras", direccion: "Calle 1, Ciudad" })],
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
      {
        id: "cli-1",
        cliente: "Aceros del Norte S.A. de C.V.",
        direccion: "Calle 2, Otra Ciudad",
        deCuantos: 1,
      },
    ]);
    expect(plan.contactosActualizados).toEqual([
      {
        id: "con-1",
        cliente: "Aceros del Norte S.A. de C.V.",
        nombre: "Juana Pérez",
        telefono: "555 110 4791",
        direccion: "Calle 2, Otra Ciudad",
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
        direccion: null,
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

  it("cada contacto se lleva la dirección de SU renglón", () => {
    const plan = planear(
      [
        fila(renglon("Aceros del Norte", "Luis Soto", "", "", "", "Calle 1, Ciudad"), 3),
        fila(renglon("Aceros del Norte", "Ana Ruiz", "", "", "", "Calle 2, Otra"), 4),
      ],
      [empresa()],
    );
    expect(plan.contactosNuevos.map((c) => [c.nombre, c.direccion])).toEqual([
      ["Luis Soto", "Calle 1, Ciudad"],
      ["Ana Ruiz", "Calle 2, Otra"],
    ]);
    // Dos sitios de la misma empresa no son una diferencia: son dos sitios.
    expect(plan.diferencias).toEqual([]);
  });

  /**
   * El caso real: una empresa con dos domicilios, nueve contactos en uno y
   * cuatro en el otro. Con la dirección por cliente, los cuatro se perdían
   * como "diferencia" contra el primero que hubiera llegado.
   */
  it("el respaldo del cliente es la dirección más repetida, no la primera", () => {
    const uno = "Carretera del Norte 2977, El Robledal";
    const dos = "Paseo de los Fresnos 2977, San Mateo";
    const plan = planear(
      [
        fila(renglon("Aceros del Norte", "Luis Soto", "", "", "", uno), 3),
        fila(renglon("Aceros del Norte", "Ana Ruiz", "", "", "", dos), 4),
        fila(renglon("Aceros del Norte", "Jorge Díaz", "", "", "", dos), 5),
      ],
      [empresa()],
    );
    expect(plan.direcciones).toEqual([
      { id: "cli-1", cliente: "Aceros del Norte S.A. de C.V.", direccion: dos, deCuantos: 2 },
    ]);
    // Y el que está en el otro sitio conserva el suyo.
    expect(plan.contactosNuevos.find((c) => c.nombre === "Luis Soto")!.direccion).toBe(uno);
    expect(plan.diferencias).toEqual([]);
  });

  it("un renglón sin contacto solo aporta su dirección al respaldo", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "", "", "", "", "Calle 1, Ciudad"), 3)],
      [empresa()],
    );
    expect(plan.contactosNuevos).toEqual([]);
    expect(plan.direcciones).toHaveLength(1);
  });

  it("la misma dirección escrita con espacios de más cuenta como una sola", () => {
    const plan = planear(
      [
        fila(renglon("Aceros del Norte", "Luis Soto", "", "", "", "Calle 1,  Ciudad"), 3),
        fila(renglon("Aceros del Norte", "Ana Ruiz", "", "", "", "Calle 1, Ciudad"), 4),
        fila(renglon("Aceros del Norte", "Jorge Díaz", "", "", "", "Calle 2, Otra"), 5),
      ],
      [empresa()],
    );
    expect(plan.direcciones[0]).toMatchObject({ direccion: "Calle 1,  Ciudad", deCuantos: 2 });
  });

  // La diferencia es de la persona, no de la empresa: antes salían seis
  // renglones de la misma empresa que eran dos domicilios de dos grupos.
  it("una dirección distinta de un contacto que ya existe se le atribuye a él", () => {
    const plan = planear(
      [fila(renglon("Aceros del Norte", "Juana Pérez", "", "", "", "Calle 2, Otra"), 7)],
      [empresa({ contactos: [persona({ direccion: "Calle 1, Ciudad" })] })],
    );
    expect(plan.diferencias).toMatchObject([
      {
        quien: "Aceros del Norte S.A. de C.V. · Juana Pérez",
        campo: "dirección",
        enErp: "Calle 1, Ciudad",
        enExcel: "Calle 2, Otra",
        fila: 7,
      },
    ]);
    expect(plan.contactosActualizados).toEqual([]);
  });
});

// ── Avisos del reporte ───────────────────────────────────────────────────────

describe("avisos del reporte", () => {
  /** Un renglón con su ID Emp propio, que el helper `renglon` fija en "E-1". */
  const conId = (idEmp: string, razon: string, contacto = "", correo = "") =>
    [idEmp, "C-1", razon, contacto, "", "", correo, ""];

  // O el id se reusó, o una razón está mal escrita. En los dos casos el
  // emparejado manda los contactos a clientes distintos sin que nadie lo note.
  it("un mismo ID Emp con razones sociales distintas se reporta", () => {
    const plan = planear(
      [
        fila(conId("035", "Embobinados Industriales"), 85),
        fila(conId("035", "ITESE JC"), 86),
        fila(conId("036", "Minera Sur"), 87),
      ],
      [empresa()],
    );
    expect(plan.idsAmbiguos).toEqual([
      { idEmp: "035", razones: ["Embobinados Industriales", "ITESE JC"], filas: [85, 86] },
    ]);
  });

  it("el mismo ID Emp con la misma razón escrita distinto NO se reporta", () => {
    const plan = planear(
      [
        fila(conId("035", "ACEROS DEL NORTE, S.A. DE C.V."), 85),
        fila(conId("035", "Aceros del Nórte S.A de C.V"), 86),
      ],
      [empresa()],
    );
    expect(plan.idsAmbiguos).toEqual([]);
  });

  it("un renglón sin ID Emp no entra al aviso", () => {
    const plan = planear([fila(conId("", "Minera Sur"), 5)], [empresa()]);
    expect(plan.idsAmbiguos).toEqual([]);
  });

  // Un contacto del cliente no tiene correo nuestro: o es el del asesor
  // capturado en la columna equivocada, o es un registro interno.
  it("un correo del dominio de la empresa se reporta", () => {
    const plan = planear(
      [fila(conId("E-1", "Aceros del Norte", "Luis Soto", "asesora.interna@proyinstelec.mx"), 2)],
      [empresa()],
    );
    expect(plan.correosInternos).toEqual([
      {
        quien: "Aceros del Norte · Luis Soto",
        correo: "asesora.interna@proyinstelec.mx",
        fila: 2,
      },
    ]);
    // Se carga igual: el dato es el dato.
    expect(plan.contactosNuevos[0].correo).toBe("asesora.interna@proyinstelec.mx");
  });

  it("el dominio se puede cambiar, y un correo de cliente no se reporta", () => {
    const filas = [fila(conId("E-1", "Aceros del Norte", "Luis Soto", "luis@otra-empresa.com"), 2)];
    expect(planear(filas, [empresa()]).correosInternos).toEqual([]);
    expect(
      planearCarga({ filas, clientes: [empresa()], dominioInterno: "otra-empresa.com" }).correosInternos,
    ).toHaveLength(1);
  });

  // Vale para un renglón que al final no se va a cargar: lo que señala es la
  // captura, no el resultado.
  it("los avisos salen aunque el cliente no exista en el ERP", () => {
    const plan = planear(
      [fila(conId("035", "Textiles del Bajío", "Ana Ruiz", "ana@proyinstelec.mx"), 9)],
      [empresa()],
    );
    expect(plan.sinCliente).toHaveLength(1);
    expect(plan.correosInternos).toHaveLength(1);
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
    expect(sentencias).toHaveLength(4); // 1 respaldo + 1 alta + 2 campos de Juana
    expect(sentencias[0]).toContain("UPDATE clientes SET direccion");
    expect(sentencias[1]).toContain("INSERT INTO contactos");
    expect(sentencias[1]).toContain("direccion");
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
