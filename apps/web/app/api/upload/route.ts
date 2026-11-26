import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { uploadPhoto } from "@/src/lib/drive";
import { DEMO_MODE } from "@/src/demo";
import { getUserById } from "@/src/lib/users";
import { getJornada } from "@/src/lib/jornadas";
import { getProyecto } from "@/src/lib/proyectos";
import { puedeFicharEn } from "@/src/lib/fichaje";
import {
  ACTUALIZA_LA_APP,
  TOPE_FOTO_BYTES,
  ahoraEnMexico,
  nombreDeFoto,
  tipoDeFoto,
} from "@/src/lib/fotos";

/**
 * La foto del check-in y del check-out (docs/seguridad-erp.md §3.4).
 *
 * **Quién:** cualquier cuenta de Google puede tener sesión —así entran los
 * temporales con su Gmail—, pero solo sube quien tiene el perfil completo,
 * está activo y ficha en campo (rol `campo` o `admin`). Se lee de la base, no
 * del token.
 *
 * **A dónde:** lo decide el servidor, nunca el navegador.
 * - check-in: al proyecto que pide, si puede fichar en él (la misma regla que
 *   `/api/jornada`);
 * - check-out: al proyecto de su jornada abierta.
 *
 * La carpeta es `{raíz}/Proyectos/{proyecto}/{fecha}/{nombre}`, con el nombre
 * del proyecto y de la persona de la base, y la fecha y la hora de México.
 *
 * **Qué:** JPEG, PNG o WebP reconocidos por sus bytes, de hasta 3 MB.
 */

/** Lo único que manda la pantalla. Cualquier otro campo es de una versión vieja. */
const CAMPOS = ["tipo", "proyectoId", "jornadaId", "base64"];
const MOMENTOS = ["checkin", "checkout"] as const;
type Momento = (typeof MOMENTOS)[number];

const error = (mensaje: string, status: number) => NextResponse.json({ error: mensaje }, { status });

/**
 * Una pantalla vieja —guardada en el teléfono por la PWA— manda la carpeta y
 * el nombre que ella decide. No se le sigue el juego: se le pide actualizar,
 * con palabras que cualquiera entienda.
 */
const actualizar = () => NextResponse.json({ error: ACTUALIZA_LA_APP, actualizar: true }, { status: 400 });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return error("No autorizado", 401);

  // En demo no hay Drive: una referencia falsa.
  if (DEMO_MODE) {
    return NextResponse.json(
      { driveFileId: "demo-file-id", webViewLink: "#", hash: "demo" },
      { status: 200 },
    );
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return error("Cuerpo inválido", 400);
  }
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return actualizar();
  if (Object.keys(cuerpo).some((c) => !CAMPOS.includes(c))) return actualizar();
  if (!MOMENTOS.includes(cuerpo.tipo as Momento)) return actualizar();
  const momento = cuerpo.tipo as Momento;

  // Cada momento lleva lo suyo, y solo eso.
  const proyectoPedido = typeof cuerpo.proyectoId === "string" ? cuerpo.proyectoId : "";
  const jornadaId = typeof cuerpo.jornadaId === "string" ? cuerpo.jornadaId : "";
  if (momento === "checkin" && (!proyectoPedido || "jornadaId" in cuerpo)) return actualizar();
  if (momento === "checkout" && (!jornadaId || "proyectoId" in cuerpo)) return actualizar();

  // ── La foto: tamaño y tipo, antes de tocar la base ─────────────────────────
  // Lo que pase de 4.5 MB ya lo cortó Vercel: aquí basta con decodificar y medir.
  const base64 = typeof cuerpo.base64 === "string" ? cuerpo.base64 : "";
  if (!base64) return error("Falta la foto", 400);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) return error("Falta la foto", 400);
  if (buffer.length > TOPE_FOTO_BYTES) return demasiadoGrande();
  const mimeType = tipoDeFoto(buffer);
  if (!mimeType) return error("La foto tiene que ser JPEG, PNG o WebP.", 415);

  // ── Quién ──────────────────────────────────────────────────────────────────
  const perfil = await getUserById(session.user.id);
  if (!perfil || !perfil.activo) return error("Tu cuenta no está activa.", 403);
  if (!perfil.perfil_completo) return error("Completa tu perfil antes de fichar.", 403);
  if (perfil.rol !== "campo" && perfil.rol !== "admin") {
    return error("Tu cuenta no ficha en campo.", 403);
  }

  // ── A qué proyecto ─────────────────────────────────────────────────────────
  let proyectoId: string;
  if (momento === "checkin") {
    if (!puedeFicharEn(perfil, proyectoPedido)) return error("No tienes acceso a este proyecto", 403);
    proyectoId = proyectoPedido;
  } else {
    // Por su id y no "la abierta de hoy": esa se busca desde la medianoche del
    // servidor, que en Vercel es UTC, y un check-out después de las 18:00 de
    // México no la encontraría.
    const jornada = await getJornada(jornadaId);
    if (!jornada) return error("Jornada no encontrada", 404);
    if (jornada.usuarioId !== perfil.id) return error("Esa jornada no es tuya", 403);
    if (jornada.estado === "cerrada") return error("La jornada ya fue cerrada", 409);
    proyectoId = jornada.proyectoId;
  }
  const proyecto = await getProyecto(proyectoId);
  if (!proyecto) return error("No existe ese proyecto", 404);

  // ── Drive ──────────────────────────────────────────────────────────────────
  const { fecha, hhmm } = ahoraEnMexico();
  try {
    const result = await uploadPhoto({
      buffer,
      filename: nombreDeFoto(momento, hhmm, mimeType),
      mimeType,
      proyectoNombre: proyecto.nombre,
      fecha,
      trabajadorNombre: perfil.nombre,
    });

    return NextResponse.json({
      driveFileId: result.driveFileId,
      hash: result.hash,
      webViewLink: result.webViewLink,
      thumbnailUrl: `https://drive.google.com/thumbnail?id=${result.driveFileId}&sz=w400`,
    });
  } catch (err) {
    console.error("[upload] Drive error:", err);
    return error("No se pudo guardar la foto en Drive.", 502);
  }
}

function demasiadoGrande() {
  return error(`La foto pesa más de ${TOPE_FOTO_BYTES / 1024 / 1024} MB.`, 413);
}
