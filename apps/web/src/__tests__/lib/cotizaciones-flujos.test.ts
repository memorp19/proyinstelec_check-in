import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks de todas las dependencias del módulo de flujos ──────────────────────

vi.mock("@/src/lib/bitacora", () => ({ registrarBitacora: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/src/lib/correo", () => ({
  enviarCorreo: vi.fn().mockResolvedValue({ enviado: true }),
  plantillaCorreo: vi.fn((p: { cuerpoHtml: string }) => p.cuerpoHtml),
}));
vi.mock("@/src/lib/cotizaciones", () => ({
  cotPk: (numero: number, anio: number) => `COT#${String(numero).padStart(3, "0")}-${anio}`,
  cambiarEstatus: vi.fn(),
  getVigente: vi.fn(),
  getVersion: vi.fn(),
  marcarNoAsignadas: vi.fn().mockResolvedValue(0),
  puedeEnviarseAlCliente: vi.fn(),
  registrarAprobacion: vi.fn().mockResolvedValue({}),
  updateCotizacion: vi.fn().mockResolvedValue(undefined),
  createCotizacion: vi.fn(),
  crearNuevaVersion: vi.fn(),
}));
vi.mock("@/src/lib/clientes", () => ({ contactosParaEnvio: vi.fn() }));
vi.mock("@/src/lib/drive-erp", () => ({
  buscarPdfCotizacion: vi.fn(),
  ensureCarpetaOT: vi.fn(),
  ensureSubcarpetaOCCotizacion: vi.fn(),
  subirArchivoErp: vi.fn(),
  ensureCarpetaCotizacion: vi.fn(),
  copiarPlantillasCotizacion: vi.fn(),
}));
vi.mock("@/src/lib/ot", () => ({
  createOT: vi.fn().mockResolvedValue({ folio: "OT001260" }),
  agregarResponsable: vi.fn().mockResolvedValue({}),
  setCarpetaDriveOT: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/src/lib/users", () => ({ listUsers: vi.fn() }));
vi.mock("@/src/lib/config-erp", () => ({ getConfigErp: vi.fn() }));

import {
  cambiarEstatus,
  getVigente,
  getVersion,
  marcarNoAsignadas,
  puedeEnviarseAlCliente,
  registrarAprobacion,
  updateCotizacion,
} from "@/src/lib/cotizaciones";
import { buscarPdfCotizacion } from "@/src/lib/drive-erp";
import { enviarCorreo } from "@/src/lib/correo";
import { createOT } from "@/src/lib/ot";
import { listUsers } from "@/src/lib/users";
import { getConfigErp } from "@/src/lib/config-erp";
import {
  aprobarCotizacion,
  solicitarCorreccion,
  enviarAlCliente,
  ingresarOrdenCompra,
  generarOTSinOrdenCompra,
} from "@/src/lib/cotizaciones-flujos";

const vigente = {
  numero: 1, anio: 2026, version: 0,
  folio: "PCOTOP-001-2026", cliente: "Aceros del Norte", titulo: "Subestación",
  dirigida_a: "Juan", prioridad: "MEDIA", estatus: "REVISION", elaboro: "EAOL",
  drive_folder_id: "folder-1",
};

const usuarios = [
  { email: "eduardo@proyinstelec.mx", nombre: "Eduardo", iniciales: "EAOL", rol: "campo", permisos: ["cotizaciones.aprobar", "cotizaciones.enviar"] },
  { email: "maria@proyinstelec.mx", nombre: "María", iniciales: "MNAA", rol: "campo", permisos: ["cotizaciones.enviar"] },
  { email: "sinini@proyinstelec.mx", nombre: "Sin Iniciales", rol: "campo", permisos: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listUsers).mockResolvedValue(usuarios as any);
  vi.mocked(getConfigErp).mockResolvedValue({
    areas_ot: [
      { clave: "PROTECCIONES", nombre: "Protecciones", correo: "protecciones@proyinstelec.mx" },
      { clave: "MANTENIMIENTOS", nombre: "Mantenimientos" },
    ],
    cc_aviso_ot: ["gerencia@proyinstelec.mx"],
  });
});

describe("aprobarCotizacion", () => {
  it("solo aprueba en REVISION y registra por versión exacta", async () => {
    vi.mocked(getVigente).mockResolvedValue(vigente as any);
    await aprobarCotizacion({ numero: 1, anio: 2026, aprobadoPor: "eduardo@proyinstelec.mx" });
    expect(registrarAprobacion).toHaveBeenCalledWith(
      expect.objectContaining({ numero: 1, anio: 2026, version: 0 }),
    );
    // correo al elaborador (EAOL → eduardo)
    expect(enviarCorreo).toHaveBeenCalledWith(
      expect.objectContaining({ para: ["eduardo@proyinstelec.mx"] }),
    );
  });

  it("rechaza si ya no está en revisión (link/pantalla vieja)", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);
    await expect(
      aprobarCotizacion({ numero: 1, anio: 2026, aprobadoPor: "x@x.mx" }),
    ).rejects.toThrow("ya no está en revisión");
  });
});

