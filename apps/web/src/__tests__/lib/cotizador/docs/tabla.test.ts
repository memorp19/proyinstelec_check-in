import { describe, it, expect } from "vitest";
import {
  bordesDeLaTabla,
  solicitudesDeTabla,
  type DatosDeTabla,
  type PartidaDeTabla,
} from "@/src/lib/cotizador/docs/tabla";
import type { SolicitudEstiloFila } from "@/src/lib/cotizador/docs/tipos";
import { TablaSimulada } from "../../../helpers/tabla-simulada";

/**
 * Todos los datos son inventados. La plantilla real y las cotizaciones reales
 * no entran al repositorio.
 */

const partida = (sobre: Partial<PartidaDeTabla> = {}): PartidaDeTabla => ({
  numero: 1,
  titulo: "Mantenimiento a transformador",
  formato: "NORMAL",
  bloques: [],
  cantidad: 2,
  unidad: "servicio",
  precioUnitario: 1000,
  importe: 2000,
  ...sobre,
});

const datos = (sobre: Partial<DatosDeTabla> = {}): DatosDeTabla => ({
  partidas: [partida()],
  totales: { moneda: "MXN", subtotal: 2000, iva: 320, total: 2320 },
  ...sobre,
});

/** Arma la tabla y la aplica, que es la única forma de ver si los índices cuadran. */
function armarYAplicar(d: DatosDeTabla, enBlanco = 22) {
  const simulada = TablaSimulada.comoLaPlantilla(3043, enBlanco);
  const r = solicitudesDeTabla(simulada.comoDocumento(), d);
  simulada.aplicar(r.solicitudes);
  return { ...r, tabla: simulada };
}

describe("solicitudesDeTabla · las filas", () => {
  it("deja el encabezado, una fila por partida y tres de totales", () => {
    const { tabla } = armarYAplicar(datos({ partidas: [partida(), partida({ numero: 2 })] }));
    expect(tabla.numeroDeFilas).toBe(1 + 2 + 3);
    expect(tabla.texto(0, 0)).toBe("Partida");
  });

  /**
   * `deleteTableRow` corre los índices de fila posteriores. De arriba hacia
   * abajo, el segundo borrado se llevaría la fila equivocada.
   */
  it("borra las filas de abajo hacia arriba", () => {
    const { solicitudes } = armarYAplicar(datos());
    const borradas = solicitudes
      .filter((s) => "deleteTableRow" in s)
      .map((s) => (s as { deleteTableRow: { tableCellLocation: { rowIndex: number } } }).deleteTableRow.tableCellLocation.rowIndex);
    expect(borradas).toEqual([...borradas].sort((a, b) => b - a));
    expect(borradas.at(-1)).toBe(2); // la 1 se conserva: es el molde
  });

  it("conserva la fila 1, que es el molde del cuadro hecho a mano", () => {
    const { solicitudes } = armarYAplicar(datos());
    const borradas = solicitudes
      .filter((s) => "deleteTableRow" in s)
      .map((s) => (s as { deleteTableRow: { tableCellLocation: { rowIndex: number } } }).deleteTableRow.tableCellLocation.rowIndex);
    expect(borradas).not.toContain(1);
    expect(borradas).not.toContain(0);
  });

  /** Una cotización con más partidas que renglones trae la plantilla. */
  it("inserta filas cuando no alcanzan las de la plantilla", () => {
    const muchas = Array.from({ length: 30 }, (_, i) => partida({ numero: i + 1 }));
    const { tabla } = armarYAplicar(datos({ partidas: muchas }));
    expect(tabla.numeroDeFilas).toBe(1 + 30 + 3);
    expect(tabla.texto(30, 0)).toBe("30");
  });

  it("todas las filas de totales se emiten aunque no haya partidas", () => {
    const { tabla, avisos } = armarYAplicar(datos({ partidas: [] }));
    expect(tabla.numeroDeFilas).toBe(1 + 3);
    expect(avisos.join(" ")).toContain("no tiene partidas");
  });
});

