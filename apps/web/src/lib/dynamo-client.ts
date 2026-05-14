import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Singleton — one connection reused across Lambda invocations / Next.js requests
let client: DynamoDBDocumentClient | null = null;

export function getDocClient(): DynamoDBDocumentClient {
  if (!client) {
    const endpoint = process.env.DYNAMODB_ENDPOINT;
    const ddb = new DynamoDBClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      // When a local endpoint is configured, pass credentials explicitly so the
      // SDK never tries to resolve AWS_PROFILE / bbvaauthcli / SSO chains.
      ...(endpoint
        ? {
            endpoint,
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
            },
          }
        : {}),
    });
    client = DynamoDBDocumentClient.from(ddb, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false,
      },
    });
  }
  return client;
}
