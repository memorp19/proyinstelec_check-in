import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { MODULOS_ERP } from "./modulos";

export default async function ErpHome() {
  const session = await getServerSession(authOptions);
  const modulos = MODULOS_ERP.filter((m) => tienePermiso(session?.user, m.permiso));

  return (
    <div className="max-w-4xl">
      <h1 className="font-head text-2xl font-bold mb-1">ERP Proyinstelec</h1>
      <p className="text-white/50 text-sm mb-8">
        Cotizaciones, órdenes de trabajo y seguimiento semanal — en migración por fases desde el
        sistema anterior.
      </p>

      {modulos.length === 0 ? (
        <div className="rounded-xl bg-white/5 border border-white/10 p-8 text-center text-white/40">
          Tu cuenta aún no tiene módulos del ERP habilitados. Pide a un administrador que te asigne
          permisos.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {modulos.map((m) =>
            m.disponible ? (
              <a
                key={m.key}
                href={m.href}
                className="rounded-xl bg-white/10 border border-white/10 p-5 hover:border-blue/40 transition-colors block"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-head font-bold">{m.titulo}</h2>
                  <span className="rounded-full bg-green/20 border border-green/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-green whitespace-nowrap">
                    Activo
                  </span>
                </div>
                <p className="text-sm text-white/50 mt-2">{m.descripcion}</p>
                <p className="font-mono text-[10px] uppercase tracking-widest text-blue-mid mt-4">
                  Abrir →
                </p>
              </a>
            ) : (
              <div
                key={m.key}
                className="rounded-xl bg-white/10 border border-white/10 p-5 opacity-70"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-head font-bold">{m.titulo}</h2>
                  <span className="rounded-full bg-white/10 border border-white/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-white/50 whitespace-nowrap">
                    Fase {m.fase}
                  </span>
                </div>
                <p className="text-sm text-white/50 mt-2">{m.descripcion}</p>
                <p className="font-mono text-[10px] uppercase tracking-widest text-white/30 mt-4">
                  Próximamente
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