describe("solicitudesDeTabla · lo que queda escrito", () => {
  it("cada partida cae en su fila y en su columna", () => {
    const { tabla } = armarYAplicar(
      datos({
        partidas: [
          partida({ numero: 1, titulo: "Primera", cantidad: 2, precioUnitario: 1000, importe: 2000 }),
          partida({ numero: 2, titulo: "Segunda", cantidad: 1, precioUnitario: 500, importe: 500 }),
        ],
        totales: { moneda: "MXN", subtotal: 2500, iva: 400, total: 2900 },
      }),
    );

    expect(tabla.texto(1, 0)).toBe("1");
    expect(tabla.texto(1, 1)).toBe("Primera");
    expect(tabla.texto(1, 2)).toBe("2 Servicios");
    expect(tabla.texto(1, 3)).toBe("$ 1,000.00 MXN");
    expect(tabla.texto(1, 4)).toBe("$ 2,000.00 MXN");

    expect(tabla.texto(2, 0)).toBe("2");
    expect(tabla.texto(2, 1)).toBe("Segunda");
    expect(tabla.texto(2, 2)).toBe("1 Servicio");
  });

  it("los bloques del concepto salen en orden, uno por párrafo", () => {
    const { tabla } = armarYAplicar(
      datos({
        partidas: [
          partida({
            titulo: "Tablero",
            bloques: [
              { tipo: "texto", texto: "Incluye:" },
              { tipo: "vineta", texto: "Limpieza general" },
              { tipo: "subvineta", texto: "Tensión" },
              { tipo: "vineta", texto: "Pruebas eléctricas" },
            ],
          }),
        ],
      }),
    );

    expect(tabla.texto(1, 1)).toBe(
      ["Tablero", "Incluye:", "-   Limpieza general", "      -   Tensión", "-   Pruebas eléctricas"].join("\n"),
    );
  });

  it("una viñeta sin texto no sale", () => {
    const { tabla } = armarYAplicar(
      datos({
        partidas: [
          partida({ titulo: "X", bloques: [{ tipo: "vineta", texto: "  " }, { tipo: "vineta", texto: "Sí" }] }),
        ],
      }),
    );
    expect(tabla.texto(1, 1)).toBe("X\n-   Sí");
  });

  it("el formato OCULTO quita el título y deja los bloques", () => {
    const { tabla } = armarYAplicar(
      datos({
        partidas: [
          partida({ titulo: "No debe salir", formato: "OCULTO", bloques: [{ tipo: "texto", texto: "Solo esto" }] }),
        ],
      }),
    );
    expect(tabla.texto(1, 1)).toBe("Solo esto");
  });

  it("el renglón de encabezado va arriba y sin número", () => {
    const { tabla } = armarYAplicar(
      datos({
        encabezado: [
          { tipo: "texto", texto: "Servicio de Mantenimiento Preventivo" },
          { tipo: "texto", texto: "Incluye:" },
        ],
      }),
    );
    expect(tabla.texto(1, 0)).toBe("");
    expect(tabla.texto(1, 1)).toBe("Servicio de Mantenimiento Preventivo\nIncluye:");
    expect(tabla.texto(2, 0)).toBe("1");
  });

  it("un encabezado vacío no gasta un renglón", () => {
    const { tabla } = armarYAplicar(datos({ encabezado: [{ tipo: "espacio", texto: "" }] }));
    expect(tabla.texto(1, 0)).toBe("1");
  });
});

