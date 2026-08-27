"use client";

import { useCallback, useEffect, useState } from "react";

interface Cot {
  numero: number;
  anio: number;
  version: number;
  folio: string;
  cliente: string;
  titulo: string;
  dirigida_a: string;
  elaboro: string;
  fecha_solicitud: string;
  drive_folder_url?: string;
  aprobada?: boolean;
}

const key = (c: Cot) => `${String(c.numero).padStart(3, "0")}-${c.anio}`;

const btnGhost =
  "font-mono text-[10px] text-white/50 hover:text-white border border-white/10 hover:border-white/30 rounded-lg px-3 py-1.5 transition-colors";

export function RevisionClient() {
  const [cotizaciones, setCotizaciones] = useState<Cot[]>([]);
  const [corrigiendo, setCorrigiendo] = useState<Cot | null>(null);
  const [comentario, setComentario] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/erp/revision");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setCotizaciones(data.cotizaciones);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function aprobar(c: Cot) {
    if (!confirm(`¿Aprobar ${c.folio}? El elaborador podrá enviarla al cliente.`)) return;
    setLoadingId(key(c));
    setError(null);
    try {
      const res = await fetch(`/api/erp/cotizaciones/${key(c)}/aprobar`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setAviso(`${c.folio} aprobada`);
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoadingId(null);
    }
  }

  async function corregir() {
    if (!corrigiendo) return;
    setLoadingId(key(corrigiendo));
    setError(null);
    try {
      const res = await fetch(`/api/erp/cotizaciones/${key(corrigiendo)}/corregir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comentario }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setAviso(`${corrigiendo.folio} devuelta a PROCESO con tus comentarios`);
      setCorrigiendo(null);
      setComentario("");
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">ERP · Revisión</p>
      <h1 className="font-head text-2xl font-bold mb-1">Cotizaciones en revisión</h1>
      <p className="text-white/50 text-sm mb-5">
        Aprueba o solicita corrección. La aprobación habilita el envío al cliente de esa versión exacta.
      </p>

      {aviso && (
        <div className="mb-4 bg-green/10 border border-green/20 rounded-xl px-4 py-3 flex justify-between gap-3">
          <p className="font-mono text-xs text-green">{aviso}</p>
          <button onClick={() => setAviso(null)} className="font-mono text-xs text-white/40">✕</button>
        </div>
      )}
      {error && <p className="font-mono text-xs text-red-400 mb-3">{error}</p>}

      <div className="space-y-2">
        {cotizaciones.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-8 text-center">
            <p className="font-mono text-sm text-white/40">No hay cotizaciones esperando revisión</p>
          </div>
        ) : (
          cotizaciones.map((c) => (
            <div key={key(c)} className="bg-white/10 border border-white/10 rounded-xl px-4 py-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-head text-sm font-bold text-white">{c.folio}</p>
                    {c.aprobada && (
                      <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-green/20 border border-green/30 text-green">
                        YA APROBADA
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-white/60 mt-1 truncate">{c.cliente} · {c.titulo}</p>
                  <p className="font-mono text-[10px] text-white/35 mt-1">
                    Dirigida: {c.dirigida_a} · Elaboró: {c.elaboro} · v{c.version}
                  </p>
                </div>
                <div className="shrink-0 flex gap-1.5">
                  {c.drive_folder_url && (
                    <a href={c.drive_folder_url} target="_blank" rel="noopener noreferrer" className={btnGhost}>
                      Ver PDF / Carpeta
                    </a>
                  )}
                  {!c.aprobada && (
                    <>
                      <button
                        onClick={() => aprobar(c)}
                        disabled={loadingId === key(c)}
                        className="font-mono text-[10px] font-bold text-white bg-green/80 rounded-lg px-3 py-1.5 disabled:opacity-40 active:scale-[0.97] transition-transform"
                      >
                        {loadingId === key(c) ? "…" : "Aprobar"}
                      </button>
                      <button
                        onClick={() => { setCorrigiendo(c); setComentario(""); }}
                        className="font-mono text-[10px] font-bold text-amber-300 border border-amber-400/30 rounded-lg px-3 py-1.5 transition-colors hover:border-amber-300"
                      >
                        Solicitar corrección
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {corrigiendo && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setCorrigiendo(null)}>
          <div className="bg-navy border border-white/20 rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-head font-bold text-white mb-1">Solicitar corrección · {corrigiendo.folio}</h2>
            <p className="font-mono text-[10px] text-white/40 mb-3">
              La cotización regresa a PROCESO y el elaborador recibe tus comentarios por correo.
            </p>
            <textarea
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue min-h-[110px]"
              placeholder="¿Qué hay que corregir? (mínimo 10 caracteres)"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setCorrigiendo(null)} className={btnGhost}>Cancelar</button>
              <button
                onClick={corregir}
                disabled={comentario.trim().length < 10 || loadingId === key(corrigiendo)}
                className="bg-blue text-white font-mono text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40 active:scale-[0.97] transition-transform"
              >
                Enviar corrección
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
