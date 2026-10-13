import { NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { exigirPermiso } from "@/src/lib/permisos";
import { tipoDeCambioFix } from "@/src/lib/banxico";

/**
 * El FIX de Banxico para la cotización que se está armando.
 *
 * Responde **200 siempre**: que Banxico esté caído no es un error de quien
 * cotiza. El cuerpo dice si hay valor o por qué no, y la pantalla ofrece
 * capturarlo a mano con cualquiera de los dos.
 */
export async function GET() {
  const session = await auth();
  const rechazo = exigirPermiso(session?.user, "modulo.cotizaciones");
  if (rechazo) return NextResponse.json({ error: rechazo.error }, { status: rechazo.status });

  return NextResponse.json(await tipoDeCambioFix());
}
