import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { redirect } from "next/navigation";

export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.rol !== "cliente") redirect("/acceso-denegado");

  return <>{children}</>;
}
