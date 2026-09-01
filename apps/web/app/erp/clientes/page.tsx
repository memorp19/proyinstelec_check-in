import { redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { ClientesClient } from "./ClientesClient";

export default async function ClientesPage() {
  const session = await auth();
  if (!session || !tienePermiso(session.user, "modulo.clientes")) {
    redirect("/acceso-denegado");
  }
  return <ClientesClient />;
}
