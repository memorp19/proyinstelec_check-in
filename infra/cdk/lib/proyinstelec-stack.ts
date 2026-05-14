import { RemovalPolicy, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DynamoTables } from "./dynamo";
import { SsmParameters } from "./ssm";
import { LambdaApi } from "./lambda";
import { CloudFrontDistribution } from "./cloudfront";

export interface ProyinstelecStackProps extends StackProps {
  environment: "dev" | "prod";
  acmCertificateArn: string;
  domainApex: string;
  nextjsOriginDomain?: string;
}

export class ProyinstelecStack extends Stack {
  constructor(scope: Construct, id: string, props: ProyinstelecStackProps) {
    super(scope, id, props);

    const removalPolicy = props.environment === "prod"
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    // ── DynamoDB ──────────────────────────────────────────────────────────────
    const dynamo = new DynamoTables(this, "DynamoTables", { removalPolicy });

    // ── SSM (Odoo + Google OAuth + Google Drive) ───────────────────────────────
    const ssm = new SsmParameters(this, "SsmParameters");

    // ── Lambda + API Gateway ──────────────────────────────────────────────────
    const lambdaApi = new LambdaApi(this, "LambdaApi", {
      tables: {
        users: dynamo.users,
        invitaciones: dynamo.invitaciones,
        main: dynamo.main,
        odooQueue: dynamo.odooQueue,
      },
      ssmParameterArns: [
        ssm.odooUrlArn,
        ssm.odooDbArn,
        ssm.odooApiKeyArn,
        ssm.googleClientIdArn,
        ssm.googleClientSecretArn,
        ssm.nextauthSecretArn,
        ssm.driveServiceAccountEmailArn,
        ssm.driveServiceAccountKeyArn,
        ssm.driveRootFolderIdArn,
      ],
    });

    // ── CloudFront ────────────────────────────────────────────────────────────
    // Note: CloudFrontDistribution no longer has an S3 origin.
    // Photos are served via drive.google.com thumbnail URLs stored in DynamoDB.
    const cdn = new CloudFrontDistribution(this, "CloudFront", {
      acmCertificateArn: props.acmCertificateArn,
      domainApex: props.domainApex,
      api: lambdaApi.api,
      nextjsOriginDomain: props.nextjsOriginDomain,
    });

    // ── Outputs ───────────────────────────────────────────────────────────────

    new CfnOutput(this, "CloudFrontDomain", {
      description: "Point GoDaddy A (apex) and CNAME (www) here",
      value: cdn.distribution.distributionDomainName,
    });

    new CfnOutput(this, "CloudFrontDistributionId", {
      description: "Set env var CLOUDFRONT_DISTRIBUTION_ID",
      value: cdn.distribution.distributionId,
    });

    new CfnOutput(this, "ApiGatewayUrl", {
      description: "Internal API Gateway URL",
      value: lambdaApi.api.url,
    });

    new CfnOutput(this, "UsersTableName", {
      value: dynamo.users.tableName,
    });

    new CfnOutput(this, "MainTableName", {
      value: dynamo.main.tableName,
    });

    new CfnOutput(this, "SsmDriveKeyPath", {
      description: "Set Drive service account key as SecureString at this path",
      value: "/proyinstelec/drive/service-account-key",
    });
  }
}
