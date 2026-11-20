import { describe, it, expect, vi, afterEach } from "vitest";
import { CONDICIONES_POR_OMISION, documentoVacio } from "@/src/lib/cotizador/documento";
import { PARTES, type Tramo } from "@/src/lib/cotizador/docs/lote";
import { esVersionAnterior, nombreDelDocumento } from "@/src/lib/cotizador/docs/nombre";
import {
  generarDocumento,
  solicitudesDelDocumento,
  type DatosDeGeneracion,
} from "@/src/lib/cotizador/docs/generar";
import type { Armado } from "@/src/lib/cotizador/armado";
import type { ResultadoCotizacion } from "@/src/lib/cotizador/tipos";
import {
  ArmaDocumento,
  documentosFalso,
  type OpcionesDelFalso,
} from "../../../helpers/documentos-falso";

/** Todos los datos son inventados. */

const armadoCon = (partidas: number): Armado =>
  ({
    numero: 1,
    anio: 2026,
    version: 0,
    documento: documentoVacio(),
    partidas: Array.from({ length: partidas }, (_, i) => ({
      id: `P${i}`,
      orden: i + 1,
      titulo: `Partida ${i + 1}`,
      bloques: [],
      cantidad: 1,
      unidad: "servicio",
      formato: "NORMAL",
    })),
    gastos: [],
  }) as unknown as Armado;

const calculoCon = (partidas: number): ResultadoCotizacion =>
  ({
    moneda: "MXN",
    partidas: Array.from({ length: partidas }, (_, i) => ({
      id: `P${i}`,
      orden: i + 1,
      cantidad: 1,
      precioUnitario: 1000,
      importe: 1000,
    })),
    subtotal: 1000 * partidas,
    iva: 160 * partidas,
    total: 1160 * partidas,
  }) as unknown as ResultadoCotizacion;

const datos = (sobre: Partial<DatosDeGeneracion> = {}): DatosDeGeneracion => ({
  numero: 1,
  anio: 2026,
  version: 0,
  cliente: "Minera Sur",
  titulo: "Servicio de Mantenimiento",
  armado: armadoCon(1),
  calculo: calculoCon(1),
  documento: { ...documentoVacio(), fecha: "2026-10-05" },
  condiciones: { ...CONDICIONES_POR_OMISION, lugar: "la planta" },
  ...sobre,
});

/** Un cuadro con la forma del de la plantilla: encabezado, molde y totales. */
const cuadroDePartidas = (): Array<Array<string>> => [
  ["Partida", "Concepto", "Cantidad", "Precio unitario", "Costo"],
  ["", "", "", "", ""],
  ["", "", "", "Subtotal:", "$ 45,000.00 MXN"],
  ["", "", "", "IVA:", "$ 7,200.00 MXN"],
  ["", "", "", "Total:", "$ 52,200.00 MXN"],
];

const plantillaCompleta = () =>
  new ArmaDocumento()
    .parrafo("{{CLIENTE}}")
    .parrafo("{{CONTACTO}}")
    .parrafo("{{DIRECCION_1}}")
    .parrafo("{{DIRECCION_2}}")
    .parrafo("{{TELEFONO}}")
    .parrafo("{{EMAIL}}")
    .parrafo("{{FOLIO}} · {{FECHA}} · {{TITULO}}")
    .parrafo("{{PAGO}} {{ENTREGA}} {{LUGAR}} {{VIGENCIA}}")
    .tabla(cuadroDePartidas())
    .construir();

const entorno = (plantilla = plantillaCompleta(), anteriores: string[] = []) => {
  const documentos = documentosFalso(plantilla);
  return {
    documentos,
    entorno: {
      documentos,
      plantillaId: "doc-plantilla",
      carpetaId: "carpeta-450",
      anteriores,
      hoy: () => new Date(2026, 10, 3),
    },
  };
};

