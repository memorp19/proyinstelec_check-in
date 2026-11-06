"use client";

import { useState } from "react";
import type { Esfuerzo, ServicioCatalogo } from "@/src/lib/cotizador";
import { btnGhost, btnPrimary, etiqueta, inputNum, pesos } from "../ui";

/**
 * Los parámetros de un estudio, al agregarlo.
 *
 * **Es obligatoria.** Un estudio no tiene precio de lista: se estima por
 * esfuerzo, y el catálogo solo propone unos valores. Aceptar la propuesta sin
 * mirarla es cómo se cotiza un estudio de diez semanas con los números de uno
 * de seis. Por eso no hay botón de "usar los del catálogo": los valores vienen
 * cargados, pero alguien tiene que confirmarlos.
 */
export function ModalEstudio({
  servicio,
  inicial,
  baseNodosPorOmision,
  onAceptar,
  onCancelar,
}: {
  servicio: { codigo: string; descripcion: string } & Partial<ServicioCatalogo>;
  inicial?: Esfuerzo | null;
  baseNodosPorOmision: number;
  onAceptar: (esfuerzo: Esfuerzo) => void;
  onCancelar: () => void;
}) {
  const [horasPorDia, setHorasPorDia] = useState(String(inicial?.horasPorDia ?? servicio.horasPorDia ?? 8));
  const [diasPorSemana, setDias] = useState(String(inicial?.diasPorSemana ?? servicio.diasPorSemana ?? 5));
  const [ingenieros, setIngenieros] = useState(String(inicial?.ingenieros ?? servicio.ingenieros ?? 1));
  const [semanas, setSemanas] = useState(String(inicial?.semanas ?? servicio.semanas ?? 1));
  const [tarifaHora, setTarifa] = useState(String(inicial?.tarifaHora ?? servicio.tarifaHora ?? ""));
  const [nodos, setNodos] = useState(inicial?.nodos ? String(inicial.nodos) : "");
  const [baseNodos, setBaseNodos] = useState(String(inicial?.baseNodos ?? servicio.baseNodos ?? baseNodosPorOmision));

  const n = (v: string) => {
    const x = Number(v.trim());
    return Number.isFinite(x) && x > 0 ? x : null;
  };

  const valores = {
    horasPorDia: n(horasPorDia),
    diasPorSemana: n(diasPorSemana),
    ingenieros: n(ingenieros),
    semanas: n(semanas),
    tarifaHora: n(tarifaHora),
  };
  const completo = Object.values(valores).every((v) => v !== null);

  const horas = completo
    ? valores.horasPorDia! * valores.diasPorSemana! * valores.ingenieros! * valores.semanas!
    : 0;
  const costo = completo ? horas * valores.tarifaHora! : 0;

  const campo = (titulo: string, valor: string, set: (v: string) => void, nota?: string) => (
    <label className="block">
      <span className={etiqueta}>{titulo}</span>
      <input value={valor} onChange={(e) => set(e.target.value)} className={`${inputNum} mt-1`} inputMode="decimal" />
      {nota && <span className="font-body text-[10px] text-white/30">{nota}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-navy/80 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-navy border border-white/20 rounded-xl w-full max-w-lg mt-10 p-5 space-y-4">
        <div>
          <p className={etiqueta}>Parámetros del estudio</p>
          <p className="font-mono text-sm text-blue-mid mt-1">{servicio.codigo}</p>
          <p className="font-body text-sm text-white/70">{servicio.descripcion}</p>
        </div>

        <p className="font-body text-xs text-white/50">
          Un estudio no tiene precio de lista: se estima por esfuerzo. Estos son los valores que
          propone el catálogo — confírmalos o cámbialos antes de agregarlo.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {campo("Horas al día", horasPorDia, setHorasPorDia)}
          {campo("Días a la semana", diasPorSemana, setDias)}
          {campo("Ingenieros", ingenieros, setIngenieros)}
          {campo("Semanas", semanas, setSemanas)}
          {campo("Tarifa por hora", tarifaHora, setTarifa)}
          {campo("Nodos base", baseNodos, setBaseNodos, "lo que cubre el costo")}
        </div>

        <label className="block">
          <span className={etiqueta}>Nodos cotizados</span>
          <input
            value={nodos}
            onChange={(e) => setNodos(e.target.value)}
            placeholder="opcional"
            className={`${inputNum} mt-1`}
            inputMode="decimal"
          />
          <span className="font-body text-[10px] text-white/30">
            Con nodos, el costo escala contra la base; sin ellos se multiplica por la cantidad.
          </span>
        </label>

        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <p className={etiqueta}>Resultado</p>
          <p className="font-mono text-sm text-white mt-1">
            {completo ? `${pesos(horas)} horas · $${pesos(costo)}` : "Faltan datos"}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onCancelar}>
            Cancelar
          </button>
          <button
            className={btnPrimary}
            disabled={!completo}
            onClick={() =>
              onAceptar({
                horasPorDia: valores.horasPorDia!,
                diasPorSemana: valores.diasPorSemana!,
                ingenieros: valores.ingenieros!,
                semanas: valores.semanas!,
                tarifaHora: valores.tarifaHora!,
                ...(n(nodos) ? { nodos: n(nodos)! } : {}),
                ...(n(baseNodos) ? { baseNodos: n(baseNodos)! } : {}),
              })
            }
          >
            Agregar el estudio
          </button>
        </div>
      </div>
    </div>
  );
}
