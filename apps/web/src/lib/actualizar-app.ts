/**
 * Que la app de campo se actualice sola en cuanto haya versión nueva.
 *
 * La PWA ya instala y activa el service worker nuevo sin esperar
 * (`skipWaiting` y `clientsClaim`, que `next-pwa` trae encendidos). Lo que
 * faltaba es la página: una app que se queda abierta en el teléfono sigue
 * corriendo el código viejo hasta que alguien la cierra. Con el servidor ya
 * rechazando lo que manda una pantalla vieja, eso es una foto que no sube.
 *
 * Esta pieza decide **cuándo recargar**: en cuanto hay versión nueva, siempre
 * que la app se esté viendo y nadie tenga trabajo a medias (una foto tomada,
 * un check-in en curso, una nota escrita). Si hay trabajo a medias, espera a
 * que se termine.
 *
 * Es pura para poder probarla: el componente `ActualizadorPwa` la conecta con
 * el service worker y con la página.
 */

/**
 * Al volver a la app desde la cámara del teléfono, la foto llega un instante
 * después de que la página se vuelve a ver. Sin esta espera se recargaría
 * antes de que la tarjeta la marque como trabajo a medias.
 */
export const ESPERA_AL_VOLVER_MS = 1500;

export interface Actualizador {
  /** Marca trabajo a medias. Devuelve con qué soltarlo; soltar dos veces no cuenta doble. */
  ocupar(): () => void;
  /** El service worker de una versión nueva ya tomó el control. */
  hayVersionNueva(): void;
  /** La app se volvió a ver (volvió del fondo o de la cámara). */
  alVolverAVerse(): void;
}

export function crearActualizador(entorno: {
  recargar: () => void;
  estaVisible: () => boolean;
  esperar?: (fn: () => void, ms: number) => void;
}): Actualizador {
  let ocupados = 0;
  let pendiente = false;
  let recargando = false;
  const esperar = entorno.esperar ?? ((fn, ms) => void setTimeout(fn, ms));

  const intentar = () => {
    if (!pendiente || recargando || ocupados > 0 || !entorno.estaVisible()) return;
    recargando = true;
    entorno.recargar();
  };

  return {
    ocupar() {
      ocupados++;
      let suelto = false;
      return () => {
        if (suelto) return;
        suelto = true;
        ocupados--;
        intentar();
      };
    },
    hayVersionNueva() {
      pendiente = true;
      intentar();
    },
    alVolverAVerse() {
      esperar(intentar, ESPERA_AL_VOLVER_MS);
    },
  };
}
