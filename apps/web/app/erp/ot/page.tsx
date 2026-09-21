import { redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { OTClient } from "./OTClient";

export default async function OTPage() {
  const session = await auth();
  if (!session || !tienePermiso(session.user, "modulo.ot")) {
    redirect("/acceso-denegado");
  }
  // La UI solo esconde; quien autoriza de verdad es `exigirPermiso` en la ruta.
  return <OTClient puedeReasignar={tienePermiso(session.user, "ot.reasignar")} />;
}
