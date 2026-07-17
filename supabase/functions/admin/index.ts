import { createClient } from "@supabase/supabase-js";

import {
  AdminImpersonationContextSchema,
  AdminMutationRequestSchema,
  AdminProfileSummarySchema,
  LedgerReceiptSchema,
  type AdminImpersonationContext,
  type LedgerReceipt,
} from "@health-design/contracts";
import {
  adminIntentIdempotencyHash,
  adminOutcomeIdempotencyHash,
  verifyLedgerReceipt,
  type AdminIntentInput,
  type AdminOutcomeInput,
  type AuditRpc,
} from "../_shared/audit.ts";
import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";

export type { AdminIntentInput } from "../_shared/audit.ts";

const MAX_BODY_BYTES = 16_384;
const RECENT_MFA_SECONDS = 5 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuthContext = {
  aal: "aal1" | "aal2";
  mfaVerifiedAt: number | null;
  sessionId: string;
  userId: string;
};

type AdminFailureOutcomeInput = AdminIntentInput & {
  errorCode: "domain_constraint" | "mutation_failed";
  intentReceipt: LedgerReceipt;
};

type AdminSuccessOutcomeInput = AdminIntentInput & {
  intentReceipt: LedgerReceipt;
};

export interface AdminDependencies {
  appendFailureOutcome(input: AdminFailureOutcomeInput): Promise<LedgerReceipt>;
  appendIntent(input: AdminIntentInput): Promise<LedgerReceipt>;
  appendSuccessOutcome(input: AdminSuccessOutcomeInput): Promise<LedgerReceipt>;
  authenticate(token: string): Promise<AuthContext>;
  environment: EdgeEnvironment;
  now(): Date;
  rpc: AuditRpc;
  verifyIntentReceipt(
    receipt: LedgerReceipt,
    input: AdminIntentInput,
  ): Promise<boolean>;
  verifyOutcomeReceipt(
    receipt: LedgerReceipt,
    input: AdminOutcomeInput,
  ): Promise<boolean>;
}

type AdminRoute =
  | { kind: "context" }
  | { kind: "impersonation-end"; impersonationSessionId: string }
  | { kind: "impersonation-start"; profileId: string }
  | { kind: "profiles-list" };

type ErrorCode =
  | "AAL2_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE"
  | "DOMAIN_CONSTRAINT"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "UNAUTHENTICATED";

const MESSAGE_KEYS: Readonly<Record<ErrorCode, string>> = {
  AAL2_REQUIRED: "admin.aal2_required",
  DEPENDENCY_UNAVAILABLE: "common.dependency_unavailable",
  DOMAIN_CONSTRAINT: "common.domain_constraint",
  FORBIDDEN: "common.forbidden",
  INTERNAL_ERROR: "common.internal_error",
  INVALID_INPUT: "common.invalid_input",
  NOT_FOUND: "common.not_found",
  UNAUTHENTICATED: "common.unauthenticated",
};

class AdminHttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

function jsonHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store, private",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...jsonHeaders(), ...corsHeaders },
    status,
  });
}

function errorResponse(
  error: AdminHttpError,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message_key: MESSAGE_KEYS[error.code],
        request_id: requestId,
        retryable: error.code === "DEPENDENCY_UNAVAILABLE",
      },
    },
    error.status,
    corsHeaders,
  );
}

function parseRoute(url: URL): AdminRoute | null {
  const path = url.pathname;
  if (path.endsWith("/v1/admin/context")) return { kind: "context" };
  if (path.endsWith("/v1/admin/profiles")) return { kind: "profiles-list" };

  const start = path.match(/\/v1\/admin\/profiles\/([0-9a-f-]{36})\/impersonations$/i);
  if (start?.[1] && UUID_PATTERN.test(start[1])) {
    return { kind: "impersonation-start", profileId: start[1] };
  }

  const end = path.match(/\/v1\/admin\/impersonations\/([0-9a-f-]{36})\/end$/i);
  if (end?.[1] && UUID_PATTERN.test(end[1])) {
    return { impersonationSessionId: end[1], kind: "impersonation-end" };
  }
  return null;
}

function expectedMethod(route: AdminRoute): "GET" | "POST" {
  return route.kind === "context" || route.kind === "profiles-list" ? "GET" : "POST";
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match?.[1]) throw new AdminHttpError("UNAUTHENTICATED", 401);
  return match[1];
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const candidate: unknown = Array.isArray(data) ? (data as unknown[])[0] : data;
  return candidate !== null && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : null;
}

