"use client";

import { useMemo, useState } from "react";
import type { ServicioCatalogo } from "@/src/lib/cotizador";
import { btnGhost, etiqueta, input, pesos } from "../ui";

/**
 * El buscador del catálogo: 87 servicios, filtrados en la pantalla.
 *
 * Busca por código, descripción y familia a la vez, sin acentos: quien cotiza
 * recuerda "termografia" o "AR" o "estudio", y cualquiera de los tres tiene que
 * llevar al mismo renglón.
 */
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function BuscadorCatalogo({
  catalogo,
  soloGastos,
  onElegir,
  onCerrar,
}: {
  catalogo: ServicioCatalogo[];
  /** Los gastos solo ofrecen códigos de gasto; las partidas, todo lo demás. */
  soloGastos?: boolean;
  onElegir: (servicio: ServicioCatalogo) => void;
  onCerrar: () => void;
}) {
  const [q, setQ] = useState("");

  const resultados = useMemo(() => {
    const activos = catalogo.filter((s) => s.activo && (soloGastos ? s.tipo === "GASTO" : s.tipo !== "GASTO"));
    const busqueda = sinAcentos(q.trim());
    if (!busqueda) return activos.slice(0, 40);
    const palabras = busqueda.split(/\s+/);
    return activos
      .filter((s) => {
        const texto = sinAcentos(`${s.codigo} ${s.descripcion} ${s.codigo.replace(/\d+$/, "")}`);
        return palabras.every((p) => texto.includes(p));
      })
      .slice(0, 40);
  }, [catalogo, q, soloGastos]);

  return (
    <div className="fixed inset-0 z-40 bg-navy/80 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-navy border border-white/20 rounded-xl w-full max-w-2xl mt-10">
        <div className="p-4 border-b border-white/10 flex items-center gap-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Código, descripción o familia…"
            className={input}
          />
          <button className={btnGhost} onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/5">
          {resultados.length === 0 && (
            <p className="p-4 font-body text-sm text-white/40">
              Nada con eso. Si el servicio no está en el catálogo, agrégalo como concepto escrito.
            </p>
          )}
          {resultados.map((s) => (
            <button
              key={s.codigo}
              onClick={() => onElegir(s)}
              className="w-full text-left p-3 hover:bg-white/5 transition-colors min-h-tap"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-blue-mid shrink-0">{s.codigo}</span>
                <span className="font-body text-sm text-white flex-1">{s.descripcion}</span>
                <span className="font-mono text-xs text-white/60 shrink-0">
                  {s.costo === null ? "—" : `$${pesos(s.costo)}`}
                </span>
              </div>
              <div className="flex gap-2 mt-1">
                <span className={etiqueta}>{s.tipo}</span>
                {s.tipo === "ESTUDIO" && (
                  <span className="font-mono text-[9px] text-amber uppercase tracking-widest">
                    pide parámetros
                  </span>
                )}
                {!s.costo && (
                  <span className="font-mono text-[9px] text-amber uppercase tracking-widest">sin costo</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
