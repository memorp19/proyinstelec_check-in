"use client";

import { useState } from "react";
import {
  NOMBRE_BLOQUE,
  type Armado,
  type Bloque,
  type ConceptoArmado,
  type Esfuerzo,
  type PartidaArmada,
  type ResultadoCotizacion,
  type ServicioCatalogo,
  type TipoBloque,
} from "@/src/lib/cotizador";
import { BuscadorCatalogo } from "./BuscadorCatalogo";
import { ModalEstudio } from "./ModalEstudio";
import { aNumero, btnGhost, btnPeligro, btnPrimary, conMoneda, etiqueta, input, inputNum, pesos, tarjeta } from "../ui";

const nuevoId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Date.now()}-${Math.random()}`;

const TIPOS: TipoBloque[] = ["texto", "vineta", "subvineta", "subtitulo", "parrafo", "espacio"];

/** El concepto que se está agregando, mientras pide los parámetros del estudio. */
type EstudioPendiente = { partidaId: string; servicio: ServicioCatalogo } | null;

export function Partidas({
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
  const [buscando, setBuscando] = useState<string | null>(null);
  const [estudio, setEstudio] = useState<EstudioPendiente>(null);
  const [editandoEsfuerzo, setEditandoEsfuerzo] = useState<{ partidaId: string; conceptoId: string } | null>(null);

  const cambiarPartidas = (partidas: PartidaArmada[]) => onCambio({ ...armado, partidas });

  const cambiarPartida = (id: string, cambios: Partial<PartidaArmada>) =>
    cambiarPartidas(armado.partidas.map((p) => (p.id === id ? { ...p, ...cambios } : p)));

  const cambiarConcepto = (partidaId: string, conceptoId: string, cambios: Partial<ConceptoArmado>) =>
    cambiarPartidas(
      armado.partidas.map((p) =>
        p.id === partidaId
          ? { ...p, conceptos: p.conceptos.map((c) => (c.id === conceptoId ? { ...c, ...cambios } : c)) }
          : p,
      ),
    );

  const agregarPartida = () =>
    cambiarPartidas([
      ...armado.partidas,
      {
        id: nuevoId(),
        orden: armado.partidas.length + 1,
        titulo: "",
        bloques: [],
        cantidad: 1,
        unidad: "servicio",
        ajuste: 0,
        precioUnitarioFinal: null,
        recibeGastosGenerales: true,
        gastoManual: null,
        formato: "NORMAL",
        notas: "",
        conceptos: [],
      },
    ]);

  const moverPartida = (indice: number, hacia: number) => {
    const destino = indice + hacia;
    if (destino < 0 || destino >= armado.partidas.length) return;
    const copia = [...armado.partidas];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    cambiarPartidas(copia.map((p, i) => ({ ...p, orden: i + 1 })));
  };

  const agregarConcepto = (partidaId: string, c: ConceptoArmado) =>
    cambiarPartidas(
      armado.partidas.map((p) => (p.id === partidaId ? { ...p, conceptos: [...p.conceptos, c] } : p)),
    );

  /** Del catálogo: el costo se COPIA, y se guarda también el del catálogo. */
  const desdeCatalogo = (partidaId: string, s: ServicioCatalogo, esfuerzo: Esfuerzo | null) =>
    agregarConcepto(partidaId, {
      id: nuevoId(),
      codigo: s.codigo,
      descripcion: s.descripcion,
      cantidad: 1,
      unidad: s.unidad,
      costo: s.costo,
      costoCatalogo: s.costo,
      utilidadPct: 0,
      monedaCosto: s.moneda === armado.moneda ? null : s.moneda,
      esfuerzo,
    });

  const elegirDelCatalogo = (partidaId: string, s: ServicioCatalogo) => {
    setBuscando(null);
    // Un estudio no se agrega sin confirmar sus parámetros.
    if (s.tipo === "ESTUDIO") setEstudio({ partidaId, servicio: s });
    else desdeCatalogo(partidaId, s, null);
  };

  return (
    <section className={`${tarjeta} p-4 space-y-4`}>
      <div className="flex items-center justify-between">
        <h2 className="font-head text-xl text-white uppercase tracking-wide">Partidas</h2>
        {!soloLectura && (
          <button className={btnPrimary} onClick={agregarPartida}>
            Agregar partida
          </button>
        )}
      </div>

      {armado.partidas.length === 0 && (
        <p className="font-body text-sm text-white/40">
          Todavía no hay partidas. Una partida es un renglón del documento: lo que el cliente ve con su
          precio.
        </p>
      )}

      {armado.partidas.map((p, i) => {
        const calculada = resultado.partidas.find((x) => x.id === p.id);
        return (
          <article key={p.id} className="border border-white/10 rounded-xl p-4 space-y-4 bg-white/[0.02]">
            {/* Encabezado de la partida */}
            <div className="flex flex-wrap items-start gap-3">
              <span className="font-mono text-xs text-white/40 mt-3">{i + 1}</span>
              <input
                value={p.titulo}
                disabled={soloLectura}
                onChange={(e) => cambiarPartida(p.id, { titulo: e.target.value })}
                placeholder="Título de la partida"
                className={`${input} flex-1 min-w-[200px]`}
              />
              {!soloLectura && (
                <div className="flex gap-1">
                  <button className={btnGhost} onClick={() => moverPartida(i, -1)} aria-label="Subir">
                    ↑
                  </button>
                  <button className={btnGhost} onClick={() => moverPartida(i, 1)} aria-label="Bajar">
                    ↓
                  </button>
                  <button
                    className={btnPeligro}
                    onClick={() => cambiarPartidas(armado.partidas.filter((x) => x.id !== p.id))}
                  >
                    Quitar
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="block">
                <span className={etiqueta}>Cantidad</span>
                <input
                  value={p.cantidad}
                  disabled={soloLectura}
                  onChange={(e) => cambiarPartida(p.id, { cantidad: aNumero(e.target.value) ?? 0 })}
                  className={`${inputNum} mt-1`}
                  inputMode="decimal"
                />
              </label>
              <label className="block">
                <span className={etiqueta}>Unidad</span>
                <input
                  value={p.unidad}
                  disabled={soloLectura}
                  onChange={(e) => cambiarPartida(p.id, { unidad: e.target.value })}
                  className={`${input} mt-1`}
                />
              </label>
              <label className="block">
                <span className={etiqueta}>Formato del título</span>
                <select
                  value={p.formato}
                  disabled={soloLectura}
                  onChange={(e) => cambiarPartida(p.id, { formato: e.target.value as PartidaArmada["formato"] })}
                  className={`${input} mt-1`}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="NEGRITAS">Negritas</option>
                  <option value="OCULTO">Oculto</option>
                </select>
              </label>
              <label className="flex items-center gap-2 mt-5">
                <input
                  type="checkbox"
                  checked={p.recibeGastosGenerales}
                  disabled={soloLectura}
                  onChange={(e) => cambiarPartida(p.id, { recibeGastosGenerales: e.target.checked })}
                  className="w-5 h-5 accent-blue"
                />
                <span className="font-body text-xs text-white/70">Recibe gastos generales</span>
              </label>
            </div>

            {armado.reparto === "MANUAL" && p.recibeGastosGenerales && (
              <label className="block max-w-xs">
                <span className={etiqueta}>Gastos asignados a mano</span>
                <input
                  value={p.gastoManual ?? ""}
                  disabled={soloLectura}
                  onChange={(e) => cambiarPartida(p.id, { gastoManual: aNumero(e.target.value) })}
                  className={`${inputNum} mt-1`}
                  inputMode="decimal"
                />
              </label>
            )}

            {/* El contenido del documento */}
            <BloquesDeLaPartida
              bloques={p.bloques}
              soloLectura={soloLectura}
              onCambio={(bloques) => cambiarPartida(p.id, { bloques })}
            />

            {/* Conceptos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className={etiqueta}>Conceptos</p>
                {!soloLectura && (
                  <div className="flex gap-2">
                    <button className={btnGhost} onClick={() => setBuscando(p.id)}>
                      Del catálogo
                    </button>
                    <button
                      className={btnGhost}
                      onClick={() =>
                        agregarConcepto(p.id, {
                          id: nuevoId(),
                          codigo: "",
                          descripcion: "",
                          cantidad: 1,
                          unidad: "",
                          costo: null,
                          costoCatalogo: null,
                          utilidadPct: 0,
                          monedaCosto: null,
                          esfuerzo: null,
                        })
                      }
                    >
                      Escribir uno
                    </button>
                  </div>
                )}
              </div>

              {p.conceptos.length === 0 && (
                <p className="font-body text-xs text-white/30">Sin conceptos: la partida costaría cero.</p>
              )}

              {p.conceptos.map((c, iConcepto) => {
                /**
                 * Se emparejan por POSICIÓN, no por código.
                 *
                 * `entradaDeArmado` conserva el orden, así que el concepto i de
                 * la pantalla es el i del resultado. Buscar por código fallaba
                 * con dos renglones del mismo servicio en una partida —que es
                 * normal: dos transformadores iguales— y los dos enseñaban el
                 * importe del primero.
                 */
                const calc = calculada?.conceptos[iConcepto];
                const esEstudio = c.esfuerzo !== null;

                return (
                  <div key={c.id} className="grid grid-cols-12 gap-2 items-start">
                    {/* Nombre, y para un estudio el botón que abre sus parámetros */}
                    <div className="col-span-12 sm:col-span-4">
                      {c.codigo ? (
                        <div className="px-3 py-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-mono text-xs text-blue-mid">{c.codigo}</p>
                            {esEstudio && !soloLectura && (
                              <button
                                className={btnGhost}
                                onClick={() => setEditandoEsfuerzo({ partidaId: p.id, conceptoId: c.id })}
                              >
                                Editar
                              </button>
                            )}
                          </div>
                          <p className="font-body text-xs text-white/70">{c.descripcion}</p>
                          {esEstudio && calc?.horas !== undefined && (
                            <p className="font-mono text-[10px] text-white/40 mt-0.5">
                              {pesos(calc.horas)} h × ${pesos(c.esfuerzo!.tarifaHora)}/h
                            </p>
                          )}
                        </div>
                      ) : (
                        <input
                          value={c.descripcion}
                          disabled={soloLectura}
                          onChange={(e) => cambiarConcepto(p.id, c.id, { descripcion: e.target.value })}
                          placeholder="Descripción del concepto"
                          className={input}
                        />
                      )}
                    </div>

                    <input
                      value={c.cantidad}
                      disabled={soloLectura}
                      onChange={(e) => cambiarConcepto(p.id, c.id, { cantidad: aNumero(e.target.value) ?? 0 })}
                      className={`${inputNum} col-span-3 sm:col-span-2`}
                      inputMode="decimal"
                      aria-label="Cantidad"
                    />

                    {/**
                     * El costo de un estudio NO se teclea: sale de sus horas por
                     * su tarifa. Dejarlo editable con el costo del catálogo
                     * enseñaba un número que el cálculo no usa —9,600 del
                     * catálogo contra los 40,000 de 80 h × $500— y el que
                     * mandaba era el de abajo. El del catálogo queda como
                     * referencia, en chico, que es lo que es.
                     */}
                    {esEstudio ? (
                      <div className="col-span-4 sm:col-span-2 px-3 py-2 text-right">
                        <p className="font-mono text-sm text-white">
                          {calc ? pesos(calc.costoUnitario) : "—"}
                        </p>
                        {c.costoCatalogo !== null && (
                          <p className="font-mono text-[9px] text-white/30">
                            catálogo {pesos(c.costoCatalogo)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <input
                        value={c.costo ?? ""}
                        disabled={soloLectura}
                        onChange={(e) => cambiarConcepto(p.id, c.id, { costo: aNumero(e.target.value) })}
                        placeholder="costo"
                        className={`${inputNum} col-span-4 sm:col-span-2`}
                        inputMode="decimal"
                        aria-label="Costo"
                      />
                    )}

                    <input
                      value={c.utilidadPct || ""}
                      disabled={soloLectura}
                      onChange={(e) => cambiarConcepto(p.id, c.id, { utilidadPct: aNumero(e.target.value) ?? 0 })}
                      placeholder="util %"
                      className={`${inputNum} col-span-3 sm:col-span-1`}
                      inputMode="decimal"
                      aria-label="Utilidad %"
                    />

                    <select
                      value={c.monedaCosto ?? ""}
                      disabled={soloLectura}
                      onChange={(e) =>
                        cambiarConcepto(p.id, c.id, {
                          monedaCosto: e.target.value === "" ? null : (e.target.value as "MXN" | "USD"),
                        })
                      }
                      className={`${input} col-span-2 sm:col-span-1`}
                      aria-label="Moneda del costo"
                    >
                      <option value="">{armado.moneda}</option>
                      <option value="MXN">MXN</option>
                      <option value="USD">USD</option>
                    </select>

                    {/* El importe y el quitar, cada uno con su espacio: antes el
                        botón del esfuerzo cabía aquí y encimaba la cifra. */}
                    <div className="col-span-10 sm:col-span-2 flex items-center gap-3 justify-end px-1">
                      <span className="font-mono text-xs text-white/70 tabular-nums">
                        {calc ? pesos(calc.importe) : "—"}
                      </span>
                      {!soloLectura && (
                        <button
                          className={btnPeligro}
                          aria-label="Quitar el concepto"
                          onClick={() =>
                            cambiarPartida(p.id, { conceptos: p.conceptos.filter((x) => x.id !== c.id) })
                          }
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Precio de la partida */}
            {calculada && (
              <PrecioDeLaPartida
                partida={p}
                costoTotal={calculada.costoTotal}
                calculado={calculada.total - calculada.ajuste}
                total={calculada.total}
                precioUnitario={calculada.precioUnitario}
                ajusteDerivado={calculada.ajusteDerivado}
                moneda={resultado.moneda}
                soloLectura={soloLectura}
                onCambio={(cambios) => cambiarPartida(p.id, cambios)}
              />
            )}
          </article>
        );
      })}

      {buscando && (
        <BuscadorCatalogo
          catalogo={catalogo}
          onCerrar={() => setBuscando(null)}
          onElegir={(s) => elegirDelCatalogo(buscando, s)}
        />
      )}

      {estudio && (
        <ModalEstudio
          servicio={estudio.servicio}
          baseNodosPorOmision={estudio.servicio.baseNodos ?? 10}
          onCancelar={() => setEstudio(null)}
          onAceptar={(esfuerzo) => {
            desdeCatalogo(estudio.partidaId, estudio.servicio, esfuerzo);
            setEstudio(null);
          }}
        />
      )}

      {editandoEsfuerzo &&
        (() => {
          const p = armado.partidas.find((x) => x.id === editandoEsfuerzo.partidaId);
          const c = p?.conceptos.find((x) => x.id === editandoEsfuerzo.conceptoId);
          if (!c) return null;
          return (
            <ModalEstudio
              servicio={{ codigo: c.codigo, descripcion: c.descripcion }}
              inicial={c.esfuerzo}
              baseNodosPorOmision={c.esfuerzo?.baseNodos ?? 10}
              onCancelar={() => setEditandoEsfuerzo(null)}
              onAceptar={(esfuerzo) => {
                cambiarConcepto(editandoEsfuerzo.partidaId, editandoEsfuerzo.conceptoId, { esfuerzo });
                setEditandoEsfuerzo(null);
              }}
            />
          );
        })()}
    </section>
  );
}

// ── El contenido del documento, por bloques ───────────────────────────────────

function BloquesDeLaPartida({
  bloques,
  soloLectura,
  onCambio,
}: {
  bloques: Bloque[];
  soloLectura: boolean;
  onCambio: (b: Bloque[]) => void;
}) {
  const cambiar = (i: number, cambios: Partial<Bloque>) =>
    onCambio(bloques.map((b, j) => (j === i ? { ...b, ...cambios } : b)));

  const mover = (i: number, hacia: number) => {
    const destino = i + hacia;
    if (destino < 0 || destino >= bloques.length) return;
    const copia = [...bloques];
    [copia[i], copia[destino]] = [copia[destino], copia[i]];
    onCambio(copia);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className={etiqueta}>Contenido en el documento</p>
        {!soloLectura && (
          <button className={btnGhost} onClick={() => onCambio([...bloques, { tipo: "texto", texto: "" }])}>
            Agregar renglón
          </button>
        )}
      </div>

      {bloques.map((b, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select
            value={b.tipo}
            disabled={soloLectura}
            onChange={(e) => cambiar(i, { tipo: e.target.value as TipoBloque })}
            className={`${input} w-32 shrink-0`}
            aria-label="Tipo de renglón"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_BLOQUE[t]}
              </option>
            ))}
          </select>
          <input
            value={b.texto}
            disabled={soloLectura || b.tipo === "espacio"}
            onChange={(e) => cambiar(i, { texto: e.target.value })}
            placeholder={b.tipo === "espacio" ? "(renglón en blanco)" : "Texto"}
            className={`${input} flex-1`}
          />
          {!soloLectura && (
            <div className="flex gap-1 shrink-0">
              <button className={btnGhost} onClick={() => mover(i, -1)} aria-label="Subir">
                ↑
              </button>
              <button className={btnGhost} onClick={() => mover(i, 1)} aria-label="Bajar">
                ↓
              </button>
              <button className={btnPeligro} onClick={() => onCambio(bloques.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── El precio, con su ajuste derivado ─────────────────────────────────────────

function PrecioDeLaPartida({
  partida,
  costoTotal,
  calculado,
  total,
  precioUnitario,
  ajusteDerivado,
  moneda,
  soloLectura,
  onCambio,
}: {
  partida: PartidaArmada;
  costoTotal: number;
  calculado: number;
  total: number;
  precioUnitario: number;
  ajusteDerivado: boolean;
  moneda: string;
  soloLectura: boolean;
  onCambio: (cambios: Partial<PartidaArmada>) => void;
}) {
  const perdida = partida.precioUnitarioFinal !== null && total < costoTotal;

  return (
    <div className="border-t border-white/10 pt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
      <div>
        <p className={etiqueta}>Costo</p>
        <p className="font-mono text-sm text-white/60">{pesos(costoTotal)}</p>
      </div>
      <div>
        <p className={etiqueta}>Precio calculado</p>
        <p className="font-mono text-sm text-white/60">{pesos(calculado)}</p>
      </div>
      <label className="block">
        <span className={etiqueta}>Precio unitario final</span>
        <input
          value={partida.precioUnitarioFinal ?? ""}
          disabled={soloLectura}
          onChange={(e) => onCambio({ precioUnitarioFinal: aNumero(e.target.value) })}
          placeholder="opcional"
          className={`${inputNum} mt-1`}
          inputMode="decimal"
        />
      </label>
      <div>
        <p className={etiqueta}>{ajusteDerivado ? "Ajuste derivado" : "Ajuste"}</p>
        {ajusteDerivado ? (
          <p className="font-mono text-sm text-amber">{pesos(total - calculado)}</p>
        ) : (
          <input
            value={partida.ajuste || ""}
            disabled={soloLectura}
            onChange={(e) => onCambio({ ajuste: aNumero(e.target.value) ?? 0 })}
            className={inputNum}
            inputMode="decimal"
          />
        )}
      </div>
      <div className="text-right">
        <p className={etiqueta}>Unitario</p>
        <p className="font-mono text-sm text-white">{conMoneda(precioUnitario, moneda)}</p>
      </div>

      {perdida && (
        <p className="col-span-2 sm:col-span-5 font-body text-xs text-danger bg-danger/15 rounded-lg px-3 py-2">
          Se vendería en {pesos(total)} y cuesta {pesos(costoTotal)}: es una venta con pérdida de{" "}
          {pesos(costoTotal - total)}.
        </p>
      )}
    </div>
  );
}
