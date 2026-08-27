/**
 * Seeds local DynamoDB with test data for development.
 * Run after create-tables:
 *   pnpm run db:seed
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const now = new Date().toISOString();
const WEEK_SECS = 7 * 24 * 60 * 60;
const futureTs = Math.floor(Date.now() / 1000) + WEEK_SECS;

async function put(TableName: string, Item: Record<string, unknown>) {
  await client.send(new PutCommand({ TableName, Item }));
}

async function main() {
  console.log("🌱  Sembrando datos de prueba...\n");

  // ── Usuarios ─────────────────────────────────────────────────────────────────

  // Super admin — placeholder google_sub se reemplaza automáticamente al primer login con Google
  await put("proyinstelec-users", {
    google_sub: "superadmin-placeholder-memorp19",
    email: "memorp19@gmail.com",
    nombre: "Super Admin",
    foto_url: null,
    tipo: "admin",
    rol: "admin",
    odoo_sync: false,
    perfil_completo: true,
    proyectos_asignados: [],
    created_at: now,
    updated_at: now,
  });
  console.log("  👑  Super Admin: memorp19@gmail.com");

  await put("proyinstelec-users", {
    google_sub: "admin-local-001",
    email: "admin@proyinstelec.mx",
    nombre: "Mario Rodríguez",
    foto_url: null,
    tipo: "admin",
    rol: "admin",
    odoo_sync: false,
    perfil_completo: true,
    proyectos_asignados: [],
    iniciales: "MARO",
    gerencia: "Administración",
    created_at: now,
    updated_at: now,
  });
  console.log("  👤  Admin: admin@proyinstelec.mx");

  // Usuaria del ERP sin rol admin: permisos explícitos (equipo comercial)
  await put("proyinstelec-users", {
    google_sub: "comercial-local-001",
    email: "maria@proyinstelec.mx",
    nombre: "María Álvarez",
    foto_url: null,
    tipo: "planta",
    rol: "campo",
    odoo_sync: false,
    perfil_completo: true,
    proyectos_asignados: [],
    iniciales: "MNAA",
    gerencia: "Administración",
    permisos: [
      "modulo.cotizaciones",
      "modulo.clientes",
      "dashboard.cotizaciones",
      "cotizaciones.enviar",
      "modulo.weekly",
    ],
    created_at: now,
    updated_at: now,
  });
  console.log("  👤  Comercial (permisos ERP): maria@proyinstelec.mx");

  await put("proyinstelec-users", {
    google_sub: "planta-local-001",
    email: "carlos@proyinstelec.mx",
    nombre: "Carlos Reyes",
    foto_url: null,
    tipo: "planta",
    rol: "campo",
    odoo_sync: true,
    perfil_completo: true,
    proyectos_asignados: ["proyecto-polanco-001"],
    created_at: now,
    updated_at: now,
  });
  console.log("  👤  Planta: carlos@proyinstelec.mx");

  await put("proyinstelec-users", {
    google_sub: "temporal-local-001",
    email: "temporal@gmail.com",
    nombre: "Juan Hernández",
    foto_url: null,
    tipo: "temporal",
    rol: "campo",
    odoo_sync: false,
    perfil_completo: false,
    proyectos_asignados: [],
    created_at: now,
    updated_at: now,
  });
  console.log("  👤  Temporal (sin completar): temporal@gmail.com");

  // ── Proyectos (main table) ────────────────────────────────────────────────────

  await put("proyinstelec-main", {
    pk: "PROYECTO#proyecto-polanco-001",
    sk: "#METADATA",
    id: "proyecto-polanco-001",
    nombre: "Subestación Polanco",
    clienteId: "cliente-bbva-001",
    estado: "activo",
    fechaInicio: "2026-03-01",
    fechaFin: "2026-06-15",
    trabajadores: ["planta-local-001"],
    gsi3pk: "cliente-bbva-001",
    gsi3sk: "PROYECTO#proyecto-polanco-001",
    created_at: now,
  });
  console.log("  🏗️   Proyecto: Subestación Polanco");

  await put("proyinstelec-main", {
    pk: "PROYECTO#proyecto-toluca-001",
    sk: "#METADATA",
    id: "proyecto-toluca-001",
    nombre: "Planta Toluca",
    clienteId: "cliente-toluca-001",
    estado: "activo",
    fechaInicio: "2026-04-01",
    fechaFin: "2026-07-30",
    trabajadores: [],
    gsi3pk: "cliente-toluca-001",
    gsi3sk: "PROYECTO#proyecto-toluca-001",
    created_at: now,
  });
  console.log("  🏗️   Proyecto: Planta Toluca");

  // ── Invitación activa ─────────────────────────────────────────────────────────

  await put("proyinstelec-invitaciones", {
    token: "dev-token-valido-12345",
    proyectoId: "proyecto-toluca-001",
    creadoPor: "admin-local-001",
    nombreSugerido: "Trabajador de Prueba",
    estado: "pendiente",
    expiresAt: futureTs,
  });
  console.log("  🔗  Token de invitación: dev-token-valido-12345");

  // ── Configuración del ERP (áreas para avisos de OT) ──────────────────────────

  await put("proyinstelec-main", {
    pk: "CONFIG#erp",
    sk: "#METADATA",
    areas_ot: [
      { clave: "ESTUDIOS_ELECTRICOS", nombre: "Estudios Eléctricos", correo: "" },
      { clave: "PROTECCIONES", nombre: "Protecciones", correo: "" },
      { clave: "MANTENIMIENTOS", nombre: "Mantenimientos", correo: "" },
      { clave: "ADMINISTRACION", nombre: "Administración", correo: "" },
    ],
    cc_aviso_ot: [],
    updated_at: now,
  });
  console.log("  ⚙️   Config ERP: áreas de OT (captura los correos en el ítem CONFIG#erp)");
  console.log(`      URL: http://localhost:3000/unirse?token=dev-token-valido-12345`);

  console.log("\n✅  Datos de prueba listos.\n");
  console.log("Cuentas disponibles (inicia sesión con Google):");
  console.log("  Super Admin → memorp19@gmail.com  (migración automática al primer login)");
  console.log("  Admin       → admin@proyinstelec.mx");
  console.log("  Planta      → carlos@proyinstelec.mx");
  console.log("  Temporal    → cualquier cuenta Google + token arriba\n");
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