describe("nombreDelDocumento", () => {
  it("es «<folio> <titulo>», con espacio", () => {
    expect(nombreDelDocumento({ numero: 68, anio: 2026, version: 0, titulo: "Mantenimiento" })).toBe(
      "PCOTOP-068-2026 Mantenimiento",
    );
  });

  // El folio sale de (numero, anio, version), no de la columna: la recarga de
  // 2026 metió 75 con "-v1" y nombrar un archivo con eso enseña una
  // convención muerta.
  it("la versión va con guion y número, nunca «v1»", () => {
    expect(nombreDelDocumento({ numero: 68, anio: 2026, version: 1, titulo: "X" })).toBe(
      "PCOTOP-068-2026-1 X",
    );
  });

  it("el guion bajo del título se convierte en « - », como dentro del documento", () => {
    expect(
      nombreDelDocumento({ numero: 1, anio: 2026, version: 0, titulo: "Servicio_Planta Norte" }),
    ).toBe("PCOTOP-001-2026 Servicio - Planta Norte");
  });

  it("sin título no deja un espacio colgando", () => {
    expect(nombreDelDocumento({ numero: 1, anio: 2026, version: 0, titulo: "" })).toBe(
      "PCOTOP-001-2026",
    );
  });

  /**
   * El archivo se llama como la portada. No es cosmético: por el nombre se
   * busca el PDF cuando no hay id guardado.
   */
  it("lleva la razón social cuando el título no la trae", () => {
    expect(
      nombreDelDocumento({
        numero: 450,
        anio: 2026,
        version: 0,
        titulo: "Mantenimiento Preventivo de Subestaciones",
        cliente: "IGSA S.A.P.I de C.V.",
      }),
    ).toBe("PCOTOP-450-2026 Mantenimiento Preventivo de Subestaciones - IGSA S.A.P.I de C.V.");
  });

  it("con guion bajo no la repite: el título ya la trae", () => {
    expect(
      nombreDelDocumento({
        numero: 1,
        anio: 2026,
        version: 0,
        titulo: "Servicio_Planta Norte",
        cliente: "Planta Norte",
      }),
    ).toBe("PCOTOP-001-2026 Servicio - Planta Norte");
  });

  // El folio de la v0 es prefijo del de todas sus versiones: comparar por
  // prefijo apartaría el documento de otra versión de la misma cotización.
  it("esVersionAnterior compara exacto, no por prefijo", () => {
    const esperado = "PCOTOP-068-2026 Mantenimiento";
    expect(esVersionAnterior(esperado, esperado)).toBe(true);
    expect(esVersionAnterior(`${esperado}.pdf`, esperado)).toBe(true);
    expect(esVersionAnterior("PCOTOP-068-2026-1 Mantenimiento", esperado)).toBe(false);
  });
});

describe("solicitudesDelDocumento", () => {
  it("primero quita los renglones y después sustituye", () => {
    const doc = plantillaCompleta();
    const { solicitudes } = solicitudesDelDocumento(doc, datos(), "2026-10-05");
    const primeraSustitucion = solicitudes.findIndex((s) => "replaceAllText" in s);
    const ultimoBorrado = solicitudes.map((s) => "deleteContentRange" in s).lastIndexOf(true);
    expect(ultimoBorrado).toBeLessThan(primeraSustitucion);
  });

  it("avisa de los marcadores que la plantilla no trae", () => {
    const doc = new ArmaDocumento().parrafo("Solo {{CLIENTE}}").construir();
    const { avisos } = solicitudesDelDocumento(doc, datos(), "2026-10-05");
    expect(avisos.join(" ")).toContain("{{FOLIO}}");
    expect(avisos.join(" ")).toContain("{{CONTACTO}}");
  });

  /**
   * Todo se calcula sobre el JSON original. Si un borrado de arriba se
   * aplicara antes que algo de abajo, correría sus índices y el lote
   * escribiría en el lugar equivocado — sin fallar.
   */
  it("lo de abajo del documento va antes que lo de arriba", () => {
    const doc = plantillaCompleta();
    const d = datos({
      documento: { ...documentoVacio(), fecha: "2026-10-05", ocultar: { telefono: true } },
    });
    const { solicitudes } = solicitudesDelDocumento(doc, d, "2026-10-05");

    const indices = solicitudes.flatMap((s) =>
      "insertText" in s
        ? [s.insertText.location.index]
        : "deleteContentRange" in s
          ? [s.deleteContentRange.range.startIndex]
          : [],
    );
    expect(indices.length).toBeGreaterThan(1);
    expect(indices).toEqual([...indices].sort((a, b) => b - a));
  });

  it("las sustituciones van al final: cambian longitudes en todo el documento", () => {
    const doc = plantillaCompleta();
    const { solicitudes } = solicitudesDelDocumento(doc, datos(), "2026-10-05");
    const primeraSustitucion = solicitudes.findIndex((s) => "replaceAllText" in s);
    expect(primeraSustitucion).toBeGreaterThan(-1);
    expect(solicitudes.slice(primeraSustitucion).every((s) => "replaceAllText" in s)).toBe(true);
  });

  it("junta los huecos del contacto con los marcadores faltantes", () => {
    const doc = plantillaCompleta();
    const { avisos } = solicitudesDelDocumento(doc, datos(), "2026-10-05");
    // El contacto viene vacío: sale ⟨falta⟩ y se avisa.
    expect(avisos.join(" ")).toContain("el nombre del contacto");
  });
});

