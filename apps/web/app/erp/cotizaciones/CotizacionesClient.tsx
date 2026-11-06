"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconoBote,
  IconoCalculadora,
  IconoCapas,
  IconoCarpeta,
  IconoCorreo,
  IconoEnviar,
  IconoLapiz,
  IconoPaquete,
  IconoRama,
  IconoReloj,
} from "./Iconos";

// ── Tipos (espejo de la API) ──────────────────────────────────────────────────

interface Cot {
  numero: number;
  anio: number;
  version: number;
  folio: string;
  cliente: string;
  titulo: string;
  dirigida_a: string;
  prioridad: string;
  estatus: string;
  elaboro: string;
  fecha_solicitud: string;
  fecha_entrega?: string;
  fecha_envio?: string;
  monto_mxn?: string;
  monto_usd?: string;
  orden_compra?: string;
  folio_ot?: string;
  drive_folder_url?: string;
  aprobada?: boolean;
  /** Todas las versiones de esta cotización, para las etiquetas. */
  versiones?: Array<{ version: number; folio: string; estatus: string; orden_compra?: string }>;
}

interface Catalogos {
  areas: Array<{ clave: string; nombre: string; correo?: string }>;
  responsables: Array<{ email: string; nombre: string; iniciales: string }>;
  responsablesSinIniciales: Array<{ email: string; nombre: string }>;
  estatus: string[];
  prioridades: string[];
}

type Modal =
  | { tipo: "editar"; cot: Cot }
  | { tipo: "version"; cot: Cot }
  | { tipo: "versiones"; cot: Cot }
  | { tipo: "eliminar"; cot: Cot }
  | { tipo: "enviar"; cot: Cot }
  | { tipo: "oc"; cot: Cot }
  | { tipo: "ot-sin-oc"; cot: Cot }
  | { tipo: "oc-posterior"; cot: Cot }
  | { tipo: "oc-modificar"; cot: Cot }
  | null;

const key = (c: Cot) => `${String(c.numero).padStart(3, "0")}-${c.anio}`;

/**
 * El folio de una versión, que es como se nombra una cotización en toda la
 * interfaz. Nunca "v1" ni "versión 1": el folio ya lo dice —`PCOTOP-260-2026`
 * la primera, `-1` la siguiente— y es lo que el cliente tiene en la mano.
 */
const folioDeVersion = (c: Cot, version: number) =>
  `PCOTOP-${String(c.numero).padStart(3, "0")}-${c.anio}${version > 0 ? `-${version}` : ""}`;

const BADGE: Record<string, string> = {
  PROCESO: "bg-amber/20 border-amber/30 text-amber",
  REVISION: "bg-blue/20 border-blue/30 text-blue-mid",
  ENVIADA: "bg-purple-500/20 border-purple-400/30 text-purple-300",
  ASIGNADA: "bg-green/20 border-green/30 text-green",
  // Descartada porque se asignó otra versión: apagada, no de alarma — no es un
  // error, es el curso normal cuando el cliente elige una de las versiones.
  "NO ASIGNADA": "bg-white/5 border-white/20 text-white/40",
  CANCELADA: "bg-red-500/20 border-red-400/30 text-red-400",
};
const badge = (e: string) => BADGE[e] ?? "bg-white/10 border-white/20 text-white/50";

/**
 * Estatus en los que la cotización todavía se arma. Los dependientes son una
 * espera, no un cierre: se siguen editando.
 */
const ARMABLES = ["PROCESO", "DEPENDIENTE PROVEEDOR", "DEPENDIENTE CLIENTE"];

const input =
  "w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue";
const btnPrimary =
  "bg-blue text-white font-mono text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40 active:scale-[0.97] transition-transform";
const btnGhost =
  "font-mono text-[10px] text-white/50 hover:text-white border border-white/10 hover:border-white/30 rounded-lg px-3 py-1.5 transition-colors";

/** Los botones de la tarjeta, todos con su ícono a la izquierda. */
const conIcono =
  "inline-flex items-center gap-1.5 font-mono text-[10px] font-bold rounded-lg px-3 py-2 min-h-tap active:scale-[0.97] transition-transform";
/** La acción principal de la tarjeta: una sola por estado. */
const btnAccion = `${conIcono} bg-blue text-white`;
const btnVerde = `${conIcono} bg-green/80 text-navy`;
const btnAmbar = `${conIcono} bg-amber text-navy`;
/** Lo que siempre está: editar, carpeta, versiones. */
const btnIcono = `${conIcono} border border-white/15 text-white/70 hover:text-white hover:border-white/30`;
/** Borrar no se parece a nada más de la tarjeta, y es a propósito. */
const btnBorrar = `${conIcono} border border-danger/25 text-danger/80 hover:text-danger hover:border-danger/60`;

const etiquetaCampo = "font-mono text-[9px] text-white/40 uppercase tracking-widest";

