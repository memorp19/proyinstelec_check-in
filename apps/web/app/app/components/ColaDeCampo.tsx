"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EVENTO_COLA,
  EVENTO_DESPERTAR,
  EVENTO_ERROR,
  contarCola,
  procesarCola,
} from "@/src/lib/sync-queue";

/**
 * Manda la cola de la app de campo sola (`procesarCola`): al abrir la app, al
 * volver la señal, al volver a verla, cuando se registra algo nuevo, y cada
 * minuto mientras falte algo, porque la señal puede volver sin que el
 * navegador avise. Va en el layout de `/app`.
 */
export function ProcesadorCola() {
  useEffect(() => {
    const procesar = () => {
      if (navigator.onLine === false) return;
      void procesarCola().catch((err) => console.error("[cola-campo]", err));
    };
    const alVerse = () => {
      if (document.visibilityState === "visible") procesar();
    };
    const revisar = () => {
      contarCola()
        .then((c) => {
          if (c.registros + c.fotos > 0) procesar();
        })
        .catch(() => {});
    };

    window.addEventListener("online", procesar);
    window.addEventListener(EVENTO_DESPERTAR, procesar);
    document.addEventListener("visibilitychange", alVerse);
    const intervalo = window.setInterval(revisar, 60_000);
    procesar();
    return () => {
      window.removeEventListener("online", procesar);
      window.removeEventListener(EVENTO_DESPERTAR, procesar);
      document.removeEventListener("visibilitychange", alVerse);
      window.clearInterval(intervalo);
    };
  }, []);

  return null;
}

/** Lo que la pantalla necesita saber de la cola: cuánto falta, si hay señal, y qué falló. */
export function useCola() {
  const [cuenta, setCuenta] = useState({ registros: 0, fotos: 0 });
  const [enLinea, setEnLinea] = useState(true);
  const [errores, setErrores] = useState<string[]>([]);

  useEffect(() => {
    setEnLinea(navigator.onLine !== false);
    const recontar = () => {
      contarCola().then(setCuenta).catch(() => {});
    };
    const alError = (e: Event) => {
      const mensaje = (e as CustomEvent<{ mensaje?: string }>).detail?.mensaje;
      if (mensaje) setErrores((antes) => [...antes, mensaje]);
    };
    const conRed = () => setEnLinea(true);
    const sinRed = () => setEnLinea(false);

    window.addEventListener(EVENTO_COLA, recontar);
    window.addEventListener(EVENTO_ERROR, alError);
    window.addEventListener("online", conRed);
    window.addEventListener("offline", sinRed);
    recontar();
    return () => {
      window.removeEventListener(EVENTO_COLA, recontar);
      window.removeEventListener(EVENTO_ERROR, alError);
      window.removeEventListener("online", conRed);
      window.removeEventListener("offline", sinRed);
    };
  }, []);

  const quitarError = useCallback((i: number) => setErrores((antes) => antes.filter((_, j) => j !== i)), []);

  return { ...cuenta, enLinea, errores, quitarError };
}
