import { describe, it, expect } from "vitest";
import { CONDICIONES_POR_OMISION, documentoVacio } from "@/src/lib/cotizador/documento";
import { esVersionAnterior, nombreDelDocumento } from "@/src/lib/cotizador/docs/nombre";
import {
  generarDocumento,
  solicitudesDelDocumento,
  type DatosDeGeneracion,
} from "@/src/lib/cotizador/docs/generar";
import type { Armado } from "@/src/lib/cotizador/armado";
import { ArmaDocumento, documentosFalso } from "../../../helpers/documentos-falso";

/** Todos los datos son inventados. */

const armadoCon = (partidas: number): Armado =>
  ({
    numero: 1,
    anio: 2026,
    version: 0,
    partidas: Array.from({ length: partidas }, (_, i) => ({ id: `P${i}` })),
    gastos: [],
  }) as unknown as Armado;

const datos = (sobre: Partial<DatosDeGeneracion> = {}): DatosDeGeneracion => ({
  numero: 1,
  anio: 2026,
  version: 0,
  cliente: "Minera Sur",
  titulo: "Servicio de Mantenimiento",
  armado: armadoCon(1),
  documento: { ...documentoVacio(), fecha: "2026-10-05" },
  condiciones: { ...CONDICIONES_POR_OMISION, lugar: "la planta" },
  ...sobre,
});

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
    .tabla([["PARTIDA", "CONCEPTO"]])
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

  it("junta los huecos del contacto con los marcadores faltantes", () => {
    const doc = plantillaCompleta();
    const { avisos } = solicitudesDelDocumento(doc, datos(), "2026-10-05");
    // El contacto viene vacío: sale ⟨falta⟩ y se avisa.
    expect(avisos.join(" ")).toContain("el nombre del contacto");
  });
});

describe("generarDocumento", () => {
  it("copia, aplica en UN solo lote y exporta", async () => {
    const { documentos, entorno: e } = entorno();
    const r = await generarDocumento(datos(), e);

    expect(documentos.copiados).toEqual([
      {
        plantillaId: "doc-plantilla",
        nombre: "PCOTOP-001-2026 Servicio de Mantenimiento",
        carpetaId: "carpeta-450",
        id: "copia-1",
      },
    ]);
    // En uno solo: si una falla, no queda un documento a medio llenar.
    expect(documentos.aplicadas).toHaveLength(1);
    expect(documentos.aplicadas[0].id).toBe("copia-1");
    expect(documentos.exportados).toEqual(["copia-1"]);
    expect(r.docId).toBe("copia-1");
    expect(r.pdf.nombre).toBe("PCOTOP-001-2026 Servicio de Mantenimiento.pdf");
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
    await expect(generarDocumento(datos({ armado: armadoCon(0) }), e)).rejects.toThrow(
      "no tiene partidas",
    );
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
