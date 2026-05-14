import { Duration } from "aws-cdk-lib";
import {
  Cors,
  LambdaIntegration,
  MethodLoggingLevel,
  Period,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Architecture, Code, Function, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export interface LambdaApiProps {
  tables: {
    users: Table;
    invitaciones: Table;
    main: Table;
    odooQueue: Table;
  };
  /** SSM parameter ARNs to grant read access (Drive + Odoo + Google OAuth) */
  ssmParameterArns: string[];
}

const LAMBDA_DEFAULTS = {
  runtime: Runtime.NODEJS_22_X,
  architecture: Architecture.ARM_64,
  memorySize: 256,
  timeout: Duration.seconds(29),
  tracing: Tracing.ACTIVE,
  code: Code.fromInline(`
    exports.handler = async (event) => ({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skeleton — not yet implemented' }),
    });
  `),
  handler: "index.handler",
  environment: {
    NODE_ENV: "production",
    TZ: "UTC",
  },
};

export class LambdaApi extends Construct {
  readonly api: RestApi;
  readonly checkinHandler: Function;
  readonly checkoutHandler: Function;
  readonly evidenciaHandler: Function;
  readonly photoUploadHandler: Function;  // replaces presigned URL handler
  readonly invitacionHandler: Function;
  readonly adminHandler: Function;
  readonly odooRetryHandler: Function;

  constructor(scope: Construct, id: string, props: LambdaApiProps) {
    super(scope, id);

    // ── Shared execution role ─────────────────────────────────────────────────
    const executionRole = new Role(this, "LambdaExecutionRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"),
      ],
    });

    // SSM read access — Odoo creds + Google Drive service account key
    executionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: props.ssmParameterArns,
      }),
    );

    // No S3 permissions needed — files go directly to Google Drive via HTTPS

    // ── DynamoDB permissions ──────────────────────────────────────────────────
    props.tables.users.grantReadWriteData(executionRole);
    props.tables.invitaciones.grantReadWriteData(executionRole);
    props.tables.main.grantReadWriteData(executionRole);
    props.tables.odooQueue.grantReadWriteData(executionRole);

    // ── Lambda functions ──────────────────────────────────────────────────────

    const fnEnv = {
      USERS_TABLE: props.tables.users.tableName,
      INVITACIONES_TABLE: props.tables.invitaciones.tableName,
      MAIN_TABLE: props.tables.main.tableName,
      ODOO_QUEUE_TABLE: props.tables.odooQueue.tableName,
      ODOO_URL_PARAM: "/proyinstelec/odoo/url",
      ODOO_DB_PARAM: "/proyinstelec/odoo/db",
      ODOO_API_KEY_PARAM: "/proyinstelec/odoo/api-key",
      DRIVE_SERVICE_ACCOUNT_EMAIL_PARAM: "/proyinstelec/drive/service-account-email",
      DRIVE_SERVICE_ACCOUNT_KEY_PARAM: "/proyinstelec/drive/service-account-key",
      DRIVE_ROOT_FOLDER_ID_PARAM: "/proyinstelec/drive/root-folder-id",
    };

    this.checkinHandler = new Function(this, "CheckinHandler", {
      ...LAMBDA_DEFAULTS,
      functionName: "proyinstelec-checkin",
      description: "Saves check-in to DynamoDB and fires async Odoo sync",
      role: executionRole,
      environment: fnEnv,
    });

    this.checkoutHandler = new Function(this, "CheckoutHandler", {
      ...LAMBDA_DEFAULTS,
      functionName: "proyinstelec-checkout",
      description: "Closes jornada, updates Odoo hr.attendance check_out",
      role: executionRole,
      environment: fnEnv,
    });

    this.evidenciaHandler = new Function(this, "EvidenciaHandler", {
      ...LAMBDA_DEFAULTS,
      functionName: "proyinstelec-evidencia",
      description: "Stores evidencia record (driveFileIds + note) linked to jornada",
      role: executionRole,
      environment: fnEnv,
    });

    // Photo upload: client sends base64 → Lambda decodes → uploads to Drive
    // Timeout extended to 60 s for large image uploads
    this.photoUploadHandler = new Function(this, "PhotoUploadHandler", {
      ...LAMBDA_DEFAULTS,
      functionName: "proyinstelec-photo-upload",
      description: "Receives base64 photo from client, uploads to Google Drive, returns driveFileId",
      role: executionRole,
      timeout: Duration.seconds(60),
      memorySize: 512, // needs more RAM for base64 decode + Drive upload
      environment: fnEnv,
    });

    this.invitacionHandler = new Function(this, "InvitacionHandler", {
      ...LAMBDA_DEFAULTS,
      functionName: "proyinstelec-invitacion",
      description: "Creates and validates temporary worker invitation tokens",
      role: executionRole,
      environment: fnEnv,
    });

    this.adminHandler = new Function(this, "AdminHandler", {
      ...LAMBDA_DEFAULTS,
      functionName: "proyinstelec-admin",
      description: "Admin-only: user management, project CRUD, reports",
      role: executionRole,
      environment: fnEnv,
    });

    this.odooRetryHandler = new Function(this, "OdooRetryHandler", {
      ...LAMBDA_DEFAULTS,
      functionName: "proyinstelec-odoo-retry",
      description: "Retries failed Odoo sync items from the odoo-queue table",
      role: executionRole,
      timeout: Duration.minutes(5),
      environment: fnEnv,
    });

    // ── API Gateway ───────────────────────────────────────────────────────────

    this.api = new RestApi(this, "Api", {
      restApiName: "proyinstelec-api",
      description: "Proyinstelec Field App — REST API",
      deployOptions: {
        stageName: "prod",
        loggingLevel: MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
        metricsEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ["https://proyinstelec.com", "https://www.proyinstelec.com"],
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: Duration.hours(1),
      },
    });

    // ── Routes ────────────────────────────────────────────────────────────────

    const v1 = this.api.root.addResource("v1");

    // Jornada
    const jornada = v1.addResource("jornada");
    jornada.addMethod("POST", new LambdaIntegration(this.checkinHandler));

    const jornadaId = jornada.addResource("{jornadaId}");
    jornadaId.addMethod("PATCH", new LambdaIntegration(this.checkoutHandler));

    // Evidencia
    const evidencia = jornadaId.addResource("evidencia");
    evidencia.addMethod("POST", new LambdaIntegration(this.evidenciaHandler));

    // Photo upload (replaces presigned URL pattern)
    const upload = v1.addResource("upload");
    upload.addMethod("POST", new LambdaIntegration(this.photoUploadHandler));

    // Invitación
    const invitacion = v1.addResource("invitacion");
    invitacion.addMethod("POST", new LambdaIntegration(this.invitacionHandler));
    const invToken = invitacion.addResource("{token}");
    invToken.addMethod("GET", new LambdaIntegration(this.invitacionHandler));

    // Admin proxy
    const admin = v1.addResource("admin");
    const adminProxy = admin.addResource("{proxy+}");
    adminProxy.addMethod("ANY", new LambdaIntegration(this.adminHandler));

    // ── Usage plan ────────────────────────────────────────────────────────────
    const usagePlan = this.api.addUsagePlan("DefaultUsagePlan", {
      name: "proyinstelec-default",
      throttle: { rateLimit: 50, burstLimit: 100 },
      quota: { limit: 50_000, period: Period.DAY },
    });
    usagePlan.addApiStage({ api: this.api, stage: this.api.deploymentStage });
  }
}
