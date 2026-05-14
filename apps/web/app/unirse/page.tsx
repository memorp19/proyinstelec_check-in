import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { validateToken } from "@/src/lib/invitaciones";
import { GoogleSignInButton } from "./_components/GoogleSignInButton";

interface Props {
  searchParams: { token?: string; callbackUrl?: string };
}

export default async function UnirsePage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);

  if (session?.user.perfil_completo) {
    redirect(searchParams.callbackUrl ?? "/app");
  }

  let tokenError: string | null = null;

  if (searchParams.token) {
    const result = await validateToken(searchParams.token);
    if (!result.valid) {
      tokenError =
        result.reason === "not_found"
          ? "El enlace de invitación no existe."
          : result.reason === "expired"
            ? "Este enlace ya expiró. Solicita uno nuevo a tu líder de proyecto."
            : "Este enlace ya fue utilizado.";
    }
  }

  const callbackUrl = searchParams.callbackUrl ?? "/app";
  const isInvitation = searchParams.token && !tokenError;

  return (
    <main className="min-h-screen bg-navy flex flex-col items-center justify-center px-6 relative overflow-hidden">

      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none select-none" aria-hidden>
        <div className="absolute top-[-20%] left-[-20%] w-[80vw] h-[80vw] rounded-full bg-blue-dark/50 blur-[140px]" />
        <div className="absolute bottom-[-25%] right-[-15%] w-[65vw] h-[65vw] rounded-full bg-blue/25 blur-[120px]" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[40vw] h-[40vw] rounded-full bg-blue-mid/10 blur-[80px]" />
      </div>

      <div className="relative w-full max-w-[340px] flex flex-col items-center gap-10">

        {/* Brand mark */}
        <div className="flex flex-col items-center gap-5">
          <div className="relative flex items-center justify-center w-[72px] h-[72px] rounded-[22px]
                          bg-gradient-to-br from-blue to-blue-dark
                          shadow-[0_0_0_1px_rgba(26,79,216,0.5),0_12px_40px_rgba(26,79,216,0.45)]">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M13.5 2L5 14H12L11 22L20 10H13L13.5 2Z" fill="white" />
            </svg>
          </div>

          <div className="text-center">
            <h1
              className="font-head text-[44px] font-bold tracking-[0.18em] uppercase
                         bg-gradient-to-b from-white via-white to-white/55
                         bg-clip-text text-transparent"
            >
              Proyinstelec
            </h1>
            <p className="font-mono text-[10px] text-white/30 mt-1.5 tracking-[0.22em] uppercase">
              {isInvitation ? "Invitación a proyecto" : "Portal de acceso"}
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="w-full rounded-[20px] overflow-hidden
                        border border-white/[0.09]
                        bg-white/[0.04] backdrop-blur-md
                        shadow-[0_24px_64px_rgba(0,0,0,0.55)]">

          {/* Top gradient accent */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-blue/60 to-transparent" />

          <div className="p-8 flex flex-col gap-6">
            {tokenError ? (
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5 w-8 h-8 rounded-xl bg-danger/15 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" stroke="#EF4444" strokeWidth="1.5" />
                    <path d="M12 8v4M12 16h.01" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="font-mono text-xs text-danger/90 leading-relaxed pt-1">{tokenError}</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <p className="font-body text-white/80 text-sm leading-relaxed">
                    {isInvitation
                      ? "Completa tu registro con tu cuenta Google para unirte al proyecto."
                      : "Accede con tu cuenta corporativa para registrar tu jornada."}
                  </p>
                  {!isInvitation && (
                    <span className="inline-flex items-center gap-1.5 mt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-mid" />
                      <p className="font-mono text-xs text-blue-mid">@proyinstelec.mx</p>
                    </span>
                  )}
                </div>

                <GoogleSignInButton callbackUrl={callbackUrl} pendingToken={searchParams.token} />

                <p className="text-center font-mono text-[10px] text-white/20 leading-relaxed">
                  Al continuar aceptas el uso interno de este sistema
                </p>
              </>
            )}
          </div>
        </div>

        <p className="font-mono text-[10px] text-white/15 tracking-widest">
          © {new Date().getFullYear()} PROYINSTELEC
        </p>
      </div>
    </main>
  );
}
