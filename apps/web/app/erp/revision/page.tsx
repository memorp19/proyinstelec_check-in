import { redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { RevisionClient } from "./RevisionClient";

export default async function RevisionPage() {
  const session = await auth();
  if (!session || !tienePermiso(session.user, "cotizaciones.aprobar")) {
    redirect("/acceso-denegado");
  }
  return <RevisionClient />;
}
