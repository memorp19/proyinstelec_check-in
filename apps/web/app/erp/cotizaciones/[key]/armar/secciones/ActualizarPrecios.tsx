"use client";

import { useState } from "react";
import type { Desfase } from "@/src/lib/cotizador";
import { btnGhost, btnPrimary, etiqueta, pesos, tarjeta } from "../ui";

/**
 * El aviso de que el catálogo cambió, y cómo se aplica.
 *
 * Enseña el antes y el después de cada renglón y **solo cambia lo que se
 * palomee**. Un botón de "actualizar todo" sería más corto y le borraría al
 * cliente el descuento que alguien negoció, sin que nadie se enterara: por eso
 * los negociados llegan sin palomear y con su propia advertencia.
 */
export function ActualizarPrecios({
  abierto,
  onAbrir,
  onCerrar,
  desfases,
  cotKey,
  version,
  soloLectura,
  onAplicado,
}: {
  abierto: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  desfases: Desfase[];
  cotKey: string;
  version: number;
  soloLectura: boolean;
  onAplicado: () => void;
}) {
  // Los que el catálogo movió llegan palomeados; los negociados, no.
  const [elegidos, setElegidos] = useState<Set<string>>(
    () => new Set(desfases.filter((d) => d.motivo === "CATALOGO_CAMBIO" && !d.tieneCostoNegociado).map((d) => d.id)),
  );
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = (id: string) =>
    setElegidos((previos) => {
      const copia = new Set(previos);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });

  const aplicar = async () => {
    setAplicando(true);
    setError(null);
    try {
      const r = await fetch(`/api/erp/cotizaciones/${cotKey}/armado/precios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, ids: [...elegidos] }),
      });
      const cuerpo = await r.json();
      if (!r.ok) throw new Error(cuerpo.error ?? "No se pudo actualizar");
      onCerrar();
      onAplicado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAplicando(false);
    }
  };

  if (!abierto) {
    return (
      <div className={`${tarjeta} p-4 bg-amber/10 border-amber/30 flex flex-wrap items-center gap-3`}>
        <div className="flex-1 min-w-[240px]">
          <p className={etiqueta}>El catálogo cambió</p>
          <p className="font-body text-sm text-amber mt-1">
            {desfases.length} {desfases.length === 1 ? "renglón usa un costo" : "renglones usan costos"} que ya
            no son los del catálogo. La cotización no se movió sola: tú decides.
          </p>
        </div>
        <button className={btnGhost} onClick={onAbrir}>
          Ver cuáles
        </button>
      </div>
    );
  }

  return (
    <div className={`${tarjeta} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <p className={etiqueta}>Costos contra el catálogo vigente</p>
        <button className={btnGhost} onClick={onCerrar}>
          Cerrar
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className={`${etiqueta} font-normal pb-1`}>Código</th>
            <th className={`${etiqueta} font-normal pb-1 text-right`}>Ahora</th>
            <th className={`${etiqueta} font-normal pb-1 text-right`}>Catálogo</th>
            <th className={`${etiqueta} font-normal pb-1`}>Qué pasó</th>
          </tr>
        </thead>
        <tbody>
          {desfases.map((d) => {
            const sePuede = d.motivo === "CATALOGO_CAMBIO" && d.catalogo !== null;
            return (
              <tr key={d.id} className="border-t border-white/5">
                <td className="py-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={elegidos.has(d.id)}
                      disabled={soloLectura || !sePuede}
                      onChange={() => alternar(d.id)}
                      className="w-5 h-5 accent-blue"
                    />
                    <span className="font-mono text-xs text-blue-mid">{d.codigo}</span>
                  </label>
                </td>
                <td className="py-2 text-right font-mono text-xs text-white">
                  {d.actual === null ? "—" : pesos(d.actual)}
                </td>
                <td className="py-2 text-right font-mono text-xs text-white/60">
                  {d.catalogo === null ? "—" : pesos(d.catalogo)}
                </td>
                <td className="py-2 font-body text-xs text-white/50">
                  {d.motivo === "CODIGO_INACTIVO"
                    ? "Ya no está en el catálogo: no hay precio al que llevarlo."
                    : d.tieneCostoNegociado
                      ? "Tiene un precio negociado. Actualizarlo lo pierde."
                      : "El catálogo se movió."}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {error && <p className="font-mono text-xs text-danger">{error}</p>}

      {!soloLectura && (
        <div className="flex justify-end">
          <button className={btnPrimary} disabled={aplicando || elegidos.size === 0} onClick={() => void aplicar()}>
            {aplicando ? "Actualizando…" : `Actualizar ${elegidos.size}`}
          </button>
        </div>
      )}
    </div>
  );
}
