import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { createJornada, getOpenJornada } from "@/src/lib/jornadas";
import { getUserById } from "@/src/lib/users";
import { syncToOdooAsync } from "@/src/lib/odoo";
import type { DeviceInfo } from "@/src/lib/device-info";
import { DEMO_MODE } from "@/src/demo";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // In demo mode skip all external services and return a fake jornada ID
  if (DEMO_MODE) {
    return NextResponse.json(
      { jornadaId: `demo-jornada-${Date.now()}` },
      { status: 201 },
    );
  }

  const usuarioId = session.user.id;

  let body: {
    proyectoId: string;
    checkIn: {
      timestamp: string;
      lat: number;
      lng: number;
      precision: number;
      driveFileId?: string;
      driveWebViewLink?: string;
      fotoHash?: string;
      deviceInfo?: DeviceInfo;
    };
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { proyectoId, checkIn } = body;

  if (!proyectoId || !checkIn?.timestamp || checkIn.lat == null || checkIn.lng == null) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  // Los temporales sólo pueden fichar en sus proyectos asignados. La asignación
  // vive en la tabla puente, no en el token, así que se lee de la base.
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && session.user.tipo === "temporal") {
    const perfil = await getUserById(usuarioId);
    if (!perfil?.proyectos_asignados.includes(proyectoId)) {
      return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
    }
  }

  try {
    // Prevent double check-in
    const open = await getOpenJornada(usuarioId);
    if (open) {
      return NextResponse.json(
        { error: "Ya tienes una jornada abierta", jornadaId: open.id },
        { status: 409 },
      );
    }

    const jornada = await createJornada({
      usuarioId,
      proyectoId,
      tipo: session.user.tipo as "planta" | "temporal",
      checkIn: {
        ...checkIn,
        uploadStatus: checkIn.driveFileId ? "ok" : "pendiente",
      },
    });

    // Fire-and-forget Odoo sync for planta workers only
    if (session.user.odoo_sync && session.user.email) {
      syncToOdooAsync({
        usuarioId,
        email: session.user.email,
        jornadaId: jornada.id,
        checkIn: checkIn.timestamp,
      });
    }

    return NextResponse.json({ jornadaId: jornada.id }, { status: 201 });
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message ?? "Error interno";
    console.error("[jornada POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
