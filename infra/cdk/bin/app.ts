#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { ProyinstelecStack } from "../lib/proyinstelec-stack";

const app = new App();

// ── Environment resolution ────────────────────────────────────────────────────
// CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION are set by `cdk bootstrap`.
// Override by passing --profile <aws-profile> to the cdk CLI.

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? "us-east-1";

// Required — must be set before running `cdk deploy`
// Generate in GCP Console → APIs & Services → Credentials, then:
//   export ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:<account>:certificate/<id>
const acmCertificateArn = process.env.ACM_CERTIFICATE_ARN ?? "arn:aws:acm:us-east-1:PLACEHOLDER:certificate/PLACEHOLDER";
const domainApex = process.env.DOMAIN_APEX ?? "proyinstelec.com";
const nextjsOriginDomain = process.env.NEXTJS_ORIGIN_DOMAIN; // undefined is fine for first deploy

// ── Dev stack ─────────────────────────────────────────────────────────────────
// Safe to destroy; uses DESTROY removal policy on all resources.
new ProyinstelecStack(app, "ProyinstelecDev", {
  env: { account, region },
  environment: "dev",
  acmCertificateArn,
  domainApex: `dev.${domainApex}`,
  nextjsOriginDomain,
  stackName: "proyinstelec-dev",
  description: "Proyinstelec Field App — Development",
  tags: {
    Project: "proyinstelec-field-app",
    Environment: "dev",
    ManagedBy: "cdk",
  },
});

// ── Prod stack ────────────────────────────────────────────────────────────────
// All stateful resources use RETAIN — stack deletion does NOT delete data.
new ProyinstelecStack(app, "ProyinstelecProd", {
  env: { account, region },
  environment: "prod",
  acmCertificateArn,
  domainApex,
  nextjsOriginDomain,
  stackName: "proyinstelec-prod",
  description: "Proyinstelec Field App — Production",
  tags: {
    Project: "proyinstelec-field-app",
    Environment: "prod",
    ManagedBy: "cdk",
  },
});

app.synth();