describe("solicitudesDeTabla · los totales y la letra", () => {
  it("Subtotal, IVA y Total en las columnas 3 y 4", () => {
    const { tabla } = armarYAplicar(
      datos({ totales: { moneda: "MXN", subtotal: 159179, iva: 25468.64, total: 184647.64 } }),
    );
    const base = tabla.numeroDeFilas - 3;

    expect(tabla.texto(base, 3)).toBe("Subtotal:");
    expect(tabla.texto(base, 4)).toBe("$ 159,179.00 MXN");
    expect(tabla.texto(base + 1, 3)).toBe("IVA:");
    expect(tabla.texto(base + 1, 4)).toBe("$ 25,468.64 MXN");
    expect(tabla.texto(base + 2, 3)).toBe("Total:");
    expect(tabla.texto(base + 2, 4)).toBe("$ 184,647.64 MXN");
  });

  /**
   * Al unir, Docs junta el contenido de las celdas en orden: en la tercera
   * columna de la tercera fila la letra queda abajo, a la altura de "Total".
   */
  it("la letra va en la tercera columna de la fila del Total", () => {
    const { tabla } = armarYAplicar(
      datos({ totales: { moneda: "MXN", subtotal: 159179, iva: 25468.64, total: 184647.64 } }),
    );
    const total = tabla.numeroDeFilas - 1;
    expect(tabla.texto(total, 2)).toBe(
      "CIENTO OCHENTA Y CUATRO MIL SEISCIENTOS CUARENTA Y SIETE PESOS 64/100 M.N.",
    );
    expect(tabla.texto(total - 1, 2)).toBe("");
  });

  /**
   * En nuestro motor la asesoría ya va dentro del precio de cada partida, así
   * que el subtotal que entra es la base gravable. El ERP viejo la llevaba
   * aparte y la sumaba al imprimir; sumarla aquí la contaría dos veces.
   */
  it("imprime el subtotal tal cual, sin volver a sumar la asesoría", () => {
    const { tabla } = armarYAplicar(
      datos({ totales: { moneda: "MXN", subtotal: 1046113, iva: 167378.08, total: 1213491.08 } }),
    );
    const base = tabla.numeroDeFilas - 3;
    expect(tabla.texto(base, 4)).toBe("$ 1,046,113.00 MXN");
    // Y el IVA es el 16 % de ese subtotal, no de otro número.
    expect(1046113 * 0.16).toBeCloseTo(167378.08, 2);
  });

  it("los importes salen en la moneda de la cotización", () => {
    const { tabla } = armarYAplicar(
      datos({
        partidas: [partida({ precioUnitario: 1200, importe: 1200, cantidad: 1 })],
        totales: { moneda: "USD", subtotal: 1200, iva: 192, total: 1392 },
      }),
    );
    expect(tabla.texto(1, 3)).toBe("$ 1,200.00 USD");
    expect(tabla.texto(tabla.numeroDeFilas - 1, 4)).toBe("$ 1,392.00 USD");
  });
});

describe("solicitudesDeTabla · el orden del lote", () => {
  it("primero las filas, después los textos", () => {
    const { solicitudes } = armarYAplicar(datos());
    const ultimaFila = solicitudes
      .map((s) => "deleteTableRow" in s || "insertTableRow" in s)
      .lastIndexOf(true);
    const primerTexto = solicitudes.findIndex((s) => "insertText" in s);
    expect(ultimaFila).toBeLessThan(primerTexto);
  });

  /**
   * `insertText` corre los índices posteriores. De la última celda a la
   * primera, cada inserción cae en una posición que lo ya insertado no movió.
   */
  it("los textos se insertan de atrás hacia adelante", () => {
    const { solicitudes } = armarYAplicar(
      datos({ partidas: [partida(), partida({ numero: 2 }), partida({ numero: 3 })] }),
    );
    const indices = solicitudes
      .filter((s) => "insertText" in s)
      .map((s) => (s as { insertText: { location: { index: number } } }).insertText.location.index);
    expect(indices).toEqual([...indices].sort((a, b) => b - a));
  });

  /**
   * La copia de la plantilla trae una viñeta molde en la celda Concepto del
   * renglón 1. Un párrafo nuevo hereda la viñeta de aquel en el que se
   * inserta: sin quitarlas, el título saldría con viñeta y las viñetas con
   * dos guiones.
   */
  it("quita las viñetas heredadas de todo el cuerpo de la tabla", () => {
    const { solicitudes, tabla } = armarYAplicar(
      datos({ partidas: [partida(), partida({ numero: 2 })] }),
    );
    const quitar = solicitudes.find((s) => "deleteParagraphBullets" in s);
    expect(quitar).toBeDefined();

    const rango = (quitar as { deleteParagraphBullets: { range: { startIndex: number; endIndex: number } } })
      .deleteParagraphBullets.range;
    // Desde el primer renglón de partidas hasta el final del cuadro: el
    // encabezado no se toca.
    expect(rango.startIndex).toBe(tabla.inicioDeFila(1));
    expect(rango.endIndex).toBe(tabla.inicioDeFila(tabla.numeroDeFilas));
  });

  it("los estilos van después de todo lo que cambia longitudes", () => {
    const { solicitudes } = armarYAplicar(datos());
    const ultimoTexto = solicitudes.map((s) => "insertText" in s).lastIndexOf(true);
    const primerEstilo = solicitudes.findIndex(
      (s) => "updateTextStyle" in s || "updateParagraphStyle" in s,
    );
    expect(ultimoTexto).toBeLessThan(primerEstilo);
  });

  /** Después de unir, las columnas de esas filas ya no son las mismas. */
  it("unir celdas es lo último", () => {
    const { solicitudes } = armarYAplicar(datos());
    const union = solicitudes.findIndex((s) => "mergeTableCells" in s);
    expect(union).toBeGreaterThan(-1);
    const despues = solicitudes.slice(union + 1);
    expect(despues.every((s) => "updateTableCellStyle" in s)).toBe(true);
  });

  it("las solicitudes de celda apuntan a donde empieza la tabla en la plantilla", () => {
    const { solicitudes } = armarYAplicar(datos());
    const inicios = solicitudes.flatMap((s) =>
      "mergeTableCells" in s
        ? [s.mergeTableCells.tableRange.tableCellLocation.tableStartLocation.index]
        : "updateTableCellStyle" in s
          ? [s.updateTableCellStyle.tableRange.tableCellLocation.tableStartLocation.index]
          : [],
    );
    expect(inicios.length).toBeGreaterThan(0);
    expect(new Set(inicios)).toEqual(new Set([3043]));
  });
});

