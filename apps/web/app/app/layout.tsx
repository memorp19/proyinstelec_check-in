import { auth } from "@/src/auth";
import { redirect } from "next/navigation";
import { AppHeader } from "../_components/AppHeader";
import { NavBar } from "./components/NavBar";
import { ActualizadorPwa } from "./components/ActualizadorPwa";
import { ProcesadorCola } from "./components/ColaDeCampo";

// Server-side guard — middleware already handles the redirect,
// but this adds a second layer for Server Components that bypass middleware.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/unirse?callbackUrl=/app");

  const isAdmin = session.user.rol === "admin";

  return (
    <>
      <AppHeader />
      <NavBar isAdmin={isAdmin} />
      {/* Que la app instalada no se quede con el código viejo. */}
      <ActualizadorPwa />
      {/* Lo que se registró sin señal se manda solo al volver. */}
      <ProcesadorCola />
      <div className="pt-[52px]">{children}</div>
    </>
  );
}