function fmtFecha(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMonto(monto: string, moneda: string) {
  const n = Number(monto);
  const cifra = Number.isFinite(n)
    ? n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : monto;
  return `$${cifra} ${moneda}`;
}

/**
 * Importes de una cotización, cada moneda por separado. Nunca un total: los
 * montos en pesos y en dólares son independientes y sumarlos exigiría inventar
 * un tipo de cambio. Sin montos capturados no se dibuja nada — vacío no es cero.
 */
function Montos({ cot }: { cot: Cot }) {
  if (!cot.monto_mxn && !cot.monto_usd) return null;
  return (
    <span className="inline-flex gap-1.5 flex-wrap">
      {cot.monto_mxn && (
        <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white/70">
          {fmtMonto(cot.monto_mxn, "MXN")}
        </span>
      )}
      {cot.monto_usd && (
        <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white/70">
          {fmtMonto(cot.monto_usd, "USD")}
        </span>
      )}
    </span>
  );
}

/** Par de campos de importe, compartido por el alta y la edición. */
function CamposMonto({
  mxn,
  usd,
  onChange,
}: {
  mxn: string;
  usd: string;
  onChange: (campo: "montoMxn" | "montoUsd", valor: string) => void;
}) {
  return (
    <div>
      <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">
        Importe — se puede capturar en las dos monedas
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          className={input}
          placeholder="Monto MXN"
          inputMode="decimal"
          value={mxn}
          onChange={(e) => onChange("montoMxn", e.target.value)}
        />
        <input
          className={input}
          placeholder="Monto USD"
          inputMode="decimal"
          value={usd}
          onChange={(e) => onChange("montoUsd", e.target.value)}
        />
      </div>
      <p className="font-mono text-[10px] text-white/30 mt-1">
        Déjalo vacío si aún no se conoce; no se guarda como cero ni se suman entre sí.
      </p>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function CotizacionesClient({
  puedeEnviar,
  puedeCrearOT,
  puedeModificarOC,
}: {
  puedeEnviar: boolean;
  puedeCrearOT: boolean;
  puedeModificarOC: boolean;
}) {
  const anioActual = new Date().getFullYear();
  const [tab, setTab] = useState<"buscar" | "nueva">("buscar");
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /**
   * Se incrementa cuando un modal escribió algo. El listado lo observa y
   * vuelve a buscar.
   *
   * Hace falta un contador —y no una llamada directa— porque el modal lo
   * monta este componente y `buscar()` vive dentro de `Buscador`. Sin esto, la
   * tarjeta seguía mostrando el valor anterior hasta recargar con F5: la base
   * y la OT quedaban bien, pero la pantalla mentía.
   */
  const [recarga, setRecarga] = useState(0);

  /** Cierra el modal, deja el aviso y pide al listado que se refresque. */
  const trasEscribir = (msg?: string) => {
    if (msg) setAviso(msg);
    setModal(null);
    setRecarga((n) => n + 1);
  };

  useEffect(() => {
    fetch("/api/erp/catalogos")
      .then((r) => r.json())
      .then((d) => !d.error && setCatalogos(d))
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-4xl">
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">ERP · Cotizaciones</p>
      <h1 className="font-head text-2xl font-bold mb-4">Cotizaciones</h1>

      <div className="flex gap-1 mb-5">
        {(["buscar", "nueva"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`font-mono text-xs px-4 py-2 rounded-lg transition-colors ${
              tab === t ? "bg-blue text-white font-bold" : "bg-white/10 text-white/50 hover:text-white"
            }`}
          >
            {t === "buscar" ? "Buscar" : "Nueva cotización"}
          </button>
        ))}
      </div>

      {aviso && (
        <div className="mb-4 bg-amber/10 border border-amber/20 rounded-xl px-4 py-3 flex justify-between gap-3">
          <p className="font-mono text-xs text-amber">{aviso}</p>
          <button onClick={() => setAviso(null)} className="font-mono text-xs text-white/40">✕</button>
        </div>
      )}

      {tab === "buscar" && (
        <Buscador
          anioActual={anioActual}
          catalogos={catalogos}
          puedeEnviar={puedeEnviar}
          puedeCrearOT={puedeCrearOT}
          puedeModificarOC={puedeModificarOC}
          abrirModal={setModal}
          setAviso={setAviso}
          recarga={recarga}
        />
      )}
      {tab === "nueva" && (
        <NuevaCotizacion
          anioActual={anioActual}
          catalogos={catalogos}
          onCreada={(avisos) => {
            setAviso(avisos.length > 0 ? avisos.join(" · ") : "Cotización creada");
            setTab("buscar");
          }}
        />
      )}

      {modal && (
        <ModalShell titulo={tituloModal(modal)} onClose={() => setModal(null)}>
          {modal.tipo === "editar" && (
            <EditarForm cot={modal.cot} catalogos={catalogos} onDone={() => trasEscribir()} />
          )}
          {modal.tipo === "version" && (
            <NuevaVersionForm cot={modal.cot} onDone={trasEscribir} />
          )}
          {modal.tipo === "versiones" && <Versiones cot={modal.cot} />}
          {modal.tipo === "eliminar" && (
            <EliminarForm cot={modal.cot} onDone={trasEscribir} />
          )}
          {modal.tipo === "enviar" && (
            <EnviarForm cot={modal.cot} onDone={trasEscribir} />
          )}
          {modal.tipo === "oc" && (
            <OcForm cot={modal.cot} catalogos={catalogos} onDone={trasEscribir} />
          )}
          {modal.tipo === "ot-sin-oc" && (
            <OcForm sinOc cot={modal.cot} catalogos={catalogos} onDone={trasEscribir} />
          )}
          {modal.tipo === "oc-posterior" && (
            <OcPosteriorForm cot={modal.cot} onDone={trasEscribir} />
          )}
          {modal.tipo === "oc-modificar" && (
            <OcModificarForm cot={modal.cot} onDone={trasEscribir} />
          )}
        </ModalShell>
      )}
    </div>
  );
}


/**
 * Captura la OC de una cotizacion que ya esta ASIGNADA y ya tiene OT.
 *
 * No reutiliza `OcForm` porque aquel genera la OT: pide responsable y areas, y
 * ofrece elegir version. Aqui no hay nada que elegir — el servidor escribe en
 * la version que tiene la OT, que no siempre es la vigente.
 */
function OcPosteriorForm({ cot, onDone }: { cot: Cot; onDone: (msg: string) => void }) {
  const [oc, setOc] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!oc.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/cotizaciones/${cot.numero}-${cot.anio}/oc-posterior`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenCompra: oc.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo registrar la orden de compra");
      onDone(`OC ${data.ordenCompra} registrada en ${folioDeVersion(cot, data.version)} y en ${data.folioOt}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] text-white/50">
        La orden de trabajo ya existe. La OC se guarda en la versión que la generó y en su OT.
      </p>
      <input
        className={input}
        placeholder="No. de Orden de Compra *"
        value={oc}
        onChange={(e) => setOc(e.target.value)}
      />
      {error && (
        <p className="font-mono text-[10px] text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <button
        onClick={guardar}
        disabled={guardando || !oc.trim()}
        className="w-full min-h-tap font-mono text-xs font-bold text-navy bg-amber rounded-xl disabled:opacity-40"
      >
        {guardando ? "Guardando…" : "Registrar OC"}
      </button>
    </div>
  );
}


/**
 * Corrige una OC ya registrada. Pide motivo porque lo que se reescribe es el
 * numero con el que se factura y se cobra: sin motivo, el cambio es
 * indistinguible de un error de captura.
 */
function OcModificarForm({ cot, onDone }: { cot: Cot; onDone: (msg: string) => void }) {
  const [oc, setOc] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listo = oc.trim() !== "" && oc.trim() !== cot.orden_compra && motivo.trim().length >= 5;

  async function guardar() {
    if (!listo) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/cotizaciones/${cot.numero}-${cot.anio}/oc-posterior`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenCompra: oc.trim(), motivo: motivo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo modificar la orden de compra");
      onDone(
        `OC ${data.anterior} → ${data.ordenCompra} en ${folioDeVersion(cot, data.version)} y en ${data.folioOt}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] text-amber bg-amber/10 border border-amber/20 rounded-lg px-3 py-2">
        Se reemplaza la OC <strong className="font-bold">{cot.orden_compra}</strong> en la versión
        que tiene la OT y en su orden de trabajo. Queda en bitácora con tu nombre y el motivo.
      </p>
      <input
        className={input}
        placeholder="Nueva orden de compra *"
        value={oc}
        onChange={(e) => setOc(e.target.value)}
      />
      <textarea
        className={`${input} min-h-[72px] resize-y`}
        placeholder="Motivo del cambio * (mínimo 5 caracteres)"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
      />
      {error && (
        <p className="font-mono text-[10px] text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <button
        onClick={guardar}
        disabled={guardando || !listo}
        className="w-full min-h-tap font-mono text-xs font-bold text-navy bg-amber rounded-xl disabled:opacity-40"
      >
        {guardando ? "Guardando…" : "Modificar OC"}
      </button>
    </div>
  );
}

function tituloModal(m: NonNullable<Modal>) {
  const t = {
    editar: "Editar",
    version: "Nueva versión",
    versiones: "Versiones",
    eliminar: "Eliminar la cotización",
    enviar: "Enviar al cliente",
    oc: "Ingresar OC → Generar OT",
    "ot-sin-oc": "Generar OT sin OC",
    "oc-posterior": "Registrar OC",
    "oc-modificar": "Modificar OC",
  }[m.tipo];
  return `${t} · ${m.cot.folio}`;
}

// ── Modal shell ───────────────────────────────────────────────────────────────

function ModalShell({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start md:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-navy border border-white/20 rounded-xl w-full max-w-lg p-5 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-head font-bold text-white">{titulo}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white font-mono">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Buscador ──────────────────────────────────────────────────────────────────

function Buscador({
  anioActual,
  catalogos,
  puedeEnviar,
  puedeCrearOT,
  puedeModificarOC,
  abrirModal,
  setAviso,
  recarga,
}: {
  anioActual: number;
  catalogos: Catalogos | null;
  puedeEnviar: boolean;
  puedeCrearOT: boolean;
  puedeModificarOC: boolean;
  abrirModal: (m: Modal) => void;
  setAviso: (s: string) => void;
  /** Cambia cuando un modal escribió algo; dispara una búsqueda nueva. */
  recarga: number;
}) {
  const [filtros, setFiltros] = useState({
    anio: String(anioActual), empresa: "", numero: "", elaboro: "", dirigidaA: "", estatus: "", mesEntrega: "", ot: "", oc: "",
  });
  /** Cola de quien persigue las OC: asignadas que aún no tienen número. */
  const [soloSinOc, setSoloSinOc] = useState(false);
  const [resultados, setResultados] = useState<Cot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => v && params.set(k, v));
      if (soloSinOc) params.set("sinOc", "1");
      const res = await fetch(`/api/erp/cotizaciones?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al buscar");
      setResultados(data.cotizaciones);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [filtros, soloSinOc]);

  useEffect(() => { buscar(); }, []); // carga inicial

  // Dos disparadores que no pasan por el botón de buscar:
  //   · el interruptor "sin OC", que es un cambio de "qué estoy mirando";
  //   · `recarga`, cuando un modal acaba de escribir.
  // El ref evita que la carga inicial se duplique en el primer render.
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    buscar();
  }, [soloSinOc, recarga]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFiltros((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <form
        onSubmit={(e) => { e.preventDefault(); buscar(); }}
        className="bg-white/5 border border-white/10 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-2"
      >
        <input className={input} placeholder="Empresa" value={filtros.empresa} onChange={set("empresa")} />
        <input className={input} placeholder="No. cotización" value={filtros.numero} onChange={set("numero")} />
        <input className={input} placeholder="Elaboró" value={filtros.elaboro} onChange={set("elaboro")} list="dl-elaboro" />
        <input className={input} placeholder="Dirigida a" value={filtros.dirigidaA} onChange={set("dirigidaA")} />
        <label className="col-span-2 md:col-span-4 flex items-center gap-2 min-h-tap font-mono text-[11px] text-white/60 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={soloSinOc}
            onChange={(e) => setSoloSinOc(e.target.checked)}
            className="w-4 h-4 accent-amber"
          />
          Solo <span className="text-amber">ASIGNADA sin orden de compra</span>
          <span className="text-white/30">— la cola de OC por conseguir</span>
        </label>
        <select className={input} value={filtros.estatus} onChange={set("estatus")}>
          <option value="">Estatus (todos)</option>
          {(catalogos?.estatus ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={input} value={filtros.mesEntrega} onChange={set("mesEntrega")}>
          <option value="">Mes entrega</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {new Date(2026, i, 1).toLocaleDateString("es-MX", { month: "long" })}
            </option>
          ))}
        </select>
        <input className={input} placeholder="OT interna" value={filtros.ot} onChange={set("ot")} />
        <input className={input} placeholder="Orden de compra" value={filtros.oc} onChange={set("oc")} />
        <select className={input} value={filtros.anio} onChange={set("anio")}>
          {[anioActual, anioActual - 1, anioActual - 2].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <button type="submit" disabled={loading} className={`${btnPrimary} col-span-2 md:col-span-3`}>
          {loading ? "Buscando…" : "Buscar"}
        </button>
        <span className="col-span-2 md:col-span-1 flex items-center justify-end font-mono text-[10px] text-white/30">
          {loading
            ? "…"
            : `${resultados.length} ${resultados.length === 1 ? "cotización" : "cotizaciones"}${
                soloSinOc ? " sin OC" : ""
              }`}
        </span>
        <datalist id="dl-elaboro">
          {(catalogos?.responsables ?? []).map((r) => <option key={r.email} value={r.iniciales} />)}
        </datalist>
      </form>

      {error && <p className="font-mono text-xs text-red-400">{error}</p>}

      {/* Resultados */}
      <div className="space-y-2">
        {resultados.length === 0 && !loading ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-6 text-center">
            <p className="font-mono text-sm text-white/40">Sin resultados</p>
          </div>
        ) : (
          resultados.map((c) => <Tarjeta
            key={key(c)}
            c={c}
            puedeEnviar={puedeEnviar}
            puedeCrearOT={puedeCrearOT}
            puedeModificarOC={puedeModificarOC}
            onModal={abrirModal}
          />)
        )}
      </div>
    </div>
  );
}

// ── La tarjeta de una cotización ──────────────────────────────────────────────

/**
 * Sigue el orden del buscador de Apps Script, que es el que la gente ya tiene
 * en la cabeza: arriba el folio con su estatus y los botones; en medio las
 * cuatro columnas que se miran para decidir; abajo la OT y la OC.
 *
 * Los botones llevan ícono porque en una lista larga se busca la forma antes
 * que la palabra.
 */
function Tarjeta({
  c,
  puedeEnviar,
  puedeCrearOT,
  puedeModificarOC,
  onModal,
}: {
  c: Cot;
  puedeEnviar: boolean;
  puedeCrearOT: boolean;
  puedeModificarOC: boolean;
  onModal: (m: Modal) => void;
}) {
  const cotizable = ARMABLES.includes(c.estatus);
  const armar = `/erp/cotizaciones/${key(c)}/armar?version=${c.version}`;

  // En qué versión quedó la orden de compra: no siempre es la vigente, porque
  // el cliente puede aceptar una anterior.
  const conOc = (c.versiones ?? []).find((v) => v.orden_compra);
  const otras = (c.versiones ?? []).filter((v) => v.version !== c.version);

  return (
    <div className="bg-white/10 border border-white/10 rounded-xl px-5 py-4">
      {/* Encabezado: folio, estatus y acciones */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className={etiquetaCampo}>No. cotización</p>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <p className="font-head text-lg font-bold text-white">{c.folio}</p>
            <span className={`font-mono text-[9px] px-2.5 py-1 rounded-full border ${badge(c.estatus)}`}>
              {c.estatus}
            </span>
            {c.estatus === "REVISION" && c.aprobada && (
              <span className="font-mono text-[9px] px-2.5 py-1 rounded-full bg-green/15 border border-green/30 text-green">
                APROBADA
              </span>
            )}
            {/* Solo visual: el estatus sigue siendo ASIGNADA. Marca que el
                trabajo se ejecutó y falta el número del cliente para facturar. */}
            {c.estatus === "ASIGNADA" && !c.orden_compra && (
              <span
                className="font-mono text-[9px] px-2.5 py-1 rounded-full bg-amber/15 border border-amber/30 text-amber"
                title="Asignada sin orden de compra: el trabajo se ejecuta y la OC del cliente está pendiente"
              >
                SIN OC
              </span>
            )}
          </div>
          <p className="font-body text-xs text-white/50 mt-1 truncate">{c.titulo}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* La acción principal, según el estado */}
          {c.estatus === "PROCESO" && (
            <a href={`${armar}&vistaPrevia=1`} className={btnAccion}>
              <IconoEnviar /> Enviar a revisión
            </a>
          )}
          {c.estatus === "REVISION" && !c.aprobada && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-white/50 bg-white/5 border border-white/15 rounded-lg px-3 py-2">
              <IconoReloj /> Esperando al revisor
            </span>
          )}
          {c.estatus === "REVISION" && c.aprobada && puedeEnviar && (
            <button onClick={() => onModal({ tipo: "enviar", cot: c })} className={btnVerde}>
              <IconoCorreo /> Enviar al cliente
            </button>
          )}
          {c.estatus === "ENVIADA" && !c.folio_ot && puedeCrearOT && (
            <>
              <button onClick={() => onModal({ tipo: "oc", cot: c })} className={btnAmbar}>
                <IconoPaquete /> Ingresar OC
              </button>
              {/* El cliente puede aceptar sin emitir OC; la OT se genera igual */}
              <button onClick={() => onModal({ tipo: "ot-sin-oc", cot: c })} className={btnIcono}>
                Generar OT sin OC
              </button>
            </>
          )}
          {c.estatus === "ASIGNADA" && !c.orden_compra && puedeCrearOT && (
            <button onClick={() => onModal({ tipo: "oc-posterior", cot: c })} className={btnAmbar}>
              <IconoPaquete /> Registrar OC
            </button>
          )}
          {c.estatus === "ENVIADA" && puedeEnviar && (
            <button onClick={() => onModal({ tipo: "enviar", cot: c })} className={btnIcono}>
              <IconoCorreo /> Reenviar
            </button>
          )}

          {/* Cotizar: mientras se puede tocar se arma; después se consulta */}
          <a href={armar} className={cotizable ? btnAccion : btnIcono}>
            <IconoCalculadora /> {cotizable ? "Cotizar" : "Ver cotización"}
          </a>
        </div>
      </div>

      {/* Las cuatro columnas que se miran para decidir */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <Campo titulo="Cliente" valor={c.cliente} />
        <Campo titulo="Dirigida a" valor={c.dirigida_a} />
        <Campo titulo="Elaboró" valor={c.elaboro} />
        <Campo titulo="Fecha entrega" valor={fmtFecha(c.fecha_entrega)} />
      </div>

      {/* OT y OC */}
      <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap gap-x-8 gap-y-2 items-center">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-white/40">OT interna:</span>
          <span className="font-mono text-xs text-white">{c.folio_ot || "—"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-white/40">Orden de compra:</span>
          <span className={`font-mono text-xs ${c.orden_compra ? "text-green" : "text-white/40"}`}>
            {c.orden_compra || "—"}
          </span>
          {/* La OC puede vivir en otra versión: decir en cuál evita buscarla */}
          {!c.orden_compra && conOc && (
            <span className="font-mono text-[9px] text-amber">en {conOc.folio}</span>
          )}
        </div>
        <Montos cot={c} />
      </div>

      {/* Las otras versiones, con su folio y su estatus */}
      {otras.length > 0 && (
        <p className="mt-2 font-mono text-[10px] text-white/35">
          También:{" "}
          {otras.map((v, i) => (
            <span key={v.version}>
              {i > 0 && " · "}
              {v.folio} <span className="text-white/25">{v.estatus}</span>
            </span>
          ))}
        </p>
      )}

      {/* El resto, en su renglón */}
      <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2 flex-wrap">
        <button onClick={() => onModal({ tipo: "editar", cot: c })} className={btnIcono}>
          <IconoLapiz /> Editar
        </button>
        {c.drive_folder_url && (
          <a href={c.drive_folder_url} target="_blank" rel="noopener noreferrer" className={btnIcono}>
            <IconoCarpeta /> Ver carpeta
          </a>
        )}
        <button onClick={() => onModal({ tipo: "version", cot: c })} className={btnIcono}>
          <IconoRama /> Nueva versión
        </button>
        <button onClick={() => onModal({ tipo: "versiones", cot: c })} className={btnIcono}>
          <IconoCapas /> Versiones
        </button>
        {c.estatus === "ASIGNADA" && c.orden_compra && puedeModificarOC && (
          <button onClick={() => onModal({ tipo: "oc-modificar", cot: c })} className={btnIcono}>
            <IconoPaquete /> Modificar OC
          </button>
        )}
        {/* Eliminar solo asoma donde de verdad se puede: en PROCESO, sin envío,
            sin OT y sin OC. El servidor lo vuelve a comprobar. */}
        {c.estatus === "PROCESO" && !c.fecha_envio && !c.folio_ot && !c.orden_compra && (
          <button onClick={() => onModal({ tipo: "eliminar", cot: c })} className={btnBorrar}>
            <IconoBote /> Eliminar
          </button>
        )}
      </div>
    </div>
  );
}

function Campo({ titulo, valor }: { titulo: string; valor?: string }) {
  return (
    <div className="min-w-0">
      <p className={etiquetaCampo}>{titulo}</p>
      <p className="font-body text-sm text-white/90 truncate mt-0.5">{valor || "—"}</p>
    </div>
  );
}

// ── Nueva cotización ──────────────────────────────────────────────────────────

function NuevaCotizacion({
  anioActual,
  catalogos,
  onCreada,
}: {
  anioActual: number;
  catalogos: Catalogos | null;
  onCreada: (avisos: string[]) => void;
}) {
  const [form, setForm] = useState({ numero: "", cliente: "", titulo: "", dirigidaA: "", elaboro: "", prioridad: "MEDIA", fechaEntrega: "", montoMxn: "", montoUsd: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientes, setClientes] = useState<string[]>([]);

  useEffect(() => {
    fetch(`/api/erp/cotizaciones?siguiente=1&anio=${anioActual}`)
      .then((r) => r.json())
      .then((d) => d.numero && setForm((p) => ({ ...p, numero: String(d.numero) })))
      .catch(() => {});
    fetch("/api/erp/clientes")
      .then((r) => r.json())
      .then((d) => d.clientes && setClientes(d.clientes.map((c: { razon_social: string }) => c.razon_social)))
      .catch(() => {});
  }, [anioActual]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/erp/cotizaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: parseInt(form.numero, 10),
          anio: anioActual,
          cliente: form.cliente,
          titulo: form.titulo,
          dirigidaA: form.dirigidaA,
          elaboro: form.elaboro,
          prioridad: form.prioridad,
          fechaEntrega: form.fechaEntrega || undefined,
          montoMxn: form.montoMxn || null,
          montoUsd: form.montoUsd || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear");
      onCreada(data.avisos ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3 max-w-lg">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">No. cotización</p>
          <input className={input} value={form.numero} onChange={set("numero")} inputMode="numeric" required />
        </div>
        <div>
          <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Año</p>
          <input className={`${input} opacity-50`} value={anioActual} readOnly />
        </div>
      </div>
      <input className={input} placeholder="Cliente (razón social) *" value={form.cliente} onChange={set("cliente")} list="dl-clientes" required />
      <datalist id="dl-clientes">{clientes.map((c) => <option key={c} value={c} />)}</datalist>
      <input className={input} placeholder="Título del proyecto *" value={form.titulo} onChange={set("titulo")} required />
      <input className={input} placeholder="Dirigida a *" value={form.dirigidaA} onChange={set("dirigidaA")} required />
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="Elaboró (iniciales) *" value={form.elaboro} onChange={set("elaboro")} list="dl-elab2" required />
        <select className={input} value={form.prioridad} onChange={set("prioridad")}>
          {(catalogos?.prioridades ?? ["BAJA", "MEDIA", "ALTA"]).map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <datalist id="dl-elab2">
        {(catalogos?.responsables ?? []).map((r) => <option key={r.email} value={r.iniciales}>{r.nombre}</option>)}
      </datalist>
      <div>
        <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Fecha compromiso de entrega</p>
        <input type="date" className={input} value={form.fechaEntrega} onChange={set("fechaEntrega")} />
      </div>
      <CamposMonto
        mxn={form.montoMxn}
        usd={form.montoUsd}
        onChange={(campo, valor) => setForm((p) => ({ ...p, [campo]: valor }))}
      />
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] text-white/30">Se creará la carpeta en Drive con las plantillas</p>
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "Creando…" : "Crear e inicializar"}
        </button>
      </div>
    </form>
  );
}

// ── Editar ────────────────────────────────────────────────────────────────────

function EditarForm({ cot, catalogos, onDone }: { cot: Cot; catalogos: Catalogos | null; onDone: () => void }) {
  const [form, setForm] = useState({
    titulo: cot.titulo, dirigidaA: cot.dirigida_a, prioridad: cot.prioridad,
    fechaEntrega: cot.fecha_entrega?.slice(0, 10) ?? "", estatus: "",
    montoMxn: cot.monto_mxn ?? "", montoUsd: cot.monto_usd ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        titulo: form.titulo, dirigidaA: form.dirigidaA, prioridad: form.prioridad,
        fechaEntrega: form.fechaEntrega || null,
        // null vacía el importe; el servidor nunca lo interpreta como cero
        montoMxn: form.montoMxn || null,
        montoUsd: form.montoUsd || null,
      };
      if (form.estatus) body.estatus = form.estatus;
      const res = await fetch(`/api/erp/cotizaciones/${key(cot)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input className={input} value={form.titulo} onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))} placeholder="Título" />
      <input className={input} value={form.dirigidaA} onChange={(e) => setForm((p) => ({ ...p, dirigidaA: e.target.value }))} placeholder="Dirigida a" />
      <div className="grid grid-cols-2 gap-2">
        <select className={input} value={form.prioridad} onChange={(e) => setForm((p) => ({ ...p, prioridad: e.target.value }))}>
          {(catalogos?.prioridades ?? ["BAJA", "MEDIA", "ALTA"]).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="date" className={input} value={form.fechaEntrega} onChange={(e) => setForm((p) => ({ ...p, fechaEntrega: e.target.value }))} />
      </div>
      <CamposMonto
        mxn={form.montoMxn}
        usd={form.montoUsd}
        onChange={(campo, valor) => setForm((p) => ({ ...p, [campo]: valor }))}
      />
      <div>
        <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Cambio de estatus manual (opcional)</p>
        <select className={input} value={form.estatus} onChange={(e) => setForm((p) => ({ ...p, estatus: e.target.value }))}>
          <option value="">Sin cambio ({cot.estatus})</option>
          {["PROCESO", "DEPENDIENTE PROVEEDOR", "DEPENDIENTE CLIENTE", "CANCELADA"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <p className="font-mono text-[10px] text-white/30 mt-1">
          REVISION, ENVIADA y ASIGNADA se alcanzan solo por su flujo.
        </p>
      </div>
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Guardando…" : "Guardar"}</button>
      </div>
    </form>
  );
}

// ── Nueva versión ─────────────────────────────────────────────────────────────

function NuevaVersionForm({ cot, onDone }: { cot: Cot; onDone: (msg: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/cotizaciones/${key(cot)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "nueva_version" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      onDone(`${data.cotizacion.folio} creada`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs text-white/60">
        Se creará {folioDeVersion(cot, cot.version + 1)} en PROCESO, heredando cliente y título. La versión actual
        deja de contar en el buscador y el dashboard; se copian de nuevo las plantillas a la misma carpeta.
      </p>
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button onClick={crear} disabled={saving} className={btnPrimary}>
          {saving ? "Creando…" : `Crear ${folioDeVersion(cot, cot.version + 1)}`}
        </button>
      </div>
    </div>
  );
}

// ── Versiones ─────────────────────────────────────────────────────────────────

function Versiones({ cot }: { cot: Cot }) {
  const [versiones, setVersiones] = useState<Cot[] | null>(null);

  useEffect(() => {
    fetch(`/api/erp/cotizaciones/${key(cot)}`)
      .then((r) => r.json())
      .then((d) => setVersiones(d.versiones ?? []))
      .catch(() => setVersiones([]));
  }, [cot]);

  if (!versiones) return <p className="font-mono text-xs text-white/40">Cargando…</p>;
  return (
    <div className="space-y-2">
      {versiones.map((v) => (
        <div key={v.version} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            {/* Sin etiqueta de versión: el folio ya la lleva (PCOTOP-245-2026-2) */}
            <p className="font-mono text-xs text-white font-bold">{v.folio}</p>
            <p className="font-mono text-[10px] text-white/40 truncate">
              {v.estatus} · Elaboró {v.elaboro} · {fmtFecha(v.fecha_solicitud)}
            </p>
          </div>
          {v.drive_folder_url && (
            <a href={v.drive_folder_url} target="_blank" rel="noopener noreferrer" className={btnGhost}>Carpeta</a>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Eliminar una cotización que nunca salió ───────────────────────────────────

/**
 * Borrar de verdad, y por eso la confirmación es teclear el folio.
 *
 * Un "¿estás seguro?" se contesta que sí sin leerlo. Copiar `PCOTOP-260-2026`
 * obliga a mirar **cuál** se está borrando, que es el error que de verdad
 * ocurre: eliminar la de al lado.
 */
function EliminarForm({ cot, onDone }: { cot: Cot; onDone: (msg: string) => void }) {
  const [confirmacion, setConfirmacion] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coincide = confirmacion.trim().toUpperCase() === cot.folio.toUpperCase();

  async function eliminar() {
    setBorrando(true);
    setError(null);
    try {
      const r = await fetch(`/api/erp/cotizaciones/${key(cot)}/eliminar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: cot.version, confirmacion }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudo eliminar");
      onDone(
        `${d.folio} eliminada.` +
          (d.carpeta ? " Su carpeta de Drive sigue ahí: revísala si hay que limpiarla." : ""),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBorrando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-danger/10 border border-danger/25 rounded-xl p-3">
        <p className="font-body text-sm text-white">
          Se va a borrar <span className="font-mono text-danger">{cot.folio}</span> y todo lo que
          tenga armado: partidas, conceptos y gastos.
        </p>
        <p className="font-body text-xs text-white/60 mt-2">
          No se recupera. <strong>El número no se reutiliza</strong>: la siguiente cotización será
          la que sigue, no esta. Si lo que quieres es dejar constancia de que existió y ya no va a
          ocurrir, ciérrala como CANCELADA desde Editar.
        </p>
      </div>

      <div className="font-mono text-[11px] text-white/50 space-y-0.5">
        <p>{cot.cliente}</p>
        <p>{cot.titulo}</p>
        <p>Elaboró {cot.elaboro}</p>
      </div>

      {cot.drive_folder_url && (
        <p className="font-body text-xs text-amber bg-amber/10 border border-amber/25 rounded-lg px-3 py-2">
          Su carpeta de Drive <strong>no se toca</strong>: puede tener dentro algo que no puso el
          sistema. Queda el enlace en la bitácora por si hay que limpiarla a mano.
        </p>
      )}

      <div>
        <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">
          Escribe {cot.folio} para confirmar
        </p>
        <input
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          placeholder={cot.folio}
          autoComplete="off"
          className={input}
        />
      </div>

      {error && (
        <p className="font-mono text-[10px] text-red-400 bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        onClick={() => void eliminar()}
        disabled={borrando || !coincide}
        className="w-full min-h-tap font-mono text-xs font-bold text-white bg-danger/80 rounded-xl disabled:opacity-40"
      >
        {borrando ? "Eliminando…" : "Eliminar definitivamente"}
      </button>
    </div>
  );
}

// ── Envío al cliente ──────────────────────────────────────────────────────────

interface DatosEnvio {
  puede: boolean;
  motivo?: string;
  contactos: Array<{ contacto_id: string; nombre: string; puesto?: string; correo?: string }>;
  sugeridoId: string | null;
  asuntoSugerido: string;
  ccEquipo: string[];
  pdfDisponible: boolean;
}

function EnviarForm({ cot, onDone }: { cot: Cot; onDone: (msg: string) => void }) {
  const [datos, setDatos] = useState<DatosEnvio | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [telefono, setTelefono] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/erp/cotizaciones/${key(cot)}/enviar`)
      .then((r) => r.json())
      .then((d: DatosEnvio & { error?: string }) => {
        if (d.error) { setError(d.error); return; }
        setDatos(d);
        setAsunto(d.asuntoSugerido);
        if (d.sugeridoId) {
          const sugerido = d.contactos.find((c) => c.contacto_id === d.sugeridoId);
          if (sugerido?.correo) setSeleccion(new Set([sugerido.correo]));
        }
      })
      .catch(() => setError("No se pudieron cargar los datos de envío"));
  }, [cot]);

  function toggle(correo: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(correo)) next.delete(correo);
      else next.add(correo);
      return next;
    });
  }

  async function enviar() {
    const destinatarios = [...seleccion, ...manual.split(",").map((s) => s.trim()).filter(Boolean)];
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/cotizaciones/${key(cot)}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinatarios,
          asunto,
          mensajeHtml: mensaje ? `<p style="font-size:13px;color:#111827;white-space:pre-wrap;">${mensaje}</p>` : undefined,
          telefonoFirma: telefono || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al enviar");
      onDone(`${cot.folio} enviada al cliente`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setSaving(false);
    }
  }

  if (!datos && !error) return <p className="font-mono text-xs text-white/40">Cargando…</p>;
  if (datos && !datos.puede) {
    return <p className="font-mono text-xs text-amber">{datos.motivo ?? "No puede enviarse todavía"}</p>;
  }

  const totalSeleccion = seleccion.size + manual.split(",").filter((s) => s.trim()).length;

  return (
    <div className="space-y-3">
      {datos && !datos.pdfDisponible && (
        <p className="font-mono text-[10px] text-amber bg-amber/10 border border-amber/20 rounded-lg px-3 py-2">
          No se localizó el PDF en la carpeta de la cotización. Genera el PDF con el nombre
          «{cot.folio} …» antes de enviar — el envío es obligatorio con PDF.
        </p>
      )}

      <div>
        <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Destinatarios</p>
        {datos && datos.contactos.length > 0 ? (
          <div className="space-y-1">
            {datos.contactos.map((c) => (
              <label key={c.contacto_id} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={c.correo ? seleccion.has(c.correo) : false} onChange={() => c.correo && toggle(c.correo)} />
                <span className="font-mono text-xs text-white">{c.nombre}</span>
                <span className="font-mono text-[10px] text-white/40 truncate">{c.puesto ? `${c.puesto} · ` : ""}{c.correo}</span>
                {datos.sugeridoId === c.contacto_id && (
                  <span className="ml-auto font-mono text-[8px] px-2 py-0.5 rounded-full bg-blue/20 border border-blue/30 text-blue-mid uppercase">Sugerido</span>
                )}
              </label>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[10px] text-white/40">Sin contactos con correo para esta empresa; escribe los correos abajo.</p>
        )}
        <input className={`${input} mt-2`} placeholder="Otros correos (separados por coma)" value={manual} onChange={(e) => setManual(e.target.value)} />
      </div>

      <input className={input} placeholder="Asunto" value={asunto} onChange={(e) => setAsunto(e.target.value)} />
      <textarea
        className={`${input} min-h-[90px]`}
        placeholder="Mensaje (vacío = plantilla estándar con propuesta adjunta y firma)"
        value={mensaje}
        onChange={(e) => setMensaje(e.target.value)}
      />
      <input className={input} placeholder="Teléfono para la firma (opcional)" value={telefono} onChange={(e) => setTelefono(e.target.value)} />

      {datos && datos.ccEquipo.length > 0 && (
        <p className="font-mono text-[10px] text-white/30">CC automático al equipo: {datos.ccEquipo.join(", ")}</p>
      )}
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button onClick={enviar} disabled={saving || totalSeleccion === 0} className={btnPrimary}>
          {saving ? "Enviando…" : "Enviar con PDF adjunto"}
        </button>
      </div>
    </div>
  );
}

// ── Generación de OT (con orden de compra o sin ella) ─────────────────────────

/**
 * Mismo formulario para las dos vías: cambian el campo de OC, el adjunto y el
 * endpoint. Responsable y áreas se piden igual porque la OT los necesita venga
 * de donde venga.
 */
function OcForm({
  cot,
  catalogos,
  onDone,
  sinOc = false,
}: {
  cot: Cot;
  catalogos: Catalogos | null;
  onDone: (msg: string) => void;
  sinOc?: boolean;
}) {
  const [oc, setOc] = useState("");
  const [responsable, setResponsable] = useState("");
  const [areas, setAreas] = useState<Set<string>>(new Set());
  const [adjunto, setAdjunto] = useState<{ filename: string; mimeType: string; base64: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * El cliente no siempre acepta la última versión: puede haberse mandado una
   * v1 posterior que no tomó. Se listan las que están en ENVIADA para poder
   * registrar la OC en la correcta.
   */
  const [enviadas, setEnviadas] = useState<Cot[] | null>(null);
  /**
   * Un fallo al cargar NO es lo mismo que "ninguna versión está en ENVIADA":
   * lo primero se reintenta, lo segundo significa que no hay nada que asignar.
   * Confundirlos dejaba un mensaje de negocio ante un problema de red.
   */
  const [errorVersiones, setErrorVersiones] = useState<string | null>(null);
  const [version, setVersion] = useState<number>(cot.version);

  useEffect(() => {
    let vigente = true;
    setEnviadas(null);
    setErrorVersiones(null);
    fetch(`/api/erp/cotizaciones/${key(cot)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "No se pudieron cargar las versiones");
        return d;
      })
      .then((d) => {
        if (!vigente) return;
        const todas: Cot[] = d.versiones ?? [];
        const candidatas = todas.filter((v) => v.estatus === "ENVIADA");
        setEnviadas(candidatas);
        // La vigente si está ENVIADA; si no, la más alta que sí lo esté.
        const preferida = candidatas.find((v) => v.version === cot.version) ?? candidatas[0];
        if (preferida) setVersion(preferida.version);
      })
      .catch((err) => {
        if (!vigente) return;
        setErrorVersiones(err instanceof Error ? err.message : "Error de red");
      });
    return () => {
      vigente = false;
    };
  }, [cot]);

  const elegida = enviadas?.find((v) => v.version === version);
  const cargandoVersiones = enviadas === null && !errorVersiones;

  function toggleArea(clave: string) {
    setAreas((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
      return next;
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setAdjunto(null); return; }
    if (file.size > 15 * 1024 * 1024) { setError("El archivo excede 15MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] ?? "";
      setAdjunto({ filename: file.name, mimeType: file.type || "application/octet-stream", base64 });
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/cotizaciones/${key(cot)}/${sinOc ? "ot" : "oc"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsableCorreo: responsable,
          areas: [...areas],
          version,
          ...(sinOc ? {} : { ordenCompra: oc, adjunto: adjunto ?? undefined }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      onDone(
        `OT ${data.folioOt} generada${data.avisos?.length ? ` · ${data.avisos.join(" · ")}` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {enviadas && enviadas.length > 1 && (
        <div>
          <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">
            Versión que aceptó el cliente *
          </p>
          <select
            className={input}
            value={version}
            onChange={(e) => setVersion(Number(e.target.value))}
          >
            {/* Sin prefijo de versión: el folio ya termina en ella */}
            {enviadas.map((v) => (
              <option key={v.version} value={v.version}>
                {v.folio} · {fmtFecha(v.fecha_solicitud)}
              </option>
            ))}
          </select>
          <p className="font-mono text-[9px] text-white/30 mt-1">
            Las demás se quedan en ENVIADA; no se cancelan.
          </p>
        </div>
      )}

      <p className="font-mono text-[10px] text-white/40">
        Folio OT que se generará: <span className="text-white font-bold">OT{String(cot.numero).padStart(3, "0")}{String(cot.anio % 100).padStart(2, "0")}{version}</span>
      </p>

      {cargandoVersiones && (
        <p className="font-mono text-[10px] text-white/40">Cargando versiones…</p>
      )}

      {errorVersiones && (
        <p className="font-mono text-[10px] text-red-400 bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
          {errorVersiones}. Cierra y vuelve a abrir para reintentar.
        </p>
      )}

      {enviadas && enviadas.length === 0 && (
        <p className="font-mono text-[10px] text-amber/80 bg-amber/10 border border-amber/20 rounded-lg px-3 py-2">
          Ninguna versión de esta cotización está en ENVIADA, así que no se puede generar la OT.
        </p>
      )}

      {elegida && elegida.version !== cot.version && (
        <p className="font-mono text-[10px] text-blue-mid bg-blue/10 border border-blue/20 rounded-lg px-3 py-2">
          Se registrará sobre {elegida.folio}, que no es la vigente ({cot.folio}).
        </p>
      )}
      {sinOc ? (
        <p className="font-mono text-[10px] text-amber/80 bg-amber/10 border border-amber/20 rounded-lg px-3 py-2">
          Se generará la OT sin orden de compra. La cotización queda ASIGNADA, y cuando el
          cliente emita la OC se captura con el botón <strong>Registrar OC</strong> de la
          tarjeta: se guarda en esta misma versión y en su orden de trabajo.
        </p>
      ) : (
        <input className={input} placeholder="No. de Orden de Compra *" value={oc} onChange={(e) => setOc(e.target.value)} />
      )}

      <div>
        <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Responsable de la actividad *</p>
        <select className={input} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
          <option value="">Seleccionar…</option>
          {(catalogos?.responsables ?? []).map((r) => (
            <option key={r.email} value={r.email}>{r.nombre} ({r.iniciales})</option>
          ))}
          {(catalogos?.responsablesSinIniciales ?? []).map((r) => (
            <option key={r.email} value={r.email} disabled>{r.nombre} — sin iniciales, no seleccionable</option>
          ))}
        </select>
        <p className="font-mono text-[10px] text-white/30 mt-1">Sin iniciales no puede cruzar con el control operativo.</p>
      </div>

      <div>
        <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Áreas * (las no seleccionadas van en CC)</p>
        <div className="flex flex-wrap gap-1.5">
          {(catalogos?.areas ?? []).map((a) => (
            <button
              key={a.clave}
              type="button"
              onClick={() => toggleArea(a.clave)}
              className={`font-mono text-[10px] px-3 py-1.5 rounded-full border transition-colors ${
                areas.has(a.clave)
                  ? "bg-blue/20 border-blue/40 text-blue-mid"
                  : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"
              }`}
            >
              {a.nombre}
            </button>
          ))}
        </div>
      </div>

      {!sinOc && (
        <div>
          <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Archivo de la OC (PDF/imagen, máx 15MB)</p>
          <input type="file" accept="application/pdf,image/*" onChange={onFile} className="font-mono text-xs text-white/60" />
        </div>
      )}

      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={
            saving ||
            (!sinOc && !oc.trim()) ||
            !responsable ||
            areas.size === 0 ||
            cargandoVersiones ||
            !!errorVersiones ||
            enviadas?.length === 0
          }
          className={btnPrimary}
        >
          {saving ? "Generando…" : sinOc ? "Generar OT sin OC" : "Generar OT"}
        </button>
      </div>
    </div>
  );
}
