/**
 * Super administradores del sistema.
 *
 * Es la única lista que vive en el código (todo lo demás se administra desde la
 * base): son las cuentas que pueden administrar usuarios y que nadie más puede
 * degradar. Al entrar por primera vez, estas cuentas reciben rol de
 * administrador automáticamente.
 *
 * Módulo puro a propósito: lo usan tanto el servidor como componentes de
 * cliente, así que no debe importar nada de la base ni de Auth.js.
 */
export const SUPER_ADMINS = [
  "memorp19@gmail.com",
  "soporteit@proyinstelec.com",
  "soporteit@proyinstelec.mx",
  "jorge.gutierrez@proyinstelec.mx",
] as const;

const CONJUNTO = new Set<string>(SUPER_ADMINS.map((c) => c.toLowerCase()));

export function esSuperAdmin(email?: string | null): boolean {
  return CONJUNTO.has((email ?? "").trim().toLowerCase());
}