/**
 * Una plantilla que trae **todo** lo que lleva formato: un renglón en rojo,
 * los Términos con su renglón en blanco antes, y el cuadro.
 */
const plantillaConFormato = () =>
  new ArmaDocumento()
    .parrafoRojo("{{CLIENTE}}")
    .parrafo("{{TELEFONO}}")
    .parrafo("{{FOLIO}} · {{FECHA}} · {{TITULO}}")
    .tabla(cuadroDePartidas())
    .parrafo("")
    .parrafo("Términos y Condiciones Comerciales")
    .construir();

const deFormato = (tramos: Tramo[]) => tramos.filter((t) => t.parte.grupo === "formato");
const deContenido = (tramos: Tramo[]) => tramos.filter((t) => t.parte.grupo === "contenido");

describe("solicitudesDelDocumento · contenido y formato", () => {
  const armadas = () =>
    solicitudesDelDocumento(
      plantillaConFormato(),
      datos({ armado: armadoCon(2), calculo: calculoCon(2) }),
      "2026-10-05",
    );

  it("los tramos son las mismas solicitudes que el lote, en el mismo orden", () => {
    const { solicitudes, tramos } = armadas();
    expect(tramos.flatMap((t) => t.solicitudes)).toEqual(solicitudes);
  });

  it("el formato son seis partes: negro, salto, filas, encabezado, bordes y celda unida", () => {
    const partes = new Set(deFormato(armadas().tramos).map((t) => t.parte));
    expect(partes).toEqual(
      new Set([
        PARTES.negro,
        PARTES.salto,
        PARTES.filasEnteras,
        PARTES.encabezadoFijo,
        PARTES.bordes,
        PARTES.celdaUnida,
      ]),
    );
  });

  /**
   * Lo que permite reintentar sin el formato: si alguna solicitud de formato
   * insertara o borrara texto, quitarla correría los índices del contenido y
   * el reintento escribiría en el lugar equivocado — sin fallar.
   */
  it("ninguna solicitud de formato inserta ni borra texto", () => {
    const tipos = new Set(
      deFormato(armadas().tramos).flatMap((t) => t.solicitudes.map((s) => Object.keys(s)[0])),
    );
    const deEstilo = [
      "updateTextStyle",
      "updateParagraphStyle",
      "updateTableRowStyle",
      "pinTableHeaderRows",
      "updateTableCellStyle",
      // Reorganiza la tabla, pero es lo último que la toca (`tabla.test.ts`).
      "mergeTableCells",
    ];
    for (const tipo of tipos) expect(deEstilo).toContain(tipo);
  });

  /** Unir la celda reorganiza la tabla: nada que use índices puede ir detrás. */
  it("después de unir la celda de la letra, nada toca la tabla", () => {
    // Con un renglón del destinatario que quitar, para que haya algo detrás.
    const { solicitudes } = solicitudesDelDocumento(
      plantillaConFormato(),
      datos({
        documento: { ...documentoVacio(), fecha: "2026-10-05", ocultar: { telefono: true } },
      }),
      "2026-10-05",
    );
    const union = solicitudes.findIndex((s) => "mergeTableCells" in s);
    expect(union).toBeGreaterThan(-1);
    const inicioTabla = plantillaConFormato().body!.content!.find((e) => e.table)!.startIndex!;
    const indices = solicitudes.slice(union + 1).flatMap((s) =>
      "insertText" in s
        ? [s.insertText.location.index]
        : "deleteContentRange" in s
          ? [s.deleteContentRange.range.startIndex]
          : [],
    );
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.every((i) => i < inicioTabla)).toBe(true);
  });
});

