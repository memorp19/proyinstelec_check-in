"use client";

import { importeEnLetra, type Armado, type ResultadoCotizacion } from "@/src/lib/cotizador";
import { conMoneda, etiqueta, pesos, tarjeta } from "../ui";

/**
 * Los totales, en dos bloques que no se mezclan.
 *
 * Arriba, **el panel interno**: costo, precio y margen por partida. Se llama
 * "costo total" y nunca "subtotal" — el subtotal es lo que ve el cliente, y
 * usar la misma palabra para las dos cosas es cómo alguien acaba leyendo en
 * voz alta el número equivocado en una junta.
 *
 * Abajo, lo que ve el cliente: subtotal, IVA, total y la letra.
 */
export function Totales({ armado, resultado }: { armado: Armado; resultado: ResultadoCotizacion }) {
  const margen = (precio: number, costo: number) => (precio > 0 ? ((precio - costo) / precio) * 100 : 0);

  /**
   * El costo neto no existía cuando se congelaron las versiones viejas.
   *
   * Si no está, el panel lo dice y **no pinta margen**. Recalcularlo hoy sobre
   * los parámetros de entonces daría un número que se ve igual de confiable
   * que uno real y no lo es.
   */
  const hayNeto = resultado.costoNeto !== undefined;
  const costoDe = (p: ResultadoCotizacion["partidas"][number]) => p.costoNeto;

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {/* ── Interno ─────────────────────────────────────────────────────────── */}
      <div className={`${tarjeta} p-4`}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-head text-xl text-white uppercase tracking-wide">Costo total</h2>
          <span className="font-mono text-[9px] text-amber uppercase tracking-widest">solo interno</span>
        </div>
        <p className="font-body text-xs text-white/40 mt-1">
          No sale en el documento. El costo es lo que cuesta hacer el trabajo —conceptos y gastos,{" "}
          <strong className="text-white/60">sin la utilidad</strong>— contra lo que se va a cobrar.
        </p>

        {!hayNeto && (
          <p className="font-body text-xs text-amber bg-amber/15 rounded-lg px-3 py-2 mt-3">
            Costo neto no disponible en esta versión: se congeló antes de que el panel lo separara de
            la utilidad. No se calcula el margen, porque saldría medido contra otro número.
          </p>
        )}

        <table className="w-full mt-3 text-sm">
          <thead>
            <tr className="text-left">
              <th className={`${etiqueta} font-normal pb-1`}>Partida</th>
              <th className={`${etiqueta} font-normal pb-1 text-right`}>Costo</th>
              <th className={`${etiqueta} font-normal pb-1 text-right`}>Precio</th>
              <th className={`${etiqueta} font-normal pb-1 text-right`}>Margen</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {resultado.partidas.map((p, i) => {
              const costo = costoDe(p);
              return (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="py-1.5 font-body text-white/70">{p.titulo || `Partida ${i + 1}`}</td>
                  <td className="py-1.5 text-right text-white/50">
                    {costo === undefined ? "—" : pesos(costo)}
                  </td>
                  <td className="py-1.5 text-right text-white">{pesos(p.importe)}</td>
                  <td
                    className={`py-1.5 text-right ${
                      costo !== undefined && margen(p.importe, costo) < 0 ? "text-danger" : "text-white/70"
                    }`}
                  >
                    {costo === undefined ? "—" : `${margen(p.importe, costo).toFixed(1)} %`}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-white/20 font-bold">
              <td className="py-2 font-body text-white">Total</td>
              <td className="py-2 text-right text-white/60">
                {resultado.costoNeto === undefined ? "—" : pesos(resultado.costoNeto)}
              </td>
              <td className="py-2 text-right text-white">{pesos(resultado.subtotal)}</td>
              <td
                className={`py-2 text-right ${
                  resultado.costoNeto !== undefined && margen(resultado.subtotal, resultado.costoNeto) < 0
                    ? "text-danger"
                    : "text-green"
                }`}
              >
                {resultado.costoNeto === undefined
                  ? "—"
                  : `${margen(resultado.subtotal, resultado.costoNeto).toFixed(1)} %`}
              </td>
            </tr>
          </tbody>
        </table>

        {/* La utilidad, en su propio renglón: es la diferencia entre el costo
            de arriba y el "costo directo" con el que se construye el precio,
            y sin verla nadie entiende por qué no son el mismo número. */}
        {resultado.utilidadConceptos !== undefined && (
          <dl className="mt-3 border-t border-white/10 pt-3 space-y-1 font-mono text-xs">
            <div className="flex justify-between">
              <dt className="font-body text-white/50">Utilidad en los conceptos</dt>
              <dd className="text-white/70">{pesos(resultado.utilidadConceptos)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="font-body text-white/40">Costo directo (costo + utilidad)</dt>
              <dd className="text-white/50">{pesos(resultado.costoTotal)}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* ── Lo que ve el cliente ────────────────────────────────────────────── */}
      <div className={`${tarjeta} p-4`}>
        <h2 className="font-head text-xl text-white uppercase tracking-wide">Lo que ve el cliente</h2>
        <p className="font-body text-xs text-white/40 mt-1">
          El total es la suma de los importes de las partidas: si el cliente multiplica cada unitario por
          su cantidad y suma, le tiene que dar esto.
        </p>

        <dl className="mt-4 space-y-2 font-mono text-sm">
          <div className="flex justify-between">
            <dt className="text-white/50">Subtotal</dt>
            <dd className="text-white">{conMoneda(resultado.subtotal, resultado.moneda)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/50">IVA {armado.ivaPct} %</dt>
            <dd className="text-white">{conMoneda(resultado.iva, resultado.moneda)}</dd>
          </div>
          <div className="flex justify-between border-t border-white/20 pt-2">
            <dt className="text-white font-bold">Total</dt>
            <dd className="text-white font-bold">{conMoneda(resultado.total, resultado.moneda)}</dd>
          </div>
        </dl>

        {/* La letra va aquí y no suelta al final de la pantalla: es parte de
            lo que ve el cliente, justo debajo del total que describe. */}
        <p className="font-body text-xs text-white/60 mt-3 border-t border-white/10 pt-3">
          {importeEnLetra(resultado.total, resultado.moneda)}
        </p>

        {/* Los avisos del motor, donde se producen. */}
        {resultado.avisos.length > 0 && (
          <ul className="mt-4 space-y-1">
            {resultado.avisos.map((a, i) => (
              <li key={i} className="font-body text-xs text-amber bg-amber/15 rounded-lg px-3 py-2">
                {a}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
