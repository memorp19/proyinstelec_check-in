/**
 * Encadenado falso de Drizzle para los tests de las libs.
 *
 * Cualquier método (`select`, `from`, `where`, `insert`, `returning`, …)
 * devuelve la misma cadena y registra la llamada; cada `await` consume el
 * siguiente resultado de la cola, en el orden en que la lib lanza las
 * consultas. Un elemento `{ error }` hace que ese await rechace (así se simula
 * el 23505 de una llave duplicada).
 */
export type ResultadoFalso = unknown[] | { error: unknown } | unknown;

export interface DbFalso {
  getDb: () => unknown;
  llamadas: Array<{ metodo: string; args: unknown[] }>;
  metodos: () => string[];
}

export function dbFalso(resultados: ResultadoFalso[] = []): DbFalso {
  const cola = [...resultados];
  const llamadas: Array<{ metodo: string; args: unknown[] }> = [];

  const cadena: unknown = new Proxy(function noop() {}, {
    get(_destino, prop) {
      if (prop === "then") {
        return (resolver: (v: unknown) => void, rechazar: (e: unknown) => void) => {
          const siguiente = cola.length > 0 ? cola.shift() : [];
          if (siguiente && typeof siguiente === "object" && "error" in siguiente) {
            return Promise.reject((siguiente as { error: unknown }).error).then(resolver, rechazar);
          }
          return Promise.resolve(siguiente).then(resolver, rechazar);
        };
      }
      return (...args: unknown[]) => {
        llamadas.push({ metodo: String(prop), args });
        return cadena;
      };
    },
  });

  return {
    getDb: () => cadena,
    llamadas,
    metodos: () => llamadas.map((l) => l.metodo),
  };
}

/** Error de violación de unicidad tal como lo reporta Postgres. */
export function errorDuplicado(): Error & { code: string } {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: "23505",
  });
}
