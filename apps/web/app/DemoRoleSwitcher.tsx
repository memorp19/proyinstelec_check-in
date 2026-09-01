"use client";

import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { DEMO_PRESETS, type DemoRole } from "@/src/demo";

const ROLES: { key: DemoRole; dot: string }[] = [
  { key: "user",       dot: "bg-amber" },
  { key: "admin",      dot: "bg-blue" },
  { key: "superAdmin", dot: "bg-purple-500" },
  { key: "guest",      dot: "bg-green" },
];

function currentRoleKey(userId: string | undefined): DemoRole {
  if (!userId) return "user";
  const found = Object.entries(DEMO_PRESETS).find(([, p]) => p.id === userId);
  return (found?.[0] as DemoRole) ?? "user";
}

export function DemoRoleSwitcher() {
  const { data: session } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const activeKey = currentRoleKey(session?.user?.id);
  const activePreset = DEMO_PRESETS[activeKey];

  async function handleSwitch(key: DemoRole) {
    if (key === activeKey || switching) return;
    setOpen(false);
    setSwitching(true);
    const preset = DEMO_PRESETS[key];
    await signOut({ redirect: false });
    await signIn("demo", { demoRole: key, redirect: false });
    router.push(preset.route);
    router.refresh();
    setSwitching(false);
  }

  return (
    <div className="fixed bottom-5 left-4 z-50 select-none">
      {/* Role menu (above button) */}
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-72 bg-[#0d1f3c] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <p className="font-mono text-[9px] text-white/30 uppercase tracking-widest px-4 pt-3 pb-2">
            Cambiar rol de prueba
          </p>
          {ROLES.map(({ key, dot }) => {
            const p = DEMO_PRESETS[key];
            const isActive = key === activeKey;
            return (
              <button
                key={key}
                onClick={() => handleSwitch(key)}
                disabled={isActive}
                className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                  isActive
                    ? "bg-white/10 cursor-default"
                    : "hover:bg-white/5 active:bg-white/10"
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-mono text-xs font-bold text-white">{p.label}</p>
                  <p className="font-mono text-[10px] text-white/40 truncate">{p.descripcion}</p>
                </div>
                {isActive && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#93b4ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
          <div className="px-4 py-2 border-t border-white/10">
            <p className="font-mono text-[9px] text-white/20">
              Datos simulados · Sin conexión real
            </p>
          </div>
        </div>
      )}

      {/* Floating pill button */}
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className="flex items-center gap-2 bg-[#0d1f3c] border border-white/15 rounded-xl px-3 py-2 shadow-lg active:scale-95 transition-transform"
      >
        {switching ? (
          <div className="w-2 h-2 rounded-full border border-white/40 border-t-white animate-spin" />
        ) : (
          <span className={`w-2 h-2 rounded-full shrink-0 ${ROLES.find((r) => r.key === activeKey)?.dot ?? "bg-white/40"}`} />
        )}
        <span className="font-mono text-[10px] text-white/70 font-bold uppercase tracking-widest">
          DEMO
        </span>
        <span className="font-mono text-[10px] text-white/40">
          {switching ? "cambiando…" : activePreset.label}
        </span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.3)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </div>
  );
}
