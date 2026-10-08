import { describe, it, expect } from "vitest";
import type { Celda } from "@/src/lib/excel";
import {
  aplicarAjustes,
  esFilaCargable,
  leerAjustes,
  esOrdenCompraDoble,
  leerFilaCotizacion,
  mapearEstatusOT,
  normalizarRazon,
  ordenCompraCruda,
  otRepetidas,
  resolverCliente,
  resolverFolioOT,
  revisarCotizacion,
  versionesNoAsignadas,
  type Ajuste,
  type FilaCotizacion,
} from "@/src/lib/importacion-2026";
import { ESTATUS_COTIZACION } from "@/src/lib/cotizaciones";

/** Celda de texto. */
const t = (valor: string): Celda => ({ valor, tipo: "s", conFormatoDeFecha: false });
/** Celda numérica, opcionalmente con formato de fecha (como las OC del Excel). */
const n = (valor: string, conFormatoDeFecha = false): Celda => ({
  valor,
  tipo: "n",
  conFormatoDeFecha,
});

describe("ordenCompraCruda", () => {
  // El guion es la forma del equipo de decir "no hay OC". Guardarlo como texto
  // dejaría a cualquiera dudando si es un dato o una marca.
  it("el guion es ausencia, no un valor", () => {
    expect(ordenCompraCruda(t("-"))).toBeNull();
    expect(ordenCompraCruda(t(""))).toBeNull();
    expect(ordenCompraCruda(undefined)).toBeNull();
  });

  // El caso que motiva todo el lector crudo: la OC está guardada como número y
  // con formato de fecha, así que un lector que respete el formato entrega 1920.
  it("una OC numérica con formato de fecha sigue siendo la OC", () => {
    expect(ordenCompraCruda(n("4501122596", true))).toBe("4501122596");
    expect(ordenCompraCruda(n("78627"))).toBe("78627");
  });

  it("no toca las OC que no son números", () => {
    expect(ordenCompraCruda(t("MEX01-0000230798"))).toBe("MEX01-0000230798");
    expect(ordenCompraCruda(t("Co0001/150/26/255492"))).toBe("Co0001/150/26/255492");
  });
});

describe("esOrdenCompraDoble", () => {
  it("reconoce las dos OC de SYMRISE y de SAINT-GOBAIN", () => {
    expect(esOrdenCompraDoble("4501122596 / 4501153770")).toBe(true);
    expect(esOrdenCompraDoble("4551218979 / 4551218980")).toBe(true);
  });

  // Partir por "/" a secas convertiría esta OC de la 185 y la 234 en cuatro.
  it("una OC con diagonales dentro del código NO es doble", () => {
    expect(esOrdenCompraDoble("Co0001/150/26/255492")).toBe(false);
    expect(esOrdenCompraDoble("Co0001/150/26/279011")).toBe(false);
  });

  it("sin OC no hay nada que partir", () => {
    expect(esOrdenCompraDoble(null)).toBe(false);
    expect(esOrdenCompraDoble("78627")).toBe(false);
  });
});

describe("esFilaCargable", () => {
  it("'Elegir' marca los números reservados sin capturar", () => {
    expect(esFilaCargable(300, "Elegir")).toBe(false);
    expect(esFilaCargable(300, "")).toBe(false);
  });

  it("la 450 es la cotización de prueba del equipo", () => {
    expect(esFilaCargable(450, "ASIGNADA")).toBe(false);
    expect(esFilaCargable(449, "ASIGNADA")).toBe(true);
  });
});

