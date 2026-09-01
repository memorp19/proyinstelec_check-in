"use client";

import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

type NavId = "inicio" | "perfil" | "admin" | "erp" | "hub";

const BASE_ITEMS: { id: NavId; href: string; label: string; exact?: boolean }[] = [
  { id: "inicio", href: "/app", label: "Inicio", exact: true },
  { id: "perfil", href: "/app/perfil", label: "Perfil" },
];

const ADMIN_ITEMS: { id: NavId; href: string; label: string; exact?: boolean }[] = [
  { id: "admin", href: "/admin", label: "Admin" },
  { id: "erp",   href: "/erp",   label: "ERP" },
  { id: "hub",   href: "/",      label: "Hub", exact: true },
];

function Icon({ id }: { id: NavId }) {
  if (id === "inicio")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    );
  if (id === "admin")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  if (id === "erp")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  if (id === "hub")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    );
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

const LogoutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export function NavBar({ isAdmin }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const items = isAdmin ? [...BASE_ITEMS, ...ADMIN_ITEMS] : BASE_ITEMS;

  return (
    /* Mobile-only bottom nav — desktop navigation is handled by AppHeader */
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-navy/95 backdrop-blur-sm border-t border-white/10 flex"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {items.map((item) => {
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
      <button
        onClick={() => signOut({ callbackUrl: "/unirse" })}
        className="flex-1 flex flex-col items-center gap-1 py-3 min-h-[56px] text-white/40 transition-opacity active:opacity-60"
      >
        <LogoutIcon />
        <span className="font-mono text-[10px] uppercase tracking-wider">Salir</span>
      </button>
    </nav>
  );
}
