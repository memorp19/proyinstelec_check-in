import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { getJornada, closeJornada } from "@/src/lib/jornadas";
import { syncToOdooAsync } from "@/src/lib/odoo";
import type { DeviceInfo } from "@/src/lib/device-info";
import { DEMO_MODE } from "@/src/demo";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { jornadaId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { jornadaId } = params;

  // In demo mode skip DynamoDB and return mock checkout data
  if (DEMO_MODE) {
    return NextResponse.json({ jornadaId, duracionMinutos: 480 }, { status: 200 });
  }
  const jornada = await getJornada(jornadaId);

  if (!jornada) {
    return NextResponse.json({ error: "Jornada no encontrada" }, { status: 404 });
  }

  // Users can only close their own jornadas
  if (jornada.usuarioId !== session.user.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  if (jornada.estado === "cerrada") {
    return NextResponse.json({ error: "La jornada ya fue cerrada" }, { status: 409 });
  }

  let body: {
    checkOut: {
      timestamp: string;
      lat: number;
      lng: number;
      precision: number;
      driveFileId?: string;
      driveWebViewLink?: string;
      fotoHash?: string;
      observaciones?: string;
      deviceInfo?: DeviceInfo;
    };
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { checkOut } = body;
  if (!checkOut?.timestamp || checkOut.lat == null || checkOut.lng == null) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const duracionMinutos = await closeJornada(
    jornadaId,
    {
      ...checkOut,
      uploadStatus: checkOut.driveFileId ? "ok" : "pendiente",
    },
    jornada.checkIn.timestamp,
  );

  // Update Odoo with check_out time
  if (session.user.odoo_sync && session.user.email) {
    syncToOdooAsync({
      email: session.user.email,
      jornadaId,
      checkIn: jornada.checkIn.timestamp,
      checkOut: checkOut.timestamp,
    });
  }

  return NextResponse.json({ jornadaId, duracionMinutos });
}
