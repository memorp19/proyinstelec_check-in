import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { getJornadasByUsuarioProyecto } from "@/src/lib/jornadas";
import { DEMO_MODE } from "@/src/demo";

// Demo jornadas shown per-project in drill-down
const DEMO_JORNADAS_BY_PROJECT: Record<string, {
  id: string;
  fecha: string;
  checkInTs: string;
  checkOutTs: string;
  duracionMinutos: number;
  checkInWebViewLink?: string;
  checkOutWebViewLink?: string;
}[]> = {
  "demo-norte": [
    { id: "d1", fecha: "2026-06-15", checkInTs: "2026-06-15T08:02:00.000Z", checkOutTs: "2026-06-15T18:05:00.000Z", duracionMinutos: 603, checkInWebViewLink: undefined },
    { id: "d2", fecha: "2026-06-14", checkInTs: "2026-06-14T07:55:00.000Z", checkOutTs: "2026-06-14T17:50:00.000Z", duracionMinutos: 595 },
    { id: "d3", fecha: "2026-06-13", checkInTs: "2026-06-13T08:10:00.000Z", checkOutTs: "2026-06-13T18:00:00.000Z", duracionMinutos: 590 },
  ],
  "demo-sur": [
    { id: "d4", fecha: "2026-06-10", checkInTs: "2026-06-10T08:00:00.000Z", checkOutTs: "2026-06-10T18:00:00.000Z", duracionMinutos: 600 },
    { id: "d5", fecha: "2026-06-09", checkInTs: "2026-06-09T07:45:00.000Z", checkOutTs: "2026-06-09T17:30:00.000Z", duracionMinutos: 585 },
  ],
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const proyectoId = new URL(req.url).searchParams.get("proyectoId");
  if (!proyectoId) return NextResponse.json({ error: "proyectoId es requerido" }, { status: 400 });

  if (DEMO_MODE) {
    const jornadas = DEMO_JORNADAS_BY_PROJECT[proyectoId] ?? [];
    return NextResponse.json({ jornadas });
  }

  const raw = await getJornadasByUsuarioProyecto(session.user.id!, proyectoId);

  const jornadas = raw.map((j) => ({
    id: j.id,
    fecha: j.checkIn.timestamp.slice(0, 10),
    checkInTs: j.checkIn.timestamp,
    checkOutTs: j.checkOut?.timestamp ?? null,
    duracionMinutos: j.duracionMinutos ?? null,
    checkInWebViewLink: j.checkIn.driveWebViewLink ?? null,
    checkOutWebViewLink: j.checkOut?.driveWebViewLink ?? null,
  }));

  return NextResponse.json({ jornadas });
}
