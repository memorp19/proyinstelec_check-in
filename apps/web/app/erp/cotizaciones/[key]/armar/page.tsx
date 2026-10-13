import { redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { parseCotKey } from "@/src/lib/cotizaciones";
import { ArmadoClient } from "./ArmadoClient";

/**
 * La pantalla de armado de una versión.
 *
 * Solo comprueba la entrada al módulo: quién puede **editar** esta cotización
 * en particular lo decide el servidor al cargarla (`accesoAlArmado`), porque
 * depende de quién la dio de alta y de en qué estatus está. La pantalla recibe
 * esa respuesta y se dibuja de solo lectura si hace falta.
 */
export default async function ArmarPage({
  params,
  searchParams,
}: {
  params: { key: string };
  searchParams: { version?: string };
}) {
  const session = await auth();
  if (!session || !tienePermiso(session.user, "modulo.cotizaciones")) {
    redirect("/acceso-denegado");
  }
  if (!parseCotKey(params.key)) redirect("/erp/cotizaciones");

  const version = Number(searchParams.version ?? "0");
  return (
    <ArmadoClient
      cotKey={params.key}
      version={Number.isInteger(version) && version >= 0 ? version : 0}
    />
  );
}