async function readJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new AdminHttpError("INVALID_INPUT", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new AdminHttpError("INVALID_INPUT", 413);
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AdminHttpError("INVALID_INPUT", 400);
  }
}

function requireUuid(value: string | null): string {
  if (!value || !UUID_PATTERN.test(value)) {
    throw new AdminHttpError("INVALID_INPUT", 400);
  }
  return value;
}

function parseMutationBody(value: unknown): void {
  if (!AdminMutationRequestSchema.safeParse(value).success) {
    throw new AdminHttpError("INVALID_INPUT", 400);
  }
}

function requireRecentMfa(auth: AuthContext, now: Date): void {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (
    !Number.isSafeInteger(nowSeconds) ||
    auth.mfaVerifiedAt === null ||
    !Number.isSafeInteger(auth.mfaVerifiedAt) ||
    auth.mfaVerifiedAt > nowSeconds ||
    nowSeconds - auth.mfaVerifiedAt > RECENT_MFA_SECONDS
  ) {
    throw new AdminHttpError("AAL2_REQUIRED", 403);
  }
}

export function latestTotpTimestamp(methods: unknown): number | null {
  if (!Array.isArray(methods)) return null;
  let latest: number | null = null;
  for (const entry of methods) {
    if (!entry || typeof entry !== "object") continue;
    const { method, timestamp } = entry as Record<string, unknown>;
    if (method === "totp" && Number.isSafeInteger(timestamp)) {
      latest = Math.max(latest ?? 0, timestamp as number);
    }
  }
  return latest;
}

function mapRpcError(error: { code?: string; message?: string }): AdminHttpError {
  if (error.message === "aal2_required") {
    return new AdminHttpError("AAL2_REQUIRED", 403);
  }
  if (error.code === "42501" || error.message === "superadmin_required") {
    return new AdminHttpError("FORBIDDEN", 403);
  }
  if (error.code === "22023" || error.code === "55000") {
    return new AdminHttpError("DOMAIN_CONSTRAINT", 409);
  }
  return new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
}

