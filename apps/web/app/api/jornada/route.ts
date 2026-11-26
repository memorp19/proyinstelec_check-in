import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { createJornada, getOpenJornada } from "@/src/lib/jornadas";
import { getUserById } from "@/src/lib/users";
import { puedeFicharEn } from "@/src/lib/fichaje";
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
  // vive en la tabla puente, no en el token, así que se lee de la base. La
  // regla es la misma de la foto del check-in (`puedeFicharEn`).
  if (session.user.tipo === "temporal") {
    const perfil = await getUserById(usuarioId);
    const asignados = perfil?.proyectos_asignados ?? [];
    if (!puedeFicharEn({ tipo: "temporal", proyectos_asignados: asignados }, proyectoId)) {
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

    // La foto no llega por aquí: la pone `/api/upload` en la jornada ya
    // creada, una sola vez. Lo que mande el navegador como id de Drive no se
    // guarda (B4): la jornada nace con la foto pendiente.
    const jornada = await createJornada({
      usuarioId,
      proyectoId,
      tipo: session.user.tipo as "planta" | "temporal",
      checkIn: {
        timestamp: checkIn.timestamp,
        lat: checkIn.lat,
        lng: checkIn.lng,
        precision: checkIn.precision,
        deviceInfo: checkIn.deviceInfo,
        uploadStatus: "pendiente",
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
