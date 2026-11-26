/**
 * La jornada abierta, guardada en el teléfono.
 *
 * Sirve para volver a la pantalla de la jornada activa aunque la app se haya
 * cerrado sin señal. Si el check-in se hizo sin señal, su id es el de la cola
 * (todavía no tiene uno del servidor); cuando la cola lo manda, lo cambia aquí
 * por el de verdad (`cambiarJornadaLocal`).
 */

const CLAVE = "proyinstelec:jornada";

export interface JornadaLocal {
  jornadaId: string;
  checkInTs: string;
  proyectoId: string | null;
}

export function guardarJornadaLocal(datos: JornadaLocal): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
  } catch {
    // Sin almacenamiento (modo privado): la jornada sigue en la pantalla.
  }
}

export function leerJornadaLocal(): JornadaLocal | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    return crudo ? (JSON.parse(crudo) as JornadaLocal) : null;
  } catch {
    return null;
  }
}

export function borrarJornadaLocal(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // Nada que borrar.
  }
}

/** Si la guardada es la del check-in que esperaba en la cola, le pone su id del servidor. */
export function cambiarJornadaLocal(idDeCola: string, idDelServidor: string): void {
  const guardada = leerJornadaLocal();
  if (guardada?.jornadaId === idDeCola) guardarJornadaLocal({ ...guardada, jornadaId: idDelServidor });
}
