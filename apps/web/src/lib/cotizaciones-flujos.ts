import { registrarBitacora } from "./bitacora";
import { getConfigErp } from "./config-erp";
import {
  cambiarEstatus,
  cotPk,
  getVigente,
  puedeEnviarseAlCliente,
  registrarAprobacion,
  updateCotizacion,
  type Cotizacion,
} from "./cotizaciones";
import { contactosParaEnvio, type ClienteEmpresa, type Contacto } from "./clientes";
import { enviarCorreo, plantillaCorreo, type Adjunto } from "./correo";
import {
  buscarPdfCotizacion,
  ensureCarpetaOT,
  ensureSubcarpetaOCCotizacion,
  subirArchivoErp,
} from "./drive-erp";
import { folioOT } from "./folios";
import { createOT, registrarResponsable, setCarpetaDriveOT } from "./ot";
import { permisosEfectivos } from "./permisos";
import { listUsers, type UserProfile } from "./users";

/**
 * Flujos de negocio de cotizaciones (revisión → aprobación → envío → OC → OT),
 * con las reglas y notificaciones del ERP legacy. Los errores de Drive y de
 * correo no abortan la operación principal (regla del legacy): se registran
 * en bitácora y se reportan en el resultado como avisos.
 */

// ── Resolución de personas por permiso (sustituye listas hardcodeadas) ────────

async function usuariosConPermiso(permiso: string): Promise<UserProfile[]> {
  const todos = await listUsers();
  return todos.filter((u) => (permisosEfectivos(u) as string[]).includes(permiso));
}

export async function correosRevisores(): Promise<string[]> {
  return (await usuariosConPermiso("cotizaciones.aprobar")).map((u) => u.email);
}

export async function equipoRemitentes(): Promise<UserProfile[]> {
  return usuariosConPermiso("cotizaciones.enviar");
}

/** Correo del elaborador: match por iniciales o por nombre contra el catálogo. */
export async function correoDeElaborador(elaboro: string): Promise<string | null> {
  const todos = await listUsers();
  const valor = elaboro.trim().toLowerCase();
  const porIniciales = todos.find((u) => u.iniciales?.toLowerCase() === valor);
  if (porIniciales) return porIniciales.email;
  const porNombre = todos.find((u) => u.nombre.toLowerCase() === valor);
  return porNombre?.email ?? null;
}