async function authorize(
  dependencies: AdminDependencies,
  auth: AuthContext,
): Promise<string> {
  const result = await dependencies.rpc("internal_admin_authorize", {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
  });
  if (result.error) throw mapRpcError(result.error);
  if (typeof result.data !== "string" || !UUID_PATTERN.test(result.data)) {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return result.data;
}

function contextFromRow(data: unknown): AdminImpersonationContext {
  const row = firstRow(data);
  if (!row) return { active: false };
  const parsed = AdminImpersonationContextSchema.safeParse({
    active: true,
    effectiveProfileId: row.effective_profile_id,
    impersonationSessionId: row.impersonation_session_id,
    startedAt: row.started_at,
  });
  if (!parsed.success) throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

async function currentContext(
  dependencies: AdminDependencies,
  auth: AuthContext,
): Promise<AdminImpersonationContext> {
  const result = await dependencies.rpc("internal_admin_current_context", {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
  });
  if (result.error) throw mapRpcError(result.error);
  return contextFromRow(result.data);
}

function bytea(hex: string): string {
  return `\\x${hex}`;
}

function base64UrlToHex(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Array.from(binary, (character) =>
    character.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
}

async function appendFailureBestEffort(
  dependencies: AdminDependencies,
  input: AdminIntentInput,
  intentReceipt: LedgerReceipt,
  error: { code?: string; message?: string },
): Promise<void> {
  const errorCode =
    error.code === "22023" || error.code === "55000"
      ? "domain_constraint"
      : "mutation_failed";
  try {
    const outcomeInput: AdminOutcomeInput = {
      ...input,
      errorCode,
      intentRecordHash: intentReceipt.recordHash,
      result: "failure",
    };
    const receipt = LedgerReceiptSchema.parse(
      await dependencies.appendFailureOutcome({
        ...input,
        errorCode,
        intentReceipt,
      }),
    );
    if (!(await dependencies.verifyOutcomeReceipt(receipt, outcomeInput))) {
      throw new Error("invalid_ledger_receipt");
    }
  } catch {
    // El reconciliador cerrará el intent pendiente; nunca se serializa el error crudo.
  }
}

async function verifiedIntent(
  dependencies: AdminDependencies,
  input: AdminIntentInput,
): Promise<LedgerReceipt> {
  let receipt: LedgerReceipt;
  try {
    receipt = LedgerReceiptSchema.parse(await dependencies.appendIntent(input));
  } catch {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  if (!(await dependencies.verifyIntentReceipt(receipt, input))) {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return receipt;
}

async function completeSuccessOutcome(
  dependencies: AdminDependencies,
  input: AdminIntentInput,
  intentReceipt: LedgerReceipt,
): Promise<boolean> {
  const outcomeInput: AdminOutcomeInput = {
    ...input,
    intentRecordHash: intentReceipt.recordHash,
    result: "success",
  };
  try {
    const receipt = LedgerReceiptSchema.parse(
      await dependencies.appendSuccessOutcome({ ...input, intentReceipt }),
    );
    if (!(await dependencies.verifyOutcomeReceipt(receipt, outcomeInput))) {
      return false;
    }
    const result = await dependencies.rpc("internal_admin_finalize_audit_outbox", {
      p_request_id: input.requestId,
      ...receiptRpcArgs(receipt),
    });
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}

function receiptRpcArgs(receipt: LedgerReceipt): Record<string, unknown> {
  return {
    p_external_idempotency_hash: bytea(receipt.idempotencyHash),
    p_external_key_version: receipt.keyVersion,
    p_external_receipt_signature: bytea(base64UrlToHex(receipt.signature)),
    p_external_record_hash: bytea(receipt.recordHash),
    p_external_sequence: receipt.sequence,
    p_external_timestamp: receipt.timestamp,
  };
}

async function startImpersonation(
  dependencies: AdminDependencies,
  auth: AuthContext,
  profileId: string,
  requestId: string,
): Promise<{ auditClosed: boolean; context: AdminImpersonationContext }> {
  const originalActorId = await authorize(dependencies, auth);
  const input: AdminIntentInput = {
    action: "impersonation_start",
    effectiveProfileId: profileId,
    originalActorId,
    requestId,
    targetId: profileId,
    targetType: "profile",
  };
  const receipt = await verifiedIntent(dependencies, input);
  let result;
  try {
    result = await dependencies.rpc("internal_admin_start_impersonation", {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_profile_id: profileId,
      p_request_id: requestId,
      ...receiptRpcArgs(receipt),
    });
  } catch {
    await appendFailureBestEffort(dependencies, input, receipt, {});
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  if (result.error) {
    await appendFailureBestEffort(dependencies, input, receipt, result.error);
    throw mapRpcError(result.error);
  }
  const context = contextFromRow(result.data);
  if (!context.active) throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return {
    auditClosed: await completeSuccessOutcome(dependencies, input, receipt),
    context,
  };
}

async function endImpersonation(
  dependencies: AdminDependencies,
  auth: AuthContext,
  impersonationSessionId: string,
  requestId: string,
): Promise<boolean> {
  const originalActorId = await authorize(dependencies, auth);
  const context = await currentContext(dependencies, auth);
  if (!context.active || context.impersonationSessionId !== impersonationSessionId) {
    throw new AdminHttpError("DOMAIN_CONSTRAINT", 409);
  }
  const input: AdminIntentInput = {
    action: "impersonation_end",
    effectiveProfileId: context.effectiveProfileId,
    originalActorId,
    requestId,
    targetId: impersonationSessionId,
    targetType: "impersonation_session",
  };
  const receipt = await verifiedIntent(dependencies, input);
  let result;
  try {
    result = await dependencies.rpc("internal_admin_end_impersonation", {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_impersonation_session_id: impersonationSessionId,
      p_request_id: requestId,
      ...receiptRpcArgs(receipt),
    });
  } catch {
    await appendFailureBestEffort(dependencies, input, receipt, {});
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  if (result.error) {
    await appendFailureBestEffort(dependencies, input, receipt, result.error);
    throw mapRpcError(result.error);
  }
  return completeSuccessOutcome(dependencies, input, receipt);
}

async function listProfiles(
  dependencies: AdminDependencies,
  auth: AuthContext,
): Promise<unknown[]> {
  const result = await dependencies.rpc("internal_admin_list_profiles", {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
  });
  if (result.error) throw mapRpcError(result.error);
  if (!Array.isArray(result.data)) {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const parsed = AdminProfileSummarySchema.array().safeParse(
    result.data.map((row: unknown) => {
      const candidate = firstRow(row);
      return {
        alias: candidate?.alias,
        createdAt: candidate?.created_at,
        profileId: candidate?.profile_id,
        status: candidate?.status,
      };
    }),
  );
  if (!parsed.success) throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

export async function handleAdmin(
  request: Request,
  dependencies: AdminDependencies,
): Promise<Response> {
  const requestedId = request.headers.get("idempotency-key");
  const requestId =
    requestedId && UUID_PATTERN.test(requestedId) ? requestedId : crypto.randomUUID();
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(new AdminHttpError("FORBIDDEN", 403), requestId, cors.headers);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...cors.headers,
        "access-control-allow-headers":
          "authorization, content-type, idempotency-key, apikey",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "cache-control": "no-store",
        vary: "Origin",
      },
      status: 204,
    });
  }

  try {
    const url = new URL(request.url);
    if (url.search || url.hash) throw new AdminHttpError("INVALID_INPUT", 400);
    const route = parseRoute(url);
    if (!route) throw new AdminHttpError("NOT_FOUND", 404);
    if (request.method !== expectedMethod(route)) {
      throw new AdminHttpError("NOT_FOUND", 404);
    }

    let auth: AuthContext;
    try {
      auth = await dependencies.authenticate(bearerToken(request));
    } catch (error) {
      if (error instanceof AdminHttpError) throw error;
      throw new AdminHttpError("UNAUTHENTICATED", 401);
    }
    if (auth.aal !== "aal2") throw new AdminHttpError("AAL2_REQUIRED", 403);

    if (route.kind === "context") {
      return jsonResponse(await currentContext(dependencies, auth), 200, cors.headers);
    }
    if (route.kind === "profiles-list") {
      return jsonResponse(await listProfiles(dependencies, auth), 200, cors.headers);
    }

    if (route.kind === "impersonation-start") {
      requireRecentMfa(auth, dependencies.now());
    }
    parseMutationBody(await readJson(request));
    const idempotencyKey = requireUuid(request.headers.get("idempotency-key"));
    if (route.kind === "impersonation-start") {
      const started = await startImpersonation(
        dependencies,
        auth,
        route.profileId,
        idempotencyKey,
      );
      return jsonResponse(
        started.auditClosed
          ? started.context
          : { ...started.context, auditClosure: "pending" },
        started.auditClosed ? 201 : 202,
        cors.headers,
      );
    }
    const auditClosed = await endImpersonation(
      dependencies,
      auth,
      route.impersonationSessionId,
      idempotencyKey,
    );
    return jsonResponse(
      auditClosed ? { active: false } : { active: false, auditClosure: "pending" },
      auditClosed ? 200 : 202,
      cors.headers,
    );
  } catch (error) {
    if (error instanceof AdminHttpError) {
      return errorResponse(error, requestId, cors.headers);
    }
    return errorResponse(
      new AdminHttpError("INTERNAL_ERROR", 500),
      requestId,
      cors.headers,
    );
  }
}

function runtimeSecret(name: string, fallback?: string): string {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: { get(key: string): string | undefined } };
    }
  ).Deno;
  const value = deno?.env?.get(name) ?? fallback;
  if (!value) throw new Error("missing_runtime_secret");
  return value;
}

function runtimeOptionalSecret(name: string): string | undefined {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: { get(key: string): string | undefined } };
    }
  ).Deno;
  return deno?.env?.get(name);
}

