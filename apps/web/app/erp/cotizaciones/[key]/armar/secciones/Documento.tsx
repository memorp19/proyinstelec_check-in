"use client";

import {
  NORMAS,
  normasSugeridas,
  textosSugeridos,
  type Completado,
  type Armado,
  type ContactoDocumento,
  type DatosDocumento,
  type ModoReporte,
} from "@/src/lib/cotizador";
import { btnGhost, etiqueta, input, tarjeta } from "../ui";

const RENGLONES: Array<{ campo: keyof ContactoDocumento; titulo: string }> = [
  { campo: "contacto", titulo: "Contacto" },
  { campo: "direccion1", titulo: "Dirección, renglón 1" },
  { campo: "direccion2", titulo: "Dirección, renglón 2" },
  { campo: "telefono", titulo: "Teléfono" },
  { campo: "correo", titulo: "Correo" },
];

const MODOS: Array<{ valor: ModoReporte; titulo: string }> = [
  { valor: "COMPLETO", titulo: "Completo (con laboratorio)" },
  { valor: "CORTO", titulo: "Corto" },
  { valor: "NINGUNO", titulo: "Sin renglón de reporte" },
  { valor: "OTRO", titulo: "Otro texto" },
];

/**
 * Lo que cambia del documento entre una cotización y otra.
 *
 * Son exactamente los campos que antes se corregían a mano en el Doc después
 * de generarlo: la fecha, el bloque del contacto, los dos párrafos de
 * actividades generales, las normas, el renglón de arriba de las partidas y el
 * del reporte.
 */
