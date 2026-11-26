import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/src/auth";
import { updatePerfil } from "@/src/lib/users";
import { uploadPhoto } from "@/src/lib/drive";
import { DEMO_MODE } from "@/src/demo";
import { EXTENSION_DE_FOTO, tipoDeFoto } from "@/src/lib/fotos";

const MAX_SIZE_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (DEMO_MODE) {
    return NextResponse.json({ foto_url: session.user.image ?? null });
  }

  // `mimeType` se acepta pero no se usa: el tipo sale de los bytes.
  let body: { base64: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.base64) return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });

  const buffer = Buffer.from(body.base64, "base64");
  if (buffer.length > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "La imagen supera el tamaño máximo (4 MB)" }, { status: 413 });
  }

  // El tipo, por los bytes: el que dice el navegador lo controla quien llama.
  const mimeType = tipoDeFoto(buffer);
  if (!mimeType) {
    return NextResponse.json({ error: "La foto tiene que ser JPEG, PNG o WebP." }, { status: 415 });
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const ext = EXTENSION_DE_FOTO[mimeType];

  try {
    const result = await uploadPhoto({
      buffer,
      filename: `perfil-${session.user.id}-${fecha}.${ext}`,
      mimeType,
      proyectoNombre: "perfiles",
      fecha,
      trabajadorNombre: session.user.name ?? session.user.email ?? "usuario",
    });

    const foto_url = `https://drive.google.com/thumbnail?id=${result.driveFileId}&sz=w400`;
    await updatePerfil(session.user.id!, { foto_url });
    return NextResponse.json({ foto_url });
  } catch (err) {
    console.error("[perfil/foto] Drive error:", err);
    return NextResponse.json({ error: "Error al subir la foto" }, { status: 502 });
  }
}

export async function DELETE() {
  const session = (await auth()) as Session | null;
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  await updatePerfil(session.user.id!, { foto_url: null });
  return NextResponse.json({ ok: true });
}
