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
  responsable: Responsable | null;
}

const btnGhost =
  "font-mono text-[10px] text-white/50 hover:text-white border border-white/10 hover:border-white/30 rounded-lg px-3 py-1.5 transition-colors";

const folioCotizacion = (o: OT) =>
  `PCOTOP-${String(o.numero_cotizacion).padStart(3, "0")}-${o.anio}${o.version > 0 ? `-${o.version}` : ""}`;

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

export function OTClient() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [ordenes, setOrdenes] = useState<OT[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Record<string, Responsable[]>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
                    Responsable: {o.responsable ? o.responsable.correo : "— sin asignar —"}
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
                        </li>
                      ))}
                    </ul>
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
