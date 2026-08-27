import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authOptions } from "@/src/auth";
import { permisosEfectivos, tienePermiso } from "@/src/lib/permisos";
import { MODULOS_ERP } from "./modulos";

export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/unirse?callbackUrl=/erp");

  const permisos = permisosEfectivos(session.user);
  if (permisos.length === 0) redirect("/acceso-denegado");

  const modulosVisibles = MODULOS_ERP.filter((m) => tienePermiso(session.user, m.permiso));

  return (
    <div className="min-h-screen bg-navy text-white flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-white/10 p-4 gap-1">
        <Link href="/erp" className="mb-4 block">
          <span className="font-head font-bold text-lg">PROYINSTELEC</span>
          <span className="block font-mono text-[10px] uppercase tracking-widest text-white/40">
            ERP
          </span>
        </Link>

        <Link
          href="/erp"
          className="rounded-lg px-3 py-2 text-sm bg-white/10 border border-white/10"
        >
          Inicio
        </Link>

        {modulosVisibles.map((m) =>
          m.disponible ? (
            <Link
              key={m.key}
              href={m.href}
              className="rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              {m.titulo}
            </Link>
          ) : (
            <span
              key={m.key}
              className="rounded-lg px-3 py-2 text-sm text-white/40 cursor-not-allowed flex items-center justify-between"
              title={`Disponible en la Fase ${m.fase}`}
            >
              {m.titulo}
              <span className="font-mono text-[9px] uppercase tracking-widest text-white/25">
                F{m.fase}
              </span>
            </span>
          ),
        )}

        {tienePermiso(session.user, "cotizaciones.aprobar") && (
          <Link
            href="/erp/revision"
            className="rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            Revisión
          </Link>
        )}

        <div className="mt-auto pt-4 border-t border-white/10">
          <p className="text-xs text-white/60 truncate">{session.user.name}</p>
          <p className="font-mono text-[10px] text-white/30 truncate">{session.user.email}</p>
        </div>
      </aside>

      {/* Contenido */}
      <main className="flex-1 min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
