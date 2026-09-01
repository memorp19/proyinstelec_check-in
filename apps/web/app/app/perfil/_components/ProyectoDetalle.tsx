"use client";

import { useEffect, useState } from "react";

interface JornadaRow {
  id: string;
  fecha: string;
  checkInTs: string;
  checkOutTs: string | null;
  duracionMinutos: number | null;
  checkInWebViewLink: string | null;
  checkOutWebViewLink: string | null;
}

interface Props {
  proyectoId: string;
  proyectoNombre: string;
  onClose: () => void;
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatFechaLarga(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function ProyectoDetalle({ proyectoId, proyectoNombre, onClose }: Props) {
  const [jornadas, setJornadas] = useState<JornadaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/perfil/jornadas?proyectoId=${encodeURIComponent(proyectoId)}`)
      .then((r) => r.json())
      .then((d) => setJornadas(d.jornadas ?? []))
      .catch(() => setError("No se pudo cargar el historial"))
      .finally(() => setLoading(false));
  }, [proyectoId]);

  return (
    <div className="fixed inset-0 z-50 bg-navy flex flex-col">
      {/* Header */}
      <div className="px-5 pt-10 pb-4 border-b border-white/10">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-white/50 font-mono text-xs mb-4 active:text-white transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Historial
        </button>
        <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">Detalle del proyecto</p>
        <p className="font-head text-xl font-bold text-white leading-tight">{proyectoNombre}</p>
        <p className="font-mono text-[10px] text-white/30 mt-0.5">{proyectoId}</p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="font-mono text-sm text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && jornadas.length === 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-8 text-center">
            <p className="font-mono text-sm text-white/40">Sin jornadas registradas para este proyecto</p>
          </div>
        )}

        {jornadas.map((j) => {
          const docs: { label: string; url: string }[] = [];
          if (j.checkInWebViewLink) docs.push({ label: "Foto check-in", url: j.checkInWebViewLink });
          if (j.checkOutWebViewLink) docs.push({ label: "Foto check-out", url: j.checkOutWebViewLink });

          return (
            <div key={j.id} className="bg-white/10 border border-white/10 rounded-xl overflow-hidden">
              {/* Day header */}
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-head text-sm font-bold text-white capitalize">
                    {formatFechaLarga(j.fecha)}
                  </p>
                  <p className="font-mono text-[10px] text-white/40 mt-0.5">
                    {formatHora(j.checkInTs)}
                    {j.checkOutTs ? ` → ${formatHora(j.checkOutTs)}` : " → en curso"}
                  </p>
                </div>
                {j.duracionMinutos != null && (
                  <span className="font-mono text-sm font-bold text-blue-mid">
                    {formatMinutos(j.duracionMinutos)}
                  </span>
                )}
              </div>

              {/* Documents */}
              {docs.length > 0 && (
                <div className="border-t border-white/10 px-4 py-2 space-y-1.5">
                  <p className="font-mono text-[9px] text-white/30 uppercase tracking-widest mb-1">Documentos</p>
                  {docs.map((doc) => (
                    <a
                      key={doc.url}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-blue-mid font-mono text-xs hover:text-white transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      {doc.label}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto opacity-50">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
