"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { getCurrentPosition } from "@/src/lib/geolocation";
import { getDeviceInfo } from "@/src/lib/device-info";
import { enqueue } from "@/src/lib/sync-queue";
import { PhotoCapture } from "./PhotoCapture";

interface CheckoutCardProps {
  jornadaId: string;
  checkInTimestamp: string;
  proyectoNombre: string;
  trabajadorNombre: string;
  onCheckoutSuccess: (duracionMinutos: number) => void;
}

type Status = "idle" | "locating" | "uploading" | "saving" | "done" | "error";

export function CheckoutCard({
  jornadaId,
  checkInTimestamp,
  proyectoNombre,
  trabajadorNombre,
  onCheckoutSuccess,
}: CheckoutCardProps) {
  const { data: session } = useSession();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [observaciones, setObservaciones] = useState("");
  const [mapLoading, setMapLoading] = useState(false);
  const [showIncident, setShowIncident] = useState(false);
  const [incidentText, setIncidentText] = useState("");
  const [showNota, setShowNota] = useState(false);
  const [notaText, setNotaText] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const handleCheckout = async () => {
    if (!photoFile) {
      setError("La foto es obligatoria para el check-out.");
      return;
    }

    setError(null);

    try {
      setStatus("locating");
      const position = await getCurrentPosition();
      const deviceInfo = getDeviceInfo();
      const timestamp = new Date().toISOString();

      let driveFileId: string | undefined;
      let driveWebViewLink: string | undefined;
      let fotoHash: string | undefined;

      if (navigator.onLine) {
        setStatus("uploading");
        const base64 = await fileToBase64(photoFile);
        const localDate = new Date().toLocaleDateString("es-MX", {
          timeZone: "America/Mexico_City",
          year: "numeric", month: "2-digit", day: "2-digit",
        }).split("/").reverse().join("-");

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64,
            filename: `checkout_${timestamp.slice(11, 16).replace(":", "")}.jpg`,
            mimeType: photoFile.type || "image/jpeg",
            proyectoNombre,
            fecha: localDate,
            trabajadorNombre,
          }),
        });

        if (uploadRes.ok) {
          const d = await uploadRes.json();
          driveFileId = d.driveFileId;
          driveWebViewLink = d.webViewLink;
          fotoHash = d.hash;
        }
      }

      const payload = {
        checkOut: {
          timestamp,
          lat: position.lat,
          lng: position.lng,
          precision: position.precision,
          driveFileId,
          driveWebViewLink,
          fotoHash,
          observaciones: observaciones.trim() || undefined,
          deviceInfo,
        },
      };

      if (navigator.onLine) {
        setStatus("saving");
        const res = await fetch(`/api/jornada/${jornadaId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Error al registrar el check-out");
        }

        const { duracionMinutos } = await res.json();
        setStatus("done");
        onCheckoutSuccess(duracionMinutos);
      } else {
        await enqueue("checkout", { jornadaId, ...payload });
        setStatus("done");
        onCheckoutSuccess(0);
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Error inesperado");
    }
  };

  const isLoading = ["locating", "uploading", "saving"].includes(status);

  const handleVerMapa = async () => {
    setMapLoading(true);
    try {
      const pos = await getCurrentPosition();
      window.open(`https://www.google.com/maps?q=${pos.lat},${pos.lng}`, "_blank", "noopener");
    } catch {
      // fallback: open maps without coords
      window.open("https://maps.google.com", "_blank", "noopener");
    } finally {
      setMapLoading(false);
    }
  };

  const handleSubmitNota = () => {
    const trimmed = notaText.trim();
    if (!trimmed) return;
    const time = new Date().toLocaleTimeString("es-MX", {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const line = `[Nota ${time}]: ${trimmed}`;
    setObservaciones((prev) => prev ? `${prev}\n\n${line}` : line);
    setNotaText("");
    setShowNota(false);
  };

  const handleSubmitIncident = () => {
    const trimmed = incidentText.trim();
    if (!trimmed) return;
    const time = new Date().toLocaleTimeString("es-MX", {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const prefix = `[INCIDENCIA ${time}]: ${trimmed}`;
    setObservaciones((prev) =>
      prev ? `${prev}\n\n${prefix}` : prefix,
    );
    setIncidentText("");
    setShowIncident(false);
  };

  return (
    <div className="space-y-3">
      {/* Quick actions 2×2 */}
      <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest">
        Acciones rápidas
      </p>
      <div className="grid grid-cols-2 gap-3">
        {/* Tomar foto — activates photo capture below */}
        <button
          type="button"
          onClick={() => document.getElementById("checkout-photo-trigger")?.click()}
          className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col items-start gap-2 min-h-[44px] active:scale-[0.97] transition-transform"
        >
          <div className="w-9 h-9 bg-blue-light rounded-lg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A4FD8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <div className="text-left">
            <p className="font-head text-sm font-bold text-gray-800">Tomar foto</p>
            <p className="font-mono text-[10px] text-gray-400">Evidencia</p>
          </div>
        </button>

        {/* Agregar nota — opens modal */}
        <button
          type="button"
          onClick={() => setShowNota(true)}
          className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col items-start gap-2 min-h-[44px] active:scale-[0.97] transition-transform"
        >
          <div className="w-9 h-9 bg-amber/10 rounded-lg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <div className="text-left">
            <p className="font-head text-sm font-bold text-gray-800">Agregar nota</p>
            <p className="font-mono text-[10px] text-gray-400">Observación</p>
          </div>
        </button>

        {/* Ver mapa — get GPS → open Google Maps */}
        <button
          type="button"
          onClick={handleVerMapa}
          disabled={mapLoading}
          className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col items-start gap-2 active:scale-[0.97] transition-transform disabled:opacity-50"
        >
          <div className="w-9 h-9 bg-green/10 rounded-lg flex items-center justify-center">
            {mapLoading ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            )}
          </div>
          <div className="text-left">
            <p className="font-head text-sm font-bold text-gray-800">Ver mapa</p>
            <p className="font-mono text-[10px] text-gray-400">Ubicación</p>
          </div>
        </button>

        {/* Incidencia — opens modal */}
        <button
          type="button"
          onClick={() => setShowIncident(true)}
          className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col items-start gap-2 active:scale-[0.97] transition-transform"
        >
          <div className="w-9 h-9 bg-danger/10 rounded-lg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="text-left">
            <p className="font-head text-sm font-bold text-gray-800">Incidencia</p>
            <p className="font-mono text-[10px] text-gray-400">Reportar</p>
          </div>
        </button>
      </div>

      {/* Photo capture for checkout */}
      <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest pt-1">
        Foto de cierre (obligatoria)
      </p>
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <PhotoCapture
          label="Foto de check-out"
          onCapture={setPhotoFile}
          captured={!!photoFile}
          triggerId="checkout-photo-trigger"
        />
      </div>

      {/* Observations */}
      <div className="bg-white border border-gray-100 rounded-xl p-3">
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value.slice(0, 500))}
          placeholder="Observaciones al cierre (opcional)"
          rows={3}
          className="w-full text-sm font-body text-gray-800 placeholder:text-gray-400 resize-none focus:outline-none"
        />
        <p className="font-mono text-[10px] text-gray-400 text-right">{observaciones.length}/500</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="font-mono text-xs text-danger">{error}</p>
        </div>
      )}

      {/* Nota modal */}
      {showNota && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNota(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-head text-lg font-bold text-gray-900">Agregar nota</p>
              <button type="button" onClick={() => setShowNota(false)} className="text-gray-400 active:text-gray-700">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <textarea
              autoFocus
              value={notaText}
              onChange={(e) => setNotaText(e.target.value.slice(0, 500))}
              placeholder="Escribe tu observación…"
              rows={4}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-body text-gray-800 placeholder:text-gray-400 resize-none focus:outline-none focus:border-amber"
            />
            <p className="font-mono text-[10px] text-gray-400 text-right -mt-2">{notaText.length}/500</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowNota(false)}
                className="flex-1 border border-gray-200 text-gray-600 font-mono text-sm py-3 rounded-xl active:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleSubmitNota} disabled={!notaText.trim()}
                className="flex-1 bg-amber text-white font-mono text-sm font-bold py-3 rounded-xl disabled:opacity-40 active:scale-[0.98] transition-transform">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incident modal */}
      {showIncident && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowIncident(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-head text-lg font-bold text-gray-900">Reportar incidencia</p>
              <button
                type="button"
                onClick={() => setShowIncident(false)}
                className="text-gray-400 active:text-gray-700"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <textarea
              autoFocus
              value={incidentText}
              onChange={(e) => setIncidentText(e.target.value.slice(0, 500))}
              placeholder="Describe la incidencia…"
              rows={4}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-body text-gray-800 placeholder:text-gray-400 resize-none focus:outline-none focus:border-danger"
            />
            <p className="font-mono text-[10px] text-gray-400 text-right -mt-2">{incidentText.length}/500</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowIncident(false)}
                className="flex-1 border border-gray-200 text-gray-600 font-mono text-sm py-3 rounded-xl active:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmitIncident}
                disabled={!incidentText.trim()}
                className="flex-1 bg-danger text-white font-mono text-sm font-bold py-3 rounded-xl disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleCheckout}
        disabled={isLoading}
        className="w-full min-h-[54px] border-2 border-danger text-danger bg-white disabled:opacity-50
                   font-head text-xl font-bold rounded-xl
                   flex items-center justify-center gap-2.5
                   active:scale-[0.98] transition-transform"
      >
        {isLoading ? (
          <span className="font-mono text-sm tracking-wide">
            {status === "locating" && "⊙  Obteniendo ubicación…"}
            {status === "uploading" && "↑  Subiendo foto…"}
            {status === "saving" && "✓  Cerrando jornada…"}
          </span>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            FINALIZAR JORNADA
          </>
        )}
      </button>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
