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
import {
  aNumero,
  btnGhost,
  btnPeligro,
  btnPrimary,
  campo,
  campoNum,
  conMoneda,
  etiqueta,
  input,
  pesos,
  tarjeta,
} from "../ui";

const nuevoId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Date.now()}-${Math.random()}`;

/** El orden del cotizador viejo, que es el de los botones de agregar. */
const TIPOS: TipoBloque[] = ["subtitulo", "texto", "parrafo", "vineta", "subvineta", "espacio"];

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
            {/**
              * El encabezado de la partida, en un renglón: número, título,
              * cantidad, unidad, formato y quitar. Como el cotizador viejo —
              * en dos renglones de campos sueltos ocupaba media pantalla por
              * partida y había que bajar para ver la siguiente.
              */}
            <div className="flex flex-wrap ancho:flex-nowrap items-center gap-2">
              <span className="font-mono text-xs text-white/40 w-5 shrink-0 text-right">{i + 1}</span>
              <input
                value={p.titulo}
                disabled={soloLectura}
                onChange={(e) => cambiarPartida(p.id, { titulo: e.target.value })}
                placeholder="Título de la partida"
                className={`${campo} w-full ancho:w-auto ancho:flex-1 ancho:min-w-[180px]`}
              />
              <input
                value={p.cantidad}
                disabled={soloLectura}
                onChange={(e) => cambiarPartida(p.id, { cantidad: aNumero(e.target.value) ?? 0 })}
                className={`${campoNum} w-20 shrink-0`}
                inputMode="decimal"
                aria-label="Cantidad de la partida"
                title="Cantidad"
              />
              <input
                value={p.unidad}
                disabled={soloLectura}
                onChange={(e) => cambiarPartida(p.id, { unidad: e.target.value })}
                className={`${campo} w-28 shrink-0`}
                aria-label="Unidad de la partida"
                title="Unidad"
              />
              <select
                value={p.formato}
                disabled={soloLectura}
                onChange={(e) => cambiarPartida(p.id, { formato: e.target.value as PartidaArmada["formato"] })}
                className={`${campo} w-28 shrink-0 px-2`}
                aria-label="Formato del título"
                title="Cómo sale el título en el documento"
              >
                <option value="NORMAL">Normal</option>
                <option value="NEGRITAS">Negritas</option>
                <option value="OCULTO">Oculto</option>
              </select>
              {!soloLectura && (
                <div className="flex gap-1 shrink-0">
                  <button className={btnGhost} onClick={() => moverPartida(i, -1)} aria-label="Subir la partida">
                    ↑
                  </button>
                  <button className={btnGhost} onClick={() => moverPartida(i, 1)} aria-label="Bajar la partida">
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

            {/* El contenido del documento */}
            <BloquesDeLaPartida
              bloques={p.bloques}
              soloLectura={soloLectura}
              onCambio={(bloques) => cambiarPartida(p.id, { bloques })}
            />

            {/**
              * Los conceptos, en el orden de Apps Script: costo, utilidad,
              * cantidad, unidad, moneda, importe. Es el orden en el que el
              * equipo los teclea desde hace años; cambiarlo por uno más
              * "lógico" solo obligaría a reaprender dónde está cada cosa.
              */}
            <div className="space-y-1">
              <p className={etiqueta}>Conceptos</p>

              {p.conceptos.length === 0 && (
                <p className="font-body text-xs text-white/30">Sin conceptos: la partida costaría cero.</p>
              )}

              {/* Los rótulos solo donde el renglón cabe de corrido: más
                  estrecho se parte y el encabezado dejaría de alinear. */}
              {p.conceptos.length > 0 && (
                <div className="hidden ancho:flex items-center gap-2 pb-1">
                  <span className="flex-1 min-w-[120px]" />
                  <span className={`${etiqueta} w-28 shrink-0 px-3 text-right`}>Costo</span>
                  <span className={`${etiqueta} w-16 shrink-0 px-2 text-right`}>Util %</span>
                  <span className={`${etiqueta} w-20 shrink-0 px-3 text-right`}>Cant.</span>
                  <span className={`${etiqueta} w-24 shrink-0 px-3`}>Unidad</span>
                  <span className={`${etiqueta} w-20 shrink-0 px-2`}>Moneda</span>
                  <span className={`${etiqueta} w-28 shrink-0 px-1 text-right`}>Importe</span>
                  {!soloLectura && <span className="w-8 shrink-0" />}
                </div>
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
                  <div key={c.id} className="flex flex-wrap ancho:flex-nowrap items-center gap-2">
                    {/* Código y descripción, con el botón del estudio al lado */}
                    <div className="w-full ancho:w-auto ancho:flex-1 ancho:min-w-[120px] min-w-0">
                      {c.codigo ? (
                        <div className="px-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-mono text-xs text-blue-mid">{c.codigo}</span>
                            <span className="font-body text-xs text-white/70 truncate">{c.descripcion}</span>
                            {esEstudio && !soloLectura && (
                              <button
                                className={btnGhost}
                                onClick={() => setEditandoEsfuerzo({ partidaId: p.id, conceptoId: c.id })}
                              >
                                Editar
                              </button>
                            )}
                          </div>
                          {esEstudio && calc?.horas !== undefined && (
                            <p className="font-mono text-[10px] text-white/40">
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
                          className={`${campo} w-full`}
                        />
                      )}
                    </div>

                    {/**
                     * El costo de un estudio NO se teclea: sale de sus horas por
                     * su tarifa. Dejarlo editable con el costo del catálogo
                     * enseñaba un número que el cálculo no usa —9,600 del
                     * catálogo contra los 40,000 de 80 h × $500— y el que
                     * mandaba era el de abajo. El del catálogo queda como
                     * referencia, en chico, que es lo que es.
                     */}
                    {esEstudio ? (
                      <div className="w-28 shrink-0 px-3 text-right">
                        <p className="font-mono text-sm text-white tabular-nums">
                          {calc ? pesos(calc.costoUnitario) : "—"}
                        </p>
                        {c.costoCatalogo !== null && (
                          <p className="font-mono text-[9px] text-white/30 tabular-nums">
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
                        className={`${campoNum} w-28 shrink-0`}
                        inputMode="decimal"
                        aria-label="Costo"
                      />
                    )}

                    <input
                      value={c.utilidadPct || ""}
                      disabled={soloLectura}
                      onChange={(e) => cambiarConcepto(p.id, c.id, { utilidadPct: aNumero(e.target.value) ?? 0 })}
                      placeholder="%"
                      className={`${campoNum} w-16 shrink-0 px-2`}
                      inputMode="decimal"
                      aria-label="Utilidad %"
                    />

                    <input
                      value={c.cantidad}
                      disabled={soloLectura}
                      onChange={(e) => cambiarConcepto(p.id, c.id, { cantidad: aNumero(e.target.value) ?? 0 })}
                      className={`${campoNum} w-20 shrink-0`}
                      inputMode="decimal"
                      aria-label="Cantidad"
                    />

                    <input
                      value={c.unidad}
                      disabled={soloLectura}
                      onChange={(e) => cambiarConcepto(p.id, c.id, { unidad: e.target.value })}
                      placeholder="unidad"
                      className={`${campo} w-24 shrink-0`}
                      aria-label="Unidad"
                    />

                    {/* Ancho propio para que "MXN" quepa con su flecha. */}
                    <select
                      value={c.monedaCosto ?? ""}
                      disabled={soloLectura}
                      onChange={(e) =>
                        cambiarConcepto(p.id, c.id, {
                          monedaCosto: e.target.value === "" ? null : (e.target.value as "MXN" | "USD"),
                        })
                      }
                      className={`${campo} w-20 shrink-0 px-2`}
                      aria-label="Moneda del costo"
                    >
                      <option value="">{armado.moneda}</option>
                      <option value="MXN">MXN</option>
                      <option value="USD">USD</option>
                    </select>

                    <p className="w-28 shrink-0 px-1 font-mono text-xs text-white/80 text-right tabular-nums">
                      {calc ? pesos(calc.importe) : "—"}
                    </p>

                    {!soloLectura && (
                      <button
                        className={`${btnPeligro} w-8 shrink-0 px-0`}
                        aria-label="Quitar el concepto"
                        onClick={() =>
                          cambiarPartida(p.id, { conceptos: p.conceptos.filter((x) => x.id !== c.id) })
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* El pie: de un lado lo que agrega, del otro lo que cuesta */}
            {calculada && (
              <PieDeLaPartida
                partida={p}
                calculada={calculada}
                reparto={armado.reparto}
                moneda={resultado.moneda}
                soloLectura={soloLectura}
                onCambio={(cambios) => cambiarPartida(p.id, cambios)}
                onDelCatalogo={() => setBuscando(p.id)}
                onEscribirUno={() =>
                  agregarConcepto(p.id, {
                    id: nuevoId(),
                    codigo: "",
                    descripcion: "",
                    cantidad: 1,
                    unidad: "servicio",
                    costo: null,
                    costoCatalogo: null,
                    utilidadPct: 0,
                    monedaCosto: null,
                    esfuerzo: null,
                  })
                }
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
      <p className={etiqueta}>Contenido en el documento</p>

      {bloques.map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          {/* El tipo, angosto: "Sub-viñeta" es la palabra más larga */}
          <select
            value={b.tipo}
            disabled={soloLectura}
            onChange={(e) => cambiar(i, { tipo: e.target.value as TipoBloque })}
            className={`${campo} w-28 shrink-0 px-2`}
            aria-label="Tipo de renglón"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_BLOQUE[t]}
              </option>
            ))}
          </select>

          {/* El texto se queda con lo que sobra; `min-w-0` es lo que impide
              que un renglón largo empuje los botones fuera del marco. */}
          <input
            value={b.texto}
            disabled={soloLectura || b.tipo === "espacio"}
            onChange={(e) => cambiar(i, { texto: e.target.value })}
            placeholder={b.tipo === "espacio" ? "(renglón en blanco)" : "Texto"}
            className={`${campo} flex-1 min-w-0`}
          />

          {!soloLectura && (
            <div className="flex gap-1 shrink-0">
              <button className={btnGhost} onClick={() => mover(i, -1)} aria-label="Subir el renglón">
                ↑
              </button>
              <button className={btnGhost} onClick={() => mover(i, 1)} aria-label="Bajar el renglón">
                ↓
              </button>
              <button
                className={`${btnPeligro} w-8 px-0`}
                aria-label="Quitar el renglón"
                onClick={() => onCambio(bloques.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          )}
        </div>
      ))}

      {/**
       * Un botón por tipo, como en el cotizador viejo.
       *
       * Antes era un solo "Agregar renglón" que metía un texto normal y había
       * que cambiarle el tipo después. Con seis botones, agregar una viñeta es
       * un clic en vez de dos.
       */}
      {!soloLectura && (
        <div className="flex flex-wrap gap-2 pt-1">
          {TIPOS.map((t) => (
            <button
              key={t}
              className={btnGhost}
              onClick={() => onCambio([...bloques, { tipo: t, texto: "" }])}
            >
              + {NOMBRE_BLOQUE[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── El pie de la partida ──────────────────────────────────────────────────────

/**
 * Lo que agrega a la izquierda y lo que cuesta a la derecha, en un renglón.
 *
 * Antes eran dos bloques separados —los botones arriba de los conceptos y una
 * rejilla de cinco celdas abajo—, y entre los dos ocupaban más alto que los
 * conceptos de la partida. Aquí es la línea que cierra: al lado de "agregar"
 * está lo que pasa al agregar.
 */
function PieDeLaPartida({
  partida,
  calculada,
  reparto,
  moneda,
  soloLectura,
  onCambio,
  onDelCatalogo,
  onEscribirUno,
}: {
  partida: PartidaArmada;
  calculada: ResultadoCotizacion["partidas"][number];
  reparto: Armado["reparto"];
  moneda: string;
  soloLectura: boolean;
  onCambio: (cambios: Partial<PartidaArmada>) => void;
  onDelCatalogo: () => void;
  onEscribirUno: () => void;
}) {
  const calculado = calculada.total - calculada.ajuste;
  const perdida = partida.precioUnitarioFinal !== null && calculada.total < calculada.costoTotal;

  return (
    <div className="border-t border-white/10 pt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {!soloLectura && (
          <div className="flex gap-2 shrink-0">
            <button className={btnGhost} onClick={onDelCatalogo}>
              + Del catálogo
            </button>
            <button className={btnGhost} onClick={onEscribirUno}>
              Escribir uno
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Si la partida recibe los gastos generales, y cuánto le tocó */}
        <label className="flex items-center gap-2 shrink-0" title="Recibe gastos generales">
          <input
            type="checkbox"
            checked={partida.recibeGastosGenerales}
            disabled={soloLectura}
            onChange={(e) => onCambio({ recibeGastosGenerales: e.target.checked })}
            className="w-4 h-4 accent-blue"
          />
          <span className={etiqueta}>Gasto</span>
          <span className="font-mono text-xs text-white/60 tabular-nums">
            {pesos(calculada.gastoAsignado)}
          </span>
        </label>

        {/* Con reparto a mano, cuánto se le asigna */}
        {reparto === "MANUAL" && partida.recibeGastosGenerales && (
          <label className="flex items-center gap-2 shrink-0">
            <span className={etiqueta}>A mano</span>
            <input
              value={partida.gastoManual ?? ""}
              disabled={soloLectura}
              onChange={(e) => onCambio({ gastoManual: aNumero(e.target.value) })}
              className={`${campoNum} w-24`}
              inputMode="decimal"
            />
          </label>
        )}

        {/**
         * El ajuste y el precio final son el mismo renglón porque son la misma
         * decisión vista de dos maneras: cuando hay precio final, el ajuste se
         * deriva de él y deja de teclearse.
         */}
        <label className="flex items-center gap-2 shrink-0">
          <span className={etiqueta}>{calculada.ajusteDerivado ? "Ajuste derivado" : "Ajuste"}</span>
          {calculada.ajusteDerivado ? (
            <span className="font-mono text-xs text-amber w-24 text-right tabular-nums">
              {pesos(calculada.ajuste)}
            </span>
          ) : (
            <input
              value={partida.ajuste || ""}
              disabled={soloLectura}
              onChange={(e) => onCambio({ ajuste: aNumero(e.target.value) ?? 0 })}
              className={`${campoNum} w-24`}
              inputMode="decimal"
            />
          )}
        </label>

        <label className="flex items-center gap-2 shrink-0">
          <span className={etiqueta}>P. final</span>
          <input
            value={partida.precioUnitarioFinal ?? ""}
            disabled={soloLectura}
            onChange={(e) => onCambio({ precioUnitarioFinal: aNumero(e.target.value) })}
            placeholder="opcional"
            className={`${campoNum} w-28`}
            inputMode="decimal"
          />
        </label>

        <div className="shrink-0 text-right">
          <p className={etiqueta}>Unitario</p>
          <p className="font-mono text-xs text-white tabular-nums">{pesos(calculada.precioUnitario)}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className={etiqueta}>Total</p>
          <p className="font-mono text-sm text-white font-bold tabular-nums">
            {conMoneda(calculada.importe, moneda)}
          </p>
        </div>
      </div>

      {/* El costo y el precio calculado, en chico: son del panel interno */}
      <p className="font-mono text-[10px] text-white/35">
        Costo {pesos(calculada.costoTotal)} · calculado {pesos(calculado)}
      </p>

      {perdida && (
        <p className="font-body text-xs text-danger bg-danger/15 rounded-lg px-3 py-2">
          Se vendería en {pesos(calculada.total)} y cuesta {pesos(calculada.costoTotal)}: es una venta con
          pérdida de {pesos(calculada.costoTotal - calculada.total)}.
        </p>
      )}
    </div>
  );
}
