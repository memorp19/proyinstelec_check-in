import { Duration } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { IRestApi } from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";

export interface CloudFrontDistributionProps {
  /**
   * ARN of the ACM certificate for proyinstelec.com (must exist in us-east-1).
   * Set via env var ACM_CERTIFICATE_ARN before running cdk deploy.
   */
  acmCertificateArn: string;
  domainApex: string;
  api?: IRestApi;
  /** Next.js deployment domain (Amplify or App Runner). Placeholder until wired up. */
  nextjsOriginDomain?: string;
}

export class CloudFrontDistribution extends Construct {
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: CloudFrontDistributionProps) {
    super(scope, id);

    const certificate = Certificate.fromCertificateArn(
      this,
      "AcmCert",
      props.acmCertificateArn,
    );

    // API Gateway origin
    const apiOriginDomain = props.api
      ? `${props.api.restApiId}.execute-api.${process.env.CDK_DEFAULT_REGION ?? "us-east-1"}.amazonaws.com`
      : "placeholder-api.execute-api.us-east-1.amazonaws.com";

    const apiOrigin = new HttpOrigin(apiOriginDomain, {
      originPath: "/prod",
      protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
    });

    // Next.js origin (public site + PWA + admin + cliente)
    const nextjsOrigin = new HttpOrigin(
      props.nextjsOriginDomain ?? "placeholder-nextjs.example.com",
      { protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY },
    );

    this.distribution = new Distribution(this, "Distribution", {
      comment: "Proyinstelec — proyinstelec.com",
      domainNames: [props.domainApex, `www.${props.domainApex}`],
      certificate,
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      enableIpv6: true,

      // Default → Next.js
      defaultBehavior: {
        origin: nextjsOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },

      additionalBehaviors: {
        // Lambda API — no cache, all methods
        "/api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // Note: photo thumbnails are served directly from drive.google.com
        // using the driveWebViewLink / thumbnail URL stored in DynamoDB.
        // No /fotos/* behavior needed.
      },
    });
  }
}
