import { describe, it, expect } from "vitest";
import { ocultarRenglones } from "@/src/lib/cotizador/docs/ocultar";
import type { RenglonOculto } from "@/src/lib/cotizador/docs/valores";
import { ArmaDocumento } from "../../../helpers/documentos-falso";

/** Documentos inventados. La plantilla real no entra al repositorio. */

const oculto = (marcador: RenglonOculto["marcador"]): RenglonOculto => ({
  marcador,
  motivo: "elegido",
});

const rangos = (doc: Parameters<typeof ocultarRenglones>[0], o: RenglonOculto[]) =>
  ocultarRenglones(doc, o).solicitudes.map((s) => s.deleteContentRange.range);

describe("ocultarRenglones", () => {
  it("borra el párrafo entero cuando solo trae ese marcador", () => {
    const doc = new ArmaDocumento()
      .parrafo("Ana Ruiz")
      .parrafo("{{TELEFONO}}")
      .parrafo("Fin")
      .construir();

    // "Ana Ruiz\n" ocupa [1, 10); "{{TELEFONO}}\n" ocupa [10, 23)
    expect(rangos(doc, [oculto("TELEFONO")])).toEqual([{ startIndex: 10, endIndex: 23 }]);
  });

  /**
   * Teléfono y correo juntos en la misma línea: borrar el párrafo se llevaría
   * el correo por delante.
   */
  it("si el renglón trae otro marcador, solo borra el texto de este", () => {
    const doc = new ArmaDocumento().parrafo("Tel {{TELEFONO}} · {{EMAIL}}").construir();
    const r = rangos(doc, [oculto("TELEFONO")]);
    expect(r).toEqual([{ startIndex: 5, endIndex: 17 }]); // solo "{{TELEFONO}}"
  });

  /**
   * `deleteContentRange` corre los índices posteriores y la API aplica en
   * orden: de arriba hacia abajo, el segundo rango apuntaría a otra cosa.
   */
  it("emite los rangos de atrás hacia adelante", () => {
    const doc = new ArmaDocumento()
      .parrafo("{{DIRECCION_1}}")
      .parrafo("{{DIRECCION_2}}")
      .parrafo("{{TELEFONO}}")
      .parrafo("{{EMAIL}}")
      .construir();

    const r = rangos(doc, [
      oculto("DIRECCION_1"),
      oculto("DIRECCION_2"),
      oculto("TELEFONO"),
      oculto("EMAIL"),
    ]);
    const inicios = r.map((x) => x.startIndex);
    expect(inicios).toEqual([...inicios].sort((a, b) => b - a));
    expect(r).toHaveLength(4);
  });

  it("un marcador que no está en la plantilla se reporta y no es un error", () => {
    const doc = new ArmaDocumento().parrafo("Sin marcadores").construir();
    const r = ocultarRenglones(doc, [oculto("TELEFONO")]);
    expect(r.solicitudes).toEqual([]);
    expect(r.sinMarcador).toEqual(["TELEFONO"]);
  });

  it("el mismo marcador repetido se quita de los dos renglones", () => {
    const doc = new ArmaDocumento().parrafo("{{EMAIL}}").parrafo("{{EMAIL}}").construir();
    expect(rangos(doc, [oculto("EMAIL")])).toHaveLength(2);
  });

  /**
   * La API no deja borrar el salto de línea final de un segmento: la petición
   * entera falla.
   */
  it("el último párrafo conserva su salto de línea", () => {
    const doc = new ArmaDocumento().parrafo("Antes").parrafo("{{EMAIL}}").construir();
    const r = rangos(doc, [oculto("EMAIL")])[0];
    const ultimo = doc.body!.content!.at(-1)!;
    expect(r.endIndex).toBe(ultimo.endIndex! - 1);
  });

  it("un marcador del encabezado lleva su segmentId", () => {
    const doc = new ArmaDocumento().parrafo("Cuerpo").conEncabezado("{{TELEFONO}}").construir();
    expect(rangos(doc, [oculto("TELEFONO")])[0]).toMatchObject({ segmentId: "enc-1" });
  });

  it("el del cuerpo no lleva segmentId, que es como la API entiende el cuerpo", () => {
    const doc = new ArmaDocumento().parrafo("{{EMAIL}}").parrafo("x").construir();
    expect(rangos(doc, [oculto("EMAIL")])[0].segmentId).toBeUndefined();
  });

  it("sin nada que ocultar no emite solicitudes", () => {
    const doc = new ArmaDocumento().parrafo("{{EMAIL}}").construir();
    expect(ocultarRenglones(doc, []).solicitudes).toEqual([]);
  });
});
