import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { NORMAS } from "@/src/lib/cotizador/normas";
import {
  PREFIJO_EN_PLANTILLA,
  normasEnPlantilla,
  quitarNormas,
} from "@/src/lib/cotizador/docs/normas-plantilla";
import type { DocumentoDocs } from "@/src/lib/cotizador/docs/tipos";
import { ArmaDocumento } from "../../../helpers/documentos-falso";

/**
 * La plantilla real **no entra al repositorio**. Aquí se usa un documento
 * inventado con su misma forma: las 23 viñetas con el texto que la plantilla
 * de verdad trae, que es justo lo que este módulo tiene que reconocer.
 *
 * Contra la plantilla de verdad se comprueba con `ERP_PLANTILLA_JSON`
 * apuntando al archivo; ver la última prueba.
 */

/** Las 23 como las imprime la plantilla, con su dedazo y todo. */
const RENGLONES_DE_LA_PLANTILLA = [
  "CFE-SOM-3531 Manual de procedimientos de prueba de campo para equipo primario ",
  "CFE-SOM-3532 Manual de procedimientos de pruebas a esquemas de protección",
  "NOM-001-SEDE-2012 Normas para instalaciones eléctricas ",
  "NOM-002-SEDE-2012 Requisitos de seguridad y eficiencia energética para transformadores ",
  "NOM-022-STPS-2015 Electricidad estática en los centros de trabajo – condiciones de seguridad",
  "NOM-029-STPS-2011 Mantenimiento de las instalaciones eléctricas en los centros de trabajo",
  "NMX-J-109-ANCE Transformadores de Corriente – especificaciones y métodos de prueba",
  "NMX-J-116-ANCE Productos Eléctricos - Transformadores de distribución tipo poste",
  "NMX-J-123-ANCE Productos Eléctricos - Aceites minerales aislantes para transformador",
  "NMX-J-142-ANCE Productos Eléctricos - Cables de Energía con pantalla metálica",
  "NMX-J-169-ANCE Transformadores y Autotransformadores de Distribución y Potencia",
  "NMX-J-215-ANCE Resistencia, Resistividad y Conductividad Eléctrica de conductores",
  "NMX-J-351-ANCE Transformadores de Distribución y Potencia Tipo Seco – especificaciones ",
  "NMX-J-294-ANCE Resistencia de Aislamiento de Conductores Eléctricos – método de prueba ",
  "NMX-J-565/4-ANCE Corriente de Fuga – método de prueba",
  "IEEC C57.12.90-1999 “IEEE Standard code for liquid-immersed distribution power",
  "IEEE Red Book – Recommended Practices for Electric Power Distribution",
  "IEEE – Recommended Practice for Protection and Coordination of Industrial Plants",
  "ANSI NETA MTS-2011 Standard for Maintenance Testing Specifications",
  "Diagramas esquemáticos del fabricante y del proyecto",
  "Manual de operación de equipo de medición y prueba",
  "Instructivos del fabricante",
  "Especificaciones técnicas del cliente",
];

function plantillaFalsa(renglones = RENGLONES_DE_LA_PLANTILLA): DocumentoDocs {
  const arma = new ArmaDocumento()
    .parrafo("Documentos Aplicables y/o Referencias.")
    .parrafo("");
  for (const r of renglones) arma.vineta(r, "kix.list.1");
  return arma.parrafo("Propuesta Comercial").construir();
}