function runtimeEnvironment(): EdgeEnvironment {
  const candidate = runtimeSecret("APP_ENV", "local");
  if (
    candidate === "development" ||
    candidate === "local" ||
    candidate === "production"
  ) {
    return candidate;
  }
  throw new Error("invalid_environment");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function runtimeDependencies(): AdminDependencies {
  const environment = runtimeEnvironment();
  const supabaseUrl = runtimeSecret("SUPABASE_URL");
  const publishableKey =
    runtimeOptionalSecret("SUPABASE_PUBLISHABLE_KEY") ??
    runtimeSecret("SUPABASE_ANON_KEY");
  const serviceRoleKey = runtimeSecret("SUPABASE_SERVICE_ROLE_KEY");
  const ledgerUrl = new URL(runtimeSecret("CONTINUITY_LEDGER_URL"));
  const ledgerHmacKey = runtimeSecret("CONTINUITY_LEDGER_HMAC_KEY");
  const pinnedPublicKeys = parsePublicKeys(
    runtimeSecret("CONTINUITY_LEDGER_PUBLIC_KEYS"),
  );
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  async function appendLedger(body: Record<string, unknown>): Promise<LedgerReceipt> {
    const path = "/v1/admin-audit/append";
    const rawBody = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const signature = await hmacSha256Hex(
      `${timestamp}\n${nonce}\nPOST\n${path}\n${await sha256Hex(rawBody)}`,
      ledgerHmacKey,
    );
    const response = await fetch(new URL(path, ledgerUrl), {
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "idempotency-key": String(body.requestId),
        "x-ledger-nonce": nonce,
        "x-ledger-signature": signature,
        "x-ledger-timestamp": timestamp,
      },
      method: "POST",
    });
    if (!response.ok) throw new Error("ledger_unavailable");
    const parsed = LedgerReceiptSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("invalid_ledger_receipt");
    return parsed.data;
  }

  return {
    appendFailureOutcome: (input) =>
      appendLedger({
        action: input.action,
        createdAt: new Date().toISOString(),
        effectiveProfileId: input.effectiveProfileId,
        errorCode: input.errorCode,
        intentRecordHash: input.intentReceipt.recordHash,
        originalActorId: input.originalActorId,
        phase: "outcome",
        requestId: input.requestId,
        result: "failure",
        schemaVersion: 1,
        stream: "admin-audit",
        targetId: input.targetId,
        targetType: input.targetType,
      }),
    appendIntent: (input) =>
      appendLedger({
        ...input,
        createdAt: new Date().toISOString(),
        phase: "intent",
        result: "pending",
        schemaVersion: 1,
        stream: "admin-audit",
      }),
    appendSuccessOutcome: (input) =>
      appendLedger({
        action: input.action,
        createdAt: new Date().toISOString(),
        effectiveProfileId: input.effectiveProfileId,
        intentRecordHash: input.intentReceipt.recordHash,
        originalActorId: input.originalActorId,
        phase: "outcome",
        requestId: input.requestId,
        result: "success",
        schemaVersion: 1,
        stream: "admin-audit",
        targetId: input.targetId,
        targetType: input.targetType,
      }),
    authenticate: async (token) => {
      const { data, error } = await authClient.auth.getClaims(token);
      const claims = data?.claims as Record<string, unknown> | undefined;
      if (
        error ||
        !claims ||
        typeof claims.sub !== "string" ||
        typeof claims.session_id !== "string"
      ) {
        throw new Error("unauthenticated");
      }
      return {
        aal: claims.aal === "aal2" ? "aal2" : "aal1",
        mfaVerifiedAt: latestTotpTimestamp(claims.amr),
        sessionId: claims.session_id,
        userId: claims.sub,
      };
    },
    environment,
    now: () => new Date(),
    rpc: async (name, args) => {
      const rawResult: unknown = await serviceClient.rpc(name as never, args as never);
      const { data, error } = rawResult as {
        data: unknown;
        error: { code?: string; message?: string } | null;
      };
      return {
        data,
        error: error
          ? {
              ...(error.code === undefined ? {} : { code: error.code }),
              ...(error.message === undefined ? {} : { message: error.message }),
            }
          : null,
      };
    },
    verifyIntentReceipt: async (receipt, input) => {
      if (
        receipt.environment !== environment ||
        receipt.stream !== "admin-audit" ||
        receipt.idempotencyHash !==
          (await adminIntentIdempotencyHash(environment, input))
      ) {
        return false;
      }
      const publicKey = pinnedPublicKeys[receipt.keyVersion];
      return publicKey ? verifyLedgerReceipt(receipt, publicKey) : false;
    },
    verifyOutcomeReceipt: async (receipt, input) => {
      if (
        receipt.environment !== environment ||
        receipt.stream !== "admin-audit" ||
        receipt.idempotencyHash !==
          (await adminOutcomeIdempotencyHash(environment, input))
      ) {
        return false;
      }
      const publicKey = pinnedPublicKeys[receipt.keyVersion];
      return publicKey ? verifyLedgerReceipt(receipt, publicKey) : false;
    },
  };
}

export default {
  fetch(request: Request) {
    return handleAdmin(request, runtimeDependencies());
  },
};
