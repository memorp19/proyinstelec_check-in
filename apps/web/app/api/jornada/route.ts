import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { createJornada, getOpenJornada } from "@/src/lib/jornadas";
import { syncToOdooAsync } from "@/src/lib/odoo";
import type { DeviceInfo } from "@/src/lib/device-info";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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

  // Temporales can only check in to their assigned projects (skipped in local dev)
  const isDev = process.env.NODE_ENV === "development";
  if (
    !isDev &&
    session.user.tipo === "temporal" &&
    !session.user.proyectos_asignados.includes(proyectoId)
  ) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
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
        email: session.user.email,
        jornadaId: jornada.id,
        checkIn: checkIn.timestamp,
      });
    }

    return NextResponse.json({ jornadaId: jornada.id }, { status: 201 });
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name ?? "";
    const message = (err as { message?: string })?.message ?? "Error interno";
    console.error("[jornada POST]", err);

    if (name === "ResourceNotFoundException") {
      return NextResponse.json(
        { error: "Tabla DynamoDB no encontrada. Ejecuta: pnpm run db:create" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
