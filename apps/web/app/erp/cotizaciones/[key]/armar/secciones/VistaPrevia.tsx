"use client";

import { importeEnLetra, normasElegidas, type Armado, type ResultadoCotizacion } from "@/src/lib/cotizador";
import { btnGhost, btnPrimary, conMoneda, etiqueta, pesos } from "../ui";

/**
 * Lo que va a ver el cliente, antes de que nadie lo mande a ningún lado.
 *
 * Mandar a revisión congela los importes: el revisor mira estos números y ya no
 * se mueven. Que el último paso sea leer lo que se va a mandar —y no un botón
 * que dispara— es la diferencia entre revisar y enterarse después.
 *
 * **Esto es un resumen, no el documento.** El PR del PDF lo sustituye por el
 * documento real con marca de BORRADOR; mientras tanto, enseña las mismas
 * cifras y las mismas condiciones que va a llevar.
 */
export function VistaPrevia({
  armado,
  resultado,
  cliente,
  titulo,
  folio,
  sinArmado,
  enviando,
  error,
  onCerrar,
  onMandar,
}: {
  armado: Armado;
  resultado: ResultadoCotizacion;
  cliente: string;
  titulo: string;
  folio: string;
  /** Las importadas de 2026 no pasaron por el cotizador y no tienen partidas. */
  sinArmado: boolean;
  enviando: boolean;
  error: string | null;
  onCerrar: () => void;
  onMandar: () => void;
}) {
  const d = armado.documento;
  const normas = normasElegidas(d.normas, titulo);

  return (
    <div className="fixed inset-0 z-50 bg-navy/90 backdrop-blur-sm overflow-y-auto">
      <div className="max-w-3xl mx-auto my-6 bg-navy border border-white/20 rounded-xl">
        {/* Barra */}
        <div className="sticky top-0 bg-navy/95 backdrop-blur border-b border-white/10 px-5 py-3 flex items-center gap-3">
          <div className="flex-1">
            <p className={etiqueta}>Vista previa</p>
            <p className="font-mono text-sm text-white">{folio}</p>
          </div>
          <button className={btnGhost} onClick={onCerrar}>
            Seguir editando
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="font-body text-xs text-white/40">
            Así van las cifras y las condiciones. El documento con su formato llega en cuanto
            esté el generador del PDF; lo que ves aquí es lo que va a decir.
          </p>

          <div>
            <p className={etiqueta}>Cliente</p>
            <p className="font-body text-sm text-white">{cliente}</p>
            <p className="font-body text-sm text-white/60">{titulo}</p>
          </div>

          {sinArmado ? (
            <div className="bg-amber/10 border border-amber/30 rounded-xl p-4">
              <p className="font-body text-sm text-amber">
                Esta cotización no está armada: no tiene partidas en el cotizador.
              </p>
              <p className="font-body text-xs text-white/50 mt-2">
                Las cargadas del control de 2026 son así — su monto se capturó a mano. Puedes
                armarla aquí, o mandarla a revisión como está: entonces no se congela nada, porque
                no hay nada que calcular.
              </p>
            </div>
          ) : (
            <>
              {/* La tabla, como la del documento */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-white/20">
                    <th className={`${etiqueta} font-normal pb-2`}>#</th>
                    <th className={`${etiqueta} font-normal pb-2`}>Concepto</th>
                    <th className={`${etiqueta} font-normal pb-2 text-right`}>Cant.</th>
                    <th className={`${etiqueta} font-normal pb-2`}>Unidad</th>
                    <th className={`${etiqueta} font-normal pb-2 text-right`}>P. unitario</th>
                    <th className={`${etiqueta} font-normal pb-2 text-right`}>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.partidas.map((p, i) => (
                    <tr key={p.id} className="border-b border-white/5 align-top">
                      <td className="py-2 font-mono text-xs text-white/40">{i + 1}</td>
                      <td className="py-2 font-body text-sm text-white">{p.titulo || "—"}</td>
                      <td className="py-2 font-mono text-xs text-white/70 text-right tabular-nums">
                        {pesos(p.cantidad)}
                      </td>
                      <td className="py-2 font-body text-xs text-white/50">{p.unidad ?? ""}</td>
                      <td className="py-2 font-mono text-xs text-white text-right tabular-nums">
                        {pesos(p.precioUnitario)}
                      </td>
                      <td className="py-2 font-mono text-xs text-white text-right tabular-nums">
                        {pesos(p.importe)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <dl className="space-y-1 font-mono text-sm max-w-xs ml-auto">
                <div className="flex justify-between gap-6">
                  <dt className="text-white/50">Subtotal</dt>
                  <dd className="text-white tabular-nums">{conMoneda(resultado.subtotal, resultado.moneda)}</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-white/50">IVA {armado.ivaPct} %</dt>
                  <dd className="text-white tabular-nums">{conMoneda(resultado.iva, resultado.moneda)}</dd>
                </div>
                <div className="flex justify-between gap-6 border-t border-white/20 pt-1">
                  <dt className="text-white font-bold">Total</dt>
                  <dd className="text-white font-bold tabular-nums">
                    {conMoneda(resultado.total, resultado.moneda)}
                  </dd>
                </div>
              </dl>

              <p className="font-body text-sm text-white/70 border-t border-white/10 pt-3">
                {importeEnLetra(resultado.total, resultado.moneda)}
              </p>

              {/* Condiciones */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className={etiqueta}>Forma de pago</p>
                  <p className="font-body text-sm text-white/80">{armado.condiciones.pago}</p>
                </div>
                <div>
                  <p className={etiqueta}>Tiempo de entrega</p>
                  <p className="font-body text-sm text-white/80">{armado.condiciones.entrega}</p>
                </div>
                {armado.condiciones.lugar && (
                  <div>
                    <p className={etiqueta}>Lugar de entrega</p>
                    <p className="font-body text-sm text-white/80">{armado.condiciones.lugar}</p>
                  </div>
                )}
                <div>
                  <p className={etiqueta}>Vigencia</p>
                  <p className="font-body text-sm text-white/80">
                    {armado.condiciones.vigenciaDias} días
                  </p>
                </div>
              </div>

              {normas.length > 0 && (
                <div>
                  <p className={etiqueta}>Documentos aplicables ({normas.length})</p>
                  <p className="font-body text-xs text-white/50 mt-1">
                    {normas.map((n) => n.id).join(" · ")}
                  </p>
                </div>
              )}

              {/* Lo que el motor tenga que decir, antes de congelar */}
              {resultado.avisos.length > 0 && (
                <ul className="space-y-1">
                  {resultado.avisos.map((a, i) => (
                    <li key={i} className="font-body text-xs text-amber bg-amber/15 rounded-lg px-3 py-2">
                      {a}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {error && <p className="font-mono text-xs text-danger">{error}</p>}
        </div>

        {/* Confirmar */}
        <div className="sticky bottom-0 bg-navy/95 backdrop-blur border-t border-white/10 px-5 py-4 flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-[220px] font-body text-xs text-white/50">
            {sinArmado
              ? "Al mandarla, el revisor la verá tal como está."
              : "Al mandarla, estos importes se congelan: el revisor ve estos números y ya no se mueven."}
          </p>
          <button className={btnGhost} onClick={onCerrar}>
            Seguir editando
          </button>
          <button className={btnPrimary} disabled={enviando} onClick={onMandar}>
            {enviando ? "Mandando…" : "Mandar a revisión"}
          </button>
        </div>
      </div>
    </div>
  );
}
