/**
 * En qué proyectos puede fichar alguien.
 *
 * La usan `/api/jornada` (abrir la jornada) y `/api/upload` (la foto del
 * check-in): si cada ruta tuviera su copia, una foto podría caer en la carpeta
 * de un proyecto donde la jornada no se habría podido abrir.
 */

/**
 * - Un **temporal** solo ficha en sus proyectos asignados. La asignación vive
 *   en la tabla puente, no en el token: quien llama pasa el perfil de la base.
 * - **Los demás** (planta, admin) fichan en cualquier proyecto, como siempre.
 * - **En desarrollo** no se revisa: ahí se usa un proyecto de prueba que no
 *   está asignado a nadie.
 */
export function puedeFicharEn(
  usuario: { tipo: string; proyectos_asignados: string[] },
  proyectoId: string,
  desarrollo: boolean = process.env.NODE_ENV === "development",
): boolean {
  if (desarrollo) return true;
  if (usuario.tipo !== "temporal") return true;
  return usuario.proyectos_asignados.includes(proyectoId);
}
