import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Cliente de base de datos (Neon serverless sobre HTTP).
 *
 * El driver HTTP no mantiene conexiones abiertas, así que funciona igual en
 * funciones serverless de Vercel, en el runtime edge del middleware y en los
 * scripts de línea de comandos: no hay pool que agotar ni que cerrar.
 */

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL — cadena de conexión de Neon (ver apps/web/.env.example)",
    );
  }
  return url;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Instancia perezosa: no toca la variable de entorno hasta la primera consulta,
 * de modo que importar este módulo nunca revienta un build sin DATABASE_URL.
 */
export function getDb() {
  if (!_db) {
    _db = drizzle(neon(connectionString()), { schema });
  }
  return _db;
}

/** Sólo para tests: fuerza recrear el cliente en la siguiente consulta. */
export function _resetDb() {
  _db = null;
}

export { schema };
export * from "./schema";