describe("leerFilaCotizacion", () => {
  const celdas = {
    B: t("PCOTOP"),
    C: t("002"),
    D: n("2026"),
    E: n("1"),
    F: t("CENTRO SANTA FE"),
    G: t("MANTENIMIENTO CORRECTIVO"),
    H: t("LIC. MARIA LUISA ROMERO"),
    I: t("media"),
    J: t("ENVIADA"),
    K: t("EAOL"),
    L: n("46119", true),
    M: n("46119", true),
    N: n("9140"),
    O: t("OT002261"),
  };

  it("arma el folio canónico, nunca con '-v'", () => {
    const f = leerFilaCotizacion(11, celdas)!;
    expect(f.folio).toBe("PCOTOP-002-2026-1");
    expect(f.numero).toBe(2);
    expect(f.version).toBe(1);
  });

  it("la v0 no lleva sufijo de versión", () => {
    const f = leerFilaCotizacion(10, { ...celdas, E: n("0") })!;
    expect(f.folio).toBe("PCOTOP-002-2026");
  });

  it("la prioridad se normaliza, y lo desconocido cae en MEDIA", () => {
    expect(leerFilaCotizacion(11, celdas)!.prioridad).toBe("MEDIA");
    expect(leerFilaCotizacion(11, { ...celdas, I: t("alta") })!.prioridad).toBe("ALTA");
    expect(leerFilaCotizacion(11, { ...celdas, I: t("URGENTE") })!.prioridad).toBe("MEDIA");
  });

  // La columna B es lo que separa las filas de datos del encabezado y de los
  // renglones de formato que el Excel lleva arriba.
  it("solo lee las filas marcadas con PCOTOP", () => {
    expect(leerFilaCotizacion(8, { ...celdas, B: t("NUMERO") })).toBeNull();
    expect(leerFilaCotizacion(5, {})).toBeNull();
  });

  it("una fila sin número no es una cotización", () => {
    expect(leerFilaCotizacion(9, { ...celdas, C: t("") })).toBeNull();
  });

  it("guarda el serial de la fecha, no una fecha convertida", () => {
    const f = leerFilaCotizacion(11, celdas)!;
    expect(f.fechaSolicitud).toBe(46119);
  });

  // Distinguir "vacía" de "ilegible" es lo que permite decir en el reporte si
  // falta capturarla o si está mal escrita.
  it("distingue la celda vacía de la capturada como texto", () => {
    const vacia = leerFilaCotizacion(11, { ...celdas, L: undefined as never })!;
    expect(vacia.fechaSolicitud).toBeNull();
    expect(vacia.fechaSolicitudCruda).toBe("");

    const mala = leerFilaCotizacion(11, { ...celdas, L: t("19/5/0226") })!;
    expect(mala.fechaSolicitud).toBeNull();
    expect(mala.fechaSolicitudCruda).toBe("19/5/0226");
  });

  it("el guion de la OC llega como null", () => {
    expect(leerFilaCotizacion(11, { ...celdas, N: t("-") })!.ordenCompra).toBeNull();
  });
});

describe("resolverFolioOT", () => {
  const base = { numero: 225, anio: 2026, version: 0 };

  it("acepta el folio que corresponde a su propia cotización", () => {
    const r = resolverFolioOT({ ...base, deCotizaciones: "OT225260" });
    expect(r.folio).toBe("OT225260");
    expect(r.hallazgos).toEqual([]);
  });

  // El caso real: Cotizaciones traía la OT de la 226. Ese folio es con el que
  // después se buscan reportes, gastos y facturas.
  it("corrige con el respaldo de otra fuente y lo reporta", () => {
    const r = resolverFolioOT({
      ...base,
      deCotizaciones: "OT226260",
      deProceso: "OT225260",
      deControlOT: "OT225260",
    });

    expect(r.folio).toBe("OT225260");
    expect(r.hallazgos.map((h) => h.tipo)).toContain("ot-corregida");
    expect(r.hallazgos.filter((h) => h.tipo === "ot-desacuerdo")).toHaveLength(2);
  });

  it("si ninguna fuente da el folio correcto, no se carga OT", () => {
    const r = resolverFolioOT({ ...base, deCotizaciones: "OT226260", deProceso: "OT226260" });

    expect(r.folio).toBeNull();
    const malo = r.hallazgos.find((h) => h.tipo === "ot-no-cuadra")!;
    expect(malo.severidad).toBe("bloqueante");
    expect(malo.mensaje).toContain("OT225260");
  });

  it("sin folio en ninguna fuente no inventa nada ni se queja", () => {
    const r = resolverFolioOT({ ...base, deCotizaciones: null });
    expect(r.folio).toBeNull();
    expect(r.hallazgos).toEqual([]);
  });

  // El Control de OT trae OT061250 (año 25) donde Cotizaciones trae OT061260.
  // Cotizaciones manda, pero la diferencia queda escrita.
  it("reporta el desacuerdo aunque el folio bueno sea el de Cotizaciones", () => {
    const r = resolverFolioOT({
      numero: 61,
      anio: 2026,
      version: 0,
      deCotizaciones: "OT061260",
      deControlOT: "OT061250",
    });

    expect(r.folio).toBe("OT061260");
    expect(r.hallazgos.map((h) => h.tipo)).toEqual(["ot-desacuerdo"]);
    expect(r.hallazgos[0].severidad).toBe("aviso");
  });

  it("no distingue mayúsculas ni espacios al comparar", () => {
    expect(resolverFolioOT({ ...base, deCotizaciones: " ot225260 " }).folio).toBe("OT225260");
  });
});

