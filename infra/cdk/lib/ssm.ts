import {
  ParameterDataType,
  ParameterTier,
  StringParameter,
} from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

/**
 * All SSM parameters use Standard tier (free).
 *
 * Sensitive values are created as String placeholders here.
 * Set real values as SecureString via CLI before first Lambda invocation:
 *
 *   aws ssm put-parameter --name /proyinstelec/odoo/api-key \
 *     --value "REAL_VALUE" --type SecureString --overwrite
 *
 * CDK does not manage SecureString directly (no CloudFormation support).
 */
export class SsmParameters extends Construct {
  readonly odooUrlArn: string;
  readonly odooDbArn: string;
  readonly odooApiKeyArn: string;
  readonly googleClientIdArn: string;
  readonly googleClientSecretArn: string;
  readonly nextauthSecretArn: string;
  // Google Drive service account (replaces S3)
  readonly driveServiceAccountEmailArn: string;
  readonly driveServiceAccountKeyArn: string;
  readonly driveRootFolderIdArn: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // ── Odoo ─────────────────────────────────────────────────────────────────

    const odooUrl = new StringParameter(this, "OdooUrl", {
      parameterName: "/proyinstelec/odoo/url",
      description: "Base URL of the Odoo instance, e.g. https://miempresa.odoo.com",
      stringValue: "PLACEHOLDER_REPLACE_BEFORE_DEPLOY",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    const odooDB = new StringParameter(this, "OdooDB", {
      parameterName: "/proyinstelec/odoo/db",
      description: "Odoo database name",
      stringValue: "PLACEHOLDER_REPLACE_BEFORE_DEPLOY",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    const odooApiKey = new StringParameter(this, "OdooApiKey", {
      parameterName: "/proyinstelec/odoo/api-key",
      description: "Odoo API key (replace with SecureString via CLI)",
      stringValue: "PLACEHOLDER_SET_AS_SECURESTRING_VIA_CLI",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    // ── Google OAuth ─────────────────────────────────────────────────────────

    const googleClientId = new StringParameter(this, "GoogleClientId", {
      parameterName: "/proyinstelec/google/client-id",
      description: "Google OAuth 2.0 client ID for the proyinstelec.com domain",
      stringValue: "PLACEHOLDER_REPLACE_BEFORE_DEPLOY",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    const googleClientSecret = new StringParameter(this, "GoogleClientSecret", {
      parameterName: "/proyinstelec/google/client-secret",
      description: "Google OAuth 2.0 client secret (replace with SecureString via CLI)",
      stringValue: "PLACEHOLDER_SET_AS_SECURESTRING_VIA_CLI",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    // ── NextAuth ─────────────────────────────────────────────────────────────

    const nextauthSecret = new StringParameter(this, "NextauthSecret", {
      parameterName: "/proyinstelec/nextauth/secret",
      description: "NEXTAUTH_SECRET — random 32-byte string (replace with SecureString via CLI)",
      stringValue: "PLACEHOLDER_SET_AS_SECURESTRING_VIA_CLI",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    // ── Google Drive service account (file storage — replaces S3) ─────────────
    // Setup steps: see docs/setup-google-drive.md

    const driveEmail = new StringParameter(this, "DriveServiceAccountEmail", {
      parameterName: "/proyinstelec/drive/service-account-email",
      description: "Email of the Google service account used to upload to Drive",
      stringValue: "PLACEHOLDER_REPLACE_BEFORE_DEPLOY",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    const driveKey = new StringParameter(this, "DriveServiceAccountKey", {
      parameterName: "/proyinstelec/drive/service-account-key",
      description: "Full JSON key of the service account (replace with SecureString via CLI)",
      stringValue: "PLACEHOLDER_SET_AS_SECURESTRING_VIA_CLI",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    const driveFolderId = new StringParameter(this, "DriveRootFolderId", {
      parameterName: "/proyinstelec/drive/root-folder-id",
      description: "Drive folder ID of 'Proyinstelec Field App' — shared with the service account",
      stringValue: "PLACEHOLDER_REPLACE_BEFORE_DEPLOY",
      tier: ParameterTier.STANDARD,
      dataType: ParameterDataType.TEXT,
    });

    this.odooUrlArn = odooUrl.parameterArn;
    this.odooDbArn = odooDB.parameterArn;
    this.odooApiKeyArn = odooApiKey.parameterArn;
    this.googleClientIdArn = googleClientId.parameterArn;
    this.googleClientSecretArn = googleClientSecret.parameterArn;
    this.nextauthSecretArn = nextauthSecret.parameterArn;
    this.driveServiceAccountEmailArn = driveEmail.parameterArn;
    this.driveServiceAccountKeyArn = driveKey.parameterArn;
    this.driveRootFolderIdArn = driveFolderId.parameterArn;
  }
}
