import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.rol !== "admin") redirect("/acceso-denegado");

  return <>{children}</>;
}
