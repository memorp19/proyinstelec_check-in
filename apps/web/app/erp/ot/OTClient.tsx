"use client";

import { useCallback, useEffect, useState } from "react";

interface Responsable {
  id: string;
  correo: string;
  rol: string;
  area?: string;
  asignado_por: string;
  fecha: string;
  activo: boolean;
  slot: number;
}

interface OT {
  folio: string;
  numero_cotizacion: number;
  anio: number;
  version: number;
  orden_compra: string;
  cliente: string;
  titulo: string;
  dirigida_a?: string;
  estatus: string;
  areas: string[];
  drive_folder_url?: string;
  tiene_control_operativo: boolean;
  created_by: string;
  created_at: string;
  /** Hasta tres activos a la vez, ordenados por slot. */
  responsables: Responsable[];
}

const btnGhost =
  "font-mono text-[10px] text-white/50 hover:text-white border border-white/10 hover:border-white/30 rounded-lg px-3 py-1.5 transition-colors";

const folioCotizacion = (o: OT) =>
  `PCOTOP-${String(o.numero_cotizacion).padStart(3, "0")}-${o.anio}${o.version > 0 ? `-${o.version}` : ""}`;

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

/**
 * El flujo real de una OT es lineal, así que el siguiente estado se deduce del
 * actual. Esto solo dibuja el botón: la transición la valida el servidor con
 * `transicionValidaOT`, igual que cualquier otra regla.
 */
const FLUJO_ESTATUS = ["", "Asignado", "En Ejecución", "Cerrado"] as const;

function siguienteEstatus(actual: string): string | null {
  const i = FLUJO_ESTATUS.indexOf(actual as (typeof FLUJO_ESTATUS)[number]);
  if (i < 0 || i === FLUJO_ESTATUS.length - 1) return null;
  return FLUJO_ESTATUS[i + 1];
}

const MAX_RESPONSABLES = 3;

