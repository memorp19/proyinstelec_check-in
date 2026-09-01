import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { deleteContacto, updateContacto } from "@/src/lib/clientes";
import { registrarBitacora } from "@/src/lib/bitacora";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; contactoId: string } },
) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.clientes");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  let body: { puesto?: string | null; telefono?: string | null; correo?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  try {
    await updateContacto(params.id, params.contactoId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[erp/contacto PATCH]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; contactoId: string } },
) {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.clientes");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  try {
    await deleteContacto(params.id, params.contactoId);
    await registrarBitacora({
      accion: "CLIENTE_CONTACTO_BAJA",
      usuario: session!.user.email ?? "",
      referencia: `CLIENTE#${params.id}`,
      detalle: params.contactoId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[erp/contacto DELETE]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
