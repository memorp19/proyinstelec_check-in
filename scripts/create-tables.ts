/**
 * Creates all DynamoDB tables locally (mirrors the CDK stack schema exactly).
 * Run after `docker compose up -d`:
 *   pnpm run db:create
 */
import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
  region: "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

async function tableExists(name: string): Promise<boolean> {
  const { TableNames } = await client.send(new ListTablesCommand({}));
  return (TableNames ?? []).includes(name);
}

async function createIfNotExists(input: Parameters<typeof CreateTableCommand>[0]) {
  const name = input.TableName!;
  if (await tableExists(name)) {
    console.log(`  ⏩  ${name} — ya existe`);
    return;
  }
  await client.send(new CreateTableCommand(input));
  console.log(`  ✅  ${name} — creada`);
}

async function main() {
  console.log("🗄️  Creando tablas DynamoDB Local...\n");

  // ── proyinstelec-users ──────────────────────────────────────────────────────
  await createIfNotExists({
    TableName: "proyinstelec-users",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [{ AttributeName: "google_sub", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "google_sub", AttributeType: "S" },
      { AttributeName: "email", AttributeType: "S" },
      { AttributeName: "tipo", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "email-index",
        KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "tipo-index",
        KeySchema: [
          { AttributeName: "tipo", KeyType: "HASH" },
          { AttributeName: "google_sub", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "INCLUDE",
          NonKeyAttributes: ["nombre", "email", "foto_url", "rol", "proyectos_asignados", "perfil_completo"],
        },
      },
    ],
  });

  // ── proyinstelec-invitaciones ───────────────────────────────────────────────
  await createIfNotExists({
    TableName: "proyinstelec-invitaciones",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [{ AttributeName: "token", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "token", AttributeType: "S" },
      { AttributeName: "proyectoId", AttributeType: "S" },
      { AttributeName: "estado", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "proyecto-estado-index",
        KeySchema: [
          { AttributeName: "proyectoId", KeyType: "HASH" },
          { AttributeName: "estado", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "INCLUDE",
          NonKeyAttributes: ["token", "nombreSugerido", "creadoPor", "expiresAt", "usadaPor"],
        },
      },
    ],
  });

  // ── proyinstelec-main (single-table) ────────────────────────────────────────
  await createIfNotExists({
    TableName: "proyinstelec-main",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
      { AttributeName: "gsi1pk", AttributeType: "S" },
      { AttributeName: "gsi1sk", AttributeType: "S" },
      { AttributeName: "gsi2pk", AttributeType: "S" },
      { AttributeName: "gsi2sk", AttributeType: "S" },
      { AttributeName: "gsi3pk", AttributeType: "S" },
      { AttributeName: "gsi3sk", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "gsi1-proyecto-ts",
        KeySchema: [
          { AttributeName: "gsi1pk", KeyType: "HASH" },
          { AttributeName: "gsi1sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "gsi2-usuario-ts",
        KeySchema: [
          { AttributeName: "gsi2pk", KeyType: "HASH" },
          { AttributeName: "gsi2sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "gsi3-cliente",
        KeySchema: [
          { AttributeName: "gsi3pk", KeyType: "HASH" },
          { AttributeName: "gsi3sk", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "INCLUDE",
          NonKeyAttributes: ["pk", "sk", "nombre", "estado", "fechaInicio", "fechaFin", "proyectoId", "usuarioId"],
        },
      },
    ],
  });

  // ── proyinstelec-odoo-queue ─────────────────────────────────────────────────
  await createIfNotExists({
    TableName: "proyinstelec-odoo-queue",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "id", AttributeType: "S" },
      { AttributeName: "estado", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "estado-index",
        KeySchema: [
          { AttributeName: "estado", KeyType: "HASH" },
          { AttributeName: "id", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "INCLUDE",
          NonKeyAttributes: ["jornadaId", "google_sub", "intento", "ttl"],
        },
      },
    ],
  });

  console.log("\n✅  Todas las tablas listas.");
  console.log("📊  Admin UI: http://localhost:8001\n");
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