describe("PREFIJO_EN_PLANTILLA", () => {
  it("tiene una entrada por cada norma del catálogo, sin sobrantes", () => {
    const delCatalogo = NORMAS.map((n) => n.id).sort();
    expect(Object.keys(PREFIJO_EN_PLANTILLA).sort()).toEqual(delCatalogo);
  });

  /**
   * Ocho ids no son el principio de su renglón. Por eso la tabla: anclar por
   * `id` encontraría quince de veintitrés y las ocho de IEEE y las generales
   * se quedarían sin localizar.
   */
  it("ocho normas no empiezan con su id, que es el motivo de la tabla", () => {
    const porId = NORMAS.filter((n) => !n.texto.startsWith(n.id));
    expect(porId.map((n) => n.id)).toEqual([
      "IEEE-C57.12.90",
      "IEEE-RED-BOOK",
      "IEEE-242",
      "NETA-MTS-2011",
      "GEN-DIAGRAMAS",
      "GEN-MANUAL",
      "GEN-INSTRUCTIVOS",
      "GEN-ESPECIFICACIONES",
    ]);
  });

  /**
   * Del texto del catálogo solo diverge una: el catálogo corrigió el dedazo
   * `IEEC` de la plantilla. Si alguien "corrige" también el prefijo de aquí,
   * esa norma deja de encontrarse — por eso está afirmado.
   */
  it("solo la C57.12.90 difiere del texto del catálogo, por el dedazo IEEC", () => {
    const distintos = NORMAS.filter((n) => !n.texto.startsWith(PREFIJO_EN_PLANTILLA[n.id]));
    expect(distintos.map((n) => n.id)).toEqual(["IEEE-C57.12.90"]);
    expect(PREFIJO_EN_PLANTILLA["IEEE-C57.12.90"]).toMatch(/^IEEC /);
  });
});