describe("mapearEstatusOT", () => {
  it("traduce el vocabulario del Control de OT al de la app", () => {
    expect(mapearEstatusOT("PROCESO", "OT001260").estatus).toBe("En Proceso");
    expect(mapearEstatusOT("REVISIÓN", "OT001260").estatus).toBe("Revisión");
    expect(mapearEstatusOT("TERMINADO", "OT001260").estatus).toBe("Cerrado");
  });

  it("el guion y el vacío significan que la OT nace sin estatus", () => {
    expect(mapearEstatusOT("-", "OT001260").estatus).toBe("");
    expect(mapearEstatusOT("", "OT001260").estatus).toBe("");
  });

  // Cargar una OT con un estatus inventado la dejaría inmovilizable desde la
  // app: `transicionesDesdeOT` no ofrecería ningún destino.
  it("un valor desconocido bloquea la carga de esa OT", () => {
    const r = mapearEstatusOT("FACTURADO", "OT001260");
    expect(r.estatus).toBeNull();
    expect(r.hallazgos[0].severidad).toBe("bloqueante");
  });

  it("no acepta la grafía de la app en la columna del Excel", () => {
    expect(mapearEstatusOT("Cerrado", "OT001260").estatus).toBeNull();
  });
});

describe("versionesNoAsignadas", () => {
  const v = (version: number, estatus: string) => ({ version, estatus });

  it("descarta las ENVIADA cuando hay una ASIGNADA", () => {
    const r = versionesNoAsignadas([v(0, "ENVIADA"), v(1, "ASIGNADA"), v(2, "ENVIADA")], "002-2026");
    expect(r.descartadas).toEqual([0, 2]);
    expect(r.hallazgos).toEqual([]);
  });

  it("sin ASIGNADA no se descarta nada", () => {
    const r = versionesNoAsignadas([v(0, "ENVIADA"), v(1, "ENVIADA")], "044-2026");
    expect(r.descartadas).toEqual([]);
  });

  it("no toca las que ya están en otro estatus", () => {
    const r = versionesNoAsignadas(
      [v(0, "CANCELADA"), v(1, "ASIGNADA"), v(2, "NO ASIGNADA")],
      "010-2026",
    );
    expect(r.descartadas).toEqual([]);
  });

  // Descartarla no sería cierto: sigue viva. Pero `ORDEN_VIGENTE` no la salta,
  // así que la vigente no será la asignada y hay que saberlo antes de cargar.
  it("avisa de la versión viva que tapa a la asignada, sin tocarla", () => {
    const r = versionesNoAsignadas([v(0, "ASIGNADA"), v(1, "PROCESO")], "011-2026");

    expect(r.descartadas).toEqual([]);
    const h = r.hallazgos.find((x) => x.tipo === "tapan-la-asignada")!;
    expect(h.severidad).toBe("bloqueante");
    expect(h.mensaje).toContain("v1 (PROCESO)");
  });

  it("una versión viva POR DEBAJO de la asignada no tapa nada", () => {
    const r = versionesNoAsignadas([v(0, "PROCESO"), v(1, "ASIGNADA")], "012-2026");
    expect(r.hallazgos).toEqual([]);
  });

  it("dos ASIGNADA violan 'una cotización, una OT' y bloquean", () => {
    const r = versionesNoAsignadas([v(0, "ASIGNADA"), v(1, "ASIGNADA")], "013-2026");
    expect(r.descartadas).toEqual([]);
    expect(r.hallazgos[0].tipo).toBe("varias-asignadas");
    expect(r.hallazgos[0].severidad).toBe("bloqueante");
  });
});

