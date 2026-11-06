"use client";

import { useState } from "react";
import type { Armado, GastoArmado, ResultadoCotizacion, ServicioCatalogo } from "@/src/lib/cotizador";
import { BuscadorCatalogo } from "./BuscadorCatalogo";
import { aNumero, btnGhost, btnPeligro, etiqueta, input, inputNum, pesos, tarjeta } from "../ui";

const nuevoId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Date.now()}-${Math.random()}`;

/**
 * Los gastos del proyecto: lista aparte de las partidas.
 *
 * Van separados a propósito. Mezclarlos haría que alguien metiera "Hospedaje"
 * como concepto de una partida, y entonces el hospedaje de todo el proyecto se
 * cobraría dentro de un solo renglón del documento.
 */
export function Gastos({
  armado,
  resultado,
  catalogo,
  soloLectura,
  onCambio,
}: {
  armado: Armado;
  resultado: ResultadoCotizacion;
  catalogo: ServicioCatalogo[];
  soloLectura: boolean;
  onCambio: (a: Armado) => void;
}) {
  const [buscando, setBuscando] = useState(false);

  const cambiarGastos = (gastos: GastoArmado[]) => onCambio({ ...armado, gastos });
  const cambiarGasto = (id: string, cambios: Partial<GastoArmado>) =>
    cambiarGastos(armado.gastos.map((g) => (g.id === id ? { ...g, ...cambios } : g)));

  const agregar = (base: Partial<GastoArmado>) =>
    cambiarGastos([
      ...armado.gastos,
      {
        id: nuevoId(),
        codigo: "",
        descripcion: "",
        cantidad: 1,
        costo: 0,
        costoCatalogo: null,
        utilidadPct: 0,
        monedaCosto: null,
        destinoPartidaId: "",
        ...base,
      },
    ]);

  // Lo que falta por asignar con reparto MANUAL, que es el aviso útil.
  const asignado = armado.partidas.reduce((s, p) => s + (p.gastoManual ?? 0), 0);
  const faltaPorAsignar = resultado.totalGastos - asignado;

  return (
    <section className={`${tarjeta} p-4 space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-head text-xl text-white uppercase tracking-wide">Gastos del proyecto</h2>
        {!soloLectura && (
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => setBuscando(true)}>
              Del catálogo
            </button>
            <button className={btnGhost} onClick={() => agregar({})}>
              Escribir uno
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className={etiqueta}>Cómo se reparten</span>
          <select
            value={armado.reparto}
            disabled={soloLectura}
            onChange={(e) => onCambio({ ...armado, reparto: e.target.value as Armado["reparto"] })}
            className={`${input} mt-1`}
          >
            <option value="IGUAL">Por partes iguales</option>
            <option value="PROPORCIONAL">En proporción al costo</option>
            <option value="MANUAL">A mano, partida por partida</option>
          </select>
        </label>
        <label className="block">
          <span className={etiqueta}>Moneda de los gastos</span>
          <select
            value={armado.monedaGastos}
            disabled={soloLectura}
            onChange={(e) => onCambio({ ...armado, monedaGastos: e.target.value as "MXN" | "USD" })}
            className={`${input} mt-1`}
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <div>
          <p className={etiqueta}>Total de gastos</p>
          <p className="font-mono text-sm text-white mt-2">
            {pesos(resultado.totalGastos)} {armado.monedaGastos}
          </p>
        </div>
      </div>

      {armado.reparto === "MANUAL" && Math.abs(faltaPorAsignar) > 0.009 && (
        <p className="font-body text-xs text-amber bg-amber/15 rounded-lg px-3 py-2">
          Con reparto a mano falta repartir {pesos(faltaPorAsignar)} {armado.monedaGastos}. Lo que no se
          asigne no se le cobra a nadie.
        </p>
      )}

      {armado.gastos.length === 0 && (
        <p className="font-body text-sm text-white/40">
          Sin gastos. Aquí van viáticos, ayudantes, transporte: lo que cuesta el proyecto y no es un
          servicio del documento.
        </p>
      )}

      {armado.gastos.map((g) => (
        <div key={g.id} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-12 sm:col-span-4">
            {g.codigo ? (
              <div className="px-3 py-2">
                <p className="font-mono text-xs text-blue-mid">{g.codigo}</p>
                <p className="font-body text-xs text-white/70">{g.descripcion}</p>
              </div>
            ) : (
              <input
                value={g.descripcion}
                disabled={soloLectura}
                onChange={(e) => cambiarGasto(g.id, { descripcion: e.target.value })}
                placeholder="Descripción del gasto"
                className={input}
              />
            )}
          </div>
          <input
            value={g.cantidad}
            disabled={soloLectura}
            onChange={(e) => cambiarGasto(g.id, { cantidad: aNumero(e.target.value) ?? 0 })}
            className={`${inputNum} col-span-3 sm:col-span-2`}
            inputMode="decimal"
            aria-label="Cantidad"
          />
          <input
            value={g.costo}
            disabled={soloLectura}
            onChange={(e) => cambiarGasto(g.id, { costo: aNumero(e.target.value) ?? 0 })}
            className={`${inputNum} col-span-4 sm:col-span-2`}
            inputMode="decimal"
            aria-label="Costo"
          />
          <select
            value={g.destinoPartidaId}
            disabled={soloLectura}
            onChange={(e) => cambiarGasto(g.id, { destinoPartidaId: e.target.value })}
            className={`${input} col-span-5 sm:col-span-3`}
            aria-label="A quién se le carga"
          >
            <option value="">Se reparte</option>
            {armado.partidas.map((p, i) => (
              <option key={p.id} value={p.id}>
                Entero a: {p.titulo || `partida ${i + 1}`}
              </option>
            ))}
          </select>
          <div className="col-span-12 sm:col-span-1 flex justify-end">
            {!soloLectura && (
              <button className={btnPeligro} onClick={() => cambiarGastos(armado.gastos.filter((x) => x.id !== g.id))}>
                ×
              </button>
            )}
          </div>
        </div>
      ))}

      {buscando && (
        <BuscadorCatalogo
          catalogo={catalogo}
          soloGastos
          onCerrar={() => setBuscando(false)}
          onElegir={(s) => {
            setBuscando(false);
            agregar({
              codigo: s.codigo,
              descripcion: s.descripcion,
              costo: s.costo ?? 0,
              costoCatalogo: s.costo,
              monedaCosto: s.moneda === armado.monedaGastos ? null : s.moneda,
            });
          }}
        />
      )}
    </section>
  );
}
