import { and, desc, eq, ilike, max, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { aprobaciones, cotizaciones } from "../db/schema";
import { folioCotizacion, pad } from "./folios";

// ── Types ─────────────────────────────────────────────────────────────────────

export const ESTATUS_COTIZACION = [
  "PROCESO",
  "REVISION",
  "ENVIADA",
  "ASIGNADA",
  "DEPENDIENTE PROVEEDOR",
  "DEPENDIENTE CLIENTE",
  "CANCELADA",
] as const;
export type EstatusCotizacion = (typeof ESTATUS_COTIZACION)[number];

export const PRIORIDADES = ["BAJA", "MEDIA", "ALTA"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

/**
 * Cotización — una fila por versión, llave (numero, anio, version).
 *
 * La versión VIGENTE es simplemente la de mayor `version` de cada
 * (numero, anio): un DISTINCT ON la resuelve en SQL, así que ya no hay índice
 * espejo que mantener ni llaves que quitar y poner al versionar.
 */
export interface Cotizacion {
  numero: number;
  anio: number;
  version: number;
  folio: string; // PCOTOP-NNN-AAAA[-v]
  cliente: string; // razón social
  cliente_id?: string;
  titulo: string;
  dirigida_a: string;
  prioridad: Prioridad;
  estatus: EstatusCotizacion;
  elaboro: string; // iniciales o nombre
  fecha_solicitud: string; // ISO
  fecha_entrega?: string; // compromiso (el legacy la mezclaba con fecha de envío; aquí separadas)
  fecha_envio?: string; // fecha real de envío al cliente
  /**
   * Importes por moneda, como cadena decimal para no perder centavos al pasar
   * por JSON. Independientes: una cotización puede traer los dos a la vez y
   * NUNCA se suman. Ausente = no capturado todavía; nunca es 0.
   */
  monto_mxn?: string;
  monto_usd?: string;
  orden_compra?: string;
  folio_ot?: string;
  drive_folder_id?: string;
  drive_folder_url?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Aprobacion {
  numero: number;
  anio: number;
  version: number;
  aprobado_por: string;
  fecha: string;
}

type FilaCotizacion = typeof cotizaciones.$inferSelect;

function aCotizacion(f: FilaCotizacion): Cotizacion {
  return {
    numero: f.numero,
    anio: f.anio,
    version: f.version,
    folio: f.folio,
    cliente: f.cliente,
    cliente_id: f.clienteId ?? undefined,
    titulo: f.titulo,
    dirigida_a: f.dirigidaA,
    prioridad: f.prioridad,
    estatus: f.estatus,
    elaboro: f.elaboro,
    fecha_solicitud: f.fechaSolicitud.toISOString(),
    fecha_entrega: f.fechaEntrega?.toISOString(),
    fecha_envio: f.fechaEnvio?.toISOString(),
    monto_mxn: f.montoMxn ?? undefined,
    monto_usd: f.montoUsd ?? undefined,
    orden_compra: f.ordenCompra ?? undefined,
    folio_ot: f.folioOt ?? undefined,
    drive_folder_id: f.driveFolderId ?? undefined,
    drive_folder_url: f.driveFolderUrl ?? undefined,
    created_by: f.createdBy,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

// ── Llaves ────────────────────────────────────────────────────────────────────

/** Etiqueta de la cotización en bitácora y correos: "COT#001-2026". */
export function cotPk(numero: number, anio: number): string {
  return `COT#${pad(numero, 3)}-${anio}`;
}

/** "001-2026" → { numero, anio } (llave de las rutas API). */
export function parseCotKey(key: string): { numero: number; anio: number } | null {
  const m = key.trim().match(/^(\d{1,3})-(\d{4})$/);
  if (!m) return null;
  return { numero: parseInt(m[1], 10), anio: parseInt(m[2], 10) };
}

/** Violación de llave primaria / índice único de Postgres. */
function esConflicto(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string } };
  return (
    e?.code === "23505" ||
    e?.cause?.code === "23505" ||
    /duplicate key|unique constraint/i.test(e?.message ?? "")
  );
}

/** Fecha ISO → Date para las columnas timestamp. */
function aFecha(valor: string | undefined): Date | undefined {
  return valor ? new Date(valor) : undefined;
}

/**
 * Normaliza un importe a la cadena decimal que espera `numeric`.
 *
 * Un monto vacío o ausente vale NULL, nunca 0: la diferencia entre "todavía no
 * lo localizamos" y "no cuesta nada" es real, y una cotización aceptada sin
 * monto sigue contando como aceptada.
 */
export function normalizarMonto(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(/[$,\s]/g, "");
  if (texto === "") return null;
  const n = Number(texto);
  if (!Number.isFinite(n)) throw new Error(`Monto inválido: "${valor}"`);
  if (n < 0) throw new Error("El monto no puede ser negativo");
  return n.toFixed(2);
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Todas las versiones de una cotización, la más reciente primero. */
export async function getVersiones(numero: number, anio: number): Promise<Cotizacion[]> {
  const filas = await getDb()
    .select()
    .from(cotizaciones)
    .where(and(eq(cotizaciones.numero, numero), eq(cotizaciones.anio, anio)))
    .orderBy(desc(cotizaciones.version));
  return filas.map(aCotizacion);
}

/** La versión vigente (la de mayor número de versión) o null si no existe. */
export async function getVigente(numero: number, anio: number): Promise<Cotizacion | null> {
  const [fila] = await getDb()
    .select()
    .from(cotizaciones)
    .where(and(eq(cotizaciones.numero, numero), eq(cotizaciones.anio, anio)))
    .orderBy(desc(cotizaciones.version))
    .limit(1);
  return fila ? aCotizacion(fila) : null;
}

/**
 * Subconsulta con la versión vigente de cada número del año.
 * DISTINCT ON (numero, anio) + ORDER BY version DESC = "solo la última versión",
 * la regla central del versionado del legacy.
 */
function vigentesDeAnio(anio: number) {
  return getDb()
    .selectDistinctOn([cotizaciones.numero, cotizaciones.anio])
    .from(cotizaciones)
    .where(eq(cotizaciones.anio, anio))
    .orderBy(cotizaciones.numero, cotizaciones.anio, desc(cotizaciones.version))
    .as("vigentes");
}

/** Columnas de la subconsulta de vigentes (Drizzle necesita la lista explícita). */
function camposVigentes(v: ReturnType<typeof vigentesDeAnio>) {
  return {
    numero: v.numero,
    anio: v.anio,
    version: v.version,
    folio: v.folio,
    cliente: v.cliente,
    clienteId: v.clienteId,
    titulo: v.titulo,
    dirigidaA: v.dirigidaA,
    prioridad: v.prioridad,
    estatus: v.estatus,
    elaboro: v.elaboro,
    fechaSolicitud: v.fechaSolicitud,
    fechaEntrega: v.fechaEntrega,
    fechaEnvio: v.fechaEnvio,
    montoMxn: v.montoMxn,
    montoUsd: v.montoUsd,
    ordenCompra: v.ordenCompra,
    folioOt: v.folioOt,
    driveFolderId: v.driveFolderId,
    driveFolderUrl: v.driveFolderUrl,
    createdBy: v.createdBy,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

/** Versiones vigentes de un año (una por número), de la más reciente a la más vieja. */
export async function listVigentesDeAnio(anio: number): Promise<Cotizacion[]> {
  const v = vigentesDeAnio(anio);
  const filas = await getDb().select().from(v).orderBy(desc(v.numero));
  return filas.map(aCotizacion);
}

/** Siguiente número sugerido para el año (MAX(numero) + 1 en SQL). */
export async function siguienteNumeroCotizacion(anio: number): Promise<number> {
  const [fila] = await getDb()
    .select({ maximo: max(cotizaciones.numero) })
    .from(cotizaciones)
    .where(eq(cotizaciones.anio, anio));
  return (fila?.maximo ?? 0) + 1;
}

// ── Búsqueda (los 8 filtros del legacy) ───────────────────────────────────────

export interface FiltrosCotizacion {
  anio: number;
  empresa?: string; // contains
  numero?: string; // contains
  elaboro?: string; // exact
  dirigidaA?: string; // contains
  estatus?: EstatusCotizacion; // exact
  mesEntrega?: number; // 1-12, sobre fecha_entrega
  ot?: string; // contains
  oc?: string; // contains
}

/**
 * Los 8 filtros se resuelven en SQL sobre las versiones vigentes y el flag de
 * aprobación sale de un LEFT JOIN por versión exacta (no una lectura por fila).
 */
export async function buscarCotizaciones(
  filtros: FiltrosCotizacion,
): Promise<Array<Cotizacion & { aprobada: boolean }>> {
  const v = vigentesDeAnio(filtros.anio);
  const condiciones: SQL[] = [];

  if (filtros.empresa) condiciones.push(ilike(v.cliente, `%${filtros.empresa}%`));
  if (filtros.numero) {
    // El legacy busca "contiene" sobre el número con padding a 3 (001, 045…)
    const digitos = filtros.numero.replace(/\D/g, "");
    if (digitos) condiciones.push(sql`lpad(${v.numero}::text, 3, '0') LIKE ${`%${digitos}%`}`);
  }
  if (filtros.elaboro) condiciones.push(ilike(v.elaboro, filtros.elaboro));
  if (filtros.dirigidaA) condiciones.push(ilike(v.dirigidaA, `%${filtros.dirigidaA}%`));
  if (filtros.estatus) condiciones.push(eq(v.estatus, filtros.estatus));
  if (filtros.mesEntrega) {
    condiciones.push(sql`EXTRACT(MONTH FROM ${v.fechaEntrega}) = ${filtros.mesEntrega}`);
  }
  if (filtros.ot) condiciones.push(ilike(v.folioOt, `%${filtros.ot}%`));
  if (filtros.oc) condiciones.push(ilike(v.ordenCompra, `%${filtros.oc}%`));

  const filas = await getDb()
    .select({
      ...camposVigentes(v),
      aprobada: sql<boolean>`${aprobaciones.numero} IS NOT NULL`,
    })
    .from(v)
    .leftJoin(
      aprobaciones,
      and(
        eq(aprobaciones.numero, v.numero),
        eq(aprobaciones.anio, v.anio),
        eq(aprobaciones.version, v.version),
      ),
    )
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(v.numero));

  return filas.map(({ aprobada, ...cot }) => ({
    ...aCotizacion(cot),
    aprobada: Boolean(aprobada),
  }));
}

// ── Alta y versiones ──────────────────────────────────────────────────────────

export async function createCotizacion(params: {
  numero: number;
  anio: number;
  cliente: string;
  clienteId?: string;
  titulo: string;
  dirigidaA: string;
  prioridad?: Prioridad;
  elaboro: string;
  fechaEntrega?: string;
  montoMxn?: string | number | null;
  montoUsd?: string | number | null;
  createdBy: string;
}): Promise<Cotizacion> {
  try {
    const [fila] = await getDb()
      .insert(cotizaciones)
      .values({
        numero: params.numero,
        anio: params.anio,
        version: 0,
        folio: folioCotizacion(params.numero, params.anio, 0),
        cliente: params.cliente.trim(),
        clienteId: params.clienteId ?? null,
        titulo: params.titulo.trim(),
        dirigidaA: params.dirigidaA.trim(),
        prioridad: params.prioridad ?? "MEDIA",
        estatus: "PROCESO",
        elaboro: params.elaboro.trim(),
        fechaEntrega: aFecha(params.fechaEntrega) ?? null,
        montoMxn: normalizarMonto(params.montoMxn),
        montoUsd: normalizarMonto(params.montoUsd),
        createdBy: params.createdBy,
      })
      .returning();
    return aCotizacion(fila);
  } catch (err) {
    // La llave primaria (numero, anio, version) es la validación de duplicado
    if (esConflicto(err)) {
      throw new Error(
        `La cotización ${pad(params.numero, 3)}-${params.anio} ya existe; usa "Nueva Versión"`,
      );
    }
    throw err;
  }
}

/**
 * Nueva versión: hereda los datos de la vigente, arranca en PROCESO y limpia
 * fecha de entrega/envío, OC y OT. No hay nada más que mover: la vigente pasa a
 * ser esta por tener el número de versión más alto.
 *
 * Los montos se heredan como el resto del contenido de la cotización; si la
 * nueva versión se cotiza a otro precio, se editan. Heredar y corregir pierde
 * menos que arrancar en blanco cuando la versión solo arregla una errata.
 */
export async function crearNuevaVersion(params: {
  numero: number;
  anio: number;
  prioridad?: Prioridad;
  elaboro?: string;
  createdBy: string;
}): Promise<Cotizacion> {
  const vigente = await getVigente(params.numero, params.anio);
  if (!vigente) throw new Error(`La cotización ${pad(params.numero, 3)}-${params.anio} no existe`);

  const version = vigente.version + 1;
  try {
    const [fila] = await getDb()
      .insert(cotizaciones)
      .values({
        numero: vigente.numero,
        anio: vigente.anio,
        version,
        folio: folioCotizacion(params.numero, params.anio, version),
        cliente: vigente.cliente,
        clienteId: vigente.cliente_id ?? null,
        titulo: vigente.titulo,
        dirigidaA: vigente.dirigida_a,
        prioridad: params.prioridad ?? vigente.prioridad,
        estatus: "PROCESO",
        elaboro: params.elaboro?.trim() || vigente.elaboro,
        fechaSolicitud: new Date(),
        montoMxn: vigente.monto_mxn ?? null,
        montoUsd: vigente.monto_usd ?? null,
        driveFolderId: vigente.drive_folder_id ?? null,
        driveFolderUrl: vigente.drive_folder_url ?? null,
        createdBy: params.createdBy,
      })
      .returning();
    return aCotizacion(fila);
  } catch (err) {
    if (esConflicto(err)) {
      throw new Error(
        `Ya existe la versión ${version} de la cotización ${pad(params.numero, 3)}-${params.anio}`,
      );
    }
    throw err;
  }
}

// ── Edición y transiciones ────────────────────────────────────────────────────

/** WHERE que apunta a la versión vigente sin leerla antes (una sola sentencia). */
function esVigente(numero: number, anio: number): SQL {
  return sql`${cotizaciones.numero} = ${numero} AND ${cotizaciones.anio} = ${anio} AND ${cotizaciones.version} = (
    SELECT MAX(v.version) FROM cotizaciones v WHERE v.numero = ${numero} AND v.anio = ${anio}
  )`;
}

/**
 * Actualiza campos de la versión vigente. El cambio de estatus pasa por
 * cambiarEstatus(), que valida la transición.
 */
export async function updateCotizacion(
  numero: number,
  anio: number,
  data: {
    titulo?: string;
    dirigidaA?: string;
    prioridad?: Prioridad;
    elaboro?: string;
    fechaEntrega?: string | null;
    /** null borra el importe (vuelve a "no capturado"); undefined lo deja igual. */
    montoMxn?: string | number | null;
    montoUsd?: string | number | null;
    ordenCompra?: string;
    folioOt?: string;
    fechaEnvio?: string;
    driveFolderId?: string;
    driveFolderUrl?: string;
    clienteId?: string;
  },
): Promise<void> {
  const cambios: Partial<typeof cotizaciones.$inferInsert> = { updatedAt: new Date() };
  if (data.titulo !== undefined) cambios.titulo = data.titulo.trim();
  if (data.dirigidaA !== undefined) cambios.dirigidaA = data.dirigidaA.trim();
  if (data.prioridad !== undefined) cambios.prioridad = data.prioridad;
  if (data.elaboro !== undefined) cambios.elaboro = data.elaboro.trim();
  if (data.fechaEntrega !== undefined) {
    cambios.fechaEntrega = data.fechaEntrega ? new Date(data.fechaEntrega) : null;
  }
  if (data.montoMxn !== undefined) cambios.montoMxn = normalizarMonto(data.montoMxn);
  if (data.montoUsd !== undefined) cambios.montoUsd = normalizarMonto(data.montoUsd);
  if (data.ordenCompra !== undefined) cambios.ordenCompra = data.ordenCompra.trim();
  if (data.folioOt !== undefined) cambios.folioOt = data.folioOt;
  if (data.fechaEnvio !== undefined) cambios.fechaEnvio = new Date(data.fechaEnvio);
  if (data.driveFolderId !== undefined) cambios.driveFolderId = data.driveFolderId;
  if (data.driveFolderUrl !== undefined) cambios.driveFolderUrl = data.driveFolderUrl;
  if (data.clienteId !== undefined) cambios.clienteId = data.clienteId;

  const filas = await getDb()
    .update(cotizaciones)
    .set(cambios)
    .where(esVigente(numero, anio))
    .returning({ numero: cotizaciones.numero });
  if (filas.length === 0) throw new Error("Cotización no encontrada");
}

/** Transiciones permitidas (reglas del legacy). */
export function transicionValida(de: EstatusCotizacion, a: EstatusCotizacion): boolean {
  if (de === a) return false;
  const mapa: Record<EstatusCotizacion, EstatusCotizacion[]> = {
    PROCESO: ["REVISION", "DEPENDIENTE PROVEEDOR", "DEPENDIENTE CLIENTE", "CANCELADA"],
    REVISION: ["PROCESO", "ENVIADA", "CANCELADA"], // PROCESO = corrección; ENVIADA requiere aprobación
    ENVIADA: ["ASIGNADA", "CANCELADA"],
    ASIGNADA: ["CANCELADA"],
    "DEPENDIENTE PROVEEDOR": ["PROCESO", "REVISION", "CANCELADA"],
    "DEPENDIENTE CLIENTE": ["PROCESO", "REVISION", "CANCELADA"],
    CANCELADA: [],
  };
  return mapa[de].includes(a);
}

/**
 * Cambia el estatus de la versión vigente. Al REENTRAR a REVISION invalida la
 * aprobación previa de esa versión (nuevo ciclo de revisión, regla del legacy).
 */
export async function cambiarEstatus(
  numero: number,
  anio: number,
  nuevo: EstatusCotizacion,
): Promise<Cotizacion> {
  const vigente = await getVigente(numero, anio);
  if (!vigente) throw new Error("Cotización no encontrada");
  if (!transicionValida(vigente.estatus, nuevo)) {
    throw new Error(`Transición no permitida: ${vigente.estatus} → ${nuevo}`);
  }

  await getDb()
    .update(cotizaciones)
    .set({ estatus: nuevo, updatedAt: new Date() })
    .where(
      and(
        eq(cotizaciones.numero, numero),
        eq(cotizaciones.anio, anio),
        eq(cotizaciones.version, vigente.version),
      ),
    );

  if (nuevo === "REVISION") {
    await eliminarAprobacion(numero, anio, vigente.version);
  }

  return { ...vigente, estatus: nuevo };
}

// ── Aprobaciones (por versión exacta, fuera del estatus — legacy) ─────────────

export async function registrarAprobacion(params: {
  numero: number;
  anio: number;
  version: number;
  aprobadoPor: string;
}): Promise<Aprobacion> {
  const [fila] = await getDb()
    .insert(aprobaciones)
    .values({
      numero: params.numero,
      anio: params.anio,
      version: params.version,
      aprobadoPor: params.aprobadoPor,
      fecha: new Date(),
    })
    .onConflictDoUpdate({
      target: [aprobaciones.numero, aprobaciones.anio, aprobaciones.version],
      set: { aprobadoPor: params.aprobadoPor, fecha: new Date() },
    })
    .returning();
  return {
    numero: fila.numero,
    anio: fila.anio,
    version: fila.version,
    aprobado_por: fila.aprobadoPor,
    fecha: fila.fecha.toISOString(),
  };
}

export async function tieneAprobacion(
  numero: number,
  anio: number,
  version: number,
): Promise<boolean> {
  const filas = await getDb()
    .select({ numero: aprobaciones.numero })
    .from(aprobaciones)
    .where(
      and(
        eq(aprobaciones.numero, numero),
        eq(aprobaciones.anio, anio),
        eq(aprobaciones.version, version),
      ),
    )
    .limit(1);
  return filas.length > 0;
}

export async function eliminarAprobacion(
  numero: number,
  anio: number,
  version: number,
): Promise<void> {
  await getDb()
    .delete(aprobaciones)
    .where(
      and(
        eq(aprobaciones.numero, numero),
        eq(aprobaciones.anio, anio),
        eq(aprobaciones.version, version),
      ),
    );
}

/**
 * ¿Puede enviarse al cliente? (validación del legacy)
 * PROCESO → no; REVISION sin aprobación → no;
 * REVISION aprobada / ENVIADA / ASIGNADA → sí (incluye reenvíos).
 */
export async function puedeEnviarseAlCliente(
  numero: number,
  anio: number,
): Promise<{ puede: boolean; motivo?: string; cotizacion: Cotizacion | null }> {
  const c = await getVigente(numero, anio);
  if (!c) return { puede: false, motivo: "No existe", cotizacion: null };
  if (c.estatus === "ENVIADA" || c.estatus === "ASIGNADA") return { puede: true, cotizacion: c };
  if (c.estatus !== "REVISION") {
    return { puede: false, motivo: `La cotización está en ${c.estatus}; debe pasar por revisión`, cotizacion: c };
  }
  const aprobada = await tieneAprobacion(numero, anio, c.version);
  if (!aprobada) {
    return { puede: false, motivo: "Esperando aprobación del revisor", cotizacion: c };
  }
  return { puede: true, cotizacion: c };
}
