"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = name.charAt(0).toUpperCase();

  useEffect(() => {
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-full bg-blue flex items-center justify-center font-head font-bold text-sm text-white shrink-0 hover:bg-blue-mid transition-colors active:scale-95"
        aria-label="Menú de usuario"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-[#0f1e3a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="font-head text-sm font-bold text-white truncate">{name}</p>
            <p className="font-mono text-[10px] text-white/40 truncate mt-0.5">{email}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/unirse" })}
            className="w-full text-left px-4 py-3 font-mono text-sm text-white/70 hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
