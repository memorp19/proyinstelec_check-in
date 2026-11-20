import { describe, it, expect } from "vitest";
import {
  formasEnTexto,
  MARCADORES,
  sustituciones,
  type Marcador,
} from "@/src/lib/cotizador/docs/marcadores";
import { ArmaDocumento } from "../../../helpers/documentos-falso";

/** Documentos inventados. La plantilla real no entra al repositorio. */

const todos = (sobre: Partial<Record<Marcador, string>> = {}): Record<Marcador, string> =>
  Object.fromEntries(MARCADORES.map((m) => [m, sobre[m] ?? `<${m}>`])) as Record<Marcador, string>;

describe("formasEnTexto", () => {
  it("encuentra la forma con el número de llaves que sea", () => {
    expect(formasEnTexto("Hola {{CLIENTE}}", "CLIENTE")).toEqual(["{{CLIENTE}}"]);
    expect(formasEnTexto("Hola {CLIENTE}", "CLIENTE")).toEqual(["{CLIENTE}"]);
    expect(formasEnTexto("Hola {{{{CLIENTE}}}}", "CLIENTE")).toEqual(["{{{{CLIENTE}}}}"]);
  });

  // Sustituir primero la corta dejaría sueltas las llaves de la larga.
  it("con dos formas en el mismo documento, primero la de más llaves", () => {
    expect(formasEnTexto("{{CLIENTE}} y {{{{CLIENTE}}}}", "CLIENTE")).toEqual([
      "{{{{CLIENTE}}}}",
      "{{CLIENTE}}",
    ]);
  });

  it("no se inventa formas que no están", () => {
    expect(formasEnTexto("Hola CLIENTE sin llaves", "CLIENTE")).toEqual([]);
  });

  it("la misma forma repetida se cuenta una vez", () => {
    expect(formasEnTexto("{{FOLIO}} … {{FOLIO}}", "FOLIO")).toEqual(["{{FOLIO}}"]);
  });
});

