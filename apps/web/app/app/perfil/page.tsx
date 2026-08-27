import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { getUserByGoogleSub } from "@/src/lib/users";
import { getJornadasHistorialByUsuario } from "@/src/lib/jornadas";
import { DEMO_MODE, DEMO_PROJECTS, DEMO_HISTORIAL, type ProyectoStats } from "@/src/demo";
import { PerfilClient } from "./_components/PerfilClient";

function formatProyectoId(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function PerfilPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const userId = session.user.id!;

  const [dbUser, jornadas] = await Promise.all([
    DEMO_MODE ? null : getUserByGoogleSub(userId).catch(() => null),
    DEMO_MODE ? Promise.resolve([]) : getJornadasHistorialByUsuario(userId).catch(() => []),
  ]);

  const fotoUrl = dbUser?.foto_url ?? session.user.image ?? null;
  const nickname = dbUser?.nickname ?? null;
  const proyectosAsignados = session.user.proyectos_asignados ?? [];

  // Build project name map
  const proyectosNombres: Record<string, string> = DEMO_MODE ? DEMO_PROJECTS : {};

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
      nombre: proyectosNombres[proyectoId] ?? formatProyectoId(proyectoId),
      ...stats,
    })).sort((a, b) => b.ultimaFecha.localeCompare(a.ultimaFecha));
  }

  return (
    <PerfilClient
      nombre={session.user.name ?? session.user.email ?? "Usuario"}
      fotoUrl={fotoUrl}
      nickname={nickname}
      proyectosAsignados={proyectosAsignados}
      proyectosNombres={proyectosNombres}
      historial={historial}
    />
  );
}
