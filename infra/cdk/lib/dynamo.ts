import { RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  StreamViewType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export interface DynamoTablesProps {
  /**
   * Set DESTROY only for non-prod environments.
   * Prod must use RETAIN.
   */
  removalPolicy: RemovalPolicy;
}

export class DynamoTables extends Construct {
  /** user_roles — auth-critical, keyed by google_sub */
  readonly users: Table;

  /** Token-based invitations for temporary workers */
  readonly invitaciones: Table;

  /**
   * Single-table for Proyectos, Jornadas, Evidencias.
   * PK / SK pattern:
   *   PROYECTO#<id>         / #METADATA
   *   JORNADA#<id>          / #METADATA
   *   JORNADA#<jornadaId>   / EVIDENCIA#<evidenciaId>
   *
   * GSI sparse attributes:
   *   gsi1pk / gsi1sk  — queries by proyectoId + timestamp
   *   gsi2pk / gsi2sk  — queries by usuarioId  + timestamp
   *   gsi3pk / gsi3sk  — queries by clienteId  + proyectoId
   */
  readonly main: Table;

  /** Fire-and-forget Odoo sync retries, TTL = 7 days */
  readonly odooQueue: Table;

  constructor(scope: Construct, id: string, props: DynamoTablesProps) {
    super(scope, id);

    // ── users ────────────────────────────────────────────────────────────────
    this.users = new Table(this, "Users", {
      tableName: "proyinstelec-users",
      partitionKey: { name: "google_sub", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: props.removalPolicy,
    });

    // Look up user by email (NextAuth login)
    this.users.addGlobalSecondaryIndex({
      indexName: "email-index",
      partitionKey: { name: "email", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // List all users by type (admin dashboard: list all planta / temporal)
    this.users.addGlobalSecondaryIndex({
      indexName: "tipo-index",
      partitionKey: { name: "tipo", type: AttributeType.STRING },
      sortKey: { name: "google_sub", type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ["nombre", "email", "foto_url", "rol", "proyectos_asignados", "perfil_completo"],
    });

    // ── invitaciones ─────────────────────────────────────────────────────────
    this.invitaciones = new Table(this, "Invitaciones", {
      tableName: "proyinstelec-invitaciones",
      partitionKey: { name: "token", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // DynamoDB native TTL — items expire automatically after expiresAt
      timeToLiveAttribute: "expiresAt",
      removalPolicy: props.removalPolicy,
    });

    // List all invitations for a project (admin view), filter by status in app layer
    this.invitaciones.addGlobalSecondaryIndex({
      indexName: "proyecto-estado-index",
      partitionKey: { name: "proyectoId", type: AttributeType.STRING },
      sortKey: { name: "estado", type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ["token", "nombreSugerido", "creadoPor", "expiresAt", "usadaPor"],
    });

    // ── main (single-table) ──────────────────────────────────────────────────
    this.main = new Table(this, "Main", {
      tableName: "proyinstelec-main",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      // Stream for future event-driven integrations (e.g. Odoo retry processor)
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: props.removalPolicy,
    });

    // GSI 1 — jornadas + evidencias by project + timestamp
    // Item shape: gsi1pk = proyectoId, gsi1sk = timestamp (ISO UTC)
    this.main.addGlobalSecondaryIndex({
      indexName: "gsi1-proyecto-ts",
      partitionKey: { name: "gsi1pk", type: AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI 2 — jornadas by usuario + timestamp (worker history)
    // Item shape: gsi2pk = usuarioId (google_sub), gsi2sk = timestamp (ISO UTC)
    this.main.addGlobalSecondaryIndex({
      indexName: "gsi2-usuario-ts",
      partitionKey: { name: "gsi2pk", type: AttributeType.STRING },
      sortKey: { name: "gsi2sk", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI 3 — projects + jornadas by client (portal cliente isolation)
    // Item shape: gsi3pk = clienteId, gsi3sk = PROYECTO#<id> or JORNADA#<id>
    this.main.addGlobalSecondaryIndex({
      indexName: "gsi3-cliente",
      partitionKey: { name: "gsi3pk", type: AttributeType.STRING },
      sortKey: { name: "gsi3sk", type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ["pk", "sk", "nombre", "estado", "fechaInicio", "fechaFin", "proyectoId", "usuarioId"],
    });

    // ── odoo_sync_queue ──────────────────────────────────────────────────────
    this.odooQueue = new Table(this, "OdooQueue", {
      tableName: "proyinstelec-odoo-queue",
      partitionKey: { name: "id", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // Items auto-deleted 7 days after createdAt + 7*86400
      timeToLiveAttribute: "ttl",
      removalPolicy: props.removalPolicy,
    });

    // Retry processor queries pending items; also useful to monitor error items
    this.odooQueue.addGlobalSecondaryIndex({
      indexName: "estado-index",
      partitionKey: { name: "estado", type: AttributeType.STRING },
      sortKey: { name: "id", type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ["jornadaId", "google_sub", "intento", "ttl"],
    });
  }
}
