import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { v4 as uuidv4 } from "uuid";
import { getDocClient } from "./dynamo-client";

const ODOO_QUEUE_TABLE = () => process.env.ODOO_QUEUE_TABLE ?? "proyinstelec-odoo-queue";
const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 3_000, 9_000]; // exponential

// ── SSM config ────────────────────────────────────────────────────────────────

interface OdooConfig {
  url: string;
  db: string;
  apiKey: string;
}

let _cachedConfig: OdooConfig | null = null;

async function getOdooConfig(): Promise<OdooConfig> {
  if (_cachedConfig) return _cachedConfig;

  if (process.env.ODOO_SYNC_ENABLED !== "true") {
    throw new Error("ODOO_SYNC_ENABLED is not true");
  }

  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const get = async (name: string) => {
    const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    return r.Parameter?.Value ?? "";
  };

  _cachedConfig = {
    url: await get(process.env.ODOO_URL_PARAM ?? "/proyinstelec/odoo/url"),
    db: await get(process.env.ODOO_DB_PARAM ?? "/proyinstelec/odoo/db"),
    apiKey: await get(process.env.ODOO_API_KEY_PARAM ?? "/proyinstelec/odoo/api-key"),
  };

  return _cachedConfig;
}

/** Exposed for tests only */
export function _resetConfigCache() {
  _cachedConfig = null;
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

async function rpc(
  url: string,
  db: string,
  apiKey: string,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${url}/web/dataset/call_kw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Odoo 16+ API key authentication
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { model, method, args, kwargs },
    }),
  });

  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.data?.message ?? JSON.stringify(json.error));
  return json.result;
}

// ── Odoo sync logic ───────────────────────────────────────────────────────────

async function findEmployeeId(config: OdooConfig, email: string): Promise<number | null> {
  const ids = (await rpc(config.url, config.db, config.apiKey, "hr.employee", "search", [
    [["work_email", "=", email]],
  ])) as number[];
  return ids[0] ?? null;
}

async function createAttendance(
  config: OdooConfig,
  employeeId: number,
  checkIn: string,
  jornadaId: string,
): Promise<number> {
  return (await rpc(config.url, config.db, config.apiKey, "hr.attendance", "create", [
    { employee_id: employeeId, check_in: checkIn, reason: jornadaId },
  ])) as number;
}

async function updateAttendance(
  config: OdooConfig,
  attendanceId: number,
  checkOut: string,
): Promise<void> {
  await rpc(config.url, config.db, config.apiKey, "hr.attendance", "write", [
    [attendanceId],
    { check_out: checkOut },
  ]);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SyncOdooParams {
  email: string;
  jornadaId: string;
  checkIn: string; // ISO UTC
  checkOut?: string; // ISO UTC — optional at check-in time
}

async function syncWithRetry(params: SyncOdooParams): Promise<void> {
  const config = await getOdooConfig();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const employeeId = await findEmployeeId(config, params.email);
      if (!employeeId) throw new Error(`No employee found for ${params.email}`);

      const attendanceId = await createAttendance(
        config,
        employeeId,
        params.checkIn,
        params.jornadaId,
      );

      if (params.checkOut) {
        await updateAttendance(config, attendanceId, params.checkOut);
      }

      return; // success
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
    }
  }

  // All retries exhausted — persist to retry queue (TTL = 7 days)
  const ttl = Math.floor(Date.now() / 1000) + 7 * 86_400;
  await getDocClient().send(
    new PutCommand({
      TableName: ODOO_QUEUE_TABLE(),
      Item: {
        id: uuidv4(),
        jornadaId: params.jornadaId,
        google_sub: params.email, // used as lookup key in retry Lambda
        intento: MAX_RETRIES,
        estado: "error",
        error: lastError?.message,
        ttl,
      },
    }),
  );

  throw lastError;
}

/**
 * Fire-and-forget Odoo sync.
 * DynamoDB is the source of truth — a failure here does NOT fail the check-in.
 */
export function syncToOdooAsync(params: SyncOdooParams): void {
  if (process.env.ODOO_SYNC_ENABLED !== "true") return;

  syncWithRetry(params).catch((err) =>
    console.error("[odoo-sync] failed after retries:", err.message),
  );
}
