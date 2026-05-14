"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface PhotoCaptureProps {
  label: string;
  onCapture: (file: File) => void;
  captured: boolean;
  /** Optional id forwarded to the hidden input so external buttons can trigger it */
  triggerId?: string;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    setMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);
  return mobile;
}

export function PhotoCapture({ label, onCapture, captured, triggerId }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showCam, setShowCam] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const isMobile = useIsMobile();

  // Attach stream to video element whenever the modal opens
  useEffect(() => {
    if (showCam && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [showCam, stream]);

  // Stop stream tracks when component unmounts
  useEffect(() => {
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  const openCamera = useCallback(async () => {
    if (isMobile) {
      // Mobile: native camera via <input capture>
      inputRef.current?.click();
      return;
    }
    // Desktop: ask for webcam via getUserMedia
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(s);
      setShowCam(true);
    } catch {
      // Permission denied or no camera — fall back to file picker
      inputRef.current?.click();
    }
  }, [isMobile]);

  const closeCamera = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setShowCam(false);
  }, [stream]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "captura.jpg", { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        setPreview(url);
        onCapture(file);
        closeCamera();
      },
      "image/jpeg",
      0.92,
    );
  }, [onCapture, closeCamera]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    onCapture(file);
  };

  return (
    <div className="w-full">
      {/* Hidden file input — used on mobile (capture) or as desktop fallback */}
      <input
        ref={inputRef}
        id={triggerId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Off-screen canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Desktop webcam modal */}
      {showCam && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
          <div className="bg-navy rounded-2xl overflow-hidden w-full max-w-sm shadow-2xl">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full aspect-video object-cover bg-black"
            />
            <div className="flex gap-3 p-4">
              <button
                type="button"
                onClick={captureFrame}
                className="flex-1 min-h-[54px] bg-blue text-white font-head text-lg font-bold rounded-xl
                           flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Capturar foto
              </button>
              <button
                type="button"
                onClick={closeCamera}
                className="px-5 min-h-[54px] border border-white/20 text-white/60 font-mono text-sm rounded-xl
                           active:scale-[0.97] transition-transform"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {preview ? (
        <div className="relative w-full rounded-xl overflow-hidden border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Vista previa" className="w-full h-40 object-cover" />
          <div className="absolute bottom-2 right-2">
            <button
              type="button"
              onClick={openCamera}
              className="bg-navy/80 text-white font-mono text-xs px-3 py-1.5 rounded-lg min-h-[44px]"
            >
              Cambiar
            </button>
          </div>
          <div className="absolute top-2 left-2 bg-green/90 text-white font-mono text-xs px-2 py-1 rounded">
            ✓ Foto lista
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openCamera}
          className="w-full min-h-[44px] border-2 border-dashed border-gray-200 rounded-xl
                     flex flex-col items-center justify-center gap-2 py-6
                     text-gray-400 hover:border-blue hover:text-blue transition-colors"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className="font-mono text-xs">{label}</span>
        </button>
      )}
    </div>
  );
}
