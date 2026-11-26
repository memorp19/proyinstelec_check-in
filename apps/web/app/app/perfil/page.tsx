import { auth } from "@/src/auth";
import { getUserById } from "@/src/lib/users";
import { getJornadasHistorialByUsuario } from "@/src/lib/jornadas";
import { nombresDeProyectos } from "@/src/lib/proyectos";
import { nombreDeProyecto, nombresDeDemo } from "@/src/lib/nombre-proyecto";
import { DEMO_MODE, DEMO_PROJECTS, DEMO_HISTORIAL, getDemoPresetById, type ProyectoStats } from "@/src/demo";
import { PerfilClient } from "./_components/PerfilClient";

export default async function PerfilPage() {
  const session = await auth();
  if (!session) return null;

  const userId = session.user.id!;

  const [dbUser, jornadas] = await Promise.all([
    DEMO_MODE ? null : getUserById(userId).catch(() => null),
    DEMO_MODE ? Promise.resolve([]) : getJornadasHistorialByUsuario(userId).catch(() => []),
  ]);

  const fotoUrl = dbUser?.foto_url ?? session.user.image ?? null;
  const nickname = dbUser?.nickname ?? null;
  const proyectosAsignados = DEMO_MODE
    ? getDemoPresetById(userId).proyectos_asignados
    : (dbUser?.proyectos_asignados ?? []);

  // Los nombres, de la base: los asignados y los del historial, que pueden ya
  // no estar asignados. Antes la pantalla enseñaba el id (un UUID).
  const nombres = DEMO_MODE
    ? nombresDeDemo(DEMO_PROJECTS)
    : await nombresDeProyectos([...proyectosAsignados, ...jornadas.map((j) => j.proyectoId)]).catch(() => ({}));

  // Compute historial from real jornadas
  let historial: ProyectoStats[];
  if (DEMO_MODE) {
    historial = DEMO_HISTORIAL;
  } else {
    const byProject: Record<string, { totalMinutos: number; sesiones: number; ultimaFecha: string }> = {};
    for (const j of jornadas) {
      if (!j.duracionMinutos) continue;
      const entry = byProject[j.proyectoId] ?? { totalMinutos: 0, sesiones: 0, ultimaFecha: "" };
      entry.totalMinutos += j.duracionMinutos;
      entry.sesiones += 1;
      if (!entry.ultimaFecha || j.checkIn.timestamp > entry.ultimaFecha) {
        entry.ultimaFecha = j.checkIn.timestamp;
      }
      byProject[j.proyectoId] = entry;
    }
    historial = Object.entries(byProject).map(([proyectoId, stats]) => ({
      proyectoId,
      nombre: nombreDeProyecto(nombres, proyectoId),
      ...stats,
    })).sort((a, b) => b.ultimaFecha.localeCompare(a.ultimaFecha));
  }

  return (
    <PerfilClient
      nombre={session.user.name ?? session.user.email ?? "Usuario"}
      fotoUrl={fotoUrl}
      nickname={nickname}
      proyectosAsignados={proyectosAsignados}
      nombresDeProyectos={nombres}
      historial={historial}
    />
  );
}
