import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks de todas las dependencias del módulo de flujos ──────────────────────

vi.mock("@/src/lib/bitacora", () => ({ registrarBitacora: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/src/lib/correo", () => {
  // Fieles a los de verdad, que tienen su propia prueba en correo.test.ts:
  // aquí hacen falta para poder afirmar que lo tecleado sale escapado.
  const escaparHtml = (t: string) =>
    String(t ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  return {
    enviarCorreo: vi.fn().mockResolvedValue({ enviado: true }),
    plantillaCorreo: vi.fn((p: { cuerpoHtml: string }) => p.cuerpoHtml),
    escaparHtml,
    textoAHtml: (t: string) => escaparHtml(String(t ?? "").trim()).replace(/\r\n|\r|\n/g, "<br/>"),
  };
});
vi.mock("@/src/lib/cotizaciones", () => ({
  cotPk: (numero: number, anio: number) => `COT#${String(numero).padStart(3, "0")}-${anio}`,
  apartarEnvio: vi.fn(),
  devolverEnvio: vi.fn(),
  cambiarEstatus: vi.fn(),
  getVigente: vi.fn(),
  getVersion: vi.fn(),
  marcarNoAsignadas: vi.fn().mockResolvedValue(0),
  // Las versiones de estas pruebas no pasaron por el cotizador: el PDF se
  // busca por nombre, que es lo que estas pruebas ejercen.
  pdfGeneradoDe: vi.fn().mockResolvedValue(null),
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
vi.mock("@/src/lib/users", () => ({ listUsers: vi.fn(), getUserByEmail: vi.fn() }));
vi.mock("@/src/lib/config-erp", () => ({ getConfigErp: vi.fn() }));

import {
  apartarEnvio,
  cambiarEstatus,
  devolverEnvio,
  getVigente,
  getVersion,
  marcarNoAsignadas,
  puedeEnviarseAlCliente,
  registrarAprobacion,
  updateCotizacion,
} from "@/src/lib/cotizaciones";
import { contactosParaEnvio } from "@/src/lib/clientes";
import { registrarBitacora } from "@/src/lib/bitacora";
import { buscarPdfCotizacion } from "@/src/lib/drive-erp";
import { enviarCorreo, plantillaCorreo } from "@/src/lib/correo";
import { createOT } from "@/src/lib/ot";
import { getUserByEmail, listUsers } from "@/src/lib/users";
import { getConfigErp } from "@/src/lib/config-erp";
import {
  enviarARevision,
  aprobarCotizacion,
  solicitarCorreccion,
  enviarAlCliente,
  ingresarOrdenCompra,
  generarOTSinOrdenCompra,
  DestinatariosNoValidos,
  EnvioDesactualizado,
  EnvioNoPermitido,
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
  // Un nombre que la etiqueta en mayúsculas deformaría, con acentos y una
  // mayúscula a media palabra. Sin permisos: no cambia a quién le llega nada.
  { email: "angeles@proyinstelec.mx", nombre: "María de los Ángeles McAllen", iniciales: "MALM", rol: "campo", permisos: [] },
];

/** El único contacto con correo del cliente, en todas las pruebas del envío. */
const CONTACTO = "compras@cliente.test";

beforeEach(() => {
  vi.clearAllMocks();
  // El dominio de la empresa, para la regla de destinatarios
  vi.stubEnv("GOOGLE_WORKSPACE_DOMAIN", "empresa.test");
  vi.mocked(contactosParaEnvio).mockResolvedValue({
    empresa: { cliente_id: "e1", razon_social: "Aceros del Norte" } as never,
    contactos: [{ contacto_id: "c1", nombre: "Compras", correo: CONTACTO }] as never,
    sugeridoId: "c1",
  });
  vi.mocked(apartarEnvio).mockResolvedValue(true);
  vi.mocked(devolverEnvio).mockResolvedValue(true);
  vi.mocked(listUsers).mockResolvedValue(usuarios as any);
  // Fiel al de verdad: busca por correo, sin distinguir mayúsculas.
  vi.mocked(getUserByEmail).mockImplementation(async (email: string) =>
    (usuarios.find((u) => u.email === email.trim().toLowerCase()) ?? null) as any,
  );
  vi.mocked(getConfigErp).mockResolvedValue({
    areas_ot: [
      { clave: "PROTECCIONES", nombre: "Protecciones", correo: "protecciones@proyinstelec.mx" },
      { clave: "MANTENIMIENTOS", nombre: "Mantenimientos" },
    ],
    cc_aviso_ot: ["gerencia@proyinstelec.mx"],
    cotizador: { ASESORIA_PCT_DEFAULT: 10, BASE_NODOS_ESTUDIO: 10, HORAS_DIA_ESTUDIO: 8 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("enviarARevision", () => {
  /**
   * Dos versiones en PROCESO a la vez: se puede, porque crear una versión
   * nueva no exige ningún estatus. El flujo tiene que mover **la que se le
   * pide**, no "la vigente" — que es la más alta, y por tanto la otra.
   *
   * El falso modela lo que `cambiarEstatus` hace de verdad: con versión toca
   * esa fila; sin ella, la vigente. Es lo que distingue el arreglo del error
   * que venía: la ruta congelaba la v0 y mandaba a revisión la v1.
   */
  function dosEnProceso() {
    const filas = [
      { ...vigente, version: 0, folio: "PCOTOP-001-2026", estatus: "PROCESO" },
      { ...vigente, version: 1, folio: "PCOTOP-001-2026-v1", estatus: "PROCESO" },
    ];
    vi.mocked(cambiarEstatus).mockImplementation((async (
      _numero: number,
      _anio: number,
      nuevo: string,
      version?: number,
    ) => {
      const fila =
        version === undefined
          ? [...filas].sort((a, b) => b.version - a.version)[0]
          : filas.find((f) => f.version === version);
      if (!fila) throw new Error("Cotización no encontrada");
      fila.estatus = nuevo;
      return { ...fila };
    }) as any);
    return filas;
  }

  const estatus = (filas: Array<{ estatus: string }>) => filas.map((f) => f.estatus);

  it("manda la v0 y deja la v1 en PROCESO", async () => {
    const filas = dosEnProceso();

    await enviarARevision({ numero: 1, anio: 2026, version: 0, usuario: "ana@proyinstelec.mx" });

    expect(estatus(filas)).toEqual(["REVISION", "PROCESO"]);
    expect(cambiarEstatus).toHaveBeenCalledWith(1, 2026, "REVISION", 0);
  });

  it("y el simétrico: manda la v1 y deja la v0 en PROCESO", async () => {
    const filas = dosEnProceso();

    await enviarARevision({ numero: 1, anio: 2026, version: 1, usuario: "ana@proyinstelec.mx" });

    expect(estatus(filas)).toEqual(["PROCESO", "REVISION"]);
    expect(cambiarEstatus).toHaveBeenCalledWith(1, 2026, "REVISION", 1);
  });

  // Los correos salen de la empresa: con el folio crudo le enseñarían al equipo
  // —y al revisor— la convención "-v1" que esta rama vino a quitar.
  it("los dos correos llevan el folio canónico de esa versión", async () => {
    dosEnProceso();

    await enviarARevision({ numero: 1, anio: 2026, version: 1, usuario: "ana@proyinstelec.mx" });

    const correos = vi.mocked(enviarCorreo).mock.calls.map(([c]) => c);
    expect(correos).toHaveLength(2); // revisores + elaboradora
    for (const correo of correos) {
      expect(correo.asunto).toContain("PCOTOP-001-2026-1");
      expect(`${correo.asunto} ${correo.html}`).not.toContain("-v1");
    }
  });

  // La columna guarda lo que se cargó: la recarga de 2026 metió 75 folios con
  // "-v1". Un registro nuevo no repite esa convención.
  it("la bitácora anota el folio canónico de esa versión, nunca el \"-v1\"", async () => {
    dosEnProceso();

    await enviarARevision({ numero: 1, anio: 2026, version: 1, usuario: "ana@proyinstelec.mx" });

    expect(registrarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "COTIZACION_A_REVISION", detalle: "PCOTOP-001-2026-1" }),
    );
  });

  // ── La nota para el revisor ────────────────────────────────────────────────

  describe("la nota para el revisor", () => {
    const mandarCon = (nota?: string, usuario = "ana@proyinstelec.mx") => {
      dosEnProceso();
      return enviarARevision({ numero: 1, anio: 2026, version: 0, usuario, nota });
    };
    const correos = () => vi.mocked(enviarCorreo).mock.calls.map(([c]) => c);

    it("va en el correo al revisor y en la confirmación a quien elaboró", async () => {
      await mandarCon("Sin viáticos: el cliente los paga aparte.");
      const html = correos().map((c) => c.html);
      expect(html).toHaveLength(2);
      for (const h of html) expect(h).toContain("Sin viáticos: el cliente los paga aparte.");
    });

    /**
     * Es la regla entera: el recado es para el revisor, no para el cliente.
     * El aviso va DENTRO del correo porque es ahí donde lo lee quien lo
     * escribió, y no en un manual que nadie abre.
     */
    it("el correo dice que no aparece en la cotización", async () => {
      await mandarCon("Revísame la partida 2.");
      for (const c of correos()) {
        expect(c.html).toContain("Solo va en este correo: no aparece en la cotización.");
      }
    });

    /**
     * "NOTA DE SUPERADMIN@PROYINSTELEC.MX" no dice quién escribió el recado:
     * dice qué cuenta se usó. El revisor necesita lo primero.
     */
    it("la firma el nombre de quien la mandó, no su correo", async () => {
      await mandarCon("Revísame la partida 2.", "angeles@proyinstelec.mx");
      const html = correos()[0].html;
      expect(html).toContain("Nota de María de los Ángeles McAllen");
      expect(html).not.toContain("angeles@proyinstelec.mx");
    });

    // El correo es el último recurso, no el primero: sirve para no dejar la
    // nota sin firma cuando la cuenta no está en el catálogo.
    it("si no hay nombre, entonces sí el correo", async () => {
      await mandarCon("Revísame la partida 2.", "ana@proyinstelec.mx");
      expect(correos()[0].html).toContain("Nota de ana@proyinstelec.mx");
    });

    /**
     * La etiqueta era `text-transform:uppercase`, y un nombre en mayúsculas
     * deja de ser el nombre de nadie: "McAllen" pasa a "MCALLEN". Como el
     * nombre va dentro de la etiqueta, la regla tuvo que salir.
     */
    it("la etiqueta no pone el nombre en mayúsculas", async () => {
      await mandarCon("Revísame la partida 2.", "angeles@proyinstelec.mx");
      const renglon = /<p[^>]*>Nota de [^<]*<\/p>/.exec(correos()[0].html)?.[0] ?? "";
      expect(renglon).toContain("McAllen");
      expect(renglon).not.toContain("text-transform");
    });

    // Lo que alguien teclea no es marcado: un <b> tiene que verse, no aplicarse.
    it("la nota sale escapada", async () => {
      await mandarCon('Ojo con <b>esto</b> & "lo otro".');
      const html = correos()[0].html;
      expect(html).toContain("&lt;b&gt;esto&lt;/b&gt;");
      expect(html).toContain("&amp;");
      expect(html).not.toContain("<b>esto</b>");
    });

    it("se recorta a 1,500 caracteres", async () => {
      await mandarCon("x".repeat(2000));
      expect(correos()[0].html).toContain("x".repeat(1500));
      expect(correos()[0].html).not.toContain("x".repeat(1501));
    });

    // Queda registrada aunque el correo falle: es lo que alguien dijo al
    // mandarla, y el correo es solo por dónde viaja.
    it("queda en la bitácora con su propia acción", async () => {
      await mandarCon("Urge para el viernes.");
      expect(registrarBitacora).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: "COTIZACION_NOTA_REVISION",
          usuario: "ana@proyinstelec.mx",
          detalle: "PCOTOP-001-2026 · Urge para el viernes.",
        }),
      );
    });

    it("sin nota, todo sale como antes", async () => {
      await mandarCon();
      for (const c of correos()) expect(c.html).not.toContain("Nota de");
      expect(registrarBitacora).not.toHaveBeenCalledWith(
        expect.objectContaining({ accion: "COTIZACION_NOTA_REVISION" }),
      );
    });

    it("una nota en blanco es como no mandar ninguna", async () => {
      await mandarCon("    ");
      for (const c of correos()) expect(c.html).not.toContain("Nota de");
      expect(registrarBitacora).not.toHaveBeenCalledWith(
        expect.objectContaining({ accion: "COTIZACION_NOTA_REVISION" }),
      );
    });
  });

  // ── El punto final de la razón social ──────────────────────────────────────

  /**
   * Casi todas las razones sociales terminan en "S.A. de C.V.", y la
   * confirmación salía con "IGSA S.A.P.I de C.V.. Te avisaremos". Es la misma
   * errata que el sistema viejo imprime en todos sus documentos, y es la misma
   * regla que ya aplica el generador: si ya hay punto, no se pone otro.
   */
  describe("el punto final de la razón social", () => {
    const mandarConCliente = (cliente: string) => {
      vi.mocked(cambiarEstatus).mockResolvedValue({
        ...vigente,
        version: 0,
        estatus: "REVISION",
        cliente,
      } as any);
      return enviarARevision({
        numero: 1, anio: 2026, version: 0, usuario: "ana@proyinstelec.mx",
      });
    };
    /** El segundo correo es la confirmación a quien elaboró. */
    const confirmacion = () => vi.mocked(enviarCorreo).mock.calls.map(([c]) => c)[1].html;

    it("no le agrega un segundo punto a la que ya lo trae", async () => {
      await mandarConCliente("IGSA S.A.P.I de C.V.");

      expect(confirmacion()).toContain("IGSA S.A.P.I de C.V. Te avisaremos");
      expect(confirmacion()).not.toContain("C.V.. Te");
    });

    it("y se lo pone a la que no", async () => {
      await mandarConCliente("Aceros del Norte");

      expect(confirmacion()).toContain("Aceros del Norte. Te avisaremos");
    });
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

    // Sobre la fila que se validó, no sobre "la vigente de ahora".
    expect(cambiarEstatus).toHaveBeenCalledWith(1, 2026, "PROCESO", 0);
    const llamada = vi.mocked(enviarCorreo).mock.calls[0][0];
    expect(llamada.html).toContain("Falta el desglose de materiales");
  });

  it("el correo lleva el folio canónico aunque la columna diga \"-v1\"", async () => {
    const importada = { ...vigente, version: 1, folio: "PCOTOP-001-2026-v1", estatus: "REVISION" };
    vi.mocked(getVigente).mockResolvedValue(importada as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({ ...importada, estatus: "PROCESO" } as any);

    await solicitarCorreccion({
      numero: 1, anio: 2026,
      comentario: "Falta el desglose de materiales", usuario: "eduardo@proyinstelec.mx",
    });

    const llamada = vi.mocked(enviarCorreo).mock.calls[0][0];
    expect(llamada.asunto).toBe("Corrección solicitada · PCOTOP-001-2026-1");
    expect(llamada.html).not.toContain("-v1");
  });
});

describe("enviarAlCliente", () => {
  /** Lo que vio la pantalla al abrir el envío de `vigente`: en REVISION, nunca enviada. */
  const VISTO = { version: 0, estatus: "REVISION" as const, fechaEnvio: null };

  const pedido = (extra: Partial<Parameters<typeof enviarAlCliente>[0]> = {}) => ({
    numero: 1,
    anio: 2026,
    destinatarios: [CONTACTO],
    visto: VISTO,
    remitente: { email: "maria@proyinstelec.mx", nombre: "María" },
    ...extra,
  });

  function conPdf(cotizacion: Record<string, unknown> = vigente) {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: cotizacion as never });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue({
      pdf: { filename: "PCOTOP-001-2026.pdf", contenido: Buffer.from("pdf") },
      nombresEnCarpeta: ["PCOTOP-001-2026.pdf"],
    });
  }

  it("bloquea sin aprobación (motivo del validador)", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({
      puede: false, motivo: "Esperando aprobación del revisor", cotizacion: vigente as never,
    });
    const enviar = enviarAlCliente(pedido());
    await expect(enviar).rejects.toThrow("Esperando aprobación");
    await expect(enviar).rejects.toBeInstanceOf(EnvioNoPermitido);
  });

  it("el PDF es obligatorio", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: vigente as never });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue({
      pdf: null,
      nombresEnCarpeta: ["otra-cosa.pdf"],
    });
    await expect(enviarAlCliente(pedido())).rejects.toThrow("PDF");
    expect(apartarEnvio).not.toHaveBeenCalled();
  });

  // El mensaje es una instrucción: le dice al equipo con qué nombre generar el
  // PDF. Si interpolara `cotizacion.folio`, las 75 filas cargadas con "-v1"
  // harían que el sistema pidiera justo el nombre que esta rama viene a quitar.
  it("el error pide el folio canónico, no el que está guardado en la fila", async () => {
    const conFolioMalo = { ...vigente, version: 1, folio: "PCOTOP-001-2026-v1" };
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({
      puede: true,
      cotizacion: conFolioMalo as never,
    });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue({
      pdf: null,
      nombresEnCarpeta: ["PCOTOP-001-2026-1 Subestación.pdf"],
    });

    const enviar = enviarAlCliente(pedido({ visto: { ...VISTO, version: 1 } }));

    await expect(enviar).rejects.toThrow('"PCOTOP-001-2026-1 …"');
    await expect(enviar).rejects.not.toThrow("-v1");
    // Y se busca por el canónico, que es lo que de verdad se llama el archivo
    expect(vi.mocked(buscarPdfCotizacion).mock.calls[0][0].folio).toBe("PCOTOP-001-2026-1");
  });

  it("el error dice qué PDF sí había en la carpeta", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: vigente as never });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue({
      pdf: null,
      nombresEnCarpeta: ["PCOTOP-001-2026_Subestación.pdf"],
    });

    await expect(enviarAlCliente(pedido())).rejects.toThrow("PCOTOP-001-2026_Subestación.pdf");
  });

  it("envía con PDF adjunto, CC al resto del equipo y aparta el envío", async () => {
    conPdf();
    vi.mocked(getVersion).mockResolvedValue({ ...vigente, estatus: "ENVIADA" } as never);

    await enviarAlCliente(pedido());

    const llamada = vi.mocked(enviarCorreo).mock.calls[0][0];
    expect(llamada.para).toEqual([CONTACTO]);
    expect(llamada.cc).toEqual(["eduardo@proyinstelec.mx"]); // el equipo menos la remitente
    expect(llamada.adjuntos?.[0].filename).toBe("PCOTOP-001-2026.pdf");
    // Sobre la versión cuya aprobación se verificó, y con lo que vio la
    // pantalla: es lo que impide un segundo correo.
    expect(apartarEnvio).toHaveBeenCalledWith({
      numero: 1, anio: 2026, visto: VISTO, ahora: expect.any(Date),
    });
    // Ya no por `cambiarEstatus`, que mira y luego escribe
    expect(cambiarEstatus).not.toHaveBeenCalled();
    expect(updateCotizacion).not.toHaveBeenCalled();
    expect(devolverEnvio).not.toHaveBeenCalled();
  });

  it("aparta el envío ANTES de mandar el correo", async () => {
    conPdf();

    await enviarAlCliente(pedido());

    const apartado = vi.mocked(apartarEnvio).mock.invocationCallOrder[0];
    const correo = vi.mocked(enviarCorreo).mock.invocationCallOrder[0];
    expect(apartado).toBeLessThan(correo);
  });

  // Este correo sale al CLIENTE, y el folio que lleva es el que va a citar en
  // su orden de compra. El título viaja en `plantillaCorreo`, que el falso
  // reduce al cuerpo: por eso se mira la llamada y no el html.
  it("el correo al cliente lleva el folio canónico, no el de la columna", async () => {
    const importada = { ...vigente, version: 1, folio: "PCOTOP-001-2026-v1" };
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: importada as never });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue({
      pdf: { filename: "PCOTOP-001-2026-1.pdf", contenido: Buffer.from("pdf") },
      nombresEnCarpeta: ["PCOTOP-001-2026-1.pdf"],
    });

    await enviarAlCliente(pedido({ visto: { ...VISTO, version: 1 } }));

    expect(vi.mocked(plantillaCorreo).mock.calls[0][0].titulo).toBe(
      "Cotización PCOTOP-001-2026-1",
    );
    // Y el envío se aparta en la versión aprobada, no en la vigente
    expect(vi.mocked(apartarEnvio).mock.calls[0][0].visto.version).toBe(1);
  });

  // El estatus ENVIADA afirma que el cliente recibió la cotización. Si el correo
  // no salió, la afirmación es falsa: lo apartado se devuelve, y la cotización
  // queda como estaba.
  describe("si el correo no salió, se devuelve lo apartado", () => {
    beforeEach(() => conPdf());

    const enviar = () => enviarAlCliente(pedido());

    /** Lo que se devolvió es exactamente lo que se apartó. */
    function seDevolvioLoApartado() {
      expect(apartarEnvio).toHaveBeenCalledTimes(1);
      expect(devolverEnvio).toHaveBeenCalledWith(vi.mocked(apartarEnvio).mock.calls[0][0]);
      expect(cambiarEstatus).not.toHaveBeenCalled();
    }

    it("CORREO_DESHABILITADO=true: nombra la variable y no queda enviada", async () => {
      vi.mocked(enviarCorreo).mockResolvedValueOnce({ enviado: false, motivo: "deshabilitado" });

      await expect(enviar()).rejects.toThrow("CORREO_DESHABILITADO");
      seDevolvioLoApartado();
    });

    it("modo demo: tampoco", async () => {
      vi.mocked(enviarCorreo).mockResolvedValueOnce({ enviado: false, motivo: "demo" });

      await expect(enviar()).rejects.toThrow("demo");
      seDevolvioLoApartado();
    });

    it("error del proveedor de correo: sigue abortando", async () => {
      vi.mocked(enviarCorreo).mockResolvedValueOnce({ enviado: false, motivo: "error" });

      await expect(enviar()).rejects.toThrow("bitácora");
      seDevolvioLoApartado();
    });

    it("si el envío lanza en vez de contestar, también", async () => {
      vi.mocked(enviarCorreo).mockRejectedValueOnce(new Error("Gmail se cayó"));
      const consola = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(enviar()).rejects.toThrow("NO se marcó como enviada");
      seDevolvioLoApartado();
      expect(consola).toHaveBeenCalled();
      consola.mockRestore();
    });

    it("si alguien la movió mientras tanto, no la pisa y lo dice", async () => {
      vi.mocked(enviarCorreo).mockResolvedValueOnce({ enviado: false, motivo: "error" });
      vi.mocked(devolverEnvio).mockResolvedValueOnce(false);

      await expect(enviar()).rejects.toThrow("no se pudo regresar");
      expect(registrarBitacora).toHaveBeenCalledWith(
        expect.objectContaining({ accion: "COTIZACION_ENVIO_NO_DESHECHO" }),
      );
    });
  });
});

