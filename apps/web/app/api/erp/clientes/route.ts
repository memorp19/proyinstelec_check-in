import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import {
  buscarEmpresasParecidas,
  createClienteEmpresa,
  createContacto,
  listClientes,
  listContactos,
} from "@/src/lib/clientes";
import { registrarBitacora } from "@/src/lib/bitacora";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const rechazo = exigirPermiso(session?.user, "modulo.clientes");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  try {
    const buscar = req.nextUrl.searchParams.get("buscar")?.toLowerCase() ?? "";
    const empresas = await listClientes();
    const conContactos = await Promise.all(
      empresas.map(async (e) => ({ ...e, contactos: await listContactos(e.cliente_id) })),
    );
    const filtradas = buscar
      ? conContactos.filter(
          (e) =>
            e.razon_social.toLowerCase().includes(buscar) ||
            e.contactos.some((c) => c.nombre.toLowerCase().includes(buscar)),
        )
      : conContactos;
    return NextResponse.json({ clientes: filtradas });
  } catch (err) {
    console.error("[erp/clientes GET]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const rechazo = exigirPermiso(session?.user, "modulo.clientes");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  let body: {
    razonSocial?: string;
    direccion?: string;
    contacto?: { nombre?: string; puesto?: string; telefono?: string; correo?: string };
    /** true = el usuario confirmó usar la empresa parecida encontrada */
    usarEmpresaId?: string;
    /** true = el usuario confirmó crear pese a coincidencias parciales */
    confirmarNueva?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.contacto?.nombre?.trim()) {
    return NextResponse.json({ error: "El nombre del contacto es obligatorio" }, { status: 400 });
  }

  try {
    let clienteId = body.usarEmpresaId;

    if (!clienteId) {
      if (!body.razonSocial?.trim()) {
        return NextResponse.json({ error: "La razón social es obligatoria" }, { status: 400 });
      }
      // Verificación de empresa existente (regla del legacy):
      // exacta → se reutiliza automáticamente; parcial → requiere confirmación
      const parecidas = await buscarEmpresasParecidas(body.razonSocial);
      const exacta = parecidas.find((p) => p.match === "exacta");
      if (exacta) {
        clienteId = exacta.empresa.cliente_id;
      } else if (parecidas.length > 0 && !body.confirmarNueva) {
        return NextResponse.json(
          {
            error: "Hay empresas con nombre parecido",
            candidatos: parecidas.map((p) => ({
              cliente_id: p.empresa.cliente_id,
              razon_social: p.empresa.razon_social,
              direccion: p.empresa.direccion,
              match: p.match,
            })),
          },
          { status: 409 },
        );
      } else {
        const empresa = await createClienteEmpresa({
          razonSocial: body.razonSocial,
          direccion: body.direccion,
          createdBy: session!.user.email ?? "",
        });
        clienteId = empresa.cliente_id;
      }
    }

    const contacto = await createContacto({
      clienteId,
      nombre: body.contacto.nombre,
      puesto: body.contacto.puesto,
      telefono: body.contacto.telefono,
      correo: body.contacto.correo,
    });

    await registrarBitacora({
      accion: "CLIENTE_ALTA",
      usuario: session!.user.email ?? "",
      referencia: `CLIENTE#${clienteId}`,
      detalle: `${body.razonSocial ?? clienteId} · ${body.contacto.nombre}`,
    });

    return NextResponse.json({ clienteId, contacto }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("ya existe")) return NextResponse.json({ error: msg }, { status: 409 });
    console.error("[erp/clientes POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
