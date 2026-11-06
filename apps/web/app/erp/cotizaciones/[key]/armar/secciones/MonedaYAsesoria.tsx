"use client";

import { useState } from "react";
import type { Armado, ResultadoCotizacion } from "@/src/lib/cotizador";
import { aNumero, btnGhost, campoNum, etiqueta, input, inputNum, tarjeta } from "../ui";

/**
 * Moneda, tipo de cambio y asesoría.
 *
 * El tipo de cambio se pide a Banxico cuando hace falta —cuando conviven dos
 * monedas—, y si no se puede, se captura. Un servicio externo caído no detiene
 * una cotización.
 */
export function MonedaYAsesoria({
  armado,
  resultado,
  soloLectura,
  onCambio,
}: {
  armado: Armado;
  resultado: ResultadoCotizacion;
  soloLectura: boolean;
  onCambio: (a: Armado) => void;
}) {
  const [consultando, setConsultando] = useState(false);
  const [mensajeFix, setMensajeFix] = useState<string | null>(null);

  const conviven =
    armado.monedaGastos !== armado.moneda ||
    armado.partidas.some((p) => p.conceptos.some((c) => c.monedaCosto && c.monedaCosto !== armado.moneda)) ||
    armado.gastos.some((g) => g.monedaCosto && g.monedaCosto !== armado.monedaGastos);

  const pedirFix = async () => {
    setConsultando(true);
    setMensajeFix(null);
    try {
      const r = await fetch("/api/erp/tipo-cambio");
      const cuerpo = await r.json();
      if (cuerpo.ok) {
        onCambio({
          ...armado,
          tipoCambio: { valor: cuerpo.valor, origen: "BANXICO", motivo: `FIX del ${cuerpo.fecha}` },
        });
        setMensajeFix(`FIX del ${cuerpo.fecha}: ${cuerpo.valor}`);
      } else {
        setMensajeFix(cuerpo.motivo ?? "No se pudo consultar");
      }
    } catch {
      setMensajeFix("No se pudo consultar. Captúralo a mano.");
    } finally {
      setConsultando(false);
    }
  };

  const tc = armado.tipoCambio;
  const preferenteSinMotivo = tc?.origen === "PREFERENTE" && !tc.motivo?.trim();

  return (
    <section className={`${tarjeta} p-4 space-y-4`}>
      <h2 className="font-head text-xl text-white uppercase tracking-wide">Moneda y asesoría</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block">
          <span className={etiqueta}>Moneda de la cotización</span>
          <select
            value={armado.moneda}
            disabled={soloLectura}
            onChange={(e) => onCambio({ ...armado, moneda: e.target.value as "MXN" | "USD" })}
            className={`${input} mt-1`}
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </select>
        </label>

        <label className="block">
          <span className={etiqueta}>Asesoría %</span>
          <input
            value={armado.asesoriaPct}
            disabled={soloLectura}
            onChange={(e) => onCambio({ ...armado, asesoriaPct: aNumero(e.target.value) ?? 0 })}
            className={`${inputNum} mt-1`}
            inputMode="decimal"
          />
        </label>

        <label className="block">
          <span className={etiqueta}>IVA %</span>
          <input
            value={armado.ivaPct}
            disabled={soloLectura}
            onChange={(e) => onCambio({ ...armado, ivaPct: aNumero(e.target.value) ?? 0 })}
            className={`${inputNum} mt-1`}
            inputMode="decimal"
          />
        </label>

        <div>
          <p className={etiqueta}>Asesoría repartida</p>
          <p className="font-mono text-sm text-white mt-2">
            {resultado.asesoria.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Tipo de cambio */}
      <div className="border-t border-white/10 pt-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className={etiqueta}>Tipo de cambio</span>
            <input
              value={tc?.valor ?? ""}
              disabled={soloLectura}
              onChange={(e) => {
                const valor = aNumero(e.target.value);
                onCambio({
                  ...armado,
                  tipoCambio: valor === null ? null : { valor, origen: tc?.origen ?? "PREFERENTE", motivo: tc?.motivo },
                });
              }}
              placeholder="18.4567"
              className={`${campoNum} mt-1 w-40`}
              inputMode="decimal"
            />
          </label>

          <label className="block">
            <span className={etiqueta}>De dónde sale</span>
            <select
              value={tc?.origen ?? "BANXICO"}
              disabled={soloLectura || !tc}
              onChange={(e) =>
                tc && onCambio({ ...armado, tipoCambio: { ...tc, origen: e.target.value as "BANXICO" | "PREFERENTE" } })
              }
              className={`${input} mt-1`}
            >
              <option value="BANXICO">FIX de Banxico</option>
              <option value="PREFERENTE">Preferente</option>
            </select>
          </label>

          {!soloLectura && (
            <button className={btnGhost} onClick={() => void pedirFix()} disabled={consultando}>
              {consultando ? "Consultando…" : "Traer el FIX de hoy"}
            </button>
          )}
        </div>

        {tc?.origen === "PREFERENTE" && (
          <label className="block">
            <span className={etiqueta}>Motivo del tipo preferente</span>
            <input
              value={tc.motivo ?? ""}
              disabled={soloLectura}
              onChange={(e) => onCambio({ ...armado, tipoCambio: { ...tc, motivo: e.target.value } })}
              placeholder="Tipo pactado con el cliente, banco del cliente…"
              className={`${input} mt-1`}
            />
          </label>
        )}

        {preferenteSinMotivo && (
          <p className="font-body text-xs text-amber bg-amber/15 rounded-lg px-3 py-2">
            Un tipo de cambio preferente sin motivo no se puede revisar después. Escribe de dónde sale.
          </p>
        )}

        {conviven && !tc && (
          <p className="font-body text-xs text-amber bg-amber/15 rounded-lg px-3 py-2">
            Hay importes en otra moneda y no hay tipo de cambio: esos conceptos no se pueden convertir.
          </p>
        )}

        {mensajeFix && <p className="font-body text-xs text-white/50">{mensajeFix}</p>}
      </div>
    </section>
  );
}
