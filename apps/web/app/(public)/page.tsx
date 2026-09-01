import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/src/auth";

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

  const firstName = session.user.name?.split(" ")[0] ?? session.user.email;

  return (
    <main className="min-h-screen bg-navy text-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">
            Proyinstelec
          </p>
          <h1 className="font-head text-4xl font-bold leading-tight">Hola, {firstName}</h1>
          <p className="font-mono text-xs text-white/40 mt-1">{session.user.email}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      </div>
    </main>
  );
}