/**
 * A quién se le puede mandar (el M7 de la revisión del 17 nov): solo
 * contactos del cliente y correos de la empresa, con al menos un contacto del
 * cliente. Si uno no cuadra, no sale nada: ni se busca el PDF ni se aparta.
 */
describe("enviarAlCliente — destinatarios", () => {
  const VISTO = { version: 0, estatus: "REVISION" as const, fechaEnvio: null };
  const enviarA = (destinatarios: string[]) =>
    enviarAlCliente({
      numero: 1, anio: 2026, destinatarios, visto: VISTO,
      remitente: { email: "alguien@empresa.test", nombre: "Alguien" },
    });

  beforeEach(() => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: vigente as never });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue({
      pdf: { filename: "c.pdf", contenido: Buffer.from("pdf") },
      nombresEnCarpeta: [],
    });
  });

  function noSalioNada() {
    expect(buscarPdfCotizacion).not.toHaveBeenCalled();
    expect(apartarEnvio).not.toHaveBeenCalled();
    expect(enviarCorreo).not.toHaveBeenCalled();
  }

  it("un correo que no es contacto del cliente: no sale nada, y dice que se dé de alta", async () => {
    const enviar = enviarA(["alguien@otra.test"]);

    await expect(enviar).rejects.toBeInstanceOf(DestinatariosNoValidos);
    await expect(enviar).rejects.toThrow(/alguien@otra\.test no es contacto de Aceros del Norte/);
    await expect(enviar).rejects.toThrow("dalo de alta como contacto del cliente en Clientes");
    noSalioNada();
  });

  it("uno bueno y uno ajeno: tampoco sale el bueno", async () => {
    await expect(enviarA([CONTACTO, "alguien@otra.test"])).rejects.toThrow("No se envió nada");
    noSalioNada();
  });

  it("solo gente de la empresa: falta un contacto del cliente", async () => {
    await expect(enviarA(["alguien@empresa.test"])).rejects.toThrow(
      "falta al menos un contacto de Aceros del Norte",
    );
    noSalioNada();
  });

  it("un contacto más gente de la empresa: sale, a los dos", async () => {
    await enviarA([CONTACTO, "gerencia@empresa.test"]);

    expect(vi.mocked(enviarCorreo).mock.calls[0][0].para).toEqual([CONTACTO, "gerencia@empresa.test"]);
  });

  it("manda las direcciones como están en el catálogo, sin repetir", async () => {
    await enviarA([" Compras@Cliente.TEST ", CONTACTO]);

    expect(vi.mocked(enviarCorreo).mock.calls[0][0].para).toEqual([CONTACTO]);
  });

  // Los destinatarios van tal cual en la cabecera `To:` del correo.
  it("un salto de línea no abre otra cabecera", async () => {
    await expect(enviarA([`${CONTACTO}\r\nBcc: alguien@otra.test`])).rejects.toThrow("No se envió nada");
    noSalioNada();
  });

  it("la lista es la del cliente de la cotización (su cliente_id), la misma que ve la pantalla", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({
      puede: true, cotizacion: { ...vigente, cliente_id: "e9" } as never,
    });

    await enviarA([CONTACTO]);

    expect(contactosParaEnvio).toHaveBeenCalledWith({
      razonSocial: "Aceros del Norte", dirigidaA: "Juan", clienteId: "e9",
    });
  });
});

