import { auth } from "@/src/auth";
import { redirect } from "next/navigation";
import { NavBar } from "./components/NavBar";

// Server-side guard — middleware already handles the redirect,
// but this adds a second layer for Server Components that bypass middleware.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/unirse?callbackUrl=/app");

  return (
    <div className="md:pl-[72px]">
      <NavBar />
      {children}
    </div>
  );
}
