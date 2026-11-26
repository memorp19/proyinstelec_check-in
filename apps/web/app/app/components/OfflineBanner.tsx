"use client";

import { faltanPorSubir } from "@/src/lib/sync-queue";
import { useCola } from "./ColaDeCampo";

/**
 * El estado de la cola, a la vista: si hay señal, cuántos registros y fotos
 * faltan por subir, y lo que no se pudo mandar.
 *
 * Antes decía «Sincronizando…» sin que nada se sincronizara: la cola nunca se
 * mandaba. Ahora la manda `ProcesadorCola`, y esto cuenta lo que falta.
 */
export function OfflineBanner() {
  const { registros, fotos, enLinea, errores, quitarError } = useCola();
  const faltan = faltanPorSubir({ registros, fotos });

  if (enLinea && !faltan && errores.length === 0) return null;

  return (
    <div className="space-y-2">
      {(!enLinea || faltan) && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl px-3 py-2.5 font-mono text-xs ${
            enLinea
              ? "border border-blue/20 bg-blue-light text-blue-dark"
              : "border border-amber/40 bg-amber/10 text-amber"
          }`}
        >
          {enLinea ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 6s4-2 11-2 11 2 11 2" /><path d="M5 10.5S7.5 9 12 9s7 1.5 7 1.5" />
              <path d="M10.7 13.4C11.1 13.1 11.5 13 12 13s.9.1 1.3.4" /><line x1="12" y1="17" x2="12.01" y2="17" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          )}
          <span>
            {enLinea
              ? `Subiendo… ${faltan}.`
              : faltan
                ? `Sin conexión · ${faltan}: se suben solos al volver la señal.`
                : "Sin conexión · lo que registres se guarda en el teléfono y se sube solo al volver la señal."}
          </span>
        </div>
      )}

      {/* Lo que no se pudo mandar: ámbar y no rojo, porque lo demás sí quedó. */}
      {errores.map((mensaje, i) => (
        <div
          key={i}
          role="alert"
          className="flex items-start gap-2 bg-amber/10 border border-amber/40 rounded-xl px-3 py-2.5 text-left"
        >
          <p className="flex-1 font-mono text-xs text-amber">{mensaje}</p>
          <button type="button" onClick={() => quitarError(i)} className="shrink-0 font-mono text-[10px] text-amber underline">
            Entendido
          </button>
        </div>
      ))}
    </div>
  );
}
