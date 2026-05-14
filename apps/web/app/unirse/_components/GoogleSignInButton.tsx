"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

interface Props {
  callbackUrl: string;
  pendingToken?: string;
}

export function GoogleSignInButton({ callbackUrl, pendingToken }: Props) {
  const [loading, setLoading] = useState(false);

  const handleSignIn = () => {
    setLoading(true);
    const url = pendingToken
      ? `${callbackUrl}?pending_token=${pendingToken}`
      : callbackUrl;
    signIn("google", { callbackUrl: url });
  };

  return (
    <button
      onClick={handleSignIn}
      disabled={loading}
      className="group w-full min-h-[52px] relative overflow-hidden
                 bg-white/[0.07] hover:bg-white/[0.12]
                 border border-white/[0.12] hover:border-white/[0.28]
                 text-white font-body font-medium text-[14px] tracking-wide
                 rounded-2xl flex items-center justify-center gap-3
                 transition-all duration-200
                 hover:shadow-[0_0_28px_rgba(26,79,216,0.35)]
                 active:scale-[0.97]
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
    >
      {/* Shine sweep on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300
                      bg-gradient-to-r from-transparent via-white/[0.05] to-transparent
                      translate-x-[-100%] group-hover:translate-x-[100%]
                      transition-transform duration-700" />

      {loading ? (
        <>
          <svg className="animate-spin shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2.5" strokeOpacity="0.15" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span>Redirigiendo…</span>
        </>
      ) : (
        <>
          {/* Google G logo */}
          <div className="w-[22px] h-[22px] rounded-full bg-white flex items-center justify-center shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          </div>
          <span>Continuar con Google</span>
          {/* Arrow */}
          <svg className="ml-auto shrink-0 opacity-30 group-hover:opacity-70 group-hover:translate-x-0.5
                          transition-all duration-200"
               width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      )}
    </button>
  );
}
