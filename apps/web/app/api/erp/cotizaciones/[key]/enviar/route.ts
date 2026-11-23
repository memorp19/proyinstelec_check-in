import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import {
  ESTATUS_COTIZACION,
  parseCotKey,
  type EnvioVisto,
  type EstatusCotizacion,
} from "@/src/lib/cotizaciones";
import {
  datosParaEnvio,
  DestinatariosNoValidos,
  EnvioDesactualizado,
  EnvioNoPermitido,
  enviarAlCliente,
} from "@/src/lib/cotizaciones-flujos";

export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "cotizaciones.enviar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  try {
    const datos = await datosParaEnvio({
      numero: key.numero,
      anio: key.anio,
      remitente: session!.user.email ?? "",
    });
    return NextResponse.json(datos);
  } catch (err) {
    console.error("[erp/enviar GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "cotizaciones.enviar");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // Lista blanca, como el PATCH del encabezado. Además cierra el `mensajeHtml`
  // de antes: una pantalla vieja en caché que lo mande recibe un 400 que pide
  // recargar, en vez de que su mensaje se pierda en silencio.
  const rechazado = Object.keys(body).find((campo) => !(CAMPOS as readonly string[]).includes(campo));
  if (rechazado) {
    return NextResponse.json(
      { error: `El campo "${rechazado}" no se acepta. Recarga la página y vuelve a enviar.` },
      { status: 400 },
    );
  }

  const { destinatarios, asunto, mensaje, telefonoFirma } = body;
  if (!Array.isArray(destinatarios) || destinatarios.some((d) => typeof d !== "string")) {
    return NextResponse.json({ error: "Selecciona al menos un contacto del cliente" }, { status: 400 });
  }
  if (!esTextoOpcional(asunto) || !esTextoOpcional(mensaje) || !esTextoOpcional(telefonoFirma)) {
    return NextResponse.json({ error: "El asunto, el mensaje y el teléfono van como texto" }, { status: 400 });
  }
  const visto = leerVisto(body.visto);
  if (!visto) {
    return NextResponse.json(
      { error: "Falta lo que vio la pantalla. Recarga la página y vuelve a enviar." },
      { status: 400 },
    );
  }

  try {
    const { cotizacion } = await enviarAlCliente({
      numero: key.numero,
      anio: key.anio,
      destinatarios,
      asunto,
      mensaje,
      telefonoFirma,
      visto,
      remitente: {
        email: session!.user.email ?? "",
        nombre: session!.user.name ?? session!.user.email ?? "",
      },
    });
    return NextResponse.json({ cotizacion });
  } catch (err) {
    const msg = (err as Error).message;
    if (err instanceof DestinatariosNoValidos) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    if (err instanceof EnvioDesactualizado || err instanceof EnvioNoPermitido || msg.includes("PDF")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg.includes("no encontrada")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error("[erp/enviar POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Lo único que acepta el POST. */
const CAMPOS = ["destinatarios", "asunto", "mensaje", "telefonoFirma", "visto"] as const;

function esTextoOpcional(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

/** `visto` tal como lo manda la pantalla, o null si no tiene forma. */
function leerVisto(v: unknown): EnvioVisto | null {
  if (!v || typeof v !== "object") return null;
  const { version, estatus, fechaEnvio } = v as Record<string, unknown>;
  if (!Number.isInteger(version) || (version as number) < 0) return null;
  if (!ESTATUS_COTIZACION.includes(estatus as EstatusCotizacion)) return null;
  if (fechaEnvio !== null && (typeof fechaEnvio !== "string" || Number.isNaN(Date.parse(fechaEnvio)))) {
    return null;
  }
  return {
    version: version as number,
    estatus: estatus as EstatusCotizacion,
    fechaEnvio: fechaEnvio as string | null,
  };
}
