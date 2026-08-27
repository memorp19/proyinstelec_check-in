"use client";

import { useCallback, useEffect, useState } from "react";

interface Contacto {
  contacto_id: string;
  nombre: string;
  puesto?: string;
  telefono?: string;
  correo?: string;
}

interface Empresa {
  cliente_id: string;
  razon_social: string;
  direccion?: string;
  contactos: Contacto[];
}

const input =
  "w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue";
const btnPrimary =
  "bg-blue text-white font-mono text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40 active:scale-[0.97] transition-transform";
const btnGhost =
  "font-mono text-[10px] text-white/50 hover:text-white border border-white/10 hover:border-white/30 rounded-lg px-3 py-1.5 transition-colors";

export function ClientesClient() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [buscar, setBuscar] = useState("");
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [editando, setEditando] = useState<{ empresa: Empresa; contacto: Contacto } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/erp/clientes${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setEmpresas(data.clientes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }, [buscar]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="max-w-4xl">
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">ERP · Clientes</p>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="font-head text-2xl font-bold">Clientes</h1>
        <button onClick={() => setMostrarAlta((v) => !v)} className={btnPrimary}>
          {mostrarAlta ? "Cerrar" : "Nuevo cliente"}
        </button>
      </div>

      {mostrarAlta && (
        <AltaCliente
          onCreado={() => { setMostrarAlta(false); cargar(); }}
        />
      )}

      <input
        className={`${input} mb-4`}
        placeholder="Buscar por razón social o contacto…"
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
      />

      {error && <p className="font-mono text-xs text-red-400 mb-3">{error}</p>}

      <div className="space-y-2">
        {empresas.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-6 text-center">
            <p className="font-mono text-sm text-white/40">Sin clientes registrados</p>
          </div>
        ) : (
          empresas.map((e) => (
            <div key={e.cliente_id} className="bg-white/10 border border-white/10 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-head text-sm font-bold text-white truncate">{e.razon_social}</p>
                  {e.direccion && <p className="font-mono text-[10px] text-white/40 truncate">{e.direccion}</p>}
                </div>
                <span className="shrink-0 font-mono text-[9px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white/50">
                  {e.contactos.length} {e.contactos.length === 1 ? "contacto" : "contactos"}
                </span>
              </div>
              {e.contactos.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                  {e.contactos.map((c) => (
                    <div key={c.contacto_id} className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono text-xs text-white/80">{c.nombre}</p>
                      <p className="font-mono text-[10px] text-white/40 truncate">
                        {[c.puesto, c.telefono, c.correo].filter(Boolean).join(" · ")}
                      </p>
                      <button onClick={() => setEditando({ empresa: e, contacto: c })} className={`${btnGhost} ml-auto`}>
                        Editar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {editando && (
        <EditarContacto
          empresa={editando.empresa}
          contacto={editando.contacto}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); cargar(); }}
        />
      )}
    </div>
  );
}

// ── Alta con verificación de empresa existente (regla del legacy) ─────────────

function AltaCliente({ onCreado }: { onCreado: () => void }) {
  const [form, setForm] = useState({ razonSocial: "", direccion: "", nombre: "", puesto: "", telefono: "", correo: "" });
  const [candidatos, setCandidatos] = useState<Array<{ cliente_id: string; razon_social: string; direccion?: string; match: string }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  async function submit(extra?: { usarEmpresaId?: string; confirmarNueva?: boolean }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/erp/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razonSocial: form.razonSocial,
          direccion: form.direccion || undefined,
          contacto: { nombre: form.nombre, puesto: form.puesto, telefono: form.telefono, correo: form.correo },
          ...extra,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.candidatos) {
        setCandidatos(data.candidatos);
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Error al crear");
      onCreado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setSaving(false);
    }
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3 mb-4">
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest">Nuevo cliente</p>
      <input className={input} placeholder="Razón social *" value={form.razonSocial} onChange={set("razonSocial")} />
      <input className={input} placeholder="Dirección" value={form.direccion} onChange={set("direccion")} />
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="Contacto *" value={form.nombre} onChange={set("nombre")} />
        <input className={input} placeholder="Puesto" value={form.puesto} onChange={set("puesto")} />
        <input className={input} placeholder="Teléfono" value={form.telefono} onChange={set("telefono")} />
        <input className={input} placeholder="Correo" value={form.correo} onChange={set("correo")} type="email" />
      </div>

      {candidatos && (
        <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl p-3 space-y-2">
          <p className="font-mono text-xs text-amber-300">
            Hay empresas con nombre parecido. ¿El contacto pertenece a alguna de estas?
          </p>
          {candidatos.map((c) => (
            <button
              key={c.cliente_id}
              onClick={() => submit({ usarEmpresaId: c.cliente_id })}
              className="w-full text-left bg-white/5 border border-white/10 rounded-lg px-3 py-2 hover:border-blue/40 transition-colors"
            >
              <p className="font-mono text-xs text-white">{c.razon_social}</p>
              {c.direccion && <p className="font-mono text-[10px] text-white/40">{c.direccion}</p>}
            </button>
          ))}
          <button onClick={() => submit({ confirmarNueva: true })} className={btnGhost}>
            No, crear empresa nueva de todos modos
          </button>
        </div>
      )}

      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={() => submit()}
          disabled={saving || !form.razonSocial.trim() || !form.nombre.trim()}
          className={btnPrimary}
        >
          {saving ? "Guardando…" : "Guardar cliente"}
        </button>
      </div>
    </div>
  );
}

// ── Edición de contacto (solo puesto/teléfono/correo) + eliminar ──────────────

function EditarContacto({
  empresa,
  contacto,
  onClose,
  onSaved,
}: {
  empresa: Empresa;
  contacto: Contacto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    puesto: contacto.puesto ?? "",
    telefono: contacto.telefono ?? "",
    correo: contacto.correo ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/clientes/${empresa.cliente_id}/contactos/${contacto.contacto_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          puesto: form.puesto || null,
          telefono: form.telefono || null,
          correo: form.correo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setSaving(false);
    }
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar el contacto ${contacto.nombre}?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/erp/clientes/${empresa.cliente_id}/contactos/${contacto.contacto_id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-navy border border-white/20 rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-head font-bold text-white">{contacto.nombre}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white font-mono">✕</button>
        </div>
        <p className="font-mono text-[10px] text-white/40 mb-4">{empresa.razon_social} — el nombre y la dirección no se editan aquí</p>
        <div className="space-y-2">
          <input className={input} placeholder="Puesto" value={form.puesto} onChange={(e) => setForm((p) => ({ ...p, puesto: e.target.value }))} />
          <input className={input} placeholder="Teléfono" value={form.telefono} onChange={(e) => setForm((p) => ({ ...p, telefono: e.target.value }))} />
          <input className={input} placeholder="Correo" type="email" value={form.correo} onChange={(e) => setForm((p) => ({ ...p, correo: e.target.value }))} />
        </div>
        {error && <p className="font-mono text-xs text-red-400 mt-2">{error}</p>}
        <div className="flex justify-between mt-4">
          <button onClick={eliminar} disabled={saving} className="font-mono text-[10px] text-red-400 hover:text-red-300 border border-red-400/20 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40">
            Eliminar contacto
          </button>
          <button onClick={guardar} disabled={saving} className={btnPrimary}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
