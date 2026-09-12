"use client";

import { useCallback, useEffect, useState } from "react";

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
  | { tipo: "enviar"; cot: Cot }
  | { tipo: "oc"; cot: Cot }
  | { tipo: "ot-sin-oc"; cot: Cot }
  | null;

const key = (c: Cot) => `${String(c.numero).padStart(3, "0")}-${c.anio}`;

const BADGE: Record<string, string> = {
  PROCESO: "bg-amber-500/20 border-amber-400/30 text-amber-300",
  REVISION: "bg-blue/20 border-blue/30 text-blue-mid",
  ENVIADA: "bg-purple-500/20 border-purple-400/30 text-purple-300",
  ASIGNADA: "bg-green/20 border-green/30 text-green",
  CANCELADA: "bg-red-500/20 border-red-400/30 text-red-400",
};
const badge = (e: string) => BADGE[e] ?? "bg-white/10 border-white/20 text-white/50";

const input =
  "w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue";
const btnPrimary =
  "bg-blue text-white font-mono text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40 active:scale-[0.97] transition-transform";
const btnGhost =
  "font-mono text-[10px] text-white/50 hover:text-white border border-white/10 hover:border-white/30 rounded-lg px-3 py-1.5 transition-colors";

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
}: {
  puedeEnviar: boolean;
  puedeCrearOT: boolean;
}) {
  const anioActual = new Date().getFullYear();
  const [tab, setTab] = useState<"buscar" | "nueva">("buscar");
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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
        <div className="mb-4 bg-amber-500/10 border border-amber-400/20 rounded-xl px-4 py-3 flex justify-between gap-3">
          <p className="font-mono text-xs text-amber-300">{aviso}</p>
          <button onClick={() => setAviso(null)} className="font-mono text-xs text-white/40">✕</button>
        </div>
      )}

      {tab === "buscar" && (
        <Buscador
          anioActual={anioActual}
          catalogos={catalogos}
          puedeEnviar={puedeEnviar}
          puedeCrearOT={puedeCrearOT}
          abrirModal={setModal}
          setAviso={setAviso}
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
            <EditarForm cot={modal.cot} catalogos={catalogos} onDone={() => setModal(null)} />
          )}
          {modal.tipo === "version" && (
            <NuevaVersionForm cot={modal.cot} onDone={(msg) => { setAviso(msg); setModal(null); }} />
          )}
          {modal.tipo === "versiones" && <Versiones cot={modal.cot} />}
          {modal.tipo === "enviar" && (
            <EnviarForm cot={modal.cot} onDone={(msg) => { setAviso(msg); setModal(null); }} />
          )}
          {modal.tipo === "oc" && (
            <OcForm cot={modal.cot} catalogos={catalogos} onDone={(msg) => { setAviso(msg); setModal(null); }} />
          )}
          {modal.tipo === "ot-sin-oc" && (
            <OcForm sinOc cot={modal.cot} catalogos={catalogos} onDone={(msg) => { setAviso(msg); setModal(null); }} />
          )}
        </ModalShell>
      )}
    </div>
  );
}

