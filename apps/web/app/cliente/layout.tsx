import { auth } from "@/src/auth";
import { redirect } from "next/navigation";
import { AppHeader } from "../_components/AppHeader";

export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/acceso-denegado");
  if (session.user.rol !== "cliente" && session.user.rol !== "admin") redirect("/acceso-denegado");

  return (
    <>
      <AppHeader />
      <div className="pt-[52px]">{children}</div>
    </>
  );
}
