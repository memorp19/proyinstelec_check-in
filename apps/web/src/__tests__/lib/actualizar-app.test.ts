/**
 * Cuándo se recarga sola la app de campo: en cuanto hay versión nueva, si se
 * está viendo y nadie tiene trabajo a medias.
 */
import { describe, it, expect, vi } from "vitest";
import { ESPERA_AL_VOLVER_MS, crearActualizador } from "@/src/lib/actualizar-app";

function preparar({ visible = true } = {}) {
  const estado = { visible };
  const recargar = vi.fn();
  const pendientes: Array<{ fn: () => void; ms: number }> = [];
  const a = crearActualizador({
    recargar,
    estaVisible: () => estado.visible,
    esperar: (fn, ms) => pendientes.push({ fn, ms }),
  });
  const correrEsperas = () => pendientes.splice(0).forEach((p) => p.fn());
  return { a, recargar, estado, pendientes, correrEsperas };
}

describe("crearActualizador", () => {
  it("versión nueva, a la vista y sin nada a medias: recarga, una sola vez", () => {
    const { a, recargar } = preparar();

    a.hayVersionNueva();
    a.hayVersionNueva();

    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("sin versión nueva no recarga nunca", () => {
    const { a, recargar, correrEsperas } = preparar();

    a.ocupar()();
    a.alVolverAVerse();
    correrEsperas();

    expect(recargar).not.toHaveBeenCalled();
  });

  // Una foto tomada, un check-in en curso: se perdería.
  it("con trabajo a medias espera, y recarga al terminar", () => {
    const { a, recargar } = preparar();
    const soltar = a.ocupar();

    a.hayVersionNueva();
    expect(recargar).not.toHaveBeenCalled();

    soltar();
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("espera a que terminen todos, y soltar dos veces no cuenta doble", () => {
    const { a, recargar } = preparar();
    const soltarUno = a.ocupar();
    const soltarOtro = a.ocupar();
    a.hayVersionNueva();

    soltarUno();
    soltarUno();
    expect(recargar).not.toHaveBeenCalled();

    soltarOtro();
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  // Fuera de la pantalla puede estar la cámara del teléfono abierta.
  it("fuera de la pantalla no recarga; al volver, después de la espera", () => {
    const { a, recargar, estado, pendientes, correrEsperas } = preparar({ visible: false });

    a.hayVersionNueva();
    expect(recargar).not.toHaveBeenCalled();

    estado.visible = true;
    a.alVolverAVerse();
    expect(recargar).not.toHaveBeenCalled();
    expect(pendientes[0].ms).toBe(ESPERA_AL_VOLVER_MS);

    correrEsperas();
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  // Volvió de la cámara con la foto: en la espera, la tarjeta ya la marcó.
  it("si en la espera llegó trabajo a medias, no recarga", () => {
    const { a, recargar, estado, correrEsperas } = preparar({ visible: false });
    a.hayVersionNueva();

    estado.visible = true;
    a.alVolverAVerse();
    const soltar = a.ocupar();
    correrEsperas();
    expect(recargar).not.toHaveBeenCalled();

    soltar();
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});
