import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { signOut } from "@/src/auth";

const SECTIONS = [
  { href: "/app",     label: "App",     desc: "Check-in / Check-out de campo" },
  { href: "/admin",   label: "Admin",   desc: "Proyectos, empresas y usuarios" },
  { href: "/erp",     label: "ERP",     desc: "Cotizaciones y órdenes de trabajo" },
  { href: "/cliente", label: "Cliente", desc: "Portal de seguimiento" },
] as const;

export default async function Home() {
  const session = await auth();

  if (!session) redirect("/unirse");

  const isAdmin = session.user.rol === "admin";

  if (!isAdmin) {
    if (session.user.rol === "cliente") redirect("/cliente");
    redirect("/app");
  }

  const name = session.user.name?.split(" ")[0] ?? session.user.email;

  return (
    <main className="min-h-screen bg-navy text-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8">
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">
            Proyinstelec
          </p>
          <h1 className="font-head text-4xl font-bold leading-tight">Hola, {name}</h1>
          <p className="font-mono text-xs text-white/40 mt-1">{session.user.email}</p>
        </div>

        {/* Section grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="bg-white/10 border border-white/10 rounded-xl p-5 hover:border-blue/50 hover:bg-white/[0.13] transition-colors group"
            >
              <p className="font-head text-xl font-bold group-hover:text-blue transition-colors">
                {s.label}
              </p>
              <p className="font-mono text-xs text-white/40 mt-1">{s.desc}</p>
            </Link>
          ))}
        </div>

        {/* Sign out */}
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/unirse" });
          }}
        >
          <button
            type="submit"
            className="font-mono text-xs text-white/30 hover:text-white/60 transition-colors flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
