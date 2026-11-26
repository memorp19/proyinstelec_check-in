import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/src/auth";
import { updatePerfil } from "@/src/lib/users";
import { uploadPhoto } from "@/src/lib/drive";
import { DEMO_MODE } from "@/src/demo";
import { EXTENSION_DE_FOTO, TOPE_FOTO_BYTES, tipoDeFoto } from "@/src/lib/fotos";
import { ahoraEnMexico } from "@/src/lib/hora-mexico";

/**
 * La foto de perfil. La pantalla la comprime antes (1600 px, JPEG al 85 %),
 * como la del check-in, y el tope es el mismo: 3 MB, lo que cabe en el cuerpo
 * que deja pasar Vercel en base64. Con 4 MB, una foto de más de ~3.3 MB ni
 * llegaba a esta ruta.
 */

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
  if (buffer.length > TOPE_FOTO_BYTES) {
    return NextResponse.json(
      { error: `La foto pesa más de ${TOPE_FOTO_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  // El tipo, por los bytes: el que dice el navegador lo controla quien llama.
  const mimeType = tipoDeFoto(buffer);
  if (!mimeType) {
    return NextResponse.json({ error: "La foto tiene que ser JPEG, PNG o WebP." }, { status: 415 });
  }

  // La fecha de México: con la del servidor (UTC), después de las 18:00 caía
  // en la carpeta del día siguiente.
  const { fecha } = ahoraEnMexico();
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
