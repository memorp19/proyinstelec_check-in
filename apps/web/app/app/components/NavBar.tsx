"use client";

import { usePathname, useRouter } from "next/navigation";

type NavId = "inicio" | "perfil";

const ITEMS: { id: NavId; href: string; label: string; exact?: boolean }[] = [
  { id: "inicio", href: "/app", label: "Inicio", exact: true },
  { id: "perfil", href: "/app/perfil", label: "Perfil" },
];

function Icon({ id }: { id: NavId }) {
  if (id === "inicio")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    );
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {/* Mobile — fixed bottom bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-navy/95 backdrop-blur-sm border-t border-white/10 flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {ITEMS.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <button
              key={item.id}
              onClick={() => router.push(item.href)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 min-h-[56px] transition-opacity active:opacity-60 ${
                active ? "text-blue" : "text-white/40"
              }`}
            >
              <Icon id={item.id} />
              <span className="font-mono text-[10px] uppercase tracking-wider">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Desktop — fixed left sidebar */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 w-[72px] z-40 bg-navy/95 backdrop-blur-sm border-r border-white/10 items-center py-6 gap-1">
        {/* Brand mark */}
        <div className="mb-6 w-10 h-10 bg-blue rounded-xl flex items-center justify-center shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        {ITEMS.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <button
              key={item.id}
              onClick={() => router.push(item.href)}
              title={item.label}
              className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${
                active
                  ? "bg-blue/20 text-blue"
                  : "text-white/40 hover:bg-white/10 hover:text-white/70"
              }`}
            >
              <Icon id={item.id} />
              <span className="font-mono text-[8px] uppercase tracking-wider leading-none">{item.label}</span>
            </button>
          );
        })}
      </aside>
    </>
  );
}
