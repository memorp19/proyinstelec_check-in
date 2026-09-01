/**
 * Siembra la base de Neon con datos de desarrollo.
 *   pnpm db:seed
 *
 * Idempotente: se puede correr varias veces. Los usuarios se crean "sembrados"
 * (sin cuenta de Google todavía); al entrar con Google, Auth.js los enlaza por
 * correo y conserva su rol y permisos.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../apps/web/src/db/schema";

config({ path: "apps/web/.env.local" });

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}

const db = drizzle(neon(process.env.DATABASE_URL), { schema });
const { users, empresas, proyectos, proyectoUsuarios, invitaciones, configErp } = schema;

async function sembrarUsuario(u: {
  email: string;
  nombre: string;
  tipo: "planta" | "temporal" | "admin" | "cliente";
  rol: "campo" | "admin" | "cliente";
  iniciales?: string;
  gerencia?: string;
  permisos?: string[];
  perfilCompleto?: boolean;
  esSuperAdmin?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: u.email.toLowerCase(),
      name: u.nombre,
      tipo: u.tipo,
      rol: u.rol,
      iniciales: u.iniciales,
      gerencia: u.gerencia,
      permisos: u.permisos ?? [],
      perfilCompleto: u.perfilCompleto ?? true,
      odooSync: u.tipo === "planta",
      esSuperAdmin: u.esSuperAdmin ?? false,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: u.nombre,
        rol: u.rol,
        tipo: u.tipo,
        esSuperAdmin: u.esSuperAdmin ?? false,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });
  console.log(`  ${u.esSuperAdmin ? "👑" : "👤"}  ${u.rol.padEnd(7)} ${u.email}`);
  return row.id;
}

async function main() {
  console.log("🌱  Sembrando datos de desarrollo...\n");

  // ── Usuarios ────────────────────────────────────────────────────────────────
  const adminId = await sembrarUsuario({
    email: "memorp19@gmail.com",
    esSuperAdmin: true,
    nombre: "Super Admin",
    tipo: "admin",
    rol: "admin",
    iniciales: "GRP",
    gerencia: "Dirección",
  });

  await sembrarUsuario({
    email: "soporteit@proyinstelec.com",
    esSuperAdmin: true,
    nombre: "Soporte IT",
    tipo: "admin",
    rol: "admin",
    iniciales: "SIT",
    gerencia: "Dirección",
  });

  await sembrarUsuario({
    email: "jorge.gutierrez@proyinstelec.mx",
    esSuperAdmin: true,
    nombre: "Jorge Gutiérrez",
    tipo: "admin",
    rol: "admin",
    iniciales: "JOGU",
    gerencia: "Dirección",
  });

  await sembrarUsuario({
    email: "admin@proyinstelec.mx",
    nombre: "Mario Rodríguez",
    tipo: "admin",
    rol: "admin",
    iniciales: "MARO",
    gerencia: "Administración",
  });

  // Colaboradora del área comercial: sin rol admin, con permisos explícitos
  await sembrarUsuario({
    email: "maria@proyinstelec.mx",
    nombre: "María Álvarez",
    tipo: "planta",
    rol: "campo",
    iniciales: "MNAA",
    gerencia: "Administración",
    permisos: [
      "modulo.cotizaciones",
      "modulo.clientes",
      "dashboard.cotizaciones",
      "cotizaciones.enviar",
      "modulo.weekly",
    ],
  });

  const revisorId = await sembrarUsuario({
    email: "eduardo@proyinstelec.mx",
    nombre: "Eduardo Ocampo",
    tipo: "planta",
    rol: "campo",
    iniciales: "EAOL",
    gerencia: "Dirección",
    permisos: [
      "modulo.cotizaciones",
      "modulo.clientes",
      "dashboard.cotizaciones",
      "cotizaciones.enviar",
      "cotizaciones.aprobar",
      "ot.crear",
      "modulo.ot",
    ],
  });

  const trabajadorId = await sembrarUsuario({
    email: "carlos@proyinstelec.mx",
    nombre: "Carlos Reyes",
    tipo: "planta",
    rol: "campo",
    iniciales: "CARE",
    gerencia: "Operación",
  });

  // ── Empresas y proyectos ────────────────────────────────────────────────────
  const [empresa] = await db
    .insert(empresas)
    .values({ nombre: "Grupo Industrial Norte" })
    .returning();
  console.log(`  🏢  Empresa: ${empresa.nombre}`);

  const [proyecto] = await db
    .insert(proyectos)
    .values({
      empresaId: empresa.id,
      nombre: "Subestación Polanco",
      descripcion: "Mantenimiento mayor de subestación",
      estado: "activo",
    })
    .returning();
  console.log(`  🏗️   Proyecto: ${proyecto.nombre}`);

  await db
    .insert(proyectoUsuarios)
    .values([
      { proyectoId: proyecto.id, usuarioId: trabajadorId },
      { proyectoId: proyecto.id, usuarioId: revisorId },
    ])
    .onConflictDoNothing();

  // ── Invitación de prueba ────────────────────────────────────────────────────
  const token = "dev-token-valido-12345";
  const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db
    .insert(invitaciones)
    .values({
      token,
      proyectoId: proyecto.id,
      creadoPor: adminId,
      nombreSugerido: "Trabajador de Prueba",
      estado: "pendiente",
      expiresAt: expira,
    })
    .onConflictDoUpdate({
      target: invitaciones.token,
      set: { estado: "pendiente", expiresAt: expira, usadaPor: null },
    });
  console.log(`  🔗  Invitación: /unirse?token=${token}`);

  // ── Configuración del ERP ───────────────────────────────────────────────────
  await db
    .insert(configErp)
    .values({
      clave: "erp",
      valor: {
        areas_ot: [
          { clave: "ESTUDIOS_ELECTRICOS", nombre: "Estudios Eléctricos", correo: "" },
          { clave: "PROTECCIONES", nombre: "Protecciones", correo: "" },
          { clave: "MANTENIMIENTOS", nombre: "Mantenimientos", correo: "" },
          { clave: "ADMINISTRACION", nombre: "Administración", correo: "" },
        ],
        cc_aviso_ot: [],
      },
    })
    .onConflictDoUpdate({ target: configErp.clave, set: { updatedAt: new Date() } });
  console.log("  ⚙️   Config ERP: áreas de OT (captura los correos cuando las tengas)");

  const total = await db.select().from(users);
  console.log(`\n✅  Listo: ${total.length} usuarios en la base.`);
  console.log("    Entra con Google usando cualquiera de esos correos.\n");
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