export function OTClient({ puedeReasignar }: { puedeReasignar: boolean }) {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [ordenes, setOrdenes] = useState<OT[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Record<string, Responsable[]>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Folio en el que hay una mutación en vuelo, para no dejar hacer doble clic. */
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [nuevoCorreo, setNuevoCorreo] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/ot?anio=${anio}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setOrdenes(data.ordenes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setCargando(false);
    }
  }, [anio]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function alternar(folio: string) {
    if (abierta === folio) {
      setAbierta(null);
      return;
    }
    setAbierta(folio);
    if (historial[folio]) return; // ya cargado
    try {
      const res = await fetch(`/api/erp/ot/${folio}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setHistorial((h) => ({ ...h, [folio]: data.responsables }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  /** Envuelve una mutación: bloquea la fila, limpia el error y refresca. */
  async function mutar(folio: string, peticion: () => Promise<Response>) {
    setOcupado(folio);
    setError(null);
    try {
      const res = await peticion();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      if (data.responsables) setHistorial((h) => ({ ...h, [folio]: data.responsables }));
      // El listado trae los activos de cada tarjeta: hay que volver a pedirlo.
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setOcupado(null);
    }
  }

  async function agregar(folio: string) {
    const correo = (nuevoCorreo[folio] ?? "").trim();
    if (!correo) return;
    await mutar(folio, () =>
      fetch(`/api/erp/ot/${folio}/responsables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo }),
      }),
    );
    setNuevoCorreo((c) => ({ ...c, [folio]: "" }));
  }

  async function quitar(folio: string, id: string) {
    await mutar(folio, () =>
      fetch(`/api/erp/ot/${folio}/responsables/${id}`, { method: "DELETE" }),
    );
  }

  async function avanzar(folio: string, estatus: string) {
    await mutar(folio, () =>
      fetch(`/api/erp/ot/${folio}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estatus }),
      }),
    );
  }

  const anios = [anioActual + 1, anioActual, anioActual - 1, anioActual - 2];

  return (
    <div className="max-w-4xl">
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">ERP · OT</p>
      <h1 className="font-head text-2xl font-bold mb-1">Órdenes de Trabajo</h1>
      <p className="text-white/50 text-sm mb-5">
        Las OT se generan al ingresar la orden de compra de una cotización enviada. El control
        operativo y los documentos llegan más adelante en la Fase 2.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <select
          className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white outline-none focus:border-blue"
          value={anio}
          onChange={(e) => setAnio(parseInt(e.target.value, 10))}
        >
          {anios.map((a) => (
            <option key={a} value={a} className="bg-navy">
              {a}
            </option>
          ))}
        </select>
        <button onClick={cargar} className={btnGhost}>
          Actualizar
        </button>
        <span className="font-mono text-[10px] text-white/30 ml-auto">
          {ordenes.length} {ordenes.length === 1 ? "orden" : "órdenes"}
        </span>
      </div>

      {error && <p className="font-mono text-xs text-red-400 mb-3">{error}</p>}

      <div className="space-y-2">
        {cargando ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-8 text-center">
            <p className="font-mono text-sm text-white/40">Cargando…</p>
          </div>
        ) : ordenes.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-8 text-center">
            <p className="font-mono text-sm text-white/40">No hay órdenes de trabajo en {anio}</p>
          </div>
        ) : (
          ordenes.map((o) => (
            <div key={o.folio} className="bg-white/10 border border-white/10 rounded-xl px-4 py-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-head text-sm font-bold text-white">{o.folio}</p>
                    <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white/60">
                      {o.estatus}
                    </span>
                    {!o.tiene_control_operativo && (
                      <span
                        className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300"
                        title="Toda OT debe tener control operativo (llega en la Fase 2)"
                      >
                        SIN CONTROL OPERATIVO
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-white/60 mt-1 truncate">
                    {o.cliente} · {o.titulo}
                  </p>
                  <p className="font-mono text-[10px] text-white/35 mt-1">
                    OC: {o.orden_compra} · Origen: {folioCotizacion(o)} · {fechaCorta(o.created_at)}
                  </p>
                  <p className="font-mono text-[10px] text-white/35 mt-1">
                    {o.responsables.length === 1 ? "Responsable: " : "Responsables: "}
                    {o.responsables.length === 0
                      ? "— sin asignar —"
                      : o.responsables.map((r) => r.correo).join(", ")}
                    {o.areas.length > 0 && ` · Áreas: ${o.areas.join(", ")}`}
                  </p>
                </div>
                <div className="shrink-0 flex gap-1.5">
                  {o.drive_folder_url ? (
                    <a
                      href={o.drive_folder_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={btnGhost}
                    >
                      Carpeta
                    </a>
                  ) : (
                    <span
                      className="font-mono text-[10px] text-amber-300/70 border border-amber-400/20 rounded-lg px-3 py-1.5"
                      title="Revisa ERP_OT_FOLDER_ID y vuelve a generar la carpeta"
                    >
                      Sin carpeta
                    </span>
                  )}
                  {puedeReasignar && siguienteEstatus(o.estatus) && (
                    <button
                      onClick={() => avanzar(o.folio, siguienteEstatus(o.estatus)!)}
                      disabled={ocupado === o.folio}
                      className="font-mono text-[10px] text-blue-mid hover:text-white border border-blue/30 hover:border-blue/60 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40"
                      title={`Mover a ${siguienteEstatus(o.estatus)}`}
                    >
                      → {siguienteEstatus(o.estatus)}
                    </button>
                  )}
                  <button onClick={() => alternar(o.folio)} className={btnGhost}>
                    {abierta === o.folio ? "Ocultar" : "Responsables"}
                  </button>
                </div>
              </div>

              {abierta === o.folio && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  {!historial[o.folio] ? (
                    <p className="font-mono text-[10px] text-white/30">Cargando historial…</p>
                  ) : historial[o.folio].length === 0 ? (
                    <p className="font-mono text-[10px] text-white/30">
                      Esta OT no tiene responsables registrados.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {historial[o.folio].map((r) => (
                        <li key={r.id} className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-mono text-[9px] px-2 py-0.5 rounded-full border ${
                              r.activo
                                ? "bg-green/20 border-green/30 text-green"
                                : "bg-white/5 border-white/15 text-white/40"
                            }`}
                          >
                            {r.activo ? "ACTUAL" : "ANTERIOR"}
                          </span>
                          <span className="font-mono text-[11px] text-white/70">{r.correo}</span>
                          <span className="font-mono text-[10px] text-white/30">
                            {r.area ? `${r.area} · ` : ""}
                            {fechaCorta(r.fecha)} · asignó {r.asignado_por}
                          </span>
                          {puedeReasignar && r.activo && (
                            <button
                              onClick={() => quitar(o.folio, r.id)}
                              disabled={ocupado === o.folio}
                              className="font-mono text-[9px] text-danger/70 hover:text-danger border border-danger/20 hover:border-danger/50 rounded-full px-2 py-0.5 transition-colors disabled:opacity-40"
                              title="Darlo de baja; la fila se conserva en el historial"
                            >
                              Quitar
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {puedeReasignar && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      {o.responsables.length >= MAX_RESPONSABLES ? (
                        <p className="font-mono text-[10px] text-amber/70">
                          Esta OT ya tiene {MAX_RESPONSABLES} responsables. Quita a uno para agregar
                          otro.
                        </p>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="email"
                            value={nuevoCorreo[o.folio] ?? ""}
                            onChange={(e) =>
                              setNuevoCorreo((c) => ({ ...c, [o.folio]: e.target.value }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && agregar(o.folio)}
                            placeholder="correo@proyinstelec.mx"
                            className="font-mono text-[11px] bg-white/5 border border-white/10 focus:border-blue/40 rounded-lg px-3 min-h-tap flex-1 min-w-[220px] outline-none"
                          />
                          <button
                            onClick={() => agregar(o.folio)}
                            disabled={ocupado === o.folio || !(nuevoCorreo[o.folio] ?? "").trim()}
                            className="font-mono text-[10px] text-green hover:text-white border border-green/30 hover:border-green/60 rounded-lg px-3 min-h-tap transition-colors disabled:opacity-40"
                          >
                            Agregar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