describe("resolverCliente", () => {
  const catalogo = [
    { id: "c1", razonNormalizada: "IGSA S.A.P.I DE C.V." },
    { id: "c2", razonNormalizada: "Universidad del Valle de Mexico, SC" },
    { id: "c3", razonNormalizada: "FONKEL MEXICANA S.A. de C.V." },
  ];

  it("empareja el nombre corto con la razón social por normalización", () => {
    const r = resolverCliente({ nombreExcel: "IGSA", catalogo, alias: {} });
    expect(r.clienteId).toBe("c1");
  });

  it("'FONKEL MEXICANA' no necesita alias: lo resuelve la normalización", () => {
    expect(resolverCliente({ nombreExcel: "FONKEL MEXICANA", catalogo, alias: {} }).clienteId).toBe(
      "c3",
    );
  });

  // Un plantel factura a la matriz; eso no sale de comparar cadenas.
  it("el alias cubre los renombres que son decisiones humanas", () => {
    const r = resolverCliente({
      nombreExcel: "UVM HISPANO",
      catalogo,
      alias: { "UVM HISPANO": "Universidad del Valle de Mexico, SC" },
    });
    expect(r.clienteId).toBe("c2");
    expect(r.hallazgos).toEqual([]);
  });

  // Lo que la carga anterior hacía mal: estas nueve filas desaparecieron sin
  // aviso porque su cliente no se pudo resolver.
  it("un cliente desconocido NUNCA descarta la fila: se da de alta", () => {
    const r = resolverCliente({ nombreExcel: "GSM INDUSTRIAL", catalogo, alias: {} });

    expect(r.clienteId).toBeNull();
    expect(r.altaComo).toBe("GSM INDUSTRIAL");
    expect(r.hallazgos[0].severidad).toBe("aviso");
  });

  it("la fila sin cliente sí es un problema", () => {
    const r = resolverCliente({ nombreExcel: "   ", catalogo, alias: {} });
    expect(r.hallazgos[0].severidad).toBe("bloqueante");
  });
});

describe("normalizarRazon", () => {
  it("quita sufijos legales, acentos y puntuación", () => {
    expect(normalizarRazon("Deacero S.A.P.I. de C.V.")).toBe("deacero");
    expect(normalizarRazon("Tlalnepantla Cogeneración")).toBe("tlalnepantla cogeneracion");
  });

  it("dos escrituras de la misma empresa llegan al mismo valor", () => {
    expect(normalizarRazon("FONKEL MEXICANA S.A. de C.V.")).toBe(normalizarRazon("Fonkel Mexicana"));
  });
});

describe("revisarCotizacion", () => {
  const fila = (p: Partial<FilaCotizacion> = {}): FilaCotizacion => ({
    fila: 10,
    numero: 2,
    anio: 2026,
    version: 0,
    folio: "PCOTOP-002-2026",
    cliente: "CENTRO SANTA FE",
    titulo: "MANTENIMIENTO",
    dirigidaA: "LIC. MARIA LUISA ROMERO",
    prioridad: "MEDIA",
    estatus: "ASIGNADA",
    elaboro: "EAOL",
    fechaSolicitud: 46119,
    fechaEntrega: 46119,
    fechaSolicitudCruda: "46119",
    fechaEntregaCruda: "46119",
    ordenCompra: "9140",
    folioOt: "OT002260",
    ...p,
  });

  const tipos = (hs: ReturnType<typeof revisarCotizacion>) => hs.map((h) => h.tipo);

  it("una cotización sana no produce hallazgos", () => {
    expect(revisarCotizacion(2, 2026, [fila()], ESTATUS_COTIZACION)).toEqual([]);
  });

  // (numero, anio, version) es la llave primaria: elegir cuál de las dos cargar
  // sería inventar. Es el caso de la 241.
  it("dos filas con la misma versión bloquean", () => {
    const hs = revisarCotizacion(
      241,
      2026,
      [fila({ numero: 241, estatus: "ENVIADA" }), fila({ numero: 241, fila: 324 })],
      ESTATUS_COTIZACION,
    );
    const h = hs.find((x) => x.tipo === "version-duplicada")!;
    expect(h.severidad).toBe("bloqueante");
    expect(h.mensaje).toContain("324");
  });

  it("detiene la carga si falta la fecha de solicitud, y no la inventa", () => {
    const hs = revisarCotizacion(
      2,
      2026,
      [fila({ fechaSolicitud: null, fechaSolicitudCruda: "" })],
      ESTATUS_COTIZACION,
    );
    expect(hs.find((h) => h.tipo === "sin-fecha-solicitud")!.severidad).toBe("bloqueante");
  });

  // Excel nunca la convirtió porque está escrita como texto, con el año mal.
  it("distingue la fecha ilegible de la ausente", () => {
    const hs = revisarCotizacion(
      136,
      2026,
      [fila({ fechaSolicitud: null, fechaSolicitudCruda: "19/5/0226" })],
      ESTATUS_COTIZACION,
    );
    const h = hs.find((x) => x.tipo === "fecha-solicitud-ilegible")!;
    expect(h.severidad).toBe("bloqueante");
    expect(h.mensaje).toContain("19/5/0226");
  });

  // Esta columna sí admite nulo, así que sin el aviso se cargaría vacía y nadie
  // se enteraría.
  it("avisa de la fecha de entrega ilegible, sin bloquear", () => {
    const hs = revisarCotizacion(
      255,
      2026,
      [fila({ fechaEntrega: null, fechaEntregaCruda: "10/0972026" })],
      ESTATUS_COTIZACION,
    );
    expect(hs.find((h) => h.tipo === "fecha-entrega-ilegible")!.severidad).toBe("aviso");
  });

  it("una OT en un estatus que no es ASIGNADA se reporta sin bloquear", () => {
    const hs = revisarCotizacion(224, 2026, [fila({ estatus: "ENVIADA" })], ESTATUS_COTIZACION);
    expect(hs.find((h) => h.tipo === "ot-sin-asignada")!.severidad).toBe("aviso");
  });

  it("una ASIGNADA sin orden de compra se reporta", () => {
    const hs = revisarCotizacion(225, 2026, [fila({ ordenCompra: null })], ESTATUS_COTIZACION);
    expect(tipos(hs)).toContain("asignada-sin-oc");
  });

  it("un estatus fuera del catálogo bloquea", () => {
    const hs = revisarCotizacion(9, 2026, [fila({ estatus: "FACTURADA" })], ESTATUS_COTIZACION);
    expect(hs.find((h) => h.tipo === "estatus-desconocido")!.severidad).toBe("bloqueante");
  });
});