describe("solicitarCorreccion", () => {
  it("exige comentario de al menos 10 caracteres", async () => {
    await expect(
      solicitarCorreccion({ numero: 1, anio: 2026, comentario: "corto", usuario: "x@x.mx" }),
    ).rejects.toThrow("al menos 10");
  });

  it("devuelve a PROCESO y avisa al elaborador con los comentarios", async () => {
    vi.mocked(getVigente).mockResolvedValue(vigente as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({ ...vigente, estatus: "PROCESO" } as any);

    await solicitarCorreccion({
      numero: 1, anio: 2026,
      comentario: "Falta el desglose de materiales", usuario: "eduardo@proyinstelec.mx",
    });

    expect(cambiarEstatus).toHaveBeenCalledWith(1, 2026, "PROCESO");
    const llamada = vi.mocked(enviarCorreo).mock.calls[0][0];
    expect(llamada.html).toContain("Falta el desglose de materiales");
  });
});

describe("enviarAlCliente", () => {
  it("bloquea sin aprobación (motivo del validador)", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({
      puede: false, motivo: "Esperando aprobación del revisor", cotizacion: vigente as any,
    });
    await expect(
      enviarAlCliente({
        numero: 1, anio: 2026, destinatarios: ["a@x.mx"],
        remitente: { email: "maria@proyinstelec.mx", nombre: "María" },
      }),
    ).rejects.toThrow("Esperando aprobación");
  });

  it("el PDF es obligatorio", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: vigente as any });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue(null);
    await expect(
      enviarAlCliente({
        numero: 1, anio: 2026, destinatarios: ["a@x.mx"],
        remitente: { email: "maria@proyinstelec.mx", nombre: "María" },
      }),
    ).rejects.toThrow("PDF");
  });

  it("envía con PDF adjunto, CC al resto del equipo y pasa a ENVIADA", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: vigente as any });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue({
      filename: "PCOTOP-001-2026.pdf", contenido: Buffer.from("pdf"),
    });
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);

    await enviarAlCliente({
      numero: 1, anio: 2026, destinatarios: ["cliente@aceros.mx"],
      remitente: { email: "maria@proyinstelec.mx", nombre: "María" },
    });

    const llamada = vi.mocked(enviarCorreo).mock.calls[0][0];
    expect(llamada.para).toEqual(["cliente@aceros.mx"]);
    expect(llamada.cc).toEqual(["eduardo@proyinstelec.mx"]); // el equipo menos la remitente
    expect(llamada.adjuntos?.[0].filename).toBe("PCOTOP-001-2026.pdf");
    expect(cambiarEstatus).toHaveBeenCalledWith(1, 2026, "ENVIADA");
  });

  // El estatus ENVIADA afirma que el cliente recibió la cotización. Si el correo
  // no salió, la afirmación es falsa: el flujo tiene que abortar antes de tocar
  // el estatus y la fecha de envío, no degradar en silencio.
  describe("si el correo no salió, la cotización no se marca como enviada", () => {
    beforeEach(() => {
      vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: vigente as any });
      vi.mocked(buscarPdfCotizacion).mockResolvedValue({
        filename: "PCOTOP-001-2026.pdf", contenido: Buffer.from("pdf"),
      });
    });

    const enviar = () =>
      enviarAlCliente({
        numero: 1, anio: 2026, destinatarios: ["cliente@aceros.mx"],
        remitente: { email: "maria@proyinstelec.mx", nombre: "María" },
      });

    it("CORREO_DESHABILITADO=true: nombra la variable y no cambia nada", async () => {
      vi.mocked(enviarCorreo).mockResolvedValueOnce({ enviado: false, motivo: "deshabilitado" });

      await expect(enviar()).rejects.toThrow("CORREO_DESHABILITADO");

      expect(cambiarEstatus).not.toHaveBeenCalled();
      expect(updateCotizacion).not.toHaveBeenCalled();
    });

    it("modo demo: tampoco sella el envío", async () => {
      vi.mocked(enviarCorreo).mockResolvedValueOnce({ enviado: false, motivo: "demo" });

      await expect(enviar()).rejects.toThrow("demo");

      expect(cambiarEstatus).not.toHaveBeenCalled();
      expect(updateCotizacion).not.toHaveBeenCalled();
    });

    it("sin destinatarios válidos: aborta", async () => {
      vi.mocked(enviarCorreo).mockResolvedValueOnce({ enviado: false, motivo: "sin_destinatarios" });

      await expect(enviar()).rejects.toThrow("destinatario");

      expect(cambiarEstatus).not.toHaveBeenCalled();
      expect(updateCotizacion).not.toHaveBeenCalled();
    });

    it("error del proveedor de correo: sigue abortando", async () => {
      vi.mocked(enviarCorreo).mockResolvedValueOnce({ enviado: false, motivo: "error" });

      await expect(enviar()).rejects.toThrow("bitácora");

      expect(cambiarEstatus).not.toHaveBeenCalled();
      expect(updateCotizacion).not.toHaveBeenCalled();
    });
  });
});

