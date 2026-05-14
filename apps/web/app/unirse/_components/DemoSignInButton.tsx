"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";

export function DemoSignInButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    await signIn("demo", { callbackUrl: "/app" });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-white/10" />
        <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">o</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2.5
                   h-12 rounded-xl
                   bg-amber/10 hover:bg-amber/20 active:bg-amber/25
                   border border-amber/30
                   text-amber font-mono text-sm font-medium
                   transition-colors duration-150
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="31.4" strokeDashoffset="10" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        )}
        Explorar modo demo
      </button>

      <p className="text-center font-mono text-[10px] text-white/20 leading-relaxed">
        Datos simulados · Sin conexión a servicios reales
      </p>
    </div>
  );
}
