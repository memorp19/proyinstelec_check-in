"use client";

import { useState } from "react";
import type { Empresa, Proyecto } from "@/src/lib/proyectos";
import type { DemoUser } from "@/src/demo";
import type { UserProfile } from "@/src/lib/users";
import { GRUPOS_PERMISOS } from "@/src/lib/permisos";

type UsuarioRow = (Pick<UserProfile, "id" | "email" | "nombre" | "rol" | "tipo" | "proyectos_asignados" | "created_at"> | DemoUser) & {
  permisos?: string[];
  iniciales?: string;
  gerencia?: string;
};

interface Props {
  empresas: Empresa[];
  proyectosIniciales: Proyecto[];
  esSuperAdmin: boolean;
  usuariosIniciales: UsuarioRow[];
}

type Tab = "empresas" | "proyectos" | "usuarios";

function formatFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(nombre: string) {
  return nombre
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ── Empresa form ──────────────────────────────────────────────────────────────

function CrearEmpresaForm({ onCreated }: { onCreated: (e: Empresa) => void }) {
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!nombre.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/empresas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear");
      onCreated(data.empresa);
      setNombre("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest">Nueva empresa cliente</p>
      <div className="flex gap-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre de la empresa"
          maxLength={80}
          className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue"
        />
        <button
          type="submit"
          disabled={saving || !nombre.trim()}
          className="bg-blue text-white font-mono text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40 active:scale-[0.97] transition-transform"
        >
          {saving ? "..." : "Crear"}
        </button>
      </div>
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
    </form>
  );
}

// ── Proyecto form ─────────────────────────────────────────────────────────────

function CrearProyectoForm({
  empresas,
  onCreated,
}: {
  empresas: Empresa[];
  onCreated: (p: Proyecto) => void;
}) {
  const [empresaId, setEmpresaId] = useState("");
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!empresaId || !nombre.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proyectos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa_id: empresaId, nombre: nombre.trim(), descripcion: descripcion.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear");
      onCreated(data.proyecto);
      setNombre("");
      setDescripcion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest">Nuevo proyecto</p>

      <select
        value={empresaId}
        onChange={(e) => setEmpresaId(e.target.value)}
        className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white outline-none focus:border-blue"
      >
        <option value="" className="bg-navy">Seleccionar empresa cliente…</option>
        {empresas.map((e) => (
          <option key={e.empresa_id} value={e.empresa_id} className="bg-navy">{e.nombre}</option>
        ))}
      </select>

      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nombre del proyecto"
        maxLength={80}
        className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue"
      />

      <input
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        placeholder="Descripción (opcional)"
        maxLength={200}
        className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue"
      />

      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] text-white/30">
          Se creará una carpeta en Google Drive automáticamente
        </p>
        <button
          type="submit"
          disabled={saving || !empresaId || !nombre.trim()}
          className="bg-blue text-white font-mono text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40 active:scale-[0.97] transition-transform"
        >
          {saving ? "Creando…" : "Crear proyecto"}
        </button>
      </div>

      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
    </form>
  );
}

// ── Editor ERP (permisos, iniciales, gerencia) ────────────────────────────────

