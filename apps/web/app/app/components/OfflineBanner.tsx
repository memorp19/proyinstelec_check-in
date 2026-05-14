"use client";

import { useEffect, useState } from "react";
import { countPending } from "@/src/lib/idb";

export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setOnline(navigator.onLine);

    const updatePending = async () => setPending(await countPending());
    updatePending();

    const onOnline = () => { setOnline(true); updatePending(); };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online && pending === 0) return null;

  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 font-mono text-xs ${
        online
          ? "border border-blue/20 bg-blue-light text-blue-dark"
          : "border border-amber/40 bg-amber/10 text-amber"
      }`}
    >
      {online ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 6s4-2 11-2 11 2 11 2" /><path d="M5 10.5S7.5 9 12 9s7 1.5 7 1.5" />
          <path d="M10.7 13.4C11.1 13.1 11.5 13 12 13s.9.1 1.3.4" /><line x1="12" y1="17" x2="12.01" y2="17" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
      )}
      <span>
        {online
          ? `Sincronizando ${pending} registro${pending !== 1 ? "s" : ""}…`
          : `Sin conexión · ${pending} pendiente${pending !== 1 ? "s" : ""} · se sincronizará al volver`}
      </span>
    </div>
  );
}