describe("otRepetidas", () => {
  const fila = (numero: number, version: number, folioOt: string | null): FilaCotizacion =>
    ({ numero, anio: 2026, version, folioOt, fila: 0 }) as FilaCotizacion;

  // 225 traía la OT de la 226: dos cotizaciones reclamando el mismo folio.
  it("el mismo folio en dos cotizaciones bloquea", () => {
    const hs = otRepetidas([fila(225, 0, "OT226260"), fila(226, 0, "OT226260")]);
    expect(hs[0].tipo).toBe("ot-compartida");
    expect(hs[0].severidad).toBe("bloqueante");
  });

  // 178 v1 y v2 comparten OT178261, pero son la MISMA cotización: eso lo
  // reporta `revisarCotizacion`, no esto.
  it("el mismo folio en dos versiones de una cotización no es conflicto aquí", () => {
    expect(otRepetidas([fila(178, 1, "OT178261"), fila(178, 2, "OT178261")])).toEqual([]);
  });

  it("las filas sin OT no se comparan", () => {
    expect(otRepetidas([fila(44, 0, null), fila(47, 0, null)])).toEqual([]);
  });
});


// Los ajustes son decisiones de operacion que el Excel no puede expresar: una
// cotizacion cuyo trabajo ya se ejecuto pero que en el control sigue en ENVIADA
// porque la OC del cliente no ha llegado. Un error de captura NO va aqui.
describe("leerAjustes", () => {
  const bueno = {
    cotizacion: 224,
    anio: 2026,
    version: 0,
    estatus: "ASIGNADA",
    ordenCompra: null,
    motivo: "Trabajo ejecutado; OC pendiente del cliente.",
  };

  it("acepta un ajuste bien formado", () => {
    const r = leerAjustes({ ajustes: [bueno] });
    expect(r.ajustes).toHaveLength(1);
    expect(r.hallazgos).toEqual([]);
  });

  // Sin motivo esto seria una lista de excepciones sin dueno, imposible de
  // revisar en un PR.
  it("el motivo es obligatorio", () => {
    for (const motivo of [undefined, "", "   "]) {
      const r = leerAjustes({ ajustes: [{ ...bueno, motivo }] });
      expect(r.ajustes).toEqual([]);
      expect(r.hallazgos[0].tipo).toBe("ajuste-sin-motivo");
      expect(r.hallazgos[0].severidad).toBe("bloqueante");
    }
  });

  it("exige cotizacion, anio y version enteros", () => {
    for (const campo of ["cotizacion", "anio", "version"]) {
      const r = leerAjustes({ ajustes: [{ ...bueno, [campo]: "224" }] });
      expect(r.ajustes).toEqual([]);
      expect(r.hallazgos[0].tipo).toBe("ajuste-invalido");
      expect(r.hallazgos[0].mensaje).toContain(campo);
    }
  });

  it("un ajuste que no cambia nada no tiene sentido", () => {
    const r = leerAjustes({ ajustes: [{ cotizacion: 1, anio: 2026, version: 0, motivo: "x" }] });
    expect(r.hallazgos[0].tipo).toBe("ajuste-vacio");
  });

  // Dos entradas para la misma fila harian que el resultado dependiera del
  // orden del archivo.
  it("rechaza dos ajustes para la misma version", () => {
    const r = leerAjustes({ ajustes: [bueno, { ...bueno, estatus: "CANCELADA" }] });
    expect(r.ajustes).toHaveLength(1);
    expect(r.hallazgos[0].tipo).toBe("ajuste-duplicado");
  });

  // Un ajuste ignorado en silencio dejaria la carga distinta de lo que su autor
  // cree, que es justo lo que el archivo viene a evitar.
  it("una entrada mala no tumba a las buenas, pero si bloquea", () => {
    const r = leerAjustes({ ajustes: [bueno, { ...bueno, cotizacion: 232, motivo: "" }] });
    expect(r.ajustes).toHaveLength(1);
    expect(r.hallazgos.filter((h) => h.severidad === "bloqueante")).toHaveLength(1);
  });

  it("un archivo sin arreglo de ajustes bloquea", () => {
    expect(leerAjustes({}).hallazgos[0].tipo).toBe("ajustes-ilegibles");
    expect(leerAjustes(null).hallazgos[0].tipo).toBe("ajustes-ilegibles");
  });
});

