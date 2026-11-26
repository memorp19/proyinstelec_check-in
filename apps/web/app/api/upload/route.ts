import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { mandarAPapelera, uploadPhoto } from "@/src/lib/drive";
import { DEMO_MODE } from "@/src/demo";
import { getUserById } from "@/src/lib/users";
import { getJornada, ponerFotoDeJornada, type CheckPoint } from "@/src/lib/jornadas";
import { getProyecto } from "@/src/lib/proyectos";
import { ahoraEnMexico } from "@/src/lib/hora-mexico";
import { ACTUALIZA_LA_APP, TOPE_FOTO_BYTES, nombreDeFoto, tipoDeFoto } from "@/src/lib/fotos";

/**
 * La foto del check-in y del check-out (docs/seguridad-erp.md §3.4).
 *
 * **Siempre de una jornada que ya existe.** La pantalla primero registra el
 * check-in (o el check-out) y después sube la foto, diciendo de qué jornada
 * es. Así funciona igual con señal que sin ella: sin señal, las dos cosas
 * esperan en el teléfono y se mandan en ese orden al volver.
 *
 * **Quién:** cualquier cuenta de Google puede tener sesión —así entran los
 * temporales con su Gmail—, pero solo sube quien tiene el perfil completo,
 * está activo y ficha en campo (rol `campo` o `admin`), y solo a una jornada
 * suya. Se lee de la base, no del token.
 *
 * **A dónde:** lo decide el servidor con los datos de la jornada:
 * `{raíz}/Proyectos/{proyecto}/{fecha}/{nombre}/checkin_HHMM.jpg`, con la
 * fecha y la hora **del check-in o del check-out**, en hora de México. Una
 * foto que se subió horas después, al volver la señal, queda con la hora en
 * que se tomó.
 *
 * **Una sola vez:** si la jornada ya tiene esa foto, se devuelve la que tiene
 * y no se sube otra. Si dos subidas llegan a la vez, la que no queda en la
 * jornada se manda a la papelera.
 *
 * **Qué:** JPEG, PNG o WebP reconocidos por sus bytes, de hasta 3 MB.
 */

/** Lo único que manda la pantalla. Cualquier otro campo es de una versión vieja. */
const CAMPOS = ["tipo", "jornadaId", "base64"];
const MOMENTOS = ["checkin", "checkout"] as const;
type Momento = (typeof MOMENTOS)[number];

const error = (mensaje: string, status: number) => NextResponse.json({ error: mensaje }, { status });

/**
 * Una pantalla vieja —guardada en el teléfono por la PWA— manda otros campos.
 * No se le sigue el juego: se le pide actualizar, con palabras que cualquiera
 * entienda.
 */
const actualizar = () => NextResponse.json({ error: ACTUALIZA_LA_APP, actualizar: true }, { status: 400 });

/** Lo que se contesta con la foto que quedó en la jornada. */
const respuesta = (foto: { driveFileId: string; webViewLink: string; hash: string }, yaEstaba = false) =>
  NextResponse.json({
    driveFileId: foto.driveFileId,
    hash: foto.hash,
    webViewLink: foto.webViewLink,
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${foto.driveFileId}&sz=w400`,
    ...(yaEstaba ? { yaEstaba: true } : {}),
  });

/** La foto que ya tiene ese lugar de la jornada, si tiene. */
function fotoDe(punto: CheckPoint | undefined) {
  return punto?.driveFileId
    ? { driveFileId: punto.driveFileId, webViewLink: punto.driveWebViewLink ?? "", hash: punto.fotoHash ?? "" }
    : null;
}

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
  const jornadaId = typeof cuerpo.jornadaId === "string" ? cuerpo.jornadaId : "";
  if (!jornadaId) return actualizar();

  // ── La foto: tamaño y tipo, antes de tocar la base ─────────────────────────
  // Lo que pase de 4.5 MB ya lo cortó Vercel: aquí basta con decodificar y medir.
  const base64 = typeof cuerpo.base64 === "string" ? cuerpo.base64 : "";
  if (!base64) return error("Falta la foto", 400);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) return error("Falta la foto", 400);
  if (buffer.length > TOPE_FOTO_BYTES) {
    return error(`La foto pesa más de ${TOPE_FOTO_BYTES / 1024 / 1024} MB.`, 413);
  }
  const mimeType = tipoDeFoto(buffer);
  if (!mimeType) return error("La foto tiene que ser JPEG, PNG o WebP.", 415);

  // ── Quién ──────────────────────────────────────────────────────────────────
  const perfil = await getUserById(session.user.id);
  if (!perfil || !perfil.activo) return error("Tu cuenta no está activa.", 403);
  if (!perfil.perfil_completo) return error("Completa tu perfil antes de fichar.", 403);
  if (perfil.rol !== "campo" && perfil.rol !== "admin") {
    return error("Tu cuenta no ficha en campo.", 403);
  }

  // ── De qué jornada ─────────────────────────────────────────────────────────
  const jornada = await getJornada(jornadaId);
  if (!jornada) return error("Jornada no encontrada", 404);
  if (jornada.usuarioId !== perfil.id) return error("Esa jornada no es tuya", 403);
  const punto = momento === "checkin" ? jornada.checkIn : jornada.checkOut;
  // Sin check-out registrado no hay hora de salida con la que nombrarla.
  // La pantalla registra el cierre antes de subir la foto; la cola, también.
  if (!punto) return error("La jornada sigue abierta: la foto de salida se sube al cerrarla.", 409);

  // Ya la tiene: un reintento no sube otra.
  const yaTiene = fotoDe(punto);
  if (yaTiene) return respuesta(yaTiene, true);

  const proyecto = await getProyecto(jornada.proyectoId);
  if (!proyecto) return error("No existe ese proyecto", 404);

  // ── Drive ──────────────────────────────────────────────────────────────────
  // La fecha y la hora son las del registro, no las de ahora.
  const { fecha, hhmm } = ahoraEnMexico(new Date(punto.timestamp));
  let subida;
  try {
    subida = await uploadPhoto({
      buffer,
      filename: nombreDeFoto(momento, hhmm, mimeType),
      mimeType,
      proyectoNombre: proyecto.nombre,
      fecha,
      trabajadorNombre: perfil.nombre,
    });
  } catch (err) {
    console.error("[upload] Drive error:", err);
    return error("No se pudo guardar la foto en Drive.", 502);
  }

  if (await ponerFotoDeJornada({ jornadaId, momento, foto: subida })) return respuesta(subida);

  // Otra subida de la misma foto ganó mientras tanto: la suya es la que vale,
  // y esta sobra. A la papelera, para que no quede repetida.
  await mandarAPapelera(subida.driveFileId).catch((err) =>
    console.error("[upload] no se pudo mandar a la papelera la foto repetida:", err),
  );
  const actual = await getJornada(jornadaId);
  const ganadora = fotoDe(momento === "checkin" ? actual?.checkIn : actual?.checkOut);
  return ganadora ? respuesta(ganadora, true) : error("La jornada cambió mientras se subía la foto.", 409);
}
