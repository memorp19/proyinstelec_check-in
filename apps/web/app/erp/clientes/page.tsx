import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/src/auth";
import { tienePermiso } from "@/src/lib/permisos";
import { ClientesClient } from "./ClientesClient";

export default async function ClientesPage() {
  const session = await getServerSession(authOptions);
  if (!session || !tienePermiso(session.user, "modulo.clientes")) {
    redirect("/acceso-denegado");
  }
  return <ClientesClient />;
}