describe("aplicarAjustes", () => {
  const fila = (p: Partial<FilaCotizacion> = {}): FilaCotizacion =>
    ({
      fila: 304,
      numero: 224,
      anio: 2026,
      version: 0,
      folio: "PCOTOP-224-2026",
      cliente: "SYMRISE",
      titulo: "CONTRA INCENDIO",
      dirigidaA: "ING. HECTOR DEL BOSQUE",
      prioridad: "BAJA",
      estatus: "ENVIADA",
      elaboro: "EAOL",
      fechaSolicitud: 46238,
      fechaEntrega: 46297,
      fechaSolicitudCruda: "46238",
      fechaEntregaCruda: "46297",
      ordenCompra: null,
      folioOt: "OT224260",
      ...p,
    }) as FilaCotizacion;

  const ajuste = (p: Partial<Ajuste> = {}): Ajuste => ({
    cotizacion: 224,
    anio: 2026,
    version: 0,
    estatus: "ASIGNADA",
    motivo: "Trabajo ejecutado; OC pendiente del cliente.",
    ...p,
  });

  it("cambia el estatus de la fila y lo reporta en texto", () => {
    const f = fila();
    const r = aplicarAjustes([f], [ajuste()]);

    expect(f.estatus).toBe("ASIGNADA");
    expect(r.aplicados).toHaveLength(1);
    expect(r.aplicados[0].cambios).toEqual(["estatus ENVIADA → ASIGNADA"]);
    expect(r.hallazgos).toEqual([]);
  });

  it("el guion del Excel ya era null, asi que la OC no cuenta como cambio", () => {
    const r = aplicarAjustes([fila()], [ajuste({ ordenCompra: null })]);
    expect(r.aplicados[0].cambios).toEqual(["estatus ENVIADA → ASIGNADA"]);
  });

  it("quitar la OC se reporta con palabras, no con null", () => {
    const r = aplicarAjustes([fila({ ordenCompra: "9140" })], [ajuste({ ordenCompra: null })]);
    expect(r.aplicados[0].cambios).toContain("OC 9140 → (ninguna)");
  });

  it("solo toca los campos presentes en el ajuste", () => {
    const f = fila({ ordenCompra: "9140" });
    aplicarAjustes([f], [ajuste()]);
    expect(f.ordenCompra).toBe("9140");
    expect(f.folioOt).toBe("OT224260");
  });

  // El caso de la 178: el cliente trabaja con la v2, pero los controles
  // conservan el folio de la v1 porque el reporte ya se emitio con el.
  it("mueve el folio de OT y registra la equivalencia", () => {
    const f = fila({ numero: 178, version: 2, estatus: "DEPENDIENTE CLIENTE", folioOt: "OT178261" });
    const r = aplicarAjustes(
      [f],
      [
        ajuste({
          cotizacion: 178,
          version: 2,
          folioOt: "OT178262",
          equivalenciaOt: "OT178261",
          motivo: "El cliente trabaja con la v2.",
        }),
      ],
    );

    expect(f.folioOt).toBe("OT178262");
    expect(r.equivalencias.get("178-2")).toBe("OT178261");
    expect(r.aplicados[0].cambios).toContain("OT OT178261 → OT178262");
  });

  it("la equivalencia se guarda en mayusculas y sin espacios", () => {
    const r = aplicarAjustes([fila()], [ajuste({ equivalenciaOt: " ot224260 " })]);
    expect(r.equivalencias.get("224-0")).toBe("OT224260");
  });

  // El archivo acumula entradas muertas si nadie las ve. Avisa y no bloquea: la
  // carga no se detiene por una excepcion que dejo de hacer falta.
  it("avisa si el ajuste apunta a una fila que no existe", () => {
    const r = aplicarAjustes([fila()], [ajuste({ cotizacion: 999 })]);

    expect(r.aplicados).toEqual([]);
    const h = r.hallazgos[0];
    expect(h.tipo).toBe("ajuste-sin-fila");
    expect(h.severidad).toBe("aviso");
    expect(h.referencia).toBe("999-2026 v0");
  });

  it("la version equivocada cuenta como fila inexistente", () => {
    const r = aplicarAjustes([fila()], [ajuste({ version: 1 })]);
    expect(r.hallazgos[0].tipo).toBe("ajuste-sin-fila");
  });

  it("avisa si la fila ya esta como pide el ajuste", () => {
    const r = aplicarAjustes([fila({ estatus: "ASIGNADA" })], [ajuste()]);

    expect(r.aplicados).toEqual([]);
    expect(r.hallazgos[0].tipo).toBe("ajuste-innecesario");
    expect(r.hallazgos[0].severidad).toBe("aviso");
  });

  // Aplicar dos veces el mismo archivo sobre las mismas filas no puede producir
  // un resultado distinto.
  it("es idempotente: la segunda pasada no cambia nada y avisa", () => {
    const f = fila();
    expect(aplicarAjustes([f], [ajuste()]).aplicados).toHaveLength(1);

    const segunda = aplicarAjustes([f], [ajuste()]);
    expect(segunda.aplicados).toEqual([]);
    expect(segunda.hallazgos[0].tipo).toBe("ajuste-innecesario");
  });

  it("sin ajustes no pasa nada", () => {
    const r = aplicarAjustes([fila()], []);
    expect(r.aplicados).toEqual([]);
    expect(r.hallazgos).toEqual([]);
    expect(r.equivalencias.size).toBe(0);
  });
});

