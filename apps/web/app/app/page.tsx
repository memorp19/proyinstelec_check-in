import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { getOpenJornada } from "@/src/lib/jornadas";
import { AppShell } from "./components/AppShell";

// Server component — loads initial state; interactive parts are client components
export default async function AppHome() {
  const session = await getServerSession(authOptions);
  if (!session) return null; // layout already handles redirect

  const openJornada = await getOpenJornada(session.user.id).catch(() => null);

  const now = new Date();
  const dateLabel = now.toLocaleDateString("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <AppShell
      userName={session.user.name ?? session.user.email ?? "Trabajador"}
      userTipo={session.user.tipo}
      proyectosAsignados={session.user.proyectos_asignados}
      proyectosNombres={{}}
      dateLabel={dateLabel}
      openJornadaId={openJornada?.id ?? null}
      openJornadaCheckInTs={openJornada?.checkIn.timestamp ?? null}
      openJornadaProyectoId={openJornada?.proyectoId ?? null}
    />
  );
}
