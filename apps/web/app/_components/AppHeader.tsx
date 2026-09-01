import Link from "next/link";
import { auth } from "@/src/auth";
import { SectionTabs } from "./SectionTabs";
import { UserMenu } from "./UserMenu";

const ALL_SECTIONS = [
  { href: "/app",     label: "App",     prefix: "/app" },
  { href: "/admin",   label: "Admin",   prefix: "/admin" },
  { href: "/erp",     label: "ERP",     prefix: "/erp" },
  { href: "/cliente", label: "Cliente", prefix: "/cliente" },
];

export async function AppHeader() {
  const session = await auth();
  if (!session) return null;

  const isAdmin = session.user.rol === "admin";

  return (
    <header className="fixed top-0 inset-x-0 z-50 h-[52px] bg-navy/95 backdrop-blur-sm border-b border-white/10 flex items-center px-4 gap-3">
      {/* Logo — links to hub for admin, /app for campo */}
      <Link
        href={isAdmin ? "/" : "/app"}
        className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
      >
        <div className="w-7 h-7 bg-blue rounded-lg flex items-center justify-center shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <span className="font-head font-bold text-sm text-white hidden sm:block tracking-wide">
          PROYINSTELEC
        </span>
      </Link>

      {isAdmin && <div className="w-px h-5 bg-white/15 hidden md:block" />}

      {isAdmin && <SectionTabs sections={ALL_SECTIONS} />}

      <div className="flex-1" />

      <UserMenu
        name={session.user.name ?? session.user.email ?? "Usuario"}
        email={session.user.email ?? ""}
      />
    </header>
  );
}