// La equivalencia tiene que llegar hasta la validacion cruzada: el folio que
// los controles conservan cuenta como confirmacion, no como discrepancia.
describe("resolverFolioOT con equivalencia", () => {
  const base = { numero: 178, anio: 2026, version: 2 };

  it("el folio viejo en los controles no es un desacuerdo", () => {
    const r = resolverFolioOT({
      ...base,
      deCotizaciones: "OT178262",
      deProceso: "OT178261",
      deControlOT: "OT178261",
      equivalenciaOt: "OT178261",
    });

    expect(r.folio).toBe("OT178262");
    expect(r.hallazgos).toEqual([]);
  });

  // Sin declararla, el mismo dato si es una discrepancia. Es lo que hace que
  // declararla valga la pena: la excepcion queda escrita en el archivo.
  it("sin equivalencia, ese mismo dato si se reporta", () => {
    const r = resolverFolioOT({
      ...base,
      deCotizaciones: "OT178262",
      deProceso: "OT178261",
      deControlOT: "OT178261",
    });
    expect(r.hallazgos.filter((h) => h.tipo === "ot-desacuerdo")).toHaveLength(2);
  });

  it("la equivalencia no tapa un folio que de verdad es de otra cotizacion", () => {
    const r = resolverFolioOT({
      numero: 225,
      anio: 2026,
      version: 0,
      deCotizaciones: "OT226260",
      equivalenciaOt: "OT178261",
    });
    expect(r.folio).toBeNull();
    expect(r.hallazgos[0].tipo).toBe("ot-no-cuadra");
  });
});
