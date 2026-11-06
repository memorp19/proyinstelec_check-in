"use client";

import { PAGOS_FRECUENTES, type Armado } from "@/src/lib/cotizador";
import { aNumero, btnGhost, etiqueta, input, inputNum, tarjeta } from "../ui";

/**
 * Las condiciones comerciales que salen en el documento.
 *
 * Las cinco formas de pago frecuentes están ahí para ahorrar teclear, no para
 * cerrar la lista: el campo se escribe libre y una condición rara se captura
 * igual.
 */
export function Condiciones({
  armado,
  soloLectura,
  onCambio,
}: {
  armado: Armado;
  soloLectura: boolean;
  onCambio: (a: Armado) => void;
}) {
  const c = armado.condiciones;
  const cambiar = (cambios: Partial<typeof c>) =>
    onCambio({ ...armado, condiciones: { ...c, ...cambios } });

  return (
    <section className={`${tarjeta} p-4 space-y-4`}>
      <h2 className="font-head text-xl text-white uppercase tracking-wide">Condiciones comerciales</h2>

      <label className="block">
        <span className={etiqueta}>Forma de pago</span>
        <input
          value={c.pago}
          disabled={soloLectura}
          onChange={(e) => cambiar({ pago: e.target.value })}
          className={`${input} mt-1`}
        />
      </label>

      {!soloLectura && (
        <div className="flex flex-wrap gap-2">
          {PAGOS_FRECUENTES.map((p) => (
            <button key={p} className={btnGhost} onClick={() => cambiar({ pago: p })}>
              {p.length > 42 ? `${p.slice(0, 42)}…` : p}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className={etiqueta}>Tiempo de entrega</span>
          <input
            value={c.entrega}
            disabled={soloLectura}
            onChange={(e) => cambiar({ entrega: e.target.value })}
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className={etiqueta}>Vigencia (días)</span>
          <input
            value={c.vigenciaDias}
            disabled={soloLectura}
            onChange={(e) => cambiar({ vigenciaDias: aNumero(e.target.value) ?? 30 })}
            className={`${inputNum} mt-1`}
            inputMode="numeric"
          />
        </label>
      </div>

      <label className="block">
        <span className={etiqueta}>Lugar de entrega</span>
        <input
          value={c.lugar}
          disabled={soloLectura}
          onChange={(e) => cambiar({ lugar: e.target.value })}
          placeholder="Si se deja vacío, el renglón no sale en el documento"
          className={`${input} mt-1`}
        />
      </label>
    </section>
  );
}
