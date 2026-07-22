import { createClient } from "@supabase/supabase-js";

import { LedgerReceiptSchema, type LedgerReceipt } from "@health-design/contracts";
import {
  adminOutcomeIdempotencyHash,
  verifyLedgerReceipt,
  type AdminAuditAction,
  type AdminAuditTargetType,
  type AdminOutcomeInput,
  type AuditRpc,
} from "../_shared/audit.ts";

const MAX_BODY_BYTES = 256;
const MAX_CLOCK_SKEW_MS = 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;

export type PendingAuditIdentity = {
  action: AdminAuditAction;
  effectiveProfileId: string;
  impersonationSessionId: string | null;
  intentRecordHash: string;
  originalActorId: string;
  requestId: string;
  targetId: string;
  targetType: AdminAuditTargetType;
};

export interface AdminReconciliationDependencies {
  authenticate(request: Request, rawBody: string): Promise<boolean>;
  closeFailure(item: PendingAuditIdentity): Promise<void>;
  closeSuccess(item: PendingAuditIdentity): Promise<void>;
  listExternalPending(): Promise<PendingAuditIdentity[]>;
  listPendingOutbox(): Promise<PendingAuditIdentity[]>;
  requestState(requestId: string): Promise<PendingAuditIdentity | null>;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "cache-control": "no-store, private",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
    status,
  });
}

function validBody(rawBody: string): boolean {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      (parsed as Record<string, unknown>).schemaVersion === 1
    );
  } catch {
    return false;
  }
}

export async function handleAdminReconciliation(
  request: Request,
  dependencies: AdminReconciliationDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    !url.pathname.endsWith("/v1/admin-audit/reconcile") ||
    url.search ||
    url.hash
  ) {
    return json({ error: "not_found" }, 404);
  }

  const rawBody = await request.text();
  if (
    new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES ||
    !validBody(rawBody)
  ) {
    return json({ error: "invalid_input" }, 400);
  }
  if (!(await dependencies.authenticate(request, rawBody))) {
    return json({ error: "unauthorized" }, 401);
  }

  let closed = 0;
  let pending = 0;
  let reconciledFailures = 0;
  const attempted = new Set<string>();

  let outboxItems: PendingAuditIdentity[];
  try {
    outboxItems = await dependencies.listPendingOutbox();
  } catch {
    return json({ error: "dependency_unavailable" }, 503);
  }
  for (const item of outboxItems) {
    attempted.add(item.requestId);
    try {
      await dependencies.closeSuccess(item);
      closed += 1;
    } catch {
      pending += 1;
    }
  }

  let externalItems: PendingAuditIdentity[];
  try {
    externalItems = await dependencies.listExternalPending();
  } catch {
    return json({ error: "dependency_unavailable" }, 503);
  }
  for (const externalItem of externalItems) {
    if (attempted.has(externalItem.requestId)) continue;
    try {
      const state = await dependencies.requestState(externalItem.requestId);
      if (state) {
        await dependencies.closeSuccess(state);
        closed += 1;
      } else {
        await dependencies.closeFailure(externalItem);
        reconciledFailures += 1;
      }
    } catch {
      pending += 1;
    }
  }

  return json({ closed, pending, reconciledFailures }, 200);
}

function runtimeSecret(name: string): string {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: { get(key: string): string | undefined } };
    }
  ).Deno;
  const value = deno?.env?.get(name);
  if (!value) throw new Error("missing_runtime_secret");
  return value;
}

function runtimeEnvironment(): "development" | "local" | "production" {
  const value = runtimeSecret("APP_ENV");
  if (value === "development" || value === "local" || value === "production") {
    return value;
  }
  throw new Error("invalid_environment");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlToHex(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Array.from(binary, (character) =>
    character.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
}

function byteaHex(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_bytea");
  const normalized = value.startsWith("\\x") ? value.slice(2) : value;
  if (!HEX_64_PATTERN.test(normalized)) throw new Error("invalid_bytea");
  return normalized;
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

async function hmacSha256Hex(value: string, secret: string): Promise<string> {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("invalid_hmac_key");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  );
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function serviceSignature(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  rawBody: string,
  secret: string,
): Promise<string> {
  return hmacSha256Hex(
    `${timestamp}\n${nonce}\n${method}\n${path}\n${await sha256Hex(rawBody)}`,
    secret,
  );
}

function parsePublicKeys(value: string): Readonly<Record<number, string>> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_ledger_public_keys");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (
    entries.length === 0 ||
    entries.some(([version, key]) => !/^\d+$/.test(version) || typeof key !== "string")
  ) {
    throw new Error("invalid_ledger_public_keys");
  }
  const keys: Record<number, string> = {};
  for (const [version, key] of entries) keys[Number(version)] = key as string;
  return keys;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const value: unknown = Array.isArray(data) ? (data as unknown[])[0] : data;
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function parseAction(value: unknown): AdminAuditAction {
  if (
    value !== "barcode_correction_approve" &&
    value !== "barcode_correction_correct" &&
    value !== "barcode_correction_reject" &&
    value !== "catalog_match_candidates_generate" &&
    value !== "catalog_publication_hide" &&
    value !== "catalog_revision_publish" &&
    value !== "impersonation_start" &&
    value !== "impersonation_end" &&
    value !== "matching_rule_activate" &&
    value !== "matching_rule_review"
  ) {
    throw new Error("invalid_action");
  }
  return value;
}

function parseTargetType(value: unknown): AdminAuditTargetType {
  if (
    value !== "barcode_correction" &&
    value !== "commercial_product_revision" &&
    value !== "catalog_publication" &&
    value !== "catalog_revision" &&
    value !== "impersonation_session" &&
    value !== "product_matching_rule" &&
    value !== "profile"
  ) {
    throw new Error("invalid_target_type");
  }
  return value;
}

function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("invalid_uuid");
  }
  return value;
}

