import { auth } from "@/src/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.rol !== "admin") redirect("/acceso-denegado");

  return <>{children}</>;
}