describe("generarDocumento · si Google rechaza el lote", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const conRechazo = (rechaza: OpcionesDelFalso["rechaza"]) => {
    const documentos = documentosFalso(plantillaConFormato(), { rechaza });
    return {
      documentos,
      entorno: { documentos, plantillaId: "doc-plantilla", carpetaId: "carpeta-450" },
    };
  };

  it("si todo entra, un solo intento y ningún aviso de formato", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const { documentos, entorno: e } = conRechazo(undefined);

    const r = await generarDocumento(datos(), e);

    expect(documentos.intentos).toHaveLength(1);
    expect(r.avisos.join(" ")).not.toContain("sin formato");
    expect(consola).not.toHaveBeenCalled();
  });

  it("si rechaza el formato, el documento sale con todo el contenido y un aviso", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const { documentos, entorno: e } = conRechazo({
      si: (s) => "pinTableHeaderRows" in s,
      motivo: "Unknown name pinTableHeaderRows",
    });

    const r = await generarDocumento(datos(), e);

    // Dos intentos: el completo y el de solo contenido, que es el que entró.
    expect(documentos.intentos).toHaveLength(2);
    expect(documentos.aplicadas).toHaveLength(1);
    const esperado = deContenido(
      solicitudesDelDocumento(plantillaConFormato(), datos(), "2026-10-05").tramos,
    ).flatMap((t) => t.solicitudes);
    expect(documentos.aplicadas[0].solicitudes).toEqual(esperado);
    expect(r.solicitudes).toBe(esperado.length);

    // Sale, y no se aparta.
    expect(documentos.exportados).toEqual(["copia-1"]);
    expect(documentos.papelera).toEqual([]);

    // Qué se rechazó y por qué, primero; después, qué le falta al documento.
    expect(r.avisos[0]).toContain("Google rechazó el encabezado fijo de la tabla");
    expect(r.avisos[0]).toContain("Unknown name pinTableHeaderRows");
    expect(r.avisos).toContain("El encabezado de la tabla no se repetirá entre páginas.");
    expect(r.avisos).toContain("El texto que la plantilla marca en rojo sale en rojo.");
    expect(r.avisos).toContain("Los Términos no empiezan en hoja nueva.");

    // Y queda en la consola del servidor, con el mensaje de la API.
    expect(consola).toHaveBeenCalledWith(
      expect.stringContaining("[cotizador/documento]"),
      expect.objectContaining({
        docId: "copia-1",
        mensaje: expect.stringContaining("Unknown name pinTableHeaderRows"),
      }),
    );
  });

  /**
   * El error nombra la parte con el índice del **segundo** rechazo, que es de
   * la lista sin formato. Con el rojo al principio, los dos índices no
   * coinciden: usar el del primero nombraría el color negro.
   */
  it("si rechaza también el contenido, no sale y el error dice qué parte", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { documentos, entorno: e } = conRechazo({
      si: (s) => "deleteTableRow" in s,
      motivo: "Invalid table row index",
    });

    const fallo = generarDocumento(datos(), e);
    await expect(fallo).rejects.toThrow("Google rechazó la tabla de partidas");
    await expect(fallo).rejects.toThrow("Invalid table row index");

    expect(documentos.intentos).toHaveLength(2);
    expect(documentos.aplicadas).toEqual([]);
    expect(documentos.exportados).toEqual([]);
    // La copia a medio llenar no se queda con el nombre bueno.
    expect(documentos.papelera).toEqual(["copia-1"]);
  });

  /**
   * Un fallo de red no dice nada del formato. Reintentarlo sin él sacaría un
   * documento sin formato que habría salido completo al volver a dar al botón.
   */
  it("un fallo que no es un rechazo no se reintenta", async () => {
    const documentos = documentosFalso(plantillaConFormato(), {
      fallaAlAplicar: new Error("socket hang up"),
    });
    await expect(
      generarDocumento(datos(), { documentos, plantillaId: "doc-plantilla", carpetaId: "c" }),
    ).rejects.toThrow("socket hang up");
    expect(documentos.intentos).toHaveLength(1);
  });
});