function parseNullableUuid(value: unknown): string | null {
  return value === null || value === undefined ? null : parseUuid(value);
}

function pendingFromDatabase(row: Record<string, unknown>): PendingAuditIdentity {
  return {
    action: parseAction(row.action),
    effectiveProfileId: parseUuid(row.effective_profile_id),
    impersonationSessionId: parseNullableUuid(row.impersonation_session_id),
    intentRecordHash: byteaHex(row.intent_record_hash),
    originalActorId: parseUuid(row.original_actor_id),
    requestId: parseUuid(row.request_id),
    targetId: parseUuid(row.target_id),
    targetType: parseTargetType(row.target_type),
  };
}

function pendingFromLedger(value: unknown): PendingAuditIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_pending_intent");
  }
  const row = value as Record<string, unknown>;
  const allowed = new Set([
    "action",
    "createdAt",
    "effectiveProfileId",
    "intentRecordHash",
    "originalActorId",
    "phase",
    "requestId",
    "result",
    "schemaVersion",
    "stream",
    "targetId",
    "targetType",
  ]);
  if (
    Object.keys(row).some((key) => !allowed.has(key)) ||
    row.phase !== "intent" ||
    row.result !== "pending" ||
    row.schemaVersion !== 1 ||
    row.stream !== "admin-audit" ||
    typeof row.intentRecordHash !== "string" ||
    !HEX_64_PATTERN.test(row.intentRecordHash)
  ) {
    throw new Error("invalid_pending_intent");
  }
  const action = parseAction(row.action);
  const targetType = parseTargetType(row.targetType);
  const targetId = parseUuid(row.targetId);
  return {
    action,
    effectiveProfileId: parseUuid(row.effectiveProfileId),
    impersonationSessionId: action === "impersonation_end" ? targetId : null,
    intentRecordHash: row.intentRecordHash,
    originalActorId: parseUuid(row.originalActorId),
    requestId: parseUuid(row.requestId),
    targetId,
    targetType,
  };
}

function receiptRpcArgs(receipt: LedgerReceipt): Record<string, unknown> {
  return {
    p_external_idempotency_hash: `\\x${receipt.idempotencyHash}`,
    p_external_key_version: receipt.keyVersion,
    p_external_receipt_signature: `\\x${base64UrlToHex(receipt.signature)}`,
    p_external_record_hash: `\\x${receipt.recordHash}`,
    p_external_sequence: receipt.sequence,
    p_external_timestamp: receipt.timestamp,
  };
}

