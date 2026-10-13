import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import {
  cambiarEstatus,
  cotPk,
  getVersiones,
  parseCotKey,
  tieneAprobacion,
  updateCotizacion,
  type EstatusCotizacion,
  type Prioridad,
} from "@/src/lib/cotizaciones";
import { crearNuevaVersionCompleta } from "@/src/lib/cotizaciones-flujos";
import { registrarBitacora } from "@/src/lib/bitacora";

export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida (usa NNN-AAAA)" }, { status: 400 });

  try {
    const versiones = await getVersiones(key.numero, key.anio);
    if (versiones.length === 0) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
    }
    const vigente = versiones[0];
    const aprobada = await tieneAprobacion(key.numero, key.anio, vigente.version);
    return NextResponse.json({ vigente, versiones, aprobada });
  } catch (err) {
    console.error("[erp/cotizacion GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  // POST /api/erp/cotizaciones/[key] con {accion: "nueva_version"}
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: { accion?: string; prioridad?: Prioridad; elaboro?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (body.accion !== "nueva_version") {
    return NextResponse.json({ error: "accion inválida" }, { status: 422 });
  }

  try {
    const { cotizacion, avisos } = await crearNuevaVersionCompleta({
      numero: key.numero,
      anio: key.anio,
      prioridad: body.prioridad,
      elaboro: body.elaboro,
      createdBy: session!.user.email ?? "",
    });
    return NextResponse.json({ cotizacion, avisos }, { status: 201 });
  } catch (err) {
    console.error("[erp/cotizacion nueva_version]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

const ESTATUS_MANUALES: EstatusCotizacion[] = [
  "DEPENDIENTE PROVEEDOR",
  "DEPENDIENTE CLIENTE",
  "CANCELADA",
  "PROCESO",
];

/**
 * Lo único que este PATCH edita — exactamente los campos del formulario de la
 * pantalla, más el estatus manual.
 *
 * Es una lista blanca y no una negra: lo que se quiere impedir no son tres
 * campos concretos sino que cualquier columna nueva del esquema quede
 * escribible por accidente desde aquí. `orden_compra` y `folio_ot` tienen sus
 * propios flujos, con su permiso y su escritura en la OT.
 */
const CAMPOS_EDITABLES = [
  "titulo",
  "dirigidaA",
  "prioridad",
  "elaboro",
  "fechaEntrega",
  "montoMxn",
  "montoUsd",
  "estatus",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  const key = parseCotKey(params.key);
  if (!key) return NextResponse.json({ error: "Llave inválida" }, { status: 400 });

  let body: {
    titulo?: string;
    dirigidaA?: string;
    prioridad?: Prioridad;
    elaboro?: string;
    fechaEntrega?: string | null;
    /** null borra el importe; omitirlo lo deja como estaba. */
    montoMxn?: string | number | null;
    montoUsd?: string | number | null;
    estatus?: EstatusCotizacion;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // El tipo de arriba es solo de compilación: `req.json()` devuelve cualquier
  // cosa y el resto del body se le pasa entero a `updateCotizacion`. Sin esta
  // lista, un PATCH con `ordenCompra` o `folioOt` escribía esos campos con el
  // permiso `modulo.cotizaciones` —mucho más laxo que `ot.crear`— y además
  // sobre la VIGENTE, que no tiene por qué ser la versión asignada. La OC se
  // registra por su propia ruta, que escribe también en la OT.
  const rechazado = Object.keys(body as Record<string, unknown>).find(
    (campo) => !(CAMPOS_EDITABLES as readonly string[]).includes(campo),
  );
  if (rechazado) {
    return NextResponse.json(
      { error: `El campo "${rechazado}" no se edita por aquí` },
      { status: 400 },
    );
  }

  try {
    // Cambio de estatus manual (solo los estados que no pertenecen a un flujo)
    if (body.estatus) {
      if (!ESTATUS_MANUALES.includes(body.estatus)) {
        return NextResponse.json(
          { error: `El estatus ${body.estatus} solo se alcanza por su flujo (revisión, envío, OC)` },
          { status: 422 },
        );
      }
      await cambiarEstatus(key.numero, key.anio, body.estatus);
      await registrarBitacora({
        accion: "COTIZACION_ESTATUS",
        usuario: session!.user.email ?? "",
        referencia: cotPk(key.numero, key.anio),
        detalle: body.estatus,
      });
    }

    const { estatus: _e, ...campos } = body;
    if (Object.keys(campos).length > 0) {
      await updateCotizacion(key.numero, key.anio, campos);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Transición no permitida") || msg.toLowerCase().includes("monto")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error("[erp/cotizacion PATCH]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
