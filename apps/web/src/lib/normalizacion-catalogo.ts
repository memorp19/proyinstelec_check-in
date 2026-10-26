/**
 * Limpieza de las columnas normalizadas del catálogo de clientes.
 *
 * `clientes.razon_normalizada` y `contactos.nombre_normalizado` existen para
 * una sola cosa: ser la llave con la que se reconoce a alguien que ya está
 * dado de alta. Una carga anterior las escribió **en mayúsculas, con acentos,
 * con puntuación y con el sufijo legal intacto** —nunca pasaron por el
 * normalizador—, y eso las vuelve inútiles para lo único que hacen.
 *
 * El daño no es que una importación no encuentre a nadie; eso se puede sortear
 * renormalizando al leer, y es lo que hace `importacion-clientes.ts`. El daño
 * es el índice `UNIQUE (cliente_id, nombre_normalizado)`: compara cadenas, así
 * que mientras convivan `"ADRIAN RAMIREZ"` y `adrian ramirez` **el índice no
 * protege de nada** y un alta por la pantalla crea el duplicado.
 *
 * Sin base: todo entra como dato, para poder probar la detección de choques
 * sin tocar nada.
 */
import { normalizarNombreContacto, normalizarRazonSocial } from "./clientes";

export interface FilaNormalizable {
  id: string;
  /** El texto bueno: la razón social o el nombre. */
  texto: string;
  /** Lo que hoy tiene la columna normalizada. */
  normalizadoActual: string;
  /** Para contactos: el cliente dentro del cual la llave debe ser única. */
  grupo?: string;
}

export interface Correccion {
  id: string;
  texto: string;
  antes: string;
  despues: string;
  grupo?: string;
}

export interface Choque {
  /** El valor normalizado que quedaría repetido. */
  valor: string;
  grupo?: string;
  filas: Array<{ id: string; texto: string }>;
}

export interface PlanDeLimpieza {
  correcciones: Correccion[];
  /**
   * Filas que al limpiarse quedarían con la misma llave dentro de su grupo.
   *
   * No son un problema de la limpieza: **son duplicados que ya existen** y que
   * la columna sucia tenía escondidos. Escribirlos rompería el índice único,
   * y resolverlos es decidir cuál se queda — eso lo hace una persona.
   */
  choques: Choque[];
  /** Las que ya estaban bien. */
  correctas: number;
}

/**
 * Qué habría que corregir, y qué chocaría al corregirlo.
 *
 * `normalizar` es la función que corresponda a la columna; se inyecta para que
 * la misma lógica sirva para clientes y para contactos sin duplicarla.
 */
export function planearLimpieza(
  filas: FilaNormalizable[],
  normalizar: (valor: string) => string,
): PlanDeLimpieza {
  const correcciones: Correccion[] = [];
  let correctas = 0;

  for (const f of filas) {
    const despues = normalizar(f.texto);
    if (despues === f.normalizadoActual) {
      correctas++;
      continue;
    }
    correcciones.push({
      id: f.id,
      texto: f.texto,
      antes: f.normalizadoActual,
      despues,
      ...(f.grupo === undefined ? {} : { grupo: f.grupo }),
    });
  }

  // El choque se mide sobre el resultado final —lo corregido y lo que ya
  // estaba bien—, no solo sobre lo que cambia: una fila correcta puede ser con
  // la que choque otra al limpiarse.
  const porLlave = new Map<string, Array<{ id: string; texto: string }>>();
  for (const f of filas) {
    const valor = normalizar(f.texto);
    if (!valor) continue;
    const llave = `${f.grupo ?? ""}\u0000${valor}`;
    porLlave.set(llave, [...(porLlave.get(llave) ?? []), { id: f.id, texto: f.texto }]);
  }

  const choques: Choque[] = [];
  for (const [llave, enEseValor] of porLlave) {
    if (enEseValor.length < 2) continue;
    const [grupo, valor] = llave.split("\u0000");
    choques.push({ valor, ...(grupo ? { grupo } : {}), filas: enEseValor });
  }

  return { correcciones, choques, correctas };
}

export const normalizarDeCliente = normalizarRazonSocial;
export const normalizarDeContacto = normalizarNombreContacto;

// ── Las escrituras ────────────────────────────────────────────────────────────

type ConsultaSql<T> = (plantilla: TemplateStringsArray, ...valores: unknown[]) => T;

export function corregirCliente<T>(sql: ConsultaSql<T>, c: { id: string; despues: string }): T {
  return sql`UPDATE clientes SET razon_normalizada = ${c.despues}, updated_at = now() WHERE id = ${c.id}`;
}

export function corregirContacto<T>(sql: ConsultaSql<T>, c: { id: string; despues: string }): T {
  return sql`UPDATE contactos SET nombre_normalizado = ${c.despues}, updated_at = now() WHERE id = ${c.id}`;
}
