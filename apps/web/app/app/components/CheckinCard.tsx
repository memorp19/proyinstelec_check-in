"use client";

import { useState } from "react";
import { getCurrentPosition } from "@/src/lib/geolocation";
import { getDeviceInfo } from "@/src/lib/device-info";
import { enqueue } from "@/src/lib/sync-queue";
import { avisoSinConexion, subirFotoDeJornada, type FotoSubida } from "@/src/lib/foto-jornada";
import { PhotoCapture } from "./PhotoCapture";
import { useSinRecargar } from "./ActualizadorPwa";

interface CheckinCardProps {
  proyectoId: string;
  /** `avisoFoto`: si la foto no subió, qué decirle a la persona. El check-in sí quedó. */
  onCheckinSuccess: (jornadaId: string, avisoFoto?: string) => void;
}

type Status = "idle" | "locating" | "uploading" | "saving" | "done" | "error";

export function CheckinCard({ proyectoId, onCheckinSuccess }: CheckinCardProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  // Mientras se ficha no hay recarga: la cámara del teléfono saca a la app de
  // la pantalla, y una recarga a medias perdería la foto.
  useSinRecargar(true);

  const handleCheckin = async () => {
    if (!proyectoId) {
      setError("No tienes un proyecto asignado. Contacta a tu supervisor.");
      return;
    }
    if (!photoFile) {
      setError("La foto es obligatoria para el check-in.");
      return;
    }

    setError(null);

    try {
      setStatus("locating");
      const position = await getCurrentPosition();
      const deviceInfo = getDeviceInfo();
      const timestamp = new Date().toISOString();

      // La foto va aparte y nunca tumba el check-in: si no sube, la jornada
      // queda con la foto pendiente y la pantalla dice por qué. La carpeta y
      // el nombre los decide el servidor; aquí solo se dice a qué proyecto.
      let foto: FotoSubida | undefined;
      let avisoFoto: string | undefined;
      if (navigator.onLine) {
        setStatus("uploading");
        const subida = await subirFotoDeJornada({ tipo: "checkin", proyectoId }, photoFile);
        if (subida.ok) foto = subida.foto;
        else avisoFoto = subida.aviso;
      } else {
        avisoFoto = avisoSinConexion("checkin");
      }

      const checkinPayload = {
        proyectoId,
        checkIn: {
          timestamp,
          lat: position.lat,
          lng: position.lng,
          precision: position.precision,
          driveFileId: foto?.driveFileId,
          driveWebViewLink: foto?.webViewLink,
          fotoHash: foto?.hash,
          deviceInfo,
        },
      };

      if (navigator.onLine) {
        setStatus("saving");
        const res = await fetch("/api/jornada", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(checkinPayload),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Error al registrar el check-in");
        }

        const { jornadaId } = await res.json();
        setStatus("done");
        onCheckinSuccess(jornadaId, avisoFoto);
      } else {
        // Offline — queue for later sync
        const id = await enqueue("checkin", checkinPayload);
        setStatus("done");
        onCheckinSuccess(id, avisoFoto);
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Error inesperado");
    }
  };

  const isLoading = ["locating", "uploading", "saving"].includes(status);

  return (
    <div className="space-y-3 pt-1">
      {/* Photo capture — white card on dark bg */}
      <div className="bg-white/10 border border-white/10 rounded-xl overflow-hidden">
        <PhotoCapture
          label="Foto de check-in (obligatoria)"
          onCapture={setPhotoFile}
          captured={!!photoFile}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="font-mono text-xs text-danger">{error}</p>
        </div>
      )}

      <button
        onClick={handleCheckin}
        disabled={isLoading}
        className="w-full min-h-[54px] bg-blue disabled:opacity-50 text-white
                   font-head text-xl font-bold rounded-xl
                   flex items-center justify-center gap-2.5
                   active:scale-[0.98] transition-transform"
      >
        {isLoading ? (
          <span className="font-mono text-sm tracking-wide">
            {status === "locating" && "⊙  Obteniendo ubicación…"}
            {status === "uploading" && "↑  Subiendo foto…"}
            {status === "saving" && "✓  Registrando…"}
          </span>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            INICIAR JORNADA
          </>
        )}
      </button>
    </div>
  );
}
