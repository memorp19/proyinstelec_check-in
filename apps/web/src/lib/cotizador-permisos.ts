/**
 * Quién puede armar una cotización, resuelto contra la sesión y la base.
 *
 * La regla pura vive en `cotizador/armado.ts` (`puedeArmar`,
 * `edicionPorEstatus`); aquí se junta con lo que hay que ir a buscar: las
 * iniciales del usuario, que la sesión trae pero pueden faltar.
 */
import { edicionPorEstatus, puedeArmar } from "./cotizador";
import { tienePermiso } from "./permisos";
import type { Cotizacion } from "./cotizaciones";

export interface UsuarioSesion {
  email?: string | null;
  iniciales?: string | null;
  rol?: string;
  es_super_admin?: boolean;
  permisos?: string[];
}

export interface Acceso {
  /** Puede ver la pantalla. Quien entra al módulo puede consultar. */
  puedeVer: boolean;
  /** Puede guardar cambios. */
  puedeEditar: boolean;
  /** Por qué no, cuando no. Es lo que se le enseña a la persona. */
  motivo: string;
}

/**
 * El acceso de alguien a una cotización.
 *
 * Son dos preguntas y las dos tienen que dar que sí: **quién** eres —la armó
 * quien la dio de alta, o el gerente de operaciones— y **en qué estado está**
 * —una versión congelada no se edita—. Se contestan en ese orden porque el
 * mensaje útil es distinto: "no es tuya" se resuelve pidiéndosela a alguien, y
 * "ya se congeló" se resuelve con una versión nueva.
 */
export function accesoAlArmado(cotizacion: Cotizacion, usuario: UsuarioSesion | null | undefined): Acceso {
  if (!usuario) return { puedeVer: false, puedeEditar: false, motivo: "No autorizado" };

  const quien = puedeArmar(cotizacion, usuario, tienePermiso(usuario, "cotizaciones.armar.todas"));
  if (!quien.puede) return { puedeVer: true, puedeEditar: false, motivo: quien.motivo };

  const estado = edicionPorEstatus(cotizacion.estatus);
  if (!estado.editable) return { puedeVer: true, puedeEditar: false, motivo: estado.motivo };

  return { puedeVer: true, puedeEditar: true, motivo: "" };
}
