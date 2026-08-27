import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks de todas las dependencias del módulo de flujos ──────────────────────

vi.mock("@/src/lib/bitacora", () => ({ registrarBitacora: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/src/lib/correo", () => ({
  enviarCorreo: vi.fn().mockResolvedValue({ enviado: true }),
  plantillaCorreo: vi.fn((p: { cuerpoHtml: string }) => p.cuerpoHtml),
}));
vi.mock("@/src/lib/cotizaciones", () => ({
  cambiarEstatus: vi.fn(),
  getVigente: vi.fn(),
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
  createOT: vi.fn().mockResolvedValue({ pk: "OT#OT001260", sk: "#METADATA" }),
  registrarResponsable: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/src/lib/users", () => ({ listUsers: vi.fn() }));
vi.mock("@/src/lib/config-erp", () => ({ getConfigErp: vi.fn() }));
vi.mock("@/src/lib/dynamo-client", () => ({ getDocClient: vi.fn(() => ({ send: vi.fn() })) }));

import { cambiarEstatus, getVigente, puedeEnviarseAlCliente, registrarAprobacion } from "@/src/lib/cotizaciones";
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
} from "@/src/lib/cotizaciones-flujos";

const vigente = {
  pk: "COT#001-2026", sk: "V#00", numero: 1, anio: 2026, version: 0,
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
    expect(cambiarEstatus).toHaveBeenCalledWith(1, 2026, "ASIGNADA");

    // Aviso: To = área seleccionada; CC incluye cc_aviso_ot y al responsable
    const aviso = vi.mocked(enviarCorreo).mock.calls.find((c) => c[0].asunto?.includes("Nueva OT"));
    expect(aviso).toBeDefined();
    expect(aviso![0].para).toEqual(["protecciones@proyinstelec.mx"]);
    expect(aviso![0].cc).toContain("gerencia@proyinstelec.mx");
    expect(aviso![0].cc).toContain("eduardo@proyinstelec.mx");
  });
});