function tituloModal(m: NonNullable<Modal>) {
  const t = {
    editar: "Editar",
    version: "Nueva versión",
    versiones: "Versiones",
    enviar: "Enviar al cliente",
    oc: "Ingresar OC → Generar OT",
    "ot-sin-oc": "Generar OT sin OC",
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
  abrirModal,
  setAviso,
}: {
  anioActual: number;
  catalogos: Catalogos | null;
  puedeEnviar: boolean;
  puedeCrearOT: boolean;
  abrirModal: (m: Modal) => void;
  setAviso: (s: string) => void;
}) {
  const [filtros, setFiltros] = useState({
    anio: String(anioActual), empresa: "", numero: "", elaboro: "", dirigidaA: "", estatus: "", mesEntrega: "", ot: "", oc: "",
  });
  const [resultados, setResultados] = useState<Cot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviandoRevision, setEnviandoRevision] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => v && params.set(k, v));
      const res = await fetch(`/api/erp/cotizaciones?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al buscar");
      setResultados(data.cotizaciones);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => { buscar(); }, []); // carga inicial

  async function enviarARevision(c: Cot) {
    if (!confirm(`¿Enviar ${c.folio} a revisión? Se avisará a los revisores por correo.`)) return;
    setEnviandoRevision(key(c));
    try {
      const res = await fetch(`/api/erp/cotizaciones/${key(c)}/revision`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setAviso(data.avisos?.length ? data.avisos.join(" · ") : `${c.folio} enviada a revisión`);
      buscar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setEnviandoRevision(null);
    }
  }

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
        <select className={input} value={filtros.estatus} onChange={set("estatus")}>
          <option value="" className="bg-navy">Estatus (todos)</option>
          {(catalogos?.estatus ?? []).map((s) => <option key={s} value={s} className="bg-navy">{s}</option>)}
        </select>
        <select className={input} value={filtros.mesEntrega} onChange={set("mesEntrega")}>
          <option value="" className="bg-navy">Mes entrega</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1} className="bg-navy">
              {new Date(2026, i, 1).toLocaleDateString("es-MX", { month: "long" })}
            </option>
          ))}
        </select>
        <input className={input} placeholder="OT interna" value={filtros.ot} onChange={set("ot")} />
        <input className={input} placeholder="Orden de compra" value={filtros.oc} onChange={set("oc")} />
        <select className={input} value={filtros.anio} onChange={set("anio")}>
          {[anioActual, anioActual - 1, anioActual - 2].map((a) => (
            <option key={a} value={a} className="bg-navy">{a}</option>
          ))}
        </select>
        <button type="submit" disabled={loading} className={`${btnPrimary} col-span-2 md:col-span-3`}>
          {loading ? "Buscando…" : "Buscar"}
        </button>
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
          resultados.map((c) => (
            <div key={key(c)} className="bg-white/10 border border-white/10 rounded-xl px-4 py-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-head text-sm font-bold text-white">{c.folio}</p>
                    <span className={`font-mono text-[9px] px-2 py-0.5 rounded-full border ${badge(c.estatus)}`}>
                      {c.estatus}
                    </span>
                    {c.estatus === "REVISION" && !c.aprobada && (
                      <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white/50">
                        Esperando aprobación del revisor
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-white/60 mt-1 truncate">{c.cliente} · {c.titulo}</p>
                  <p className="font-mono text-[10px] text-white/35 mt-1">
                    Dirigida: {c.dirigida_a} · Elaboró: {c.elaboro} · Entrega: {fmtFecha(c.fecha_entrega)}
                    {c.folio_ot ? ` · OT ${c.folio_ot}` : ""}{c.orden_compra ? ` · OC ${c.orden_compra}` : ""}
                  </p>
                  <div className="mt-1.5">
                    <Montos cot={c} />
                  </div>
                </div>

                {/* Acción principal según estado (regla del legacy) */}
                <div className="shrink-0">
                  {c.estatus === "PROCESO" && (
                    <button
                      onClick={() => enviarARevision(c)}
                      disabled={enviandoRevision === key(c)}
                      className="font-mono text-[10px] font-bold text-white bg-blue rounded-lg px-3 py-1.5 disabled:opacity-40 active:scale-[0.97] transition-transform"
                    >
                      {enviandoRevision === key(c) ? "…" : "Enviar a Revisión"}
                    </button>
                  )}
                  {c.estatus === "REVISION" && c.aprobada && puedeEnviar && (
                    <button onClick={() => abrirModal({ tipo: "enviar", cot: c })} className="font-mono text-[10px] font-bold text-white bg-green/80 rounded-lg px-3 py-1.5 active:scale-[0.97] transition-transform">
                      Enviar al Cliente
                    </button>
                  )}
                  {c.estatus === "ENVIADA" && !c.folio_ot && puedeCrearOT && (
                    <>
                      <button onClick={() => abrirModal({ tipo: "oc", cot: c })} className="font-mono text-[10px] font-bold text-navy bg-amber-400 rounded-lg px-3 py-1.5 active:scale-[0.97] transition-transform">
                        Ingresar OC
                      </button>
                      {/* El cliente puede aceptar sin emitir OC; la OT se genera igual */}
                      <button onClick={() => abrirModal({ tipo: "ot-sin-oc", cot: c })} className={`${btnGhost} ml-1.5`}>
                        Generar OT sin OC
                      </button>
                    </>
                  )}
                  {c.estatus === "ENVIADA" && puedeEnviar && (
                    <button onClick={() => abrirModal({ tipo: "enviar", cot: c })} className={`${btnGhost} ml-1.5`}>
                      Reenviar
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-1.5 flex-wrap">
                <button onClick={() => abrirModal({ tipo: "editar", cot: c })} className={btnGhost}>Editar</button>
                <button onClick={() => abrirModal({ tipo: "version", cot: c })} className={btnGhost}>Nueva Versión</button>
                <button onClick={() => abrirModal({ tipo: "versiones", cot: c })} className={btnGhost}>Versiones</button>
                {c.drive_folder_url && (
                  <a href={c.drive_folder_url} target="_blank" rel="noopener noreferrer" className={btnGhost}>
                    Ver Carpeta
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>
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
            <option key={p} value={p} className="bg-navy">{p}</option>
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
          {(catalogos?.prioridades ?? ["BAJA", "MEDIA", "ALTA"]).map((p) => <option key={p} value={p} className="bg-navy">{p}</option>)}
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
          <option value="" className="bg-navy">Sin cambio ({cot.estatus})</option>
          {["PROCESO", "DEPENDIENTE PROVEEDOR", "DEPENDIENTE CLIENTE", "CANCELADA"].map((s) => (
            <option key={s} value={s} className="bg-navy">{s}</option>
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
      onDone(`Versión ${data.cotizacion.version} creada (${data.cotizacion.folio})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs text-white/60">
        Se creará la versión {cot.version + 1} en PROCESO, heredando cliente y título. La versión actual
        deja de contar en el buscador y el dashboard; se copian de nuevo las plantillas a la misma carpeta.
      </p>
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button onClick={crear} disabled={saving} className={btnPrimary}>
          {saving ? "Creando…" : `Crear versión ${cot.version + 1}`}
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
            <p className="font-mono text-xs text-white font-bold">{v.folio} <span className="text-white/40">v{v.version}</span></p>
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
    return <p className="font-mono text-xs text-amber-300">{datos.motivo ?? "No puede enviarse todavía"}</p>;
  }

  const totalSeleccion = seleccion.size + manual.split(",").filter((s) => s.trim()).length;

  return (
    <div className="space-y-3">
      {datos && !datos.pdfDisponible && (
        <p className="font-mono text-[10px] text-amber-300 bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2">
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
      <p className="font-mono text-[10px] text-white/40">
        Folio OT que se generará: <span className="text-white font-bold">OT{String(cot.numero).padStart(3, "0")}{String(cot.anio % 100).padStart(2, "0")}{cot.version}</span>
      </p>
      {sinOc ? (
        <p className="font-mono text-[10px] text-amber-300/80 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          Se generará la OT sin orden de compra. La cotización queda ASIGNADA y la OC puede
          capturarse después, cuando el cliente la emita.
        </p>
      ) : (
        <input className={input} placeholder="No. de Orden de Compra *" value={oc} onChange={(e) => setOc(e.target.value)} />
      )}

      <div>
        <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Responsable de la actividad *</p>
        <select className={input} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
          <option value="" className="bg-navy">Seleccionar…</option>
          {(catalogos?.responsables ?? []).map((r) => (
            <option key={r.email} value={r.email} className="bg-navy">{r.nombre} ({r.iniciales})</option>
          ))}
          {(catalogos?.responsablesSinIniciales ?? []).map((r) => (
            <option key={r.email} value={r.email} disabled className="bg-navy">{r.nombre} — sin iniciales, no seleccionable</option>
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
          disabled={saving || (!sinOc && !oc.trim()) || !responsable || areas.size === 0}
          className={btnPrimary}
        >
          {saving ? "Generando…" : sinOc ? "Generar OT sin OC" : "Generar OT"}
        </button>
      </div>
    </div>
  );
}
