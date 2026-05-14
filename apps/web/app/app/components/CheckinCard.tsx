"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { getCurrentPosition } from "@/src/lib/geolocation";
import { getDeviceInfo } from "@/src/lib/device-info";
import { enqueue } from "@/src/lib/sync-queue";
import { PhotoCapture } from "./PhotoCapture";

interface CheckinCardProps {
  proyectoId: string;
  proyectoNombre: string;
  onCheckinSuccess: (jornadaId: string) => void;
}

type Status = "idle" | "locating" | "uploading" | "saving" | "done" | "error";

export function CheckinCard({ proyectoId, proyectoNombre, onCheckinSuccess }: CheckinCardProps) {
  const { data: session } = useSession();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

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

      let driveFileId: string | undefined;
      let driveWebViewLink: string | undefined;
      let fotoHash: string | undefined;

      if (navigator.onLine) {
        setStatus("uploading");
        const base64 = await fileToBase64(photoFile);
        const localDate = new Date().toLocaleDateString("es-MX", {
          timeZone: "America/Mexico_City",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).split("/").reverse().join("-"); // YYYY-MM-DD

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64,
            filename: `checkin_${timestamp.slice(11, 16).replace(":", "")}.jpg`,
            mimeType: photoFile.type || "image/jpeg",
            proyectoNombre,
            fecha: localDate,
            trabajadorNombre: session?.user.name ?? "trabajador",
          }),
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          driveFileId = uploadData.driveFileId;
          driveWebViewLink = uploadData.webViewLink;
          fotoHash = uploadData.hash;
        }
        // If upload fails, continue — mark as pendiente
      }

      const checkinPayload = {
        proyectoId,
        checkIn: {
          timestamp,
          lat: position.lat,
          lng: position.lng,
          precision: position.precision,
          driveFileId,
          driveWebViewLink,
          fotoHash,
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
        onCheckinSuccess(jornadaId);
      } else {
        // Offline — queue for later sync
        const id = await enqueue("checkin", checkinPayload);
        setStatus("done");
        onCheckinSuccess(id);
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

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
