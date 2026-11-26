/**
 * Cómo se enseña un proyecto en la app de campo: por su nombre, con su
 * empresa debajo. Nunca por su id, que es un UUID.
 *
 * Sin base de datos: lo usan las páginas del servidor y las pantallas.
 */

export interface NombreDeProyecto {
  nombre: string;
  empresa: string;
}

/** Lo que se enseña si un proyecto ya no existe (o no se pudo leer). */
export const PROYECTO_SIN_NOMBRE = "Proyecto sin nombre";

/** El nombre de un proyecto, o `PROYECTO_SIN_NOMBRE`; nunca su id. */
export function nombreDeProyecto(nombres: Record<string, NombreDeProyecto>, id: string | null | undefined): string {
  return (id && nombres[id]?.nombre) || PROYECTO_SIN_NOMBRE;
}

/** Los proyectos del modo demo, que solo traen nombre, en la misma forma. */
export function nombresDeDemo(proyectos: Record<string, string>): Record<string, NombreDeProyecto> {
  return Object.fromEntries(Object.entries(proyectos).map(([id, nombre]) => [id, { nombre, empresa: "" }]));
}