describe("bordesDeLaTabla", () => {
  it("une las tres primeras columnas de los tres renglones de totales", () => {
    const union = bordesDeLaTabla(100, 4).find((s) => "mergeTableCells" in s);
    expect(union).toEqual({
      mergeTableCells: {
        tableRange: {
          tableCellLocation: { tableStartLocation: { index: 100 }, rowIndex: 5, columnIndex: 0 },
          rowSpan: 3,
          columnSpan: 3,
        },
      },
    });
  });

  it("con una sola partida no quita líneas entre partidas", () => {
    const campos = bordesDeLaTabla(100, 1)
      .filter((s) => "updateTableCellStyle" in s)
      .map((s) => (s as { updateTableCellStyle: { fields: string } }).updateTableCellStyle.fields);
    expect(campos).not.toContain("borderBottom");
    expect(campos).not.toContain("borderTop");
  });

  it("el encabezado conserva sus líneas verticales", () => {
    const rangos = bordesDeLaTabla(100, 4)
      .filter((s) => "updateTableCellStyle" in s)
      .map((s) => (s as { updateTableCellStyle: { tableRange: { tableCellLocation: { rowIndex: number } } } }).updateTableCellStyle.tableRange.tableCellLocation.rowIndex);
    expect(rangos.every((r) => r >= 1)).toBe(true);
  });
});

describe("solicitudesDeTabla · plantillas que no son la esperada", () => {
  it("sin tabla de partidas avisa y no emite nada", () => {
    const doc = { body: { content: [] } };
    const r = solicitudesDeTabla(doc, datos());
    expect(r.solicitudes).toEqual([]);
    expect(r.avisos.join(" ")).toContain("no trae la tabla de partidas");
  });

  it("sin renglón de ejemplo avisa en vez de inventarse el formato", () => {
    const simulada = TablaSimulada.comoLaPlantilla(3043, 22);
    simulada.filas = [simulada.filas[0]];
    const r = solicitudesDeTabla(simulada.comoDocumento(), datos());
    expect(r.solicitudes).toEqual([]);
    expect(r.avisos.join(" ")).toContain("renglón de ejemplo");
  });
});

describe("solicitudesDeTabla · que la tabla se lea al partirse", () => {
  const estilosDeFila = (d: DatosDeTabla) =>
    armarYAplicar(d).solicitudes.filter(
      (s): s is SolicitudEstiloFila => "updateTableRowStyle" in s,
    );

  /**
   * El encabezado que se repite no se pide desde aquí: la API contesta
   * `Unallowed field: tableHeader`. Se deja puesto en la plantilla. Esta
   * prueba fija que no se vuelva a intentar, porque el lote entero falla.
   */
  it("no intenta marcar el encabezado, que la API no deja", () => {
    const campos = estilosDeFila(datos()).map((s) => s.updateTableRowStyle.fields);
    expect(campos.join(" ")).not.toContain("tableHeader");
  });

  /** Una partida con quince viñetas salta entera, no se corta por la mitad. */
  it("ninguna fila se parte entre páginas", () => {
    const todas = estilosDeFila(datos()).find((s) =>
      s.updateTableRowStyle.tableRowStyle.preventOverflow,
    );
    expect(todas).toBeDefined();
    // Sin `rowIndices` la API lo aplica a todas, que es lo que se quiere.
    expect(todas?.updateTableRowStyle.rowIndices).toBeUndefined();
  });

  /** Hablan de filas, no de índices: da igual cuánto texto tenga dentro. */
  it("van antes de unir, que es lo que cambia las columnas", () => {
    const solicitudes = armarYAplicar(datos()).solicitudes;
    const union = solicitudes.findIndex((s) => "mergeTableCells" in s);
    const ultimoEstilo = solicitudes.map((s) => "updateTableRowStyle" in s).lastIndexOf(true);
    expect(ultimoEstilo).toBeLessThan(union);
  });
});

