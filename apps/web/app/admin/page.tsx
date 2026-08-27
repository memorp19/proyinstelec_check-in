import { auth } from "@/src/auth";
import { listEmpresas, listProyectos } from "@/src/lib/proyectos";
import { listUsers } from "@/src/lib/users";
import { DEMO_MODE, DEMO_USERS } from "@/src/demo";
import { AdminClient } from "./components/AdminClient";

export default async function AdminDashboard() {
  const session = await auth();
  const esSuperAdmin = session?.user?.es_super_admin ?? false;

  const [empresas, proyectos, usuarios] = await Promise.all([
    listEmpresas().catch(() => []),
    listProyectos().catch(() => []),
    esSuperAdmin && !DEMO_MODE ? listUsers().catch(() => []) : Promise.resolve([]),
  ]);

  const usuariosIniciales = DEMO_MODE && esSuperAdmin ? DEMO_USERS : usuarios;

  return (
    <AdminClient
      empresas={empresas}
      proyectosIniciales={proyectos}
      esSuperAdmin={esSuperAdmin}
      usuariosIniciales={usuariosIniciales}
    />
  );
}
