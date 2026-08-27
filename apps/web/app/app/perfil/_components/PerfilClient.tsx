"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProyectoStats } from "@/src/demo";
import { ProyectoDetalle } from "./ProyectoDetalle";

interface Props {
  nombre: string;
  fotoUrl: string | null;
  nickname: string | null;
  proyectosAsignados: string[];
  proyectosNombres: Record<string, string>;
  historial: ProyectoStats[];
}

function formatMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatProyectoId(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Initials({ nombre }: { nombre: string }) {
  const parts = nombre.trim().split(" ");
  const initials = parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`
    : parts[0].slice(0, 2);
  return (
    <div className="w-24 h-24 rounded-full bg-blue/40 border-2 border-white/20 flex items-center justify-center shrink-0">
      <span className="font-head text-3xl font-bold text-white uppercase">{initials}</span>
    </div>
  );
}

export function PerfilClient({ nombre, fotoUrl: initialFotoUrl, nickname: initialNickname, proyectosAsignados, proyectosNombres, historial }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fotoUrl, setFotoUrl] = useState(initialFotoUrl);
  const [nickname, setNickname] = useState(initialNickname ?? "");
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(initialNickname ?? "");
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [savingNickname, setSavingNickname] = useState(false);
  const [showFotoMenu, setShowFotoMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detalleProyecto, setDetalleProyecto] = useState<{ id: string; nombre: string } | null>(null);

  const displayName = nickname || nombre.split(" ")[0];

  // ── Foto handlers ─────────────────────────────────────────────────────────

  async function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowFotoMenu(false);
    setUploadingFoto(true);
    setError(null);

    try {
      const base64 = await toBase64(file);
      const res = await fetch("/api/perfil/foto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mimeType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al subir foto");
      setFotoUrl(data.foto_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir foto");
    } finally {
      setUploadingFoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleQuitarFoto() {
    setShowFotoMenu(false);
    setUploadingFoto(true);
    setError(null);
    try {
      const res = await fetch("/api/perfil/foto", { method: "DELETE" });
      if (!res.ok) throw new Error("Error al quitar foto");
      setFotoUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al quitar foto");
    } finally {
      setUploadingFoto(false);
    }
  }

  // ── Nickname handlers ──────────────────────────────────────────────────────

  async function handleNicknameSave() {
    setSavingNickname(true);
    setError(null);
    try {
      const res = await fetch("/api/perfil/actualizar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nicknameDraft.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setNickname(nicknameDraft.trim());
      setEditingNickname(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingNickname(false);
    }
  }

  function handleNicknameCancel() {
    setNicknameDraft(nickname);
    setEditingNickname(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (detalleProyecto) {
    return (
      <ProyectoDetalle
        proyectoId={detalleProyecto.id}
        proyectoNombre={detalleProyecto.nombre}
        onClose={() => setDetalleProyecto(null)}
      />
    );
  }

  return (
    <main className="min-h-screen bg-navy flex flex-col">
      {/* Header */}
      <div className="px-5 pt-10 pb-5">
        <button
          onClick={() => router.push("/app")}
          className="flex items-center gap-1.5 text-white/50 font-mono text-xs mb-5 active:text-white transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Inicio
        </button>

        <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-4">Mi perfil</p>

        {/* Avatar + identity */}
        <div className="flex items-center gap-4">
          <div className="relative">
            {fotoUrl ? (
              <img
                src={fotoUrl}
                alt={nombre}
                className="w-24 h-24 rounded-full object-cover border-2 border-white/20"
              />
            ) : (
              <Initials nombre={nombre} />
            )}
            <button
              onClick={() => setShowFotoMenu(!showFotoMenu)}
              disabled={uploadingFoto}
              className="absolute -bottom-1 -right-1 w-8 h-8 bg-blue rounded-full flex items-center justify-center border-2 border-navy active:scale-95 transition-transform"
            >
              {uploadingFoto ? (
                <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              )}
            </button>

            {/* Foto menu */}
            {showFotoMenu && (
              <div className="absolute top-full left-0 mt-2 z-10 bg-[#1a2a4a] border border-white/10 rounded-xl overflow-hidden shadow-xl min-w-[160px]">
                <button
                  onClick={() => { setShowFotoMenu(false); fileInputRef.current?.click(); }}
                  className="w-full text-left px-4 py-3 font-mono text-sm text-white hover:bg-white/10 transition-colors"
                >
                  Cambiar foto
                </button>
                {fotoUrl && (
                  <button
                    onClick={handleQuitarFoto}
                    className="w-full text-left px-4 py-3 font-mono text-sm text-red-400 hover:bg-white/10 transition-colors border-t border-white/10"
                  >
                    Quitar foto
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-head text-2xl font-bold text-white leading-tight truncate">{displayName}</p>
            <p className="font-mono text-xs text-white/40 mt-0.5 truncate">{nombre}</p>

            {/* Nickname edit */}
            {editingNickname ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  autoFocus
                  maxLength={30}
                  value={nicknameDraft}
                  onChange={(e) => setNicknameDraft(e.target.value)}
                  placeholder="Apodo (opcional)"
                  className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue w-36"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleNicknameSave();
                    if (e.key === "Escape") handleNicknameCancel();
                  }}
                />
                <button onClick={handleNicknameSave} disabled={savingNickname} className="text-blue font-mono text-xs">
                  {savingNickname ? "..." : "Guardar"}
                </button>
                <button onClick={handleNicknameCancel} className="text-white/40 font-mono text-xs">Cancelar</button>
              </div>
            ) : (
              <button
                onClick={() => { setNicknameDraft(nickname); setEditingNickname(true); }}
                className="mt-2 flex items-center gap-1.5 text-white/40 font-mono text-xs hover:text-white/70 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {nickname ? `"${nickname}"` : "Agregar apodo"}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2">
            <p className="font-mono text-xs text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 px-4 pb-8 space-y-5">

        {/* Proyectos activos */}
        <section>
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-3">
            Proyectos activos
          </p>
          {proyectosAsignados.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-5 text-center">
              <p className="font-mono text-sm text-white/40">Sin proyectos asignados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {proyectosAsignados.map((id) => (
                <div key={id} className="bg-white/10 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue/30 rounded-lg flex items-center justify-center shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93b4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-head text-sm font-bold text-white truncate">
                      {proyectosNombres[id] ?? formatProyectoId(id)}
                    </p>
                    <p className="font-mono text-[10px] text-white/40">{id}</p>
                  </div>
                  <span className="shrink-0 flex items-center gap-1 bg-green/20 border border-green/30 rounded-full px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green" />
                    <span className="font-mono text-[9px] text-green uppercase">Activo</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Historial */}
        <section>
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-3">
            Historial de proyectos
          </p>
          {historial.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-5 text-center">
              <p className="font-mono text-sm text-white/40">Sin jornadas registradas aún</p>
            </div>
          ) : (
            <div className="space-y-2">
              {historial.map((p) => (
                <button
                  key={p.proyectoId}
                  onClick={() => setDetalleProyecto({ id: p.proyectoId, nombre: p.nombre })}
                  className="w-full text-left bg-white/10 border border-white/10 rounded-xl px-4 py-4 active:scale-[0.99] transition-transform"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-head text-sm font-bold text-white truncate">{p.nombre}</p>
                      <p className="font-mono text-[10px] text-white/40 mt-0.5">{p.proyectoId}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm font-bold text-blue-mid">{formatMinutos(p.totalMinutos)}</p>
                      <p className="font-mono text-[10px] text-white/40 mt-0.5">
                        {p.sesiones} {p.sesiones === 1 ? "jornada" : "jornadas"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <p className="font-mono text-[10px] text-white/30">Última: {formatFecha(p.ultimaFecha)}</p>
                    </div>
                    <div className="flex items-center gap-1 text-white/30">
                      <p className="font-mono text-[9px]">Ver detalle</p>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFotoChange}
      />
    </main>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
