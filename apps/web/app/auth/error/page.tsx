"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

const errorMessages: Record<string, string> = {
  Configuration: "Error de configuración del servidor.",
  AccessDenied: "No tienes permiso para acceder con esta cuenta.",
  Verification: "El enlace de verificación es inválido o ha expirado.",
  OAuthSignin: "Error al iniciar sesión con Google.",
  OAuthCallback: "Error en el callback de Google.",
  OAuthCreateAccount: "No se pudo crear la cuenta.",
  EmailCreateAccount: "No se pudo crear la cuenta con ese correo.",
  Callback: "Error en el proceso de autenticación.",
  Default: "Ocurrió un error inesperado al iniciar sesión.",
};

function ErrorContent() {
  const params = useSearchParams();
  const error = params.get("error") ?? "Default";
  const message = errorMessages[error] ?? errorMessages.Default;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-2xl font-semibold">Error de autenticación</h1>
      <p className="max-w-sm text-gray-500">{message}</p>
      {process.env.NODE_ENV === "development" && (
        <p className="rounded bg-gray-100 px-3 py-1 font-mono text-xs text-gray-400">
          {error}
        </p>
      )}
      <Link
        href="/unirse"
        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        Volver a intentar
      </Link>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