describe("ingresarOrdenCompra", () => {
  it("solo con estatus ENVIADA", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "PROCESO" } as any);
    await expect(
      ingresarOrdenCompra({
        numero: 1, anio: 2026, ordenCompra: "OC-1",
        responsableCorreo: "eduardo@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "x@x.mx",
      }),
    ).rejects.toThrow("ENVIADA");
  });

  it("el responsable debe tener iniciales (cruce con control operativo)", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);
    await expect(
      ingresarOrdenCompra({
        numero: 1, anio: 2026, ordenCompra: "OC-1",
        responsableCorreo: "sinini@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "x@x.mx",
      }),
    ).rejects.toThrow("iniciales");
  });

  it("genera la OT con el folio del legacy y avisa a las áreas", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({} as any);

    const r = await ingresarOrdenCompra({
      numero: 1, anio: 2026, ordenCompra: "OC-77",
      responsableCorreo: "eduardo@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "maria@proyinstelec.mx",
    });

    expect(r.folioOt).toBe("OT001260");
    expect(createOT).toHaveBeenCalledWith(expect.objectContaining({ ordenCompra: "OC-77" }));
    // Lleva la versión: se escribe sobre la elegida, no sobre "la vigente" implícita
    expect(cambiarEstatus).toHaveBeenCalledWith(1, 2026, "ASIGNADA", 0);

    // Aviso: To = área seleccionada; CC incluye cc_aviso_ot y al responsable
    const aviso = vi.mocked(enviarCorreo).mock.calls.find((c) => c[0].asunto?.includes("Nueva OT"));
    expect(aviso).toBeDefined();
    expect(aviso![0].para).toEqual(["protecciones@proyinstelec.mx"]);
    expect(aviso![0].cc).toContain("gerencia@proyinstelec.mx");
    expect(aviso![0].cc).toContain("eduardo@proyinstelec.mx");
  });

  it("la orden de compra es obligatoria por esta vía", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);
    await expect(
      ingresarOrdenCompra({
        numero: 1, anio: 2026, ordenCompra: "   ",
        responsableCorreo: "eduardo@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "x@x.mx",
      }),
    ).rejects.toThrow("orden de compra es obligatoria");
  });

  it("imprime los dos importes por separado en el aviso, sin totalizarlos", async () => {
    vi.mocked(getVigente).mockResolvedValue({
      ...vigente, estatus: "ENVIADA", monto_mxn: "50000.00", monto_usd: "3000.00",
    } as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({} as any);

    await ingresarOrdenCompra({
      numero: 1, anio: 2026, ordenCompra: "OC-77",
      responsableCorreo: "eduardo@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "x@x.mx",
    });

    const aviso = vi.mocked(enviarCorreo).mock.calls.find((c) => c[0].asunto?.includes("Nueva OT"))!;
    expect(aviso[0].html).toContain("$50,000.00 MXN");
    expect(aviso[0].html).toContain("$3,000.00 USD");
    expect(aviso[0].html).not.toContain("53,000"); // jamás una suma de monedas
  });
});