function ErpEditor({
  usuario,
  onSaved,
  onClose,
}: {
  usuario: UsuarioRow;
  onSaved: (cambios: { permisos: string[]; iniciales: string; gerencia: string }) => void;
  onClose: () => void;
}) {
  const esAdmin = usuario.rol === "admin";
  const [permisos, setPermisos] = useState<string[]>(usuario.permisos ?? []);
  const [iniciales, setIniciales] = useState(usuario.iniciales ?? "");
  const [gerencia, setGerencia] = useState(usuario.gerencia ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePermiso(p: string) {
    setPermisos((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${usuario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "actualizar_erp",
          permisos,
          iniciales: iniciales.trim().toUpperCase() || null,
          gerencia: gerencia.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      onSaved({ permisos, iniciales: iniciales.trim().toUpperCase(), gerencia: gerencia.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">
            Iniciales (llave ERP)
          </p>
          <input
            value={iniciales}
            onChange={(e) => setIniciales(e.target.value.toUpperCase())}
            placeholder="EAOL"
            maxLength={5}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue uppercase"
          />
        </div>
        <div>
          <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">Gerencia</p>
          <input
            value={gerencia}
            onChange={(e) => setGerencia(e.target.value)}
            placeholder="Operación"
            maxLength={40}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue"
          />
        </div>
      </div>

      {esAdmin ? (
        <p className="font-mono text-[10px] text-purple-300/70 bg-purple-500/10 border border-purple-400/20 rounded-lg px-3 py-2">
          Los administradores tienen todos los permisos del ERP; no es necesario asignarlos.
        </p>
      ) : (
        <div className="space-y-2">
          {GRUPOS_PERMISOS.map((grupo) => (
            <div key={grupo.titulo}>
              <p className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1">
                {grupo.titulo}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {grupo.permisos.map((p) => {
                  const activo = permisos.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePermiso(p)}
                      className={`font-mono text-[9px] px-2 py-1 rounded-full border transition-colors ${
                        activo
                          ? "bg-blue/20 border-blue/40 text-blue-mid"
                          : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="font-mono text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="font-mono text-[10px] text-white/50 hover:text-white border border-white/10 rounded-lg px-3 py-1.5 transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="font-mono text-[10px] font-bold text-white bg-blue rounded-lg px-3 py-1.5 disabled:opacity-40 active:scale-[0.97] transition-transform"
        >
          {saving ? "Guardando…" : "Guardar ERP"}
        </button>
      </div>
    </div>
  );
}

// ── Usuarios tab ──────────────────────────────────────────────────────────────

type RolFilter = "todos" | "campo" | "admin" | "cliente";

function UsuariosTab({ usuariosIniciales }: { usuariosIniciales: UsuarioRow[] }) {
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>(usuariosIniciales);
  const [filtroRol, setFiltroRol] = useState<RolFilter>("todos");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [erpEditId, setErpEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtrados = filtroRol === "todos" ? usuarios : usuarios.filter((u) => u.rol === filtroRol);

  async function handleRolChange(u: UsuarioRow, accion: "promover" | "revocar") {
    setLoadingId(u.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al actualizar");

      setUsuarios((prev) =>
        prev.map((usr) => {
          if (usr.id !== u.id) return usr;
          if (accion === "promover") return { ...usr, rol: "admin" as const, tipo: "admin" as const };
          const tipo = u.email.endsWith("@proyinstelec.mx") ? ("planta" as const) : ("temporal" as const);
          return { ...usr, rol: "campo" as const, tipo };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoadingId(null);
    }
  }

  const SUPER_ADMIN_EMAIL = "soporteit@proyinstelec.mx";

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {(["todos", "campo", "admin", "cliente"] as RolFilter[]).map((f) => {
          const count = f === "todos" ? usuarios.length : usuarios.filter((u) => u.rol === f).length;
          return (
            <button
              key={f}
              onClick={() => setFiltroRol(f)}
              className={`font-mono text-[10px] px-3 py-1.5 rounded-lg capitalize transition-colors ${
                filtroRol === f
                  ? "bg-purple-500/30 border border-purple-400/40 text-purple-300 font-bold"
                  : "bg-white/10 border border-white/10 text-white/50 hover:text-white"
              }`}
            >
              {f === "todos" ? "Todos" : f === "campo" ? "Campo" : f === "admin" ? "Admins" : "Clientes"} ({count})
            </button>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-3">
          <p className="font-mono text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="space-y-2">
        {filtrados.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-6 text-center">
            <p className="font-mono text-sm text-white/40">Sin usuarios en esta categoría</p>
          </div>
        ) : (
          filtrados.map((u) => {
            const isSuper = u.email.toLowerCase() === SUPER_ADMIN_EMAIL;
            const isLoading = loadingId === u.id;
            return (
              <div key={u.id} className="bg-white/10 border border-white/10 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                {/* Avatar */}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-mono text-xs font-bold ${
                  u.rol === "admin" ? "bg-purple-500/30 text-purple-300" : u.rol === "cliente" ? "bg-green/20 text-green" : "bg-blue/20 text-blue-mid"
                }`}>
                  {initials(u.nombre)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-head text-sm font-bold text-white truncate">{u.nombre}</p>
                    {isSuper && (
                      <span className="font-mono text-[8px] px-2 py-0.5 rounded-full bg-purple-500/30 border border-purple-400/30 text-purple-300 uppercase tracking-widest">
                        Super Admin
                      </span>
                    )}
                    {u.rol === "admin" && !isSuper && (
                      <span className="font-mono text-[8px] px-2 py-0.5 rounded-full bg-blue/20 border border-blue/30 text-blue-mid uppercase tracking-widest">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-white/40 truncate">{u.email}</p>
                  <p className="font-mono text-[9px] text-white/25 mt-0.5">
                    {u.tipo} · {u.proyectos_asignados.length} {u.proyectos_asignados.length === 1 ? "proyecto" : "proyectos"} · desde {formatFecha(u.created_at)}
                    {u.iniciales ? ` · ${u.iniciales}` : ""}
                    {u.gerencia ? ` · ${u.gerencia}` : ""}
                  </p>
                </div>

                {/* Actions */}
                {!isSuper && (
                  <div className="shrink-0 flex gap-1.5">
                    <button
                      onClick={() => setErpEditId(erpEditId === u.id ? null : u.id)}
                      className={`font-mono text-[10px] rounded-lg px-3 py-1.5 border transition-colors ${
                        erpEditId === u.id
                          ? "text-white border-white/40"
                          : "text-white/50 hover:text-white border-white/10 hover:border-white/30"
                      }`}
                    >
                      ERP
                    </button>
                    {u.rol !== "admin" ? (
                      <button
                        onClick={() => handleRolChange(u, "promover")}
                        disabled={isLoading}
                        className="font-mono text-[10px] text-blue hover:text-white border border-blue/30 hover:border-white/30 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40"
                      >
                        {isLoading ? "…" : "Hacer Admin"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRolChange(u, "revocar")}
                        disabled={isLoading}
                        className="font-mono text-[10px] text-red-400 hover:text-red-300 border border-red-400/20 hover:border-red-300/30 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40"
                      >
                        {isLoading ? "…" : "Revocar Admin"}
                      </button>
                    )}
                  </div>
                )}
                </div>

                {erpEditId === u.id && !isSuper && (
                  <ErpEditor
                    usuario={u}
                    onClose={() => setErpEditId(null)}
                    onSaved={(cambios) =>
                      setUsuarios((prev) =>
                        prev.map((usr) =>
                          usr.id === u.id
                            ? {
                                ...usr,
                                permisos: cambios.permisos,
                                iniciales: cambios.iniciales || undefined,
                                gerencia: cambios.gerencia || undefined,
                              }
                            : usr,
                        ),
                      )
                    }
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AdminClient({ empresas: initialEmpresas, proyectosIniciales, esSuperAdmin, usuariosIniciales }: Props) {
  const [tab, setTab] = useState<Tab>("empresas");
  const [empresas, setEmpresas] = useState<Empresa[]>(initialEmpresas);
  const [proyectos, setProyectos] = useState<Proyecto[]>(proyectosIniciales);
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("");

  const proyectosFiltrados = filtroEmpresa
    ? proyectos.filter((p) => p.empresa_id === filtroEmpresa)
    : proyectos;

  const tabs: { key: Tab; label: string }[] = [
    { key: "empresas", label: `Empresas (${empresas.length})` },
    { key: "proyectos", label: `Proyectos (${proyectos.length})` },
    ...(esSuperAdmin ? [{ key: "usuarios" as Tab, label: `Usuarios (${usuariosIniciales.length})` }] : []),
  ];

  return (
    <main className="min-h-screen bg-navy flex flex-col">
      {/* Header */}
      <div className="px-5 pt-10 pb-4 border-b border-white/10">
        <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">Panel de administración</p>
        <p className="font-head text-2xl font-bold text-white">
          {esSuperAdmin ? "Gestión completa" : "Gestión de proyectos"}
        </p>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`font-mono text-xs px-4 py-2 rounded-lg transition-colors ${
                tab === t.key
                  ? t.key === "usuarios"
                    ? "bg-purple-500 text-white font-bold"
                    : "bg-blue text-white font-bold"
                  : "bg-white/10 text-white/50 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-5">
        {/* EMPRESAS TAB */}
        {tab === "empresas" && (
          <>
            <CrearEmpresaForm onCreated={(e) => setEmpresas((prev) => [...prev, e].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")))} />

            <div className="space-y-2">
              {empresas.length === 0 ? (
                <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-6 text-center">
                  <p className="font-mono text-sm text-white/40">Sin empresas registradas</p>
                </div>
              ) : (
                empresas.map((e) => {
                  const count = proyectos.filter((p) => p.empresa_id === e.empresa_id).length;
                  return (
                    <div key={e.empresa_id} className="bg-white/10 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue/30 rounded-lg flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#93b4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                          <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-head text-sm font-bold text-white truncate">{e.nombre}</p>
                        <p className="font-mono text-[10px] text-white/40">
                          {count} {count === 1 ? "proyecto" : "proyectos"} · Creada {formatFecha(e.created_at)}
                        </p>
                      </div>
                      <button
                        onClick={() => { setFiltroEmpresa(e.empresa_id); setTab("proyectos"); }}
                        className="shrink-0 font-mono text-xs text-blue hover:text-white transition-colors"
                      >
                        Ver →
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* PROYECTOS TAB */}
        {tab === "proyectos" && (
          <>
            <CrearProyectoForm
              empresas={empresas}
              onCreated={(p) => setProyectos((prev) => [...prev, p].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")))}
            />

            {empresas.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={filtroEmpresa}
                  onChange={(e) => setFiltroEmpresa(e.target.value)}
                  className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white outline-none"
                >
                  <option value="" className="bg-navy">Todas las empresas</option>
                  {empresas.map((e) => (
                    <option key={e.empresa_id} value={e.empresa_id} className="bg-navy">{e.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              {proyectosFiltrados.length === 0 ? (
                <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-6 text-center">
                  <p className="font-mono text-sm text-white/40">Sin proyectos registrados</p>
                </div>
              ) : (
                proyectosFiltrados.map((p) => (
                  <div key={p.proyecto_id} className="bg-white/10 border border-white/10 rounded-xl px-4 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-head text-sm font-bold text-white truncate">{p.nombre}</p>
                        <p className="font-mono text-[10px] text-white/40 mt-0.5">{p.empresa_nombre}</p>
                        {p.descripcion && (
                          <p className="font-mono text-xs text-white/50 mt-1">{p.descripcion}</p>
                        )}
                      </div>
                      <span className={`shrink-0 font-mono text-[9px] px-2 py-0.5 rounded-full border ${
                        p.estado === "activo"
                          ? "bg-green/20 border-green/30 text-green"
                          : "bg-white/10 border-white/20 text-white/40"
                      }`}>
                        {p.estado.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 text-white/30">
                        <span className="font-mono text-[10px]">
                          {p.usuarios_asignados.length} usuarios · {formatFecha(p.created_at)}
                        </span>
                      </div>
                      {p.drive_folder_url && (
                        <a
                          href={p.drive_folder_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 font-mono text-[10px] text-blue-mid hover:text-white transition-colors"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          Carpeta Drive
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* USUARIOS TAB (solo superAdmin) */}
        {tab === "usuarios" && esSuperAdmin && (
          <UsuariosTab usuariosIniciales={usuariosIniciales} />
        )}
      </div>
    </main>
  );
}