describe("generarDocumento", () => {
  it("copia, aplica en UN solo lote y exporta", async () => {
    const { documentos, entorno: e } = entorno();
    const r = await generarDocumento(datos(), e);

    expect(documentos.copiados).toEqual([
      {
        plantillaId: "doc-plantilla",
        nombre: "PCOTOP-001-2026 Servicio de Mantenimiento - Minera Sur",
        carpetaId: "carpeta-450",
        id: "copia-1",
      },
    ]);
    // En uno solo: si una falla, no queda un documento a medio llenar.
    expect(documentos.aplicadas).toHaveLength(1);
    expect(documentos.aplicadas[0].id).toBe("copia-1");
    expect(documentos.exportados).toEqual(["copia-1"]);
    expect(r.docId).toBe("copia-1");
    expect(r.pdf.nombre).toBe("PCOTOP-001-2026 Servicio de Mantenimiento - Minera Sur.pdf");
  });

  it("no escribe en la base: devuelve la fecha para que la guarde quien llame", async () => {
    const { entorno: e } = entorno();
    const r = await generarDocumento(datos(), e);
    expect(r).toMatchObject({ fecha: "2026-10-05", fechaEsNueva: false });
  });

  // Dos PDF del mismo folio con fechas distintas y ninguna la buena.
  it("sin fecha guardada toma la de hoy y avisa que hay que guardarla", async () => {
    const { entorno: e } = entorno();
    const r = await generarDocumento(datos({ documento: documentoVacio() }), e);
    expect(r).toMatchObject({ fecha: "2026-11-03", fechaEsNueva: true });
  });

  /** Lo anterior se aparta DESPUÉS de tener lo nuevo. */
  it("aparta los anteriores al final, no antes", async () => {
    const { documentos, entorno: e } = entorno(plantillaCompleta(), []);
    documentos.sembrar("doc-viejo", new ArmaDocumento().parrafo("x").construir());
    documentos.sembrar("pdf-viejo", new ArmaDocumento().parrafo("x").construir());

    await generarDocumento(datos(), { ...e, anteriores: ["doc-viejo", "pdf-viejo"] });

    expect(documentos.papelera).toEqual(["doc-viejo", "pdf-viejo"]);
    // Se exportó antes de apartar: lo nuevo ya existía.
    expect(documentos.exportados).toHaveLength(1);
  });

  it("no se aparta a sí mismo aunque venga en la lista", async () => {
    const { documentos, entorno: e } = entorno();
    await generarDocumento(datos(), { ...e, anteriores: ["copia-1", null, undefined] });
    expect(documentos.papelera).toEqual([]);
  });

  /**
   * La copia a medio llenar no se queda con el nombre bueno: la siguiente
   * corrida crearía una segunda y nadie sabría cuál es la buena.
   */
  it("si algo falla, la copia a medio llenar se va a la papelera", async () => {
    const plantilla = plantillaCompleta();
    const documentos = documentosFalso(plantilla, { fallaAlAplicar: new Error("Docs dijo que no") });
    const e = {
      documentos,
      plantillaId: "doc-plantilla",
      carpetaId: "carpeta-450",
      anteriores: ["doc-viejo"],
    };

    await expect(generarDocumento(datos(), e)).rejects.toThrow("Docs dijo que no");
    expect(documentos.papelera).toEqual(["copia-1"]);
    // Y lo anterior NO se tocó.
    expect(documentos.papelera).not.toContain("doc-viejo");
  });

  it("una cotización sin partidas no genera nada", async () => {
    const { documentos, entorno: e } = entorno();
    await expect(
      generarDocumento(datos({ armado: armadoCon(0), calculo: calculoCon(0) }), e),
    ).rejects.toThrow("no tiene partidas");
    expect(documentos.copiados).toEqual([]);
  });

  // Apartar lo viejo es lo último y lo menos importante: si falla, lo nuevo ya
  // existe y vale más entregarlo con un aviso que perderlo.
  it("si no se puede apartar el anterior, avisa y el documento nuevo se queda", async () => {
    const plantilla = plantillaCompleta();
    const documentos = documentosFalso(plantilla, { fallaAlApartar: "doc-viejo" });
    documentos.sembrar("doc-viejo", new ArmaDocumento().parrafo("x").construir());

    const r = await generarDocumento(datos(), {
      documentos,
      plantillaId: "doc-plantilla",
      carpetaId: "carpeta-450",
      anteriores: ["doc-viejo"],
    });

    expect(r.docId).toBe("copia-1");
    expect(r.avisos.join(" ")).toContain("papelera el documento anterior");
    expect(documentos.papelera).toEqual([]);
  });
});