export function Documento({
  armado,
  cliente,
  titulo,
  soloLectura,
  llenadoAutomatico,
  onCambio,
}: {
  armado: Armado;
  cliente: string;
  titulo: string;
  soloLectura: boolean;
  /** Qué llegó del machote y no de lo guardado. */
  llenadoAutomatico: Completado["llenados"];
  onCambio: (a: Armado) => void;
}) {
  const d = armado.documento;
  const cambiar = (cambios: Partial<DatosDocumento>) =>
    onCambio({ ...armado, documento: { ...d, ...cambios } });

  const sugeridas = normasSugeridas(titulo);
  const elegidas = d.normas ?? sugeridas;

  const alternarNorma = (id: string) =>
    cambiar({ normas: elegidas.includes(id) ? elegidas.filter((x) => x !== id) : [...elegidas, id] });

  const proponerTextos = () => {
    const { objeto, alcance } = textosSugeridos(titulo, cliente);
    cambiar({ objeto, alcance });
  };

  const delCatalogo = llenadoAutomatico.includes("contacto");
  const contactoVacio = Object.values(d.contacto).every((v) => !v);

  return (
    <section className={`${tarjeta} p-4 space-y-5`}>
      <h2 className="font-head text-xl text-white uppercase tracking-wide">Documento</h2>

      <label className="block max-w-xs">
        <span className={etiqueta}>Fecha de la cotización</span>
        <input
          type="date"
          value={d.fecha}
          disabled={soloLectura}
          onChange={(e) => cambiar({ fecha: e.target.value })}
          className={`${input} mt-1`}
        />
        <span className="font-body text-[10px] text-white/30">
          Vacía: se fija al generar el documento y ya no se mueve al regenerarlo.
        </span>
      </label>

      {/* El bloque del contacto en la carta */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={etiqueta}>El contacto, como sale en la carta</p>
          {delCatalogo && (
            <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-green/15 border border-green/30 text-green">
              Encontrado en el catálogo
            </span>
          )}
        </div>
        <p className="font-body text-xs text-white/40">
          {contactoVacio
            ? "No hay un contacto de este cliente en el catálogo: captúralo aquí."
            : "Lo que se escriba aquí es solo de esta cotización: no cambia quién es el contacto de la cuenta."}
        </p>
        {RENGLONES.map(({ campo, titulo: t }) => (
          <div key={campo} className="flex items-center gap-3">
            <input
              value={d.contacto[campo]}
              disabled={soloLectura || d.ocultar[campo] === true}
              onChange={(e) => cambiar({ contacto: { ...d.contacto, [campo]: e.target.value } })}
              placeholder={t}
              className={`${input} flex-1`}
            />
            <label className="flex items-center gap-2 shrink-0">
              <input
                type="checkbox"
                checked={d.ocultar[campo] === true}
                disabled={soloLectura}
                onChange={(e) => {
                  const ocultar = { ...d.ocultar };
                  if (e.target.checked) ocultar[campo] = true;
                  else delete ocultar[campo];
                  cambiar({ ocultar });
                }}
                className="w-5 h-5 accent-blue"
              />
              <span className="font-body text-xs text-white/50">ocultar</span>
            </label>
          </div>
        ))}
      </div>

      {/* Actividades generales */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className={etiqueta}>Actividades generales</p>
          {!soloLectura && (
            <button className={btnGhost} onClick={proponerTextos}>
              Volver al texto sugerido
            </button>
          )}
        </div>
        <p className="font-body text-xs text-white/40">
          Llegan escritos con el tipo de servicio y el nombre del cliente. Son un punto de partida:
          se editan encima, y el botón los devuelve a como estaban.
        </p>
        <textarea
          value={d.objeto}
          disabled={soloLectura}
          onChange={(e) => cambiar({ objeto: e.target.value })}
          rows={3}
          placeholder="Primer párrafo: el objeto de la propuesta"
          className={input}
        />
        <textarea
          value={d.alcance}
          disabled={soloLectura || d.sinAlcance}
          onChange={(e) => cambiar({ alcance: e.target.value })}
          rows={3}
          placeholder="Segundo párrafo: el alcance"
          className={input}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={d.sinAlcance}
            disabled={soloLectura}
            onChange={(e) => cambiar({ sinAlcance: e.target.checked })}
            className="w-5 h-5 accent-blue"
          />
          <span className="font-body text-xs text-white/70">Sin el segundo párrafo</span>
        </label>
      </div>

      {/* Normas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className={etiqueta}>Documentos aplicables</p>
          {!soloLectura && (
            <div className="flex gap-2">
              {/* `null` no es lo mismo que la lista de sugeridas: significa "no
                  las he tocado", y así la cotización sigue al título si este
                  cambia. Por eso Sugeridas vuelve a null y no copia ids. */}
              <button className={btnGhost} onClick={() => cambiar({ normas: null })}>
                Sugeridas
              </button>
              <button className={btnGhost} onClick={() => cambiar({ normas: NORMAS.map((n) => n.id) })}>
                Todas
              </button>
              <button className={btnGhost} onClick={() => cambiar({ normas: [] })}>
                Ninguna
              </button>
            </div>
          )}
        </div>
        <p className="font-body text-xs text-white/40">
          {d.normas === null
            ? `Las ${sugeridas.length} que corresponden a este tipo de servicio, de ${NORMAS.length}.`
            : `${elegidas.length} elegidas a mano, de ${NORMAS.length}.`}
        </p>
        <div className="grid gap-1 sm:grid-cols-2">
          {NORMAS.map((n) => (
            <label key={n.id} className="flex items-start gap-2 py-1">
              <input
                type="checkbox"
                checked={elegidas.includes(n.id)}
                disabled={soloLectura}
                onChange={() => alternarNorma(n.id)}
                className="w-5 h-5 accent-blue mt-0.5 shrink-0"
              />
              <span className="font-body text-xs text-white/70">{n.texto}</span>
            </label>
          ))}
        </div>
        <label className="block">
          <span className={etiqueta}>Otras normas, una por renglón</span>
          <textarea
            value={d.normasExtra}
            disabled={soloLectura}
            onChange={(e) => cambiar({ normasExtra: e.target.value })}
            rows={2}
            className={`${input} mt-1`}
          />
        </label>
      </div>

      {/* Los dos renglones sueltos */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={etiqueta}>Renglón arriba de las partidas</span>
          <input
            value={d.encabezadoTabla}
            disabled={soloLectura}
            onChange={(e) => cambiar({ encabezadoTabla: e.target.value })}
            placeholder="Opcional, sin número"
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className={etiqueta}>Renglón del reporte</span>
          <select
            value={d.reporte}
            disabled={soloLectura}
            onChange={(e) => cambiar({ reporte: e.target.value as ModoReporte })}
            className={`${input} mt-1`}
          >
            {MODOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.titulo}
              </option>
            ))}
          </select>
        </label>
      </div>

      {d.reporte === "OTRO" && (
        <label className="block">
          <span className={etiqueta}>Texto del reporte</span>
          <textarea
            value={d.reporteTexto}
            disabled={soloLectura}
            onChange={(e) => cambiar({ reporteTexto: e.target.value })}
            rows={2}
            className={`${input} mt-1`}
          />
        </label>
      )}
    </section>
  );
}
