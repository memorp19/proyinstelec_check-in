"use client";

import { useState, useEffect } from "react";
import { CheckinCard } from "./CheckinCard";
import { CheckoutCard } from "./CheckoutCard";
import { OfflineBanner } from "./OfflineBanner";
import { getDeviceInfo } from "@/src/lib/device-info";

interface AppShellProps {
  userName: string;
  userTipo: string;
  proyectosAsignados: string[];
  proyectosNombres: Record<string, string>;
  dateLabel: string;
  openJornadaId: string | null;
  openJornadaCheckInTs: string | null;
  openJornadaProyectoId: string | null;
}

type View = "dashboard" | "checkin" | "active" | "done";

const STORAGE_KEY = "proyinstelec:jornada" as const;

interface CachedJornada {
  jornadaId: string;
  checkInTs: string;
  proyectoId: string | null;
}

function saveJornada(data: CachedJornada) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function loadJornada(): CachedJornada | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CachedJornada) : null;
  } catch { return null; }
}

function clearJornada() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function useLiveClock() {
  const fmt = () =>
    new Date().toLocaleTimeString("es-MX", {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt), 10_000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function useElapsedTimer(checkInTs: string | null) {
  const calc = () => {
    if (!checkInTs) return "00:00:00";
    const diff = Math.floor((Date.now() - new Date(checkInTs).getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const [elapsed, setElapsed] = useState(calc);
  useEffect(() => {
    if (!checkInTs) return;
    const id = setInterval(() => setElapsed(calc), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkInTs]);
  return elapsed;
}

export function AppShell({
  userName,
  userTipo,
  proyectosAsignados,
  proyectosNombres,
  dateLabel,
  openJornadaId,
  openJornadaCheckInTs,
  openJornadaProyectoId,
}: AppShellProps) {
  const isDev = process.env.NODE_ENV === "development";

  // If there's an open jornada on load, go directly to "active"
  const initialView: View = openJornadaId ? "active" : "dashboard";
  const [view, setView] = useState<View>(initialView);

  const [jornadaId, setJornadaId] = useState<string | null>(openJornadaId);
  const [checkInTs, setCheckInTs] = useState<string | null>(openJornadaCheckInTs);
  const [selectedProyectoId, setSelectedProyectoId] = useState<string | null>(
    openJornadaProyectoId ?? null,
  );
  const [duracion, setDuracion] = useState<number | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("Detectando dispositivo…");

  // Restore from localStorage when server didn't return an open jornada
  // (covers browser refresh when DynamoDB query fails or offline start)
  useEffect(() => {
    if (openJornadaId) return; // server data is authoritative
    const cached = loadJornada();
    if (!cached) return;
    setJornadaId(cached.jornadaId);
    setCheckInTs(cached.checkInTs);
    setSelectedProyectoId(cached.proyectoId);
    setView("active");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clock = useLiveClock();
  const elapsed = useElapsedTimer(view === "active" ? checkInTs : null);

  useEffect(() => {
    const d = getDeviceInfo();
    const parts = [d.os, d.browser].filter(Boolean);
    setDeviceLabel(parts.join(" · ") || "Dispositivo desconocido");
  }, []);

  // Build the effective project list (include dev fallback)
  const proyectos: { id: string; nombre: string }[] =
    proyectosAsignados.length > 0
      ? proyectosAsignados.map((id) => ({
          id,
          nombre: proyectosNombres[id] ?? formatProyectoId(id),
        }))
      : isDev
        ? [{ id: "dev-proyecto", nombre: "Proyecto dev (local)" }]
        : [];

  const proyectoActual = proyectos.find((p) => p.id === selectedProyectoId) ?? proyectos[0];

  const firstName = userName.split(" ")[0];

  const dayLabel = new Date().toLocaleDateString("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).toUpperCase();

  const checkInTime = checkInTs
    ? new Date(checkInTs).toLocaleTimeString("es-MX", {
        timeZone: "America/Mexico_City",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "--:--";

  const handleCheckinSuccess = (id: string) => {
    const ts = new Date().toISOString();
    saveJornada({ jornadaId: id, checkInTs: ts, proyectoId: selectedProyectoId });
    setJornadaId(id);
    setCheckInTs(ts);
    setView("active");
  };

  const handleCheckoutSuccess = (mins: number) => {
    clearJornada();
    setDuracion(mins);
    setView("done");
  };

  const handleNuevaJornada = () => {
    clearJornada();
    setJornadaId(null);
    setCheckInTs(null);
    setSelectedProyectoId(null);
    setDuracion(null);
    setView("dashboard");
  };

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (view === "done") {
    return (
      <main className="min-h-screen bg-navy flex flex-col items-center justify-center px-6 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-green/20 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="font-head text-3xl font-bold text-white">¡Jornada completada!</p>
        {duracion != null && duracion > 0 && (
          <p className="font-mono text-sm text-white/40">
            {Math.floor(duracion / 60)}h {duracion % 60}m registradas
          </p>
        )}
        <p className="font-mono text-xs text-white/25 mt-1">Se sincronizará automáticamente</p>
        <button
          onClick={handleNuevaJornada}
          className="mt-6 bg-blue text-white font-head text-base font-bold px-8 py-3 rounded-xl active:scale-[0.98] transition-transform"
        >
          Volver al inicio
        </button>
      </main>
    );
  }

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  if (view === "dashboard") {
    return (
      <main className="min-h-screen bg-navy flex flex-col">
        {/* Header */}
        <div className="px-5 pt-10 pb-5">
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">Bienvenido</p>
          <p className="font-head text-[34px] font-bold text-white leading-tight">{firstName}</p>
          <div className="inline-flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 mt-2">
            <span className="w-2 h-2 rounded-full bg-amber" />
            <span className="font-mono text-[11px] text-white/70 capitalize">{userTipo}</span>
          </div>

          {/* Date / Clock card */}
          <div className="mt-4 bg-white/10 border border-white/10 rounded-xl px-4 py-3 flex justify-between items-center">
            <div>
              <p className="font-head text-xl font-bold text-white">{dayLabel}</p>
              <p className="font-mono text-[10px] text-white/40 uppercase tracking-wider mt-0.5">
                {new Date().toLocaleDateString("es-MX", {
                  timeZone: "America/Mexico_City",
                  weekday: "long",
                  month: "long",
                  year: "numeric",
                }).toUpperCase()}
              </p>
            </div>
            <p className="font-mono text-3xl font-bold text-blue-mid tracking-tight">{clock}</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 px-4 pb-6 space-y-3">
          <OfflineBanner />

          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest">
            Tus proyectos
          </p>

          {proyectos.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-6 text-center">
              <p className="font-mono text-sm text-white/40">No tienes proyectos asignados.</p>
              <p className="font-mono text-xs text-white/20 mt-1">Contacta a tu supervisor.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {proyectos.map((p) => (
                <div
                  key={p.id}
                  className="bg-white/10 border border-white/10 rounded-xl px-4 py-4 flex items-center gap-3"
                >
                  <div className="w-10 h-10 bg-blue/30 rounded-lg flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#93b4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-head text-base font-bold text-white">{p.nombre}</p>
                    <p className="font-mono text-[10px] text-white/40 truncate">{p.id}</p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedProyectoId(p.id);
                      setView("checkin");
                    }}
                    className="shrink-0 bg-blue text-white font-mono text-xs font-bold px-3 py-2 rounded-lg active:scale-[0.97] transition-transform"
                  >
                    Iniciar
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Device info */}
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest pt-1">
            Dispositivo detectado
          </p>
          <div className="bg-white/10 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" />
                <circle cx="12" cy="17" r="1" />
              </svg>
            </div>
            <div>
              <p className="font-mono text-xs text-white/80">{deviceLabel}</p>
              <p className="font-mono text-[10px] text-white/30">IMEI registrado</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── CHECK-IN ──────────────────────────────────────────────────────────────
  if (view === "checkin" && proyectoActual) {
    return (
      <main className="min-h-screen bg-navy flex flex-col">
        {/* Header with back button */}
        <div className="px-5 pt-10 pb-5">
          <button
            onClick={() => setView("dashboard")}
            className="flex items-center gap-1.5 text-white/50 font-mono text-xs mb-4 active:text-white transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Mis proyectos
          </button>

          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">Check-in</p>
          <p className="font-head text-2xl font-bold text-white leading-tight">{proyectoActual.nombre}</p>
          <p className="font-mono text-[10px] text-white/40 mt-1">{proyectoActual.id}</p>

          {/* Date / Clock card */}
          <div className="mt-4 bg-white/10 border border-white/10 rounded-xl px-4 py-3 flex justify-between items-center">
            <div>
              <p className="font-head text-xl font-bold text-white">{dayLabel}</p>
              <p className="font-mono text-[10px] text-white/40 uppercase tracking-wider mt-0.5">
                {new Date().toLocaleDateString("es-MX", {
                  timeZone: "America/Mexico_City",
                  weekday: "long",
                  month: "long",
                  year: "numeric",
                }).toUpperCase()}
              </p>
            </div>
            <p className="font-mono text-3xl font-bold text-blue-mid tracking-tight">{clock}</p>
          </div>
        </div>

        <div className="flex-1 px-4 pb-6 space-y-3">
          <OfflineBanner />
          <CheckinCard
            proyectoId={proyectoActual.id}
            proyectoNombre={proyectoActual.nombre}
            onCheckinSuccess={handleCheckinSuccess}
          />
        </div>
      </main>
    );
  }

  // ── JORNADA ACTIVA ────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#f0f4f8] flex flex-col">
      {/* Active header — gradient navy → blue */}
      <div className="bg-gradient-to-b from-navy via-[#0f2e8c] to-blue px-5 pt-10 pb-6">
        <p className="font-mono text-[10px] text-white/60 uppercase tracking-widest mb-1">
          Jornada activa
        </p>
        <div className="flex items-center justify-between gap-2">
          <p className="font-head text-2xl font-bold text-white leading-tight">
            {proyectoActual?.nombre ?? "Proyecto"}
          </p>
          <span className="shrink-0 flex items-center gap-1.5 bg-green/20 border border-green/40 text-green font-mono text-[10px] px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
            EN CAMPO
          </span>
        </div>

        {/* Elapsed timer */}
        <p className="font-mono text-5xl font-bold text-white tracking-tight mt-4 tabular-nums">
          {elapsed}
        </p>
        <p className="font-mono text-[10px] text-white/50 mt-2">
          Check-in: {checkInTime} · {proyectoActual?.nombre ?? ""}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-4 space-y-3">
        <OfflineBanner />
        <CheckoutCard
          jornadaId={jornadaId!}
          checkInTimestamp={checkInTs!}
          proyectoNombre={proyectoActual?.nombre ?? "Proyecto"}
          trabajadorNombre={userName}
          onCheckoutSuccess={handleCheckoutSuccess}
        />
      </div>
    </main>
  );
}

function formatProyectoId(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

