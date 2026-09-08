import { redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { OTClient } from "./OTClient";

export default async function OTPage() {
  const session = await auth();
  if (!session || !tienePermiso(session.user, "modulo.ot")) {
    redirect("/acceso-denegado");
  }
  return <OTClient />;
}