describe("sustituciones", () => {
  it("una solicitud literal por cada forma encontrada", () => {
    const doc = new ArmaDocumento().parrafo("Para {{CLIENTE}}, folio {{FOLIO}}").construir();
    const r = sustituciones(doc, todos({ CLIENTE: "Minera Sur", FOLIO: "PCOTOP-001-2026" }));

    expect(r.solicitudes).toContainEqual({
      replaceAllText: { containsText: { text: "{{CLIENTE}}", matchCase: true }, replaceText: "Minera Sur" },
    });
    expect(r.solicitudes).toContainEqual({
      replaceAllText: {
        containsText: { text: "{{FOLIO}}", matchCase: true },
        replaceText: "PCOTOP-001-2026",
      },
    });
  });

  it("no emite solicitudes de marcadores que la plantilla no trae", () => {
    const doc = new ArmaDocumento().parrafo("Solo {{CLIENTE}}").construir();
    const r = sustituciones(doc, todos());
    const textos = r.solicitudes.map((s) => s.replaceAllText.containsText.text);
    expect(textos).toEqual(["{{CLIENTE}}"]);
  });

  /**
   * Un hueco se descubre cuando el cliente ya la tiene, así que se dice
   * antes. Pero no vale la pena no generar el documento por eso.
   */
  it("lo que falta se avisa y no es un error", () => {
    const doc = new ArmaDocumento().parrafo("Solo {{CLIENTE}} y {{FOLIO}}").construir();
    const r = sustituciones(doc, todos());
    // Sin orden: se recorre por longitud del nombre, y para un aviso da igual.
    expect([...r.faltantes].sort()).toEqual(
      ["CONTACTO", "ENTREGA", "FECHA", "LUGAR", "PAGO", "TITULO"],
    );
    expect(r.encontrados).toEqual(expect.arrayContaining(["CLIENTE", "FOLIO"]));
  });

  // DIRECCION_2 y SITIO pueden no estar: avisarlo llenaría la vista previa de
  // ruido que nadie puede accionar.
  it("no avisa de los marcadores que son opcionales", () => {
    const doc = new ArmaDocumento()
      .parrafo("{{CLIENTE}} {{FOLIO}} {{FECHA}} {{TITULO}} {{CONTACTO}} {{PAGO}} {{ENTREGA}} {{LUGAR}}")
      .construir();
    expect(sustituciones(doc, todos()).faltantes).toEqual([]);
  });

  /**
   * `replaceAllText` aplica a todos los segmentos sin que haya que pedirlo,
   * que es justo lo que el original tiene que hacer a mano para el encabezado.
   */
  it("un marcador que solo está en el encabezado también se sustituye", () => {
    const doc = new ArmaDocumento().parrafo("Cuerpo").conEncabezado("{{FOLIO}}").construir();
    const r = sustituciones(doc, todos({ FOLIO: "PCOTOP-001-2026" }));
    expect(r.encontrados).toContain("FOLIO");
    expect(r.solicitudes).toHaveLength(1);
  });

  it("y uno de dentro de la tabla de partidas también", () => {
    const doc = new ArmaDocumento().tabla([["PARTIDA", "{{TITULO}}"]]).construir();
    expect(sustituciones(doc, todos()).encontrados).toContain("TITULO");
  });

  // El día que alguien agregue {{FECHA_ENTREGA}} junto a {{FECHA}}.
  it("sustituye de nombre más largo a más corto", () => {
    const doc = new ArmaDocumento().parrafo("{{DIRECCION_1}} {{DIRECCION_2}} {{CLIENTE}}").construir();
    const orden = sustituciones(doc, todos()).solicitudes.map(
      (s) => s.replaceAllText.containsText.text,
    );
    expect(orden.indexOf("{{DIRECCION_1}}")).toBeLessThan(orden.indexOf("{{CLIENTE}}"));
  });

  it("un valor vacío sustituye por vacío, no deja el marcador", () => {
    const doc = new ArmaDocumento().parrafo("{{DIRECCION_2}}").construir();
    const r = sustituciones(doc, todos({ DIRECCION_2: "" }));
    expect(r.solicitudes[0].replaceAllText.replaceText).toBe("");
  });
});

/**
 * El "S.A. de C.V.." de todos los documentos del sistema viejo.
 *
 * La plantilla escribe "propiedad del {{SITIO}}." y casi todas las razones
 * sociales terminan en punto, así que el legacy imprime dos. Nadie lo arregló
 * ahí; copiarlo a propósito no tiene defensa.
 */
describe("sustituciones · el punto de más", () => {
  const doc = (texto: string) => new ArmaDocumento().parrafo(texto).construir();
  const vacios = () =>
    Object.fromEntries(MARCADORES.map((m) => [m, ""])) as Record<Marcador, string>;

  it("un valor que ya trae punto se come el de la plantilla", () => {
    const valores = { ...vacios(), SITIO: "IGSA S.A.P.I de C.V." };
    const r = sustituciones(doc("propiedad del {{SITIO}}."), valores);
    const formas = r.solicitudes.map((s) => s.replaceAllText.containsText.text);

    // Primero la forma con punto, que es la más larga: al revés, la corta ya
    // no dejaría ver la otra.
    expect(formas.indexOf("{{SITIO}}.")).toBeLessThan(formas.indexOf("{{SITIO}}"));
    const conPunto = r.solicitudes.find((s) => s.replaceAllText.containsText.text === "{{SITIO}}.");
    expect(conPunto?.replaceAllText.replaceText).toBe("IGSA S.A.P.I de C.V.");
  });

  it("un valor sin punto deja el de la plantilla donde está", () => {
    const valores = { ...vacios(), SITIO: "Prologis Puente Grande" };
    const r = sustituciones(doc("propiedad del {{SITIO}}."), valores);
    const formas = r.solicitudes.map((s) => s.replaceAllText.containsText.text);
    expect(formas).not.toContain("{{SITIO}}.");
  });
});