describe("generarOTSinOrdenCompra", () => {
  it("crea la OT con ordenCompra null y deja la cotización ASIGNADA", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({} as any);

    const r = await generarOTSinOrdenCompra({
      numero: 1, anio: 2026,
      responsableCorreo: "eduardo@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "maria@proyinstelec.mx",
    });

    expect(r.folioOt).toBe("OT001260");
    expect(createOT).toHaveBeenCalledWith(expect.objectContaining({ ordenCompra: null }));
    // Lleva la versión: se escribe sobre la elegida, no sobre "la vigente" implícita
    expect(cambiarEstatus).toHaveBeenCalledWith(1, 2026, "ASIGNADA", 0);
  });

  it("no escribe una OC vacía en la cotización", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({} as any);

    await generarOTSinOrdenCompra({
      numero: 1, anio: 2026,
      responsableCorreo: "eduardo@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "x@x.mx",
    });

    const cambios = vi.mocked(updateCotizacion).mock.calls.at(-1)![2];
    expect(cambios.folioOt).toBe("OT001260");
    expect("ordenCompra" in cambios).toBe(false);
  });

  it("el aviso dice explícitamente que no hay orden de compra", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({} as any);

    await generarOTSinOrdenCompra({
      numero: 1, anio: 2026,
      responsableCorreo: "eduardo@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "x@x.mx",
    });

    const aviso = vi.mocked(enviarCorreo).mock.calls.find((c) => c[0].asunto?.includes("Nueva OT"))!;
    expect(aviso[0].html).toContain("Sin orden de compra");
  });

  it("exige el mismo estatus ENVIADA que la vía con OC", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "REVISION" } as any);
    await expect(
      generarOTSinOrdenCompra({
        numero: 1, anio: 2026,
        responsableCorreo: "eduardo@proyinstelec.mx", areas: ["PROTECCIONES"], usuario: "x@x.mx",
      }),
    ).rejects.toThrow("ENVIADA");
  });
});

