import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/auth";
import { CompletarPerfilForm } from "./_components/CompletarPerfilForm";

interface Props {
  searchParams: { pending_token?: string };
}

export default async function CompletarPerfilPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/unirse");
  }

  if (session.user.perfil_completo) {
    redirect("/app");
  }

  return (
    <main className="min-h-screen bg-navy flex flex-col items-center justify-center px-6 py-10">
      <div className="mb-6 text-center">
        <h1 className="font-head text-2xl font-bold text-white tracking-widest">
          PROYINSTELEC
        </h1>
        <p className="font-mono text-xs text-white/40 mt-1 uppercase tracking-wider">
          Completar perfil
        </p>
      </div>

      <CompletarPerfilForm
        nombreInicial={session.user.name ?? ""}
        pendingToken={searchParams.pending_token}
      />
    </main>
  );
}