/**
 * Sin doble envío: un segundo clic, otra pestaña u otra persona no mandan un
 * segundo correo. Lo que decide es lo que vio la pantalla al abrir el envío.
 */
describe("enviarAlCliente — sin doble envío", () => {
  const VISTO = { version: 0, estatus: "REVISION" as const, fechaEnvio: null };
  const PRIMER_ENVIO = "2026-11-20T18:03:05.123Z";
  const enviar = (visto: typeof VISTO | { version: number; estatus: "ENVIADA"; fechaEnvio: string } = VISTO) =>
    enviarAlCliente({
      numero: 1, anio: 2026, destinatarios: [CONTACTO], visto,
      remitente: { email: "alguien@empresa.test", nombre: "Alguien" },
    });

  beforeEach(() => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: vigente as never });
    vi.mocked(buscarPdfCotizacion).mockResolvedValue({
      pdf: { filename: "c.pdf", contenido: Buffer.from("pdf") },
      nombresEnCarpeta: [],
    });
  });

  it("si otro clic apartó primero: «ya se envió», y no sale correo", async () => {
    vi.mocked(apartarEnvio).mockResolvedValueOnce(false);
    vi.mocked(getVigente).mockResolvedValue({ ...vigente, estatus: "ENVIADA", fecha_envio: PRIMER_ENVIO } as never);

    const intento = enviar();

    await expect(intento).rejects.toBeInstanceOf(EnvioDesactualizado);
    await expect(intento).rejects.toThrow("Ya se envió: no se mandó otro correo");
    expect(enviarCorreo).not.toHaveBeenCalled();
    expect(devolverEnvio).not.toHaveBeenCalled();
  });

  // El caso que una revisión «¿se puede enviar?» deja pasar: ENVIADA se puede
  // reenviar. Lo detiene que la pantalla la vio sin enviar.
  it("si el primer clic ya terminó: «ya se envió», sin buscar el PDF ni apartar", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({
      puede: true, cotizacion: { ...vigente, estatus: "ENVIADA", fecha_envio: PRIMER_ENVIO } as never,
    });

    await expect(enviar()).rejects.toThrow("Ya se envió");
    expect(buscarPdfCotizacion).not.toHaveBeenCalled();
    expect(apartarEnvio).not.toHaveBeenCalled();
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it("un reenvío a propósito sí sale: la pantalla ya vio el primer envío", async () => {
    const enviada = { ...vigente, estatus: "ENVIADA", fecha_envio: PRIMER_ENVIO };
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: enviada as never });
    const visto = { version: 0, estatus: "ENVIADA" as const, fechaEnvio: PRIMER_ENVIO };

    await enviar(visto);

    expect(apartarEnvio).toHaveBeenCalledWith(expect.objectContaining({ visto }));
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });

  it("si la cancelaron mientras tanto, lo dice así, sin «ya se envió»", async () => {
    vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({
      puede: false,
      motivo: "La cotización está en CANCELADA; debe pasar por revisión",
      cotizacion: { ...vigente, estatus: "CANCELADA" } as never,
    });

    const intento = enviar();

    await expect(intento).rejects.toThrow("cambió mientras tanto (ahora está en CANCELADA)");
    await expect(intento).rejects.not.toThrow("Ya se envió");
    expect(enviarCorreo).not.toHaveBeenCalled();
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

    await expect(ingresarOrdenCompra({ ...alta, version: 7 })).rejects.toThrow("PCOTOP-002-2026-7");
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

// ── Lo que alguien teclea no es marcado ───────────────────────────────────────

/**
 * Los correos se arman concatenando texto de la base, y casi todo ese texto lo
 * tecleó una persona: la razón social, el título, las iniciales, el comentario
 * del revisor. Un cliente llamado `Aceros & Cía <MX>` no puede romper la tabla
 * del correo, y menos el que sale de la empresa.
 */
describe("el texto tecleado va escapado en los correos", () => {
  const FEO = 'Aceros & Cía <script>alert(1)</script> "SA"';
  const sucia = { ...vigente, cliente: FEO, titulo: "Subestación <b>Norte</b>" };

  it("la razón social y el título, en la tabla del correo al revisor", async () => {
    vi.mocked(cambiarEstatus).mockResolvedValue({ ...sucia, estatus: "REVISION" } as any);

    await enviarARevision({ numero: 1, anio: 2026, version: 0, usuario: "ana@proyinstelec.mx" });

    const [alRevisor] = vi.mocked(enviarCorreo).mock.calls.map(([c]) => c);
    expect(alRevisor.html).toContain("Aceros &amp; Cía &lt;script&gt;");
    expect(alRevisor.html).toContain("Subestación &lt;b&gt;Norte&lt;/b&gt;");
    expect(alRevisor.html).not.toContain("<script>");
  });

  it("y en la confirmación a quien elaboró", async () => {
    vi.mocked(cambiarEstatus).mockResolvedValue({ ...sucia, estatus: "REVISION" } as any);

    await enviarARevision({ numero: 1, anio: 2026, version: 0, usuario: "ana@proyinstelec.mx" });

    const correos = vi.mocked(enviarCorreo).mock.calls.map(([c]) => c);
    expect(correos[1].html).not.toContain("<script>");
    expect(correos[1].html).toContain("Aceros &amp; Cía");
  });

  /**
   * El asunto **no** es HTML: escaparlo haría que el revisor leyera
   * «Aceros &amp;amp; Cía» en su bandeja.
   */
  it("el asunto no se escapa, porque no es HTML", async () => {
    vi.mocked(cambiarEstatus).mockResolvedValue({ ...sucia, estatus: "REVISION" } as any);

    await enviarARevision({ numero: 1, anio: 2026, version: 0, usuario: "ana@proyinstelec.mx" });

    expect(vi.mocked(enviarCorreo).mock.calls[0][0].asunto).toContain("Aceros & Cía");
  });

  // Lo teclea el revisor, y va en el correo de vuelta a quien cotizó.
  it("el comentario del revisor, al pedir una corrección", async () => {
    vi.mocked(getVigente).mockResolvedValue(vigente as any);
    vi.mocked(cambiarEstatus).mockResolvedValue({ ...vigente, estatus: "PROCESO" } as any);

    await solicitarCorreccion({
      numero: 1, anio: 2026,
      comentario: 'Revisa el <b>precio</b> & la vigencia',
      usuario: "eduardo@proyinstelec.mx",
    });

    const html = vi.mocked(enviarCorreo).mock.calls[0][0].html;
    expect(html).toContain("Revisa el &lt;b&gt;precio&lt;/b&gt; &amp; la vigencia");
    expect(html).not.toContain("<b>precio</b>");
  });

  describe("el correo al cliente", () => {
    beforeEach(() => {
      vi.mocked(puedeEnviarseAlCliente).mockResolvedValue({ puede: true, cotizacion: sucia as any });
      vi.mocked(buscarPdfCotizacion).mockResolvedValue({
        pdf: { filename: "c.pdf", contenido: Buffer.from("PDF") },
        nombresEnCarpeta: [],
      } as any);
      vi.mocked(listUsers).mockResolvedValue([] as any);
    });

    const VISTO = { version: 0, estatus: "REVISION" as const, fechaEnvio: null };

    // Este sale de la empresa: es el que más importa de todos.
    it("escapa el título y a quién va dirigida en el cuerpo por omisión", async () => {
      await enviarAlCliente({
        numero: 1, anio: 2026, destinatarios: [CONTACTO], visto: VISTO,
        remitente: { email: "alguien@empresa.test", nombre: 'Alguien <"Tere">' },
      });

      const html = vi.mocked(enviarCorreo).mock.calls[0][0].html;
      expect(html).toContain("Subestación &lt;b&gt;Norte&lt;/b&gt;");
      expect(html).toContain("Alguien &lt;&quot;Tere&quot;&gt;");
      expect(html).not.toContain("<b>Norte</b>");
    });

    /**
     * El «Mensaje» es texto tecleado como cualquier otro (el M7 de la revisión
     * del 17 nov). Antes la pantalla lo envolvía en un `<p>` sin escapar y el
     * servidor lo mandaba tal cual: lo que se tecleaba llegaba como marcado al
     * cliente. Ahora se escapa, y los saltos de línea se conservan.
     */
    it("el mensaje que escribió quien envía va escapado, con sus saltos de línea", async () => {
      await enviarAlCliente({
        numero: 1, anio: 2026, destinatarios: [CONTACTO], visto: VISTO,
        remitente: { email: "alguien@empresa.test", nombre: "Alguien" },
        mensaje: 'Estimado <b>cliente</b>:\r\nva la propuesta & el <a href="x">PDF</a>.\n\nSaludos',
      });

      const html = vi.mocked(enviarCorreo).mock.calls[0][0].html;
      expect(html).toContain(
        "Estimado &lt;b&gt;cliente&lt;/b&gt;:<br/>va la propuesta &amp; el &lt;a href=&quot;x&quot;&gt;PDF&lt;/a&gt;.<br/><br/>Saludos",
      );
      expect(html).not.toContain("<b>cliente</b>");
      expect(html).not.toContain('<a href="x">');
    });

    it("un mensaje en blanco deja el cuerpo por omisión", async () => {
      await enviarAlCliente({
        numero: 1, anio: 2026, destinatarios: [CONTACTO], visto: VISTO,
        remitente: { email: "alguien@empresa.test", nombre: "Alguien" },
        mensaje: "   \n  ",
      });

      expect(vi.mocked(enviarCorreo).mock.calls[0][0].html).toContain("Quedamos atentos");
    });
  });
});