describe("solicitudesDeTabla · los totales, como en los documentos reales", () => {
  it("ni el Total ni la letra llevan negritas", () => {
    const { solicitudes } = armarYAplicar(datos());
    const negritas = solicitudes.filter(
      (s) => "updateTextStyle" in s && (s as { updateTextStyle: { textStyle: { bold?: boolean } } }).updateTextStyle.textStyle.bold,
    );
    // La única negrita que queda es la del título de la partida si lo pide su
    // formato; con `NORMAL` no hay ninguna.
    expect(negritas).toEqual([]);
  });

  it("el título de la partida sigue pudiendo ir en negritas", () => {
    const { solicitudes } = armarYAplicar(datos({ partidas: [partida({ formato: "NEGRITAS" })] }));
    const negritas = solicitudes.filter(
      (s) => "updateTextStyle" in s && (s as { updateTextStyle: { textStyle: { bold?: boolean } } }).updateTextStyle.textStyle.bold,
    );
    expect(negritas).toHaveLength(1);
  });

  /**
   * Abajo y no en medio: así la letra queda a la altura del renglón del Total
   * y no flotando entre Subtotal e IVA.
   */
  it("la celda de la letra se alinea abajo", () => {
    const union = bordesDeLaTabla(100, 2).find((s) => "mergeTableCells" in s);
    expect(union).toBeDefined();
    const estiloDeLaUnida = bordesDeLaTabla(100, 2)
      .filter((s) => "updateTableCellStyle" in s)
      .at(-1) as { updateTableCellStyle: { tableCellStyle: { contentAlignment?: string }; fields: string } };
    expect(estiloDeLaUnida.updateTableCellStyle.tableCellStyle.contentAlignment).toBe("BOTTOM");
    expect(estiloDeLaUnida.updateTableCellStyle.fields).toContain("contentAlignment");
  });
});

describe("solicitudesDeTabla · la nota de la partida", () => {
  /**
   * Renglón propio y sin número, debajo del concepto: la nota habla de la
   * partida entera, y mezclarla con el alcance la haría parecer una viñeta
   * más de lo que se incluye.
   */
  it("sale en su propio renglón, sin número y en negritas", () => {
    const { tabla } = armarYAplicar(
      datos({ partidas: [partida({ nota: "Nota: el cliente proporciona la plataforma." })] }),
    );
    expect(tabla.numeroDeFilas).toBe(1 + 1 + 1 + 3);
    expect(tabla.texto(2, 0)).toBe("");
    expect(tabla.texto(2, 1)).toBe("Nota: el cliente proporciona la plataforma.");
    expect(tabla.texto(2, 4)).toBe("");
  });

  it("una nota en blanco no agrega renglón", () => {
    const { tabla } = armarYAplicar(datos({ partidas: [partida({ nota: "   " })] }));
    expect(tabla.numeroDeFilas).toBe(1 + 1 + 3);
  });

  it("la nota cuenta como fila de partida para los bordes", () => {
    const { solicitudes } = armarYAplicar(
      datos({ partidas: [partida({ nota: "Nota: algo." })] }),
    );
    const union = solicitudes.find((s) => "mergeTableCells" in s) as {
      mergeTableCells: { tableRange: { tableCellLocation: { rowIndex: number } } };
    };
    // Encabezado + partida + nota = los totales empiezan en la fila 3.
    expect(union.mergeTableCells.tableRange.tableCellLocation.rowIndex).toBe(3);
  });
});