function runtimeDependencies(): AdminReconciliationDependencies {
  const environment = runtimeEnvironment();
  const ledgerUrl = new URL(runtimeSecret("CONTINUITY_LEDGER_URL"));
  const ledgerHmacKey = runtimeSecret("CONTINUITY_LEDGER_HMAC_KEY");
  const callbackHmacKey = runtimeSecret("CONTINUITY_RECONCILER_HMAC_KEY");
  const pinnedPublicKeys = parsePublicKeys(
    runtimeSecret("CONTINUITY_LEDGER_PUBLIC_KEYS"),
  );
  const serviceClient = createClient(
    runtimeSecret("SUPABASE_URL"),
    runtimeSecret("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const rpc: AuditRpc = async (name, args) => {
    const raw: unknown = await serviceClient.rpc(name as never, args as never);
    const result = raw as {
      data: unknown;
      error: { code?: string; message?: string } | null;
    };
    return { data: result.data, error: result.error };
  };

  async function ledgerRequest(
    path: "/v1/admin-audit/append" | "/v1/admin-audit/pending",
    method: "GET" | "POST",
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const rawBody = body ? JSON.stringify(body) : "";
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const signature = await serviceSignature(
      timestamp,
      nonce,
      method,
      path,
      rawBody,
      ledgerHmacKey,
    );
    const requestId = body?.requestId;
    return fetch(new URL(path, ledgerUrl), {
      ...(body ? { body: rawBody } : {}),
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(typeof requestId === "string" ? { "idempotency-key": requestId } : {}),
        "x-ledger-nonce": nonce,
        "x-ledger-signature": signature,
        "x-ledger-timestamp": timestamp,
      },
      method,
    });
  }

  async function appendOutcome(
    item: PendingAuditIdentity,
    result: "failure" | "success",
  ): Promise<LedgerReceipt> {
    const outcome: AdminOutcomeInput = {
      action: item.action,
      effectiveProfileId: item.effectiveProfileId,
      ...(result === "failure"
        ? { errorCode: "reconciliation_required" as const }
        : {}),
      intentRecordHash: item.intentRecordHash,
      originalActorId: item.originalActorId,
      requestId: item.requestId,
      result,
      targetId: item.targetId,
      targetType: item.targetType,
    };
    const response = await ledgerRequest("/v1/admin-audit/append", "POST", {
      ...outcome,
      createdAt: new Date().toISOString(),
      phase: "outcome",
      schemaVersion: 1,
      stream: "admin-audit",
    });
    if (!response.ok) throw new Error("ledger_unavailable");
    const receipt = LedgerReceiptSchema.parse(await response.json());
    const publicKey = pinnedPublicKeys[receipt.keyVersion];
    if (
      !publicKey ||
      receipt.environment !== environment ||
      receipt.idempotencyHash !==
        (await adminOutcomeIdempotencyHash(environment, outcome)) ||
      !(await verifyLedgerReceipt(receipt, publicKey))
    ) {
      throw new Error("invalid_ledger_receipt");
    }
    return receipt;
  }

  return {
    authenticate: async (request, rawBody) => {
      const timestamp = request.headers.get("x-reconciler-timestamp");
      const nonce = request.headers.get("x-reconciler-nonce");
      const supplied = request.headers.get("x-reconciler-signature");
      const parsedTimestamp = timestamp ? Date.parse(timestamp) : Number.NaN;
      if (
        !timestamp ||
        !nonce ||
        !supplied ||
        !UUID_PATTERN.test(nonce) ||
        !HEX_64_PATTERN.test(supplied) ||
        !Number.isFinite(parsedTimestamp) ||
        Math.abs(Date.now() - parsedTimestamp) > MAX_CLOCK_SKEW_MS
      ) {
        return false;
      }
      const expected = await serviceSignature(
        timestamp,
        nonce,
        request.method,
        new URL(request.url).pathname,
        rawBody,
        callbackHmacKey,
      );
      return constantTimeHexEqual(supplied, expected);
    },
    closeFailure: async (item) => {
      const receipt = await appendOutcome(item, "failure");
      const result = await rpc("internal_admin_record_reconciliation", {
        p_action: item.action,
        p_effective_profile_id: item.effectiveProfileId,
        p_impersonation_session_id: item.impersonationSessionId,
        p_original_actor_id: item.originalActorId,
        p_request_id: item.requestId,
        p_target_id: item.targetId,
        p_target_type: item.targetType,
        ...receiptRpcArgs(receipt),
      });
      if (result.error || result.data !== true) throw new Error("database_unavailable");
    },
    closeSuccess: async (item) => {
      const receipt = await appendOutcome(item, "success");
      const result = await rpc("internal_admin_finalize_audit_outbox", {
        p_request_id: item.requestId,
        ...receiptRpcArgs(receipt),
      });
      if (result.error || result.data !== true) throw new Error("database_unavailable");
    },
    listExternalPending: async () => {
      const response = await ledgerRequest("/v1/admin-audit/pending", "GET");
      if (!response.ok) throw new Error("ledger_unavailable");
      const body = (await response.json()) as unknown;
      if (
        !body ||
        typeof body !== "object" ||
        !Array.isArray((body as { items?: unknown }).items)
      ) {
        throw new Error("invalid_pending_response");
      }
      return (body as { items: unknown[] }).items.map(pendingFromLedger);
    },
    listPendingOutbox: async () => {
      const result = await rpc("internal_admin_list_pending_audit_outbox", {
        p_limit: 25,
      });
      if (result.error || !Array.isArray(result.data)) {
        throw new Error("database_unavailable");
      }
      return result.data.map((row) => {
        if (!row || typeof row !== "object") throw new Error("invalid_outbox_row");
        return pendingFromDatabase(row as Record<string, unknown>);
      });
    },
    requestState: async (requestId) => {
      const result = await rpc("internal_admin_audit_request_state", {
        p_request_id: requestId,
      });
      if (result.error) throw new Error("database_unavailable");
      const row = firstRow(result.data);
      return row ? pendingFromDatabase(row) : null;
    },
  };
}

export default {
  fetch(request: Request) {
    return handleAdminReconciliation(request, runtimeDependencies());
  },
};
