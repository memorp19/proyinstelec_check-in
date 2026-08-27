import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { CotizacionesClient } from "./CotizacionesClient";

export default async function CotizacionesPage() {
  const session = await getServerSession(authOptions);
  if (!session || !tienePermiso(session.user, "modulo.cotizaciones")) {
    redirect("/acceso-denegado");
  }
  return (
    <CotizacionesClient
      puedeEnviar={tienePermiso(session.user, "cotizaciones.enviar")}
      puedeCrearOT={tienePermiso(session.user, "ot.crear")}
    />
  );
}
