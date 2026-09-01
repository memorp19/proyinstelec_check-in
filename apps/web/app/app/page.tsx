import { auth } from "@/src/auth";
import { getOpenJornada } from "@/src/lib/jornadas";
import { getUserById } from "@/src/lib/users";
import { DEMO_MODE, DEMO_PROJECTS, getDemoPresetById } from "@/src/demo";
import { AppShell } from "./components/AppShell";

// Server component — loads initial state; interactive parts are client components
export default async function AppHome() {
  const session = await auth();
  if (!session) return null; // layout already handles redirect

  // Los proyectos asignados salen de la tabla puente, no del token de sesión.
  const [openJornada, perfil] = await Promise.all([
    DEMO_MODE ? null : getOpenJornada(session.user.id).catch(() => null),
    DEMO_MODE ? null : getUserById(session.user.id).catch(() => null),
  ]);

  const proyectosAsignados = DEMO_MODE
    ? getDemoPresetById(session.user.id).proyectos_asignados
    : (perfil?.proyectos_asignados ?? []);

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
      proyectosAsignados={proyectosAsignados}
      proyectosNombres={DEMO_MODE ? DEMO_PROJECTS : {}}
      dateLabel={dateLabel}
      openJornadaId={openJornada?.id ?? null}
      openJornadaCheckInTs={openJornada?.checkIn.timestamp ?? null}
      openJornadaProyectoId={openJornada?.proyectoId ?? null}
    />
  );
}
