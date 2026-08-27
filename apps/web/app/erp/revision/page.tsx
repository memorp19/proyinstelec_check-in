import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { RevisionClient } from "./RevisionClient";

export default async function RevisionPage() {
  const session = await getServerSession(authOptions);
  if (!session || !tienePermiso(session.user, "cotizaciones.aprobar")) {
    redirect("/acceso-denegado");
  }
  return <RevisionClient />;
}
