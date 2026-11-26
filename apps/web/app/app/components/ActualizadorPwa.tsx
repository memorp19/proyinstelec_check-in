"use client";

import { useEffect } from "react";
import { crearActualizador } from "@/src/lib/actualizar-app";

/**
 * Conecta `crearActualizador` con el service worker de la PWA y con la
 * página. Va en el layout de `/app`, que es la app instalada en los
 * teléfonos; el ERP de oficina no se recarga solo, porque ahí alguien puede
 * estar escribiendo en un formulario.
 */

const actualizador =
  typeof window === "undefined"
    ? null
    : crearActualizador({
        recargar: () => window.location.reload(),
        estaVisible: () => document.visibilityState === "visible",
      });

/** Cada cuánto se pregunta por una versión nueva mientras la app sigue abierta. */
const CADA_MS = 30 * 60 * 1000;

export function ActualizadorPwa() {
  useEffect(() => {
    // En desarrollo `next-pwa` no registra service worker: no hay nada que hacer.
    if (!actualizador || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;

    // La primera vez que se instala, el service worker también toma el
    // control (`clientsClaim`), y eso no es una versión nueva.
    let controlado = Boolean(sw.controller);
    const alCambiar = () => {
      if (controlado) actualizador.hayVersionNueva();
      controlado = true;
    };

    // El navegador solo revisa al navegar, y una app abierta en el teléfono
    // casi no navega: se pregunta al volver a verla y cada media hora.
    const buscar = () => {
      sw.getRegistration()
        .then((r) => r?.update())
        .catch(() => {});
    };
    const alVerse = () => {
      if (document.visibilityState !== "visible") return;
      buscar();
      actualizador.alVolverAVerse();
    };

    sw.addEventListener("controllerchange", alCambiar);
    document.addEventListener("visibilitychange", alVerse);
    const intervalo = window.setInterval(buscar, CADA_MS);
    buscar();
    return () => {
      sw.removeEventListener("controllerchange", alCambiar);
      document.removeEventListener("visibilitychange", alVerse);
      window.clearInterval(intervalo);
    };
  }, []);

  return null;
}

/** Mientras `activo` sea cierto, la app no se recarga sola: hay trabajo a medias. */
export function useSinRecargar(activo: boolean) {
  useEffect(() => {
    if (!activo || !actualizador) return;
    return actualizador.ocupar();
  }, [activo]);
}
