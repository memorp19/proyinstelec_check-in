import { auth } from "@/src/auth";
import { redirect } from "next/navigation";
import { AppHeader } from "../_components/AppHeader";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.rol !== "admin") redirect("/acceso-denegado");

  return (
    <>
      <AppHeader />
      <div className="pt-[52px]">{children}</div>
    </>
  );
}