// La OC se registra en la versión que el cliente aceptó, que no siempre es la
// vigente. Caso real: la 002-2026 tiene la v0 ASIGNADA con OC y OT, y una v1
// posterior en ENVIADA que el cliente nunca tomó.
describe("ingresarOrdenCompra — elegir versión", () => {
  const alta = {
    numero: 2,
    anio: 2026,
    ordenCompra: "OC-900",
    responsableCorreo: "eduardo@proyinstelec.mx",
    areas: ["PROTECCIONES"],
    usuario: "ana@proyinstelec.mx",
  };

  it("sin versión sigue usando la vigente, como antes", async () => {
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, version: 1, estatus: "ENVIADA" } as any);

    await ingresarOrdenCompra(alta);

    expect(getVersion).not.toHaveBeenCalled();
    expect(createOT).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));
  });

  it("con versión lee ESA y no la vigente", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, version: 0, estatus: "ENVIADA" } as any);

    await ingresarOrdenCompra({ ...alta, version: 0 });

    expect(getVersion).toHaveBeenCalledWith(2, 2026, 0);
    expect(getVigente).not.toHaveBeenCalled();
    expect(createOT).toHaveBeenCalledWith(expect.objectContaining({ version: 0 }));
  });

  // Lo que se rompía si se escribía sobre la vigente: asignar la v0 habría
  // movido el estatus de la v1 y escrito la OC en la cotización equivocada.
  it("escribe la OC y el estatus sobre la versión elegida, no sobre la vigente", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, version: 0, estatus: "ENVIADA" } as any);

    await ingresarOrdenCompra({ ...alta, version: 0 });

    expect(updateCotizacion).toHaveBeenCalledWith(
      2,
      2026,
      expect.objectContaining({ ordenCompra: "OC-900" }),
      0,
    );
    expect(cambiarEstatus).toHaveBeenCalledWith(2, 2026, "ASIGNADA", 0);
  });

  it("el folio de la OT sale de la versión elegida", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, version: 0, estatus: "ENVIADA" } as any);

    const r = await ingresarOrdenCompra({ ...alta, version: 0 });

    expect(r.folioOt).toBe("OT002260");
  });

  it("rechaza una versión que no está en ENVIADA", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, version: 0, estatus: "ASIGNADA" } as any);

    await expect(ingresarOrdenCompra({ ...alta, version: 0 })).rejects.toThrow("ENVIADA");
    expect(createOT).not.toHaveBeenCalled();
  });

  it("avisa si la versión no existe", async () => {
    vi.mocked(getVersion).mockResolvedValue(null);

    await expect(ingresarOrdenCompra({ ...alta, version: 7 })).rejects.toThrow("versión 7");
  });

  // Una cotización, una OT: sigue aplicando aunque se intente con otra versión.
  it("si la cotización ya tiene OT, la rechaza aunque se pida otra versión", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, version: 1, estatus: "ENVIADA" } as any);
    vi.mocked(createOT).mockRejectedValueOnce(
      new Error("La cotización 002-2026 ya tiene la OT OT002260."),
    );

    await expect(ingresarOrdenCompra({ ...alta, version: 1 })).rejects.toThrow("ya tiene la OT");
    expect(cambiarEstatus).not.toHaveBeenCalled();
  });

  it("la vía sin OC también acepta versión", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, version: 0, estatus: "ENVIADA" } as any);

    await generarOTSinOrdenCompra({
      numero: 2,
      anio: 2026,
      version: 0,
      responsableCorreo: "eduardo@proyinstelec.mx",
      areas: ["PROTECCIONES"],
      usuario: "ana@proyinstelec.mx",
    });

    expect(getVersion).toHaveBeenCalledWith(2, 2026, 0);
    expect(cambiarEstatus).toHaveBeenCalledWith(2, 2026, "ASIGNADA", 0);
  });

  // Al asignar una versión, las demás que seguían en ENVIADA se descartan.
  it("descarta las demás versiones en ENVIADA y lo reporta", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, version: 0, estatus: "ENVIADA" } as any);
    vi.mocked(marcarNoAsignadas).mockResolvedValueOnce(2);

    const r = await ingresarOrdenCompra({ ...alta, version: 0 });

    expect(marcarNoAsignadas).toHaveBeenCalledWith(2, 2026, 0, "ana@proyinstelec.mx");
    expect(r.avisos.join(" ")).toContain("NO ASIGNADA");
  });

  it("si no había otras en ENVIADA no inventa un aviso", async () => {
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, version: 0, estatus: "ENVIADA" } as any);
    vi.mocked(marcarNoAsignadas).mockResolvedValueOnce(0);

    const r = await ingresarOrdenCompra({ ...alta, version: 0 });

    expect(r.avisos.join(" ")).not.toContain("NO ASIGNADA");
  });
});