const urlSistema = () => process.env.NEXTAUTH_URL ?? "";
const filaTabla = (etiqueta: string, valor: string) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;">${etiqueta}</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:bold;">${valor}</td></tr>`;

/** Importe con separadores de miles: "1234.5" → "1,234.50". */
export function formatearMonto(monto: string, moneda: "MXN" | "USD"): string {
  const n = Number(monto);
  const cifra = Number.isFinite(n)
    ? n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : monto;
  return `$${cifra} ${moneda}`;
}

/**
 * Filas de importe para los correos. Una por moneda y nunca una suma: los
 * montos en pesos y en dólares son independientes, y totalizarlos exigiría
 * inventar un tipo de cambio. Sin montos capturados no se imprime nada.
 */
function montoParaCorreo(cot: Cotizacion): string {
  return [
    cot.monto_mxn ? filaTabla("Monto MXN", formatearMonto(cot.monto_mxn, "MXN")) : "",
    cot.monto_usd ? filaTabla("Monto USD", formatearMonto(cot.monto_usd, "USD")) : "",
  ].join("");
}

// ── 0. Alta y nueva versión (con carpeta y plantillas de Drive) ───────────────

export async function crearCotizacionCompleta(params: {
  numero: number;
  anio: number;
  cliente: string;
  clienteId?: string;
  titulo: string;
  dirigidaA: string;
  prioridad?: "BAJA" | "MEDIA" | "ALTA";
  elaboro: string;
  fechaEntrega?: string;
  montoMxn?: string | number | null;
  montoUsd?: string | number | null;
  createdBy: string;
}): Promise<{ cotizacion: Cotizacion; avisos: string[] }> {
  const avisos: string[] = [];
  const { createCotizacion } = await import("./cotizaciones");
  const cotizacion = await createCotizacion(params);

  try {
    const { ensureCarpetaCotizacion, copiarPlantillasCotizacion } = await import("./drive-erp");
    const carpeta = await ensureCarpetaCotizacion(params.numero, params.anio);
    await updateCotizacion(params.numero, params.anio, {
      driveFolderId: carpeta.folderId,
      driveFolderUrl: carpeta.folderUrl,
    });
    cotizacion.drive_folder_id = carpeta.folderId;
    cotizacion.drive_folder_url = carpeta.folderUrl;
    await copiarPlantillasCotizacion({
      folderId: carpeta.folderId,
      folio: cotizacion.folio,
      titulo: cotizacion.titulo,
    });
  } catch (err) {
    avisos.push(`Drive: ${(err as Error).message} (la cotización se creó de todos modos)`);
  }

  await registrarBitacora({
    accion: "COTIZACION_CREADA",
    usuario: params.createdBy,
    referencia: cotPk(cotizacion.numero, cotizacion.anio),
    detalle: cotizacion.folio,
  });
  return { cotizacion, avisos };
}

export async function crearNuevaVersionCompleta(params: {
  numero: number;
  anio: number;
  prioridad?: "BAJA" | "MEDIA" | "ALTA";
  elaboro?: string;
  createdBy: string;
}): Promise<{ cotizacion: Cotizacion; avisos: string[] }> {
  const avisos: string[] = [];
  const { crearNuevaVersion } = await import("./cotizaciones");
  const cotizacion = await crearNuevaVersion(params);

  // Nuevas copias de las plantillas a la MISMA carpeta (todas las versiones la comparten)
  try {
    const { ensureCarpetaCotizacion, copiarPlantillasCotizacion } = await import("./drive-erp");
    const carpeta = cotizacion.drive_folder_id
      ? { folderId: cotizacion.drive_folder_id }
      : await ensureCarpetaCotizacion(params.numero, params.anio);
    await copiarPlantillasCotizacion({
      folderId: carpeta.folderId,
      folio: cotizacion.folio,
      titulo: cotizacion.titulo,
    });
  } catch (err) {
    avisos.push(`Drive: ${(err as Error).message}`);
  }

  await registrarBitacora({
    accion: "COTIZACION_NUEVA_VERSION",
    usuario: params.createdBy,
    referencia: cotPk(cotizacion.numero, cotizacion.anio),
    detalle: cotizacion.folio,
  });
  return { cotizacion, avisos };
}

// ── 1. Enviar a revisión ──────────────────────────────────────────────────────

export async function enviarARevision(params: {
  numero: number;
  anio: number;
  usuario: string;
}): Promise<{ cotizacion: Cotizacion; avisos: string[] }> {
  const avisos: string[] = [];
  const cotizacion = await cambiarEstatus(params.numero, params.anio, "REVISION");

  await registrarBitacora({
    accion: "COTIZACION_A_REVISION",
    usuario: params.usuario,
    referencia: cotPk(cotizacion.numero, cotizacion.anio),
    detalle: cotizacion.folio,
  });

  // PDF adjunto si ya existe en la carpeta (opcional en esta etapa)
  let adjuntos: Adjunto[] | undefined;
  if (cotizacion.drive_folder_id) {
    try {
      const pdf = await buscarPdfCotizacion({
        folderId: cotizacion.drive_folder_id,
        folio: cotizacion.folio,
      });
      if (pdf) {
        adjuntos = [{ filename: pdf.filename, mimeType: "application/pdf", contenido: pdf.contenido }];
      } else {
        avisos.push("No se localizó el PDF en la carpeta; el correo de revisión salió sin adjunto");
      }
    } catch {
      avisos.push("No se pudo leer la carpeta de Drive; el correo de revisión salió sin adjunto");
    }
  }

  // Correo a revisores con acceso directo a la bandeja de revisión
  const revisores = await correosRevisores();
  if (revisores.length === 0) {
    avisos.push("No hay usuarios con permiso cotizaciones.aprobar; nadie recibió el aviso de revisión");
  } else {
    await enviarCorreo({
      para: revisores,
      asunto: `Lista para Revisión · ${cotizacion.folio} · ${cotizacion.cliente}`,
      html: plantillaCorreo({
        titulo: "Cotización lista para revisión",
        cuerpoHtml: `<table>${filaTabla("Folio", cotizacion.folio)}${filaTabla("Cliente", cotizacion.cliente)}${filaTabla("Título", cotizacion.titulo)}${filaTabla("Elaboró", cotizacion.elaboro)}</table>
          <p style="margin:16px 0 0;"><a href="${urlSistema()}/erp/revision" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:bold;">Revisar en el sistema</a></p>
          <p style="color:#6b7280;font-size:12px;margin-top:12px;">Desde ahí puedes aprobarla o solicitar una corrección.</p>`,
      }),
      adjuntos,
      registradoPor: params.usuario,
      referencia: cotPk(cotizacion.numero, cotizacion.anio),
    });
  }

  // Confirmación al elaborador
  const correoElab = await correoDeElaborador(cotizacion.elaboro);
  if (correoElab && correoElab !== params.usuario) {
    await enviarCorreo({
      para: [correoElab],
      asunto: `Enviada a revisión · ${cotizacion.folio}`,
      html: plantillaCorreo({
        titulo: "Tu cotización fue enviada a revisión",
        cuerpoHtml: `<p style="font-size:13px;color:#111827;">${cotizacion.folio} · ${cotizacion.cliente}. Te avisaremos cuando el revisor la apruebe o pida una corrección.</p>`,
      }),
      registradoPor: params.usuario,
      referencia: cotPk(cotizacion.numero, cotizacion.anio),
    });
  }

  return { cotizacion, avisos };
}

// ── 2. Aprobar / solicitar corrección (autenticado, permiso cotizaciones.aprobar)

export async function aprobarCotizacion(params: {
  numero: number;
  anio: number;
  aprobadoPor: string;
}): Promise<Cotizacion> {
  const vigente = await getVigente(params.numero, params.anio);
  if (!vigente) throw new Error("Cotización no encontrada");
  if (vigente.estatus !== "REVISION") {
    throw new Error(`La cotización ya no está en revisión (estatus actual: ${vigente.estatus})`);
  }

  await registrarAprobacion({
    numero: params.numero,
    anio: params.anio,
    version: vigente.version,
    aprobadoPor: params.aprobadoPor,
  });
  await registrarBitacora({
    accion: "COTIZACION_APROBADA",
    usuario: params.aprobadoPor,
    referencia: cotPk(vigente.numero, vigente.anio),
    detalle: `${vigente.folio} v${vigente.version}`,
  });

  const correoElab = await correoDeElaborador(vigente.elaboro);
  if (correoElab) {
    await enviarCorreo({
      para: [correoElab],
      asunto: `Aprobada · ${vigente.folio}`,
      html: plantillaCorreo({
        titulo: "Cotización aprobada",
        cuerpoHtml: `<p style="font-size:13px;color:#111827;">${vigente.folio} · ${vigente.cliente} fue aprobada. Ya puedes enviarla al cliente desde el sistema.</p>`,
      }),
      registradoPor: params.aprobadoPor,
      referencia: cotPk(vigente.numero, vigente.anio),
    });
  }

  return vigente;
}

export async function solicitarCorreccion(params: {
  numero: number;
  anio: number;
  comentario: string;
  usuario: string;
}): Promise<Cotizacion> {
  if (params.comentario.trim().length < 10) {
    throw new Error("El comentario de corrección debe tener al menos 10 caracteres");
  }
  const vigente = await getVigente(params.numero, params.anio);
  if (!vigente) throw new Error("Cotización no encontrada");
  if (vigente.estatus !== "REVISION") {
    throw new Error(`La cotización ya no está en revisión (estatus actual: ${vigente.estatus})`);
  }

  const cotizacion = await cambiarEstatus(params.numero, params.anio, "PROCESO");
  await registrarBitacora({
    accion: "COTIZACION_CORRECCION",
    usuario: params.usuario,
    referencia: cotPk(cotizacion.numero, cotizacion.anio),
    detalle: params.comentario.trim(),
  });

  const correoElab = await correoDeElaborador(cotizacion.elaboro);
  if (correoElab) {
    await enviarCorreo({
      para: [correoElab],
      asunto: `Corrección solicitada · ${cotizacion.folio}`,
      html: plantillaCorreo({
        titulo: "Se solicitó una corrección",
        cuerpoHtml: `<table>${filaTabla("Folio", cotizacion.folio)}${filaTabla("Cliente", cotizacion.cliente)}</table>
          <p style="font-size:13px;color:#111827;margin-top:12px;">La cotización regresó a PROCESO. Comentarios del revisor:</p>
          <blockquote style="border-left:3px solid #d1d5db;margin:8px 0;padding:4px 12px;color:#374151;font-size:13px;">${params.comentario.trim()}</blockquote>`,
      }),
      registradoPor: params.usuario,
      referencia: cotPk(cotizacion.numero, cotizacion.anio),
    });
  }

  return cotizacion;
}

// ── 3. Envío al cliente ───────────────────────────────────────────────────────

export interface DatosEnvio {
  puede: boolean;
  motivo?: string;
  cotizacion: Cotizacion | null;
  empresa: ClienteEmpresa | null;
  contactos: Contacto[];
  sugeridoId: string | null;
  asuntoSugerido: string;
  ccEquipo: string[];
  pdfDisponible: boolean;
}

export async function datosParaEnvio(params: {
  numero: number;
  anio: number;
  remitente: string;
}): Promise<DatosEnvio> {
  const { puede, motivo, cotizacion } = await puedeEnviarseAlCliente(params.numero, params.anio);
  const base: DatosEnvio = {
    puede,
    motivo,
    cotizacion,
    empresa: null,
    contactos: [],
    sugeridoId: null,
    asuntoSugerido: "",
    ccEquipo: [],
    pdfDisponible: false,
  };
  if (!cotizacion) return base;

  const { empresa, contactos, sugeridoId } = await contactosParaEnvio({
    razonSocial: cotizacion.cliente,
    dirigidaA: cotizacion.dirigida_a,
  });

  const equipo = await equipoRemitentes();
  const ccEquipo = equipo.map((u) => u.email).filter((e) => e !== params.remitente.toLowerCase());

  let pdfDisponible = false;
  if (cotizacion.drive_folder_id) {
    try {
      pdfDisponible =
        (await buscarPdfCotizacion({ folderId: cotizacion.drive_folder_id, folio: cotizacion.folio })) != null;
    } catch {
      pdfDisponible = false;
    }
  }

  return {
    ...base,
    empresa,
    contactos,
    sugeridoId,
    asuntoSugerido: `Cotización PCOTOP-${String(cotizacion.numero).padStart(3, "0")} - ${cotizacion.cliente}`,
    ccEquipo,
    pdfDisponible,
  };
}

export async function enviarAlCliente(params: {
  numero: number;
  anio: number;
  destinatarios: string[];
  asunto?: string;
  mensajeHtml?: string;
  telefonoFirma?: string;
  remitente: { email: string; nombre: string };
}): Promise<{ cotizacion: Cotizacion }> {
  const { puede, motivo, cotizacion } = await puedeEnviarseAlCliente(params.numero, params.anio);
  if (!cotizacion) throw new Error("Cotización no encontrada");
  if (!puede) throw new Error(motivo ?? "La cotización no puede enviarse todavía");
  if (params.destinatarios.filter(Boolean).length === 0) {
    throw new Error("Selecciona al menos un contacto con correo");
  }

  // PDF obligatorio (regla dura del legacy)
  if (!cotizacion.drive_folder_id) {
    throw new Error("La cotización no tiene carpeta de Drive; no se localizó el PDF");
  }
  const pdf = await buscarPdfCotizacion({
    folderId: cotizacion.drive_folder_id,
    folio: cotizacion.folio,
  });
  if (!pdf) {
    throw new Error(
      `No se encontró el PDF en la carpeta de la cotización. Genera el PDF con el nombre "${cotizacion.folio} …" y vuelve a intentar`,
    );
  }

  const equipo = await equipoRemitentes();
  const cc = equipo.map((u) => u.email).filter((e) => e !== params.remitente.email.toLowerCase());

  const asunto =
    params.asunto?.trim() ||
    `Cotización PCOTOP-${String(cotizacion.numero).padStart(3, "0")} - ${cotizacion.cliente}`;
  const cuerpo =
    params.mensajeHtml?.trim() ||
    `<p style="font-size:13px;color:#111827;">Estimado(a) ${cotizacion.dirigida_a}:</p>
     <p style="font-size:13px;color:#111827;">Por este medio le hacemos llegar nuestra propuesta económica del proyecto <b>${cotizacion.titulo}</b>, adjunta en PDF.</p>
     <p style="font-size:13px;color:#111827;">Quedamos atentos a sus comentarios.</p>
     <p style="font-size:13px;color:#111827;margin-top:16px;">${params.remitente.nombre}<br/>${params.telefonoFirma ?? ""}<br/>${params.remitente.email}</p>`;

  const resultado = await enviarCorreo({
    para: params.destinatarios,
    cc,
    asunto,
    html: plantillaCorreo({ titulo: `Cotización ${cotizacion.folio}`, cuerpoHtml: cuerpo }),
    adjuntos: [{ filename: pdf.filename, mimeType: "application/pdf", contenido: pdf.contenido }],
    registradoPor: params.remitente.email,
    referencia: cotPk(cotizacion.numero, cotizacion.anio),
  });
  if (!resultado.enviado && resultado.motivo === "error") {
    throw new Error("El correo al cliente no pudo enviarse; revisa la bitácora");
  }

  // Estatus → ENVIADA (si venía de REVISION) y fecha de envío
  const ahora = new Date().toISOString();
  if (cotizacion.estatus === "REVISION") {
    await cambiarEstatus(params.numero, params.anio, "ENVIADA");
  }
  await updateCotizacion(params.numero, params.anio, { fechaEnvio: ahora });

  await registrarBitacora({
    accion: "COTIZACION_ENVIADA",
    usuario: params.remitente.email,
    referencia: cotPk(cotizacion.numero, cotizacion.anio),
    detalle: `${cotizacion.folio} → ${params.destinatarios.join(", ")}`,
  });

  const actualizada = await getVigente(params.numero, params.anio);
  return { cotizacion: actualizada ?? cotizacion };
}

// ── 4. Ingreso de OC → generación de OT ───────────────────────────────────────

/**
 * Núcleo compartido por las dos vías de generación de OT: con orden de compra
 * y sin ella. Una cotización aceptada de palabra genera OT igual; el bloqueo de
 * "una cotización, una OT" vive en `createOT`, que revisa por (numero, anio).
 */
async function generarOT(params: {
  numero: number;
  anio: number;
  /** null = el cliente aceptó sin emitir OC. */
  ordenCompra: string | null;
  responsableCorreo: string;
  areas: string[]; // claves del catálogo de áreas
  adjunto?: { filename: string; mimeType: string; base64: string };
  usuario: string;
}): Promise<{ folioOt: string; avisos: string[] }> {
  const avisos: string[] = [];
  const ordenCompra = params.ordenCompra?.trim() || null;

  const vigente = await getVigente(params.numero, params.anio);
  if (!vigente) throw new Error("Cotización no encontrada");
  if (vigente.estatus !== "ENVIADA") {
    throw new Error(`Solo se puede generar OT con estatus ENVIADA (actual: ${vigente.estatus})`);
  }
  if (params.areas.length === 0) throw new Error("Selecciona al menos un área");

  // Responsable: debe existir en el catálogo y tener iniciales (cruce con CO, legacy)
  const usuarios = await listUsers();
  const responsable = usuarios.find(
    (u) => u.email.toLowerCase() === params.responsableCorreo.toLowerCase(),
  );
  if (!responsable) throw new Error("El responsable no existe en el catálogo de usuarios");
  if (!responsable.iniciales) {
    throw new Error(
      `${responsable.nombre} no tiene iniciales registradas; captúralas en Admin → Usuarios → ERP antes de asignarle una OT`,
    );
  }

  const config = await getConfigErp();
  const areasValidas = config.areas_ot.filter((a) => params.areas.includes(a.clave));
  if (areasValidas.length === 0) throw new Error("Las áreas seleccionadas no existen en el catálogo");

  const folio = folioOT(params.numero, params.anio, vigente.version);

  // 1) OT en la base (aquí se rechaza la segunda OT de una misma cotización)
  const ot = await createOT({
    numeroCotizacion: params.numero,
    anio: params.anio,
    version: vigente.version,
    ordenCompra,
    cliente: vigente.cliente,
    titulo: vigente.titulo,
    dirigidaA: vigente.dirigida_a,
    areas: areasValidas.map((a) => a.clave),
    createdBy: params.usuario,
  });

  // 2) Responsable (con historial)
  await registrarResponsable({
    folioOt: folio,
    correo: responsable.email,
    area: areasValidas[0]?.nombre,
    asignadoPor: params.usuario,
  });

  // 3) Cotización: OC (si la hay) + folio OT + estatus ASIGNADA
  await updateCotizacion(params.numero, params.anio, {
    ...(ordenCompra ? { ordenCompra } : {}),
    folioOt: folio,
  });
  await cambiarEstatus(params.numero, params.anio, "ASIGNADA");

  // 4) Drive: carpeta de la OT + adjunto de la OC (errores no abortan — legacy)
  let carpetaUrl: string | undefined;
  try {
    const carpeta = await ensureCarpetaOT({ folioOt: folio, cliente: vigente.cliente, anio: params.anio });
    carpetaUrl = carpeta.folderUrl;
    await setCarpetaDriveOT(ot.folio, {
      folderId: carpeta.folderId,
      folderUrl: carpeta.folderUrl,
    });

    if (params.adjunto) {
      const contenido = Buffer.from(params.adjunto.base64, "base64");
      if (contenido.length > 15 * 1024 * 1024) {
        avisos.push("El adjunto de la OC excede 15MB; no se subió a Drive");
      } else {
        await subirArchivoErp({
          folderId: carpeta.ocFolderId,
          filename: params.adjunto.filename,
          mimeType: params.adjunto.mimeType,
          contenido,
        });
        // Copia en la subcarpeta OC de la cotización
        if (vigente.drive_folder_id) {
          const ocCot = await ensureSubcarpetaOCCotizacion(vigente.drive_folder_id);
          await subirArchivoErp({
            folderId: ocCot,
            filename: params.adjunto.filename,
            mimeType: params.adjunto.mimeType,
            contenido,
          });
        }
      }
    }
  } catch (err) {
    avisos.push(`Drive: ${(err as Error).message} (la OT se creó de todos modos)`);
  }

  // 5) Correo de aviso de nueva OT
  const para = areasValidas.map((a) => a.correo).filter((c): c is string => Boolean(c));
  const ccAreas = config.areas_ot
    .filter((a) => !params.areas.includes(a.clave))
    .map((a) => a.correo)
    .filter((c): c is string => Boolean(c));
  const cc = [...new Set([...ccAreas, ...config.cc_aviso_ot, responsable.email])].filter(
    (c) => !para.includes(c),
  );
  if (para.length === 0 && cc.length === 0) {
    avisos.push("El catálogo de áreas no tiene correos configurados; no se envió el aviso de nueva OT");
  } else {
    await enviarCorreo({
      para: para.length > 0 ? para : cc,
      cc: para.length > 0 ? cc : undefined,
      asunto: `Nueva OT ${folio} · ${vigente.cliente} · ${areasValidas.map((a) => a.nombre).join(", ")}`,
      html: plantillaCorreo({
        titulo: `Nueva Orden de Trabajo ${folio}`,
        cuerpoHtml: `<table>${filaTabla("Folio OT", folio)}${filaTabla("Responsable", `${responsable.nombre} (${responsable.iniciales})`)}${filaTabla("OC", ordenCompra ?? "Sin orden de compra")}${filaTabla("Cotización origen", vigente.folio)}${filaTabla("Cliente", vigente.cliente)}${filaTabla("Título", vigente.titulo)}${filaTabla("Áreas", areasValidas.map((a) => a.nombre).join(", "))}${montoParaCorreo(vigente)}</table>
        ${carpetaUrl ? `<p style="margin-top:12px;font-size:13px;"><a href="${carpetaUrl}" style="color:#1d4ed8;">Carpeta de la OT en Drive</a></p>` : ""}`,
      }),
      registradoPor: params.usuario,
      referencia: `OT#${ot.folio}`,
    });
  }

  await registrarBitacora({
    accion: "OT_CREADA",
    usuario: params.usuario,
    referencia: `OT#${ot.folio}`,
    detalle: `${folio} desde ${vigente.folio} · ${ordenCompra ? `OC ${ordenCompra}` : "sin OC"}`,
  });

  return { folioOt: folio, avisos };
}

/** Ingreso de la orden de compra del cliente → OT. */
export async function ingresarOrdenCompra(params: {
  numero: number;
  anio: number;
  ordenCompra: string;
  responsableCorreo: string;
  areas: string[];
  adjunto?: { filename: string; mimeType: string; base64: string };
  usuario: string;
}): Promise<{ folioOt: string; avisos: string[] }> {
  if (!params.ordenCompra.trim()) throw new Error("La orden de compra es obligatoria");
  return generarOT({ ...params, ordenCompra: params.ordenCompra });
}

/**
 * OT de una cotización aceptada sin orden de compra. Mismo flujo salvo la OC:
 * la cotización queda ASIGNADA y la OC puede capturarse después.
 */
export async function generarOTSinOrdenCompra(params: {
  numero: number;
  anio: number;
  responsableCorreo: string;
  areas: string[];
  usuario: string;
}): Promise<{ folioOt: string; avisos: string[] }> {
  return generarOT({ ...params, ordenCompra: null });
}
