import { describe, it, expect } from "vitest";
import {
  avisoDeEncabezado,
  avisoSinPdf,
  cambiosDeEncabezado,
  documentoVacio,
  fotoDelDocumento,
  leerFoto,
} from "@/src/lib/cotizador";

/**
 * La foto de lo que imprime el documento: se toma al congelar y el PDF
 * definitivo sale de ella, no del encabezado vivo.
 */

const cotizacion = { cliente: "Aceros del Norte S.A. de C.V.", titulo: "Subestación", dirigida_a: "Ing. Ruiz" };

describe("fotoDelDocumento y leerFoto", () => {
  it("guarda el encabezado, el documento y las direcciones", () => {
    const documento = { ...documentoVacio(), fecha: "2026-11-23" };
    const foto = fotoDelDocumento({
      cotizacion,
      documento,
      direccionContacto: "Camino Real 12",
    });

    expect(foto).toEqual({
      encabezado: { cliente: cotizacion.cliente, titulo: "Subestación", dirigidaA: "Ing. Ruiz" },
      documento,
      direccionContacto: "Camino Real 12",
      direccionCliente: null,
    });
  });

  it("de ida y vuelta por jsonb queda igual", () => {
    const foto = fotoDelDocumento({ cotizacion, documento: documentoVacio() });
    expect(leerFoto(JSON.parse(JSON.stringify(foto)))).toEqual(foto);
  });

  // Lo congelado antes de que existiera la foto no la trae: no es un error.
  it.each([
    ["nada", null],
    ["un texto", "foto"],
    ["sin encabezado", { documento: {} }],
    ["un encabezado incompleto", { encabezado: { cliente: "X", titulo: "Y" }, documento: {} }],
    ["sin documento", { encabezado: { cliente: "X", titulo: "Y", dirigidaA: "Z" } }],
  ])("%s: null", (_caso, crudo) => {
    expect(leerFoto(crudo)).toBeNull();
  });
});

describe("cambiosDeEncabezado y avisoDeEncabezado", () => {
  const foto = fotoDelDocumento({ cotizacion, documento: documentoVacio() }).encabezado;

  it("si nada cambió, no hay aviso", () => {
    expect(cambiosDeEncabezado(foto, cotizacion)).toEqual([]);
    expect(avisoDeEncabezado([])).toBeNull();
  });

  it("los espacios de sobra no son un cambio", () => {
    expect(cambiosDeEncabezado(foto, { ...cotizacion, titulo: " Subestación " })).toEqual([]);
  });

  it("dice qué cambió, con lo de ahora y lo del PDF", () => {
    const cambios = cambiosDeEncabezado(foto, { ...cotizacion, titulo: "Subestación Norte" });

    expect(cambios).toEqual([
      { campo: "titulo", etiqueta: "el título", enElPdf: "Subestación", ahora: "Subestación Norte" },
    ]);
    expect(avisoDeEncabezado(cambios)).toBe(
      "El encabezado cambió después de mandarla a revisión: el título ahora dice «Subestación Norte» " +
        "y el PDF lleva «Subestación». El PDF sale de lo que se congeló, que es lo que se revisó.",
    );
  });

  it("varios cambios, todos en el mismo aviso", () => {
    const aviso = avisoDeEncabezado(
      cambiosDeEncabezado(foto, { cliente: "IGSA S.A.P.I de C.V.", titulo: "Subestación", dirigida_a: "Lic. Mora" }),
    );

    expect(aviso).toContain("el cliente ahora dice «IGSA S.A.P.I de C.V.»");
    expect(aviso).toContain("dirigida a ahora dice «Lic. Mora» y el PDF lleva «Ing. Ruiz»");
    // La razón social termina en punto, pero va entre comillas: no hay doble punto
    expect(aviso).not.toContain("..");
  });
});

describe("avisoSinPdf", () => {
  it("armada en el ERP y en REVISION: que se genere, desde lo congelado", () => {
    const aviso = avisoSinPdf({ delCotizador: true, estatus: "REVISION", folio: "PCOTOP-454-2026" });
    expect(aviso).toContain("no tiene su PDF definitivo");
    expect(aviso).toContain("«Generar PDF»");
    expect(aviso).not.toContain("Apps Script");
  });

  it("armada en el ERP y ya enviada: no se regenera", () => {
    const aviso = avisoSinPdf({ delCotizador: true, estatus: "ENVIADA", folio: "PCOTOP-454-2026" });
    expect(aviso).toContain("no se regenera");
    expect(aviso).toContain("papelera");
    expect(aviso).not.toContain("Generar PDF");
  });

  // El mensaje de antes («Genera el PDF con el nombre…») solo tiene sentido aquí.
  it("importada: su PDF lo hace el Apps Script, con el nombre que espera la búsqueda", () => {
    const aviso = avisoSinPdf({ delCotizador: false, estatus: "REVISION", folio: "PCOTOP-120-2026" });
    expect(aviso).toContain("no se armó en el ERP");
    expect(aviso).toContain("Apps Script");
    expect(aviso).toContain("«PCOTOP-120-2026 …»");
    expect(aviso).not.toContain("Generar PDF");
  });
});
