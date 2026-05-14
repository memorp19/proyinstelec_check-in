import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { uploadPhoto } from "@/src/lib/drive";
import { DEMO_MODE } from "@/src/demo";

const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB after client-side compression

export async function POST(req: NextRequest) {
  // Auth guard
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // In demo mode skip Google Drive and return a fake file reference
  if (DEMO_MODE) {
    return NextResponse.json(
      { driveFileId: "demo-file-id", webViewLink: "#", hash: "demo" },
      { status: 200 },
    );
  }

  let body: {
    base64: string;
    filename: string;
    mimeType?: string;
    proyectoNombre: string;
    fecha: string;       // YYYY-MM-DD in America/Mexico_City
    trabajadorNombre: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { base64, filename, proyectoNombre, fecha, trabajadorNombre } = body;

  if (!base64 || !filename || !proyectoNombre || !fecha || !trabajadorNombre) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  // Decode base64
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `La foto supera el tamaño máximo (${MAX_SIZE_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }

  // Validate MIME type
  const mimeType = body.mimeType ?? "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 415 });
  }

  try {
    const result = await uploadPhoto({
      buffer,
      filename,
      mimeType,
      proyectoNombre,
      fecha,
      trabajadorNombre,
    });

    return NextResponse.json({
      driveFileId: result.driveFileId,
      hash: result.hash,
      webViewLink: result.webViewLink,
      thumbnailUrl: `https://drive.google.com/thumbnail?id=${result.driveFileId}&sz=w400`,
    });
  } catch (err) {
    console.error("[upload] Drive error:", err);
    return NextResponse.json({ error: "Error al subir la foto" }, { status: 502 });
  }
}