// ── La moneda, dentro del lote entero ─────────────────────────────────────────

describe("la moneda de los Términos", () => {
  /** Como la plantilla real: los Términos van DESPUÉS del cuadro. */
  const conTerminos = () =>
    new ArmaDocumento()
      .parrafo("{{CLIENTE}}")
      .parrafo("{{CONTACTO}}")
      .tabla(cuadroDePartidas())
      .parrafo("Términos y Condiciones Comerciales")
      .corridas([
        { texto: "Nuestros precios son firmes en " },
        { texto: "Moneda Nacional", negrita: true },
      ])
      .construir();

  const enMoneda = (moneda: "MXN" | "USD") =>
    solicitudesDelDocumento(
      conTerminos(),
      datos({ armado: { ...armadoCon(1), moneda } as Armado }),
      "2026-10-05",
    ).solicitudes;

  it("en pesos el renglón no se toca", () => {
    expect(enMoneda("MXN").some((s) => "insertText" in s && s.insertText.text === "Dólares Americanos")).toBe(false);
  });

  it("en dólares, sí", () => {
    expect(enMoneda("USD").some((s) => "insertText" in s && s.insertText.text === "Dólares Americanos")).toBe(true);
  });

  /**
   * Todo lo que mueve índices se emite de abajo hacia arriba, y los Términos
   * son lo más abajo que se toca: su borrado tiene que ser el PRIMERO del
   * lote que corre un índice. Al revés, el cuadro movería el renglón de la
   * moneda y se borrarían quince caracteres de otro sitio.
   */
  it("va antes que todo lo que mueve índices, porque está más abajo", () => {
    const solicitudes = enMoneda("USD");
    const mueve = (s: (typeof solicitudes)[number]) =>
      "insertText" in s || "deleteContentRange" in s;
    const primero = solicitudes.findIndex(mueve);
    expect(solicitudes[primero]).toHaveProperty("deleteContentRange");
    expect(solicitudes[primero + 1]).toMatchObject({ insertText: { text: "Dólares Americanos" } });
  });

  /**
   * Las tres solicitudes son contenido, negritas incluidas: si Google rechaza
   * el formato, el reintento sigue diciendo dólares, y en negritas.
   */
  it("es contenido entera: el reintento sin formato también la cambia", () => {
    const { tramos } = solicitudesDelDocumento(
      conTerminos(),
      datos({ armado: { ...armadoCon(1), moneda: "USD" } as Armado }),
      "2026-10-05",
    );
    const deMoneda = tramos.filter((t) => t.parte === PARTES.moneda);

    expect(PARTES.moneda.grupo).toBe("contenido");
    expect(deMoneda.flatMap((t) => t.solicitudes).map((s) => Object.keys(s)[0])).toEqual([
      "deleteContentRange",
      "insertText",
      "updateTextStyle",
    ]);
  });
});