describe("normasEnPlantilla", () => {
  it("encuentra las 23, cada una exactamente una vez", () => {
    const r = normasEnPlantilla(plantillaFalsa());
    expect(r.encontradas.size).toBe(23);
    expect(r.faltantes).toEqual([]);
    expect(r.repetidas).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("cada norma cae en su propio renglón, no en el del vecino", () => {
    const r = normasEnPlantilla(plantillaFalsa());
    for (const { id } of NORMAS) {
      expect(r.encontradas.get(id)!.texto).toContain(PREFIJO_EN_PLANTILLA[id]);
    }
    const indices = [...r.encontradas.values()].map((p) => p.startIndex);
    expect(new Set(indices).size).toBe(23);
  });

  /** "IEEE Red Book" y "IEEE – Recommended…" empiezan igual los primeros cuatro. */
  it("distingue las dos normas de IEEE que empiezan igual", () => {
    const r = normasEnPlantilla(plantillaFalsa());
    expect(r.encontradas.get("IEEE-RED-BOOK")!.texto).toContain("Red Book");
    expect(r.encontradas.get("IEEE-242")!.texto).toContain("Protection and Coordination");
  });

  it("una norma que la plantilla no trae es un aviso, no un error", () => {
    const sinLaUltima = RENGLONES_DE_LA_PLANTILLA.slice(0, -1);
    const r = normasEnPlantilla(plantillaFalsa(sinLaUltima));
    expect(r.faltantes).toEqual(["GEN-ESPECIFICACIONES"]);
    expect(r.avisos.join(" ")).toContain("GEN-ESPECIFICACIONES");
    expect(r.encontradas.size).toBe(22);
  });

  it("una norma repetida se deja quieta y se avisa", () => {
    const dosVeces = [...RENGLONES_DE_LA_PLANTILLA, "Instructivos del fabricante"];
    const r = normasEnPlantilla(plantillaFalsa(dosVeces));
    expect(r.repetidas).toEqual(["GEN-INSTRUCTIVOS"]);
    expect(r.encontradas.has("GEN-INSTRUCTIVOS")).toBe(false);
    expect(r.avisos.join(" ")).toContain("más de un renglón");
  });

  it("un párrafo sin viñeta que empiece igual no cuenta como norma", () => {
    const doc = new ArmaDocumento()
      .parrafo("Instructivos del fabricante, según el anexo")
      .vineta("Instructivos del fabricante", "kix.list.1")
      .construir();
    const r = normasEnPlantilla(doc);
    expect(r.repetidas).not.toContain("GEN-INSTRUCTIVOS");
    expect(r.encontradas.has("GEN-INSTRUCTIVOS")).toBe(true);
  });
});

describe("quitarNormas", () => {
  const borrados = (r: ReturnType<typeof quitarNormas>) =>
    r.solicitudes.filter((s) => "deleteContentRange" in s);
  const insertados = (r: ReturnType<typeof quitarNormas>) =>
    r.solicitudes.flatMap((s) => ("insertText" in s ? [s.insertText.text] : []));
  /** El índice en el que opera cada solicitud, sea del tipo que sea. */
  const inicios = (r: ReturnType<typeof quitarNormas>) =>
    r.solicitudes.map((s) =>
      "deleteContentRange" in s ? s.deleteContentRange.range.startIndex : s.insertText.location.index,
    );

  it("borra las que no se eligieron", () => {
    const r = quitarNormas(plantillaFalsa(), ["CFE-SOM-3531", "GEN-INSTRUCTIVOS"]);
    expect(borrados(r)).toHaveLength(
      // Las 21 que sobran, más el texto de la elegida que hay que reescribir.
      21 + 1,
    );
  });

  /**
   * Lo que de verdad importa de este módulo: el texto que sale es el del
   * catálogo, no el de la plantilla. La plantilla imprime `IEEC` por `IEEE`,
   * no cierra la comilla y deja espacios de más; Apps Script no hereda nada
   * de eso porque escribe los suyos, y ningún documento real lo trae.
   */
  it("reescribe con el texto del catálogo lo que la plantilla trae mal", () => {
    const r = quitarNormas(plantillaFalsa(), ["IEEE-C57.12.90"]);
    const bueno = NORMAS.find((n) => n.id === "IEEE-C57.12.90")!.texto;

    expect(insertados(r)).toContain(bueno);
    expect(bueno).toContain("IEEE C57.12.90-1999");
    expect(insertados(r).join(" ")).not.toContain("IEEC");
  });

  it("la que ya dice lo mismo que el catálogo no se toca", () => {
    // "Instructivos del fabricante" está igual en la plantilla y en el catálogo.
    const r = quitarNormas(plantillaFalsa(), NORMAS.map((n) => n.id));
    expect(insertados(r)).not.toContain("Instructivos del fabricante");
  });

  it("eligiéndolas todas no se borra ningún párrafo, solo se reescribe", () => {
    const r = quitarNormas(plantillaFalsa(), NORMAS.map((n) => n.id));
    // Un borrado por cada reescritura, y ninguno que se lleve el párrafo entero.
    expect(borrados(r)).toHaveLength(insertados(r).length);
    for (const texto of insertados(r)) {
      expect(NORMAS.map((n) => n.texto)).toContain(texto);
    }
  });

  /** Todo lo que cambia longitudes corre los índices posteriores. */
  it("emite los rangos de atrás hacia adelante", () => {
    const r = quitarNormas(plantillaFalsa(), ["CFE-SOM-3531"]);
    expect(inicios(r)).toEqual([...inicios(r)].sort((a, b) => b - a));
  });

  /**
   * Dentro del mismo párrafo, borrar va antes que insertar: al revés, el
   * borrado se llevaría por delante el texto recién escrito.
   */
  it("en el párrafo que se reescribe, primero borra y después inserta", () => {
    const r = quitarNormas(plantillaFalsa(), ["IEEE-C57.12.90"]);
    const i = r.solicitudes.findIndex((s) => "insertText" in s);
    expect(i).toBeGreaterThan(0);
    expect(r.solicitudes[i - 1]).toHaveProperty("deleteContentRange");
  });

  it("elegir una norma que la plantilla no imprime avisa", () => {
    const sinLaUltima = RENGLONES_DE_LA_PLANTILLA.slice(0, -1);
    const r = quitarNormas(plantillaFalsa(sinLaUltima), ["GEN-ESPECIFICACIONES"]);
    expect(r.avisos.join(" ")).toContain("no van a salir en el documento");
  });
});

/**
 * La comprobación contra la plantilla de verdad.
 *
 * El JSON tiene datos de la empresa y no entra al repositorio, así que esta
 * prueba se salta sola. Para correrla:
 *
 *     ERP_PLANTILLA_JSON=C:/.../plantilla-cotizacion.json pnpm test:ci
 */
const ruta = process.env.ERP_PLANTILLA_JSON;
const hayPlantilla = !!ruta && existsSync(ruta);

describe.skipIf(!hayPlantilla)("contra la plantilla de verdad", () => {
  it("las 23 normas aparecen exactamente una vez", () => {
    const doc = JSON.parse(readFileSync(ruta!, "utf8")) as DocumentoDocs;
    const r = normasEnPlantilla(doc);
    expect(r.faltantes).toEqual([]);
    expect(r.repetidas).toEqual([]);
    expect(r.encontradas.size).toBe(NORMAS.length);
  });
});
