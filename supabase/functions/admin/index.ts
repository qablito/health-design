import { createClient } from "@supabase/supabase-js";

import { classifyCommercialProductCompleteness } from "@health-design/catalog/products";
import {
  AdminBarcodeCorrectionApproveRequestSchema,
  AdminBarcodeCorrectionDetailSchema,
  AdminBarcodeCorrectionListSchema,
  AdminBarcodeCorrectionMutationAckSchema,
  AdminBarcodeCorrectionRejectRequestSchema,
  AdminBarcodeCorrectionRequestSchema,
  AdminCatalogMatchCandidatesAckSchema,
  AdminCatalogMatchCandidatesRequestSchema,
  AdminCatalogPublicationHideRequestSchema,
  AdminCatalogPublicationMutationAckSchema,
  AdminCatalogPublishRequestSchema,
  AdminImpersonationContextSchema,
  AdminMatchingRuleActivateRequestSchema,
  AdminMatchingRuleMutationAckSchema,
  AdminMutationRequestSchema,
  AdminProfileSummarySchema,
  AdminSupermarketMatchingRuleReviewAckSchema,
  AdminSupermarketMatchingRuleReviewRequestSchema,
  LedgerReceiptSchema,
  type AdminBarcodeCorrectionMutationAck,
  type AdminCatalogMatchCandidatesAck,
  type AdminCatalogPublicationMutationAck,
  type AdminImpersonationContext,
  type AdminMatchingRuleMutationAck,
  type AdminSupermarketMatchingRuleReviewAck,
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
import {
  adminCatalogRevisionListFromRows,
  adminSupermarketMatchingRuleListFromRows,
  CatalogAdminInputError,
  parseCatalogAdminRoute,
  supermarketMatchCandidateBatchFromRows,
  type CatalogAdminRoute,
} from "./supermarket-catalogs.ts";

export type { AdminIntentInput } from "../_shared/audit.ts";

const MAX_BODY_BYTES = 131_072;
const RECENT_MFA_SECONDS = 5 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_CORRECTION_STATUSES = new Set([
  "approved",
  "pending",
  "rejected",
  "superseded",
]);

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
  | CatalogAdminRoute
  | { kind: "barcode-correction-approve"; correctionId: string }
  | { kind: "barcode-correction-correct"; correctionId: string }
  | { kind: "barcode-correction-detail"; correctionId: string }
  | { cursor: string | null; kind: "barcode-corrections-list"; status: string }
  | { kind: "barcode-correction-reject"; correctionId: string }
  | { kind: "context" }
  | { kind: "impersonation-end"; impersonationSessionId: string }
  | { kind: "impersonation-start"; profileId: string }
  | { kind: "matching-rule-activate"; matchingRuleId: string }
  | { kind: "profiles-list" };

type ErrorCode =
  | "AAL2_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE"
  | "DOMAIN_CONSTRAINT"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "NOT_FOUND"
  | "UNAUTHENTICATED";

const MESSAGE_KEYS: Readonly<Record<ErrorCode, string>> = {
  AAL2_REQUIRED: "admin.aal2_required",
  DEPENDENCY_UNAVAILABLE: "common.dependency_unavailable",
  DOMAIN_CONSTRAINT: "common.domain_constraint",
  FORBIDDEN: "common.forbidden",
  INTERNAL_ERROR: "common.internal_error",
  INVALID_INPUT: "common.invalid_input",
  IDEMPOTENCY_KEY_REUSED: "admin.idempotency_key_reused",
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
  try {
    const catalogRoute = parseCatalogAdminRoute(url);
    if (catalogRoute) return catalogRoute;
  } catch (error) {
    if (error instanceof CatalogAdminInputError) {
      throw new AdminHttpError("INVALID_INPUT", 400);
    }
    throw error;
  }
  if (path.endsWith("/v1/admin/context")) return { kind: "context" };
  if (path.endsWith("/v1/admin/profiles")) return { kind: "profiles-list" };
  if (path.endsWith("/v1/admin/barcode-corrections")) {
    const keys = [...url.searchParams.keys()];
    if (
      keys.some((key) => key !== "status" && key !== "cursor") ||
      new Set(keys).size !== keys.length
    ) {
      throw new AdminHttpError("INVALID_INPUT", 400);
    }
    const status = url.searchParams.get("status") ?? "pending";
    if (!ADMIN_CORRECTION_STATUSES.has(status)) {
      throw new AdminHttpError("INVALID_INPUT", 400);
    }
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && !UUID_PATTERN.test(cursor)) {
      throw new AdminHttpError("INVALID_INPUT", 400);
    }
    return { cursor, kind: "barcode-corrections-list", status };
  }

  const correction = path.match(
    /\/v1\/admin\/barcode-corrections\/([0-9a-f-]{36})(?:\/(correct|approve|reject))?$/i,
  );
  if (correction?.[1] && UUID_PATTERN.test(correction[1])) {
    const action = correction[2];
    if (action === "correct") {
      return { correctionId: correction[1], kind: "barcode-correction-correct" };
    }
    if (action === "approve") {
      return { correctionId: correction[1], kind: "barcode-correction-approve" };
    }
    if (action === "reject") {
      return { correctionId: correction[1], kind: "barcode-correction-reject" };
    }
    if (action === undefined) {
      return { correctionId: correction[1], kind: "barcode-correction-detail" };
    }
  }

  const matching = path.match(
    /\/v1\/admin\/matching-rules\/([0-9a-f-]{36})\/activate$/i,
  );
  if (matching?.[1] && UUID_PATTERN.test(matching[1])) {
    return { kind: "matching-rule-activate", matchingRuleId: matching[1] };
  }

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
  return route.kind === "context" ||
    route.kind === "profiles-list" ||
    route.kind === "barcode-corrections-list" ||
    route.kind === "barcode-correction-detail" ||
    route.kind === "catalog-revisions-list" ||
    route.kind === "supermarket-matching-rules-list"
    ? "GET"
    : "POST";
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
  if (error.message === "idempotency_conflict") {
    return new AdminHttpError("IDEMPOTENCY_KEY_REUSED", 409);
  }
  if (
    error.code === "22023" ||
    error.code === "23505" ||
    error.code === "40001" ||
    error.code === "55000"
  ) {
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

async function listBarcodeCorrections(
  dependencies: AdminDependencies,
  auth: AuthContext,
  route: Extract<AdminRoute, { kind: "barcode-corrections-list" }>,
): Promise<unknown> {
  const result = await dependencies.rpc("internal_admin_list_barcode_corrections", {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
    p_cursor: route.cursor,
    p_limit: 51,
    p_status: route.status,
  });
  if (result.error) throw mapRpcError(result.error);
  if (!Array.isArray(result.data)) {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const rows = result.data.slice(0, 50).map((value: unknown) => {
    const row = firstRow(value);
    return {
      ...(typeof row?.brand === "string" ? { brand: row.brand } : {}),
      completeness: row?.completeness,
      correctionId: row?.correction_id,
      createdAt: row?.created_at,
      duplicateCount: Number(row?.duplicate_count),
      gtin14: row?.gtin14,
      name: row?.name,
      profileId: row?.profile_id,
      status: row?.status,
      version: row?.version,
    };
  });
  const parsed = AdminBarcodeCorrectionListSchema.safeParse({
    items: rows,
    nextCursor:
      result.data.length > 50 && rows.length > 0
        ? rows[rows.length - 1]?.correctionId
        : null,
    schemaVersion: 1,
  });
  if (!parsed.success) throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

async function listCatalogRevisions(
  dependencies: AdminDependencies,
  auth: AuthContext,
  route: Extract<AdminRoute, { kind: "catalog-revisions-list" }>,
): Promise<unknown> {
  const result = await dependencies.rpc(
    "internal_admin_list_supermarket_catalog_revisions",
    {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_chain: route.chain,
      p_cursor: route.cursor,
      p_limit: 51,
      p_state: route.state,
    },
  );
  if (result.error) throw mapRpcError(result.error);
  try {
    return adminCatalogRevisionListFromRows(result.data);
  } catch {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
}

async function barcodeCorrectionDetail(
  dependencies: AdminDependencies,
  auth: AuthContext,
  correctionId: string,
): Promise<unknown> {
  const result = await dependencies.rpc("internal_admin_get_barcode_correction", {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
    p_correction_id: correctionId,
  });
  if (result.error) throw mapRpcError(result.error);
  const row = firstRow(result.data);
  if (!row) throw new AdminHttpError("NOT_FOUND", 404);
  const parsed = AdminBarcodeCorrectionDetailSchema.safeParse({
    baseSnapshot: row.base_snapshot ?? null,
    correctionId: row.correction_id,
    createdAt: row.created_at,
    globalSnapshot: row.global_snapshot ?? null,
    productId: row.product_id,
    profileId: row.profile_id,
    proposedSnapshot: row.proposed_snapshot,
    reviewRevisionId: row.review_revision_id,
    schemaVersion: 1,
    status: row.status,
    version: row.version,
  });
  if (!parsed.success) throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

type AdminMutationContext = Readonly<{
  effectiveProfileId: string;
  mutationScope?: "product" | "supermarket";
  originalActorId: string;
  targetId: string;
  targetType: AdminIntentInput["targetType"];
}>;

async function productAuditContext(
  dependencies: AdminDependencies,
  auth: AuthContext,
  action: AdminIntentInput["action"],
  targetId: string,
): Promise<AdminMutationContext> {
  let result = await dependencies.rpc("internal_admin_product_audit_context", {
    p_action: action,
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
    p_target_id: targetId,
  });
  if (
    result.error &&
    action === "matching_rule_activate" &&
    result.error.message === "matching_rule_not_found"
  ) {
    result = await dependencies.rpc("internal_admin_supermarket_audit_context", {
      p_action: action,
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_target_id: targetId,
    });
  }
  if (result.error) throw mapRpcError(result.error);
  const row = firstRow(result.data);
  if (
    !row ||
    typeof row.original_actor_id !== "string" ||
    !UUID_PATTERN.test(row.original_actor_id) ||
    typeof row.effective_profile_id !== "string" ||
    !UUID_PATTERN.test(row.effective_profile_id) ||
    typeof row.audit_target_id !== "string" ||
    !UUID_PATTERN.test(row.audit_target_id) ||
    (row.audit_target_type !== "barcode_correction" &&
      row.audit_target_type !== "commercial_product_revision" &&
      row.audit_target_type !== "product_matching_rule")
  ) {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return {
    effectiveProfileId: row.effective_profile_id,
    mutationScope: row.mutation_scope === "supermarket" ? "supermarket" : "product",
    originalActorId: row.original_actor_id,
    targetId: row.audit_target_id,
    targetType: row.audit_target_type,
  };
}

async function supermarketAuditContext(
  dependencies: AdminDependencies,
  auth: AuthContext,
  action: AdminIntentInput["action"],
  targetId: string,
): Promise<AdminMutationContext> {
  const result = await dependencies.rpc("internal_admin_supermarket_audit_context", {
    p_action: action,
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
    p_target_id: targetId,
  });
  if (result.error) throw mapRpcError(result.error);
  const row = firstRow(result.data);
  if (
    !row ||
    typeof row.original_actor_id !== "string" ||
    !UUID_PATTERN.test(row.original_actor_id) ||
    typeof row.effective_profile_id !== "string" ||
    !UUID_PATTERN.test(row.effective_profile_id) ||
    typeof row.audit_target_id !== "string" ||
    !UUID_PATTERN.test(row.audit_target_id) ||
    (row.audit_target_type !== "catalog_revision" &&
      row.audit_target_type !== "catalog_publication" &&
      row.audit_target_type !== "product_matching_rule")
  ) {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return {
    effectiveProfileId: row.effective_profile_id,
    mutationScope: "supermarket",
    originalActorId: row.original_actor_id,
    targetId: row.audit_target_id,
    targetType: row.audit_target_type,
  };
}

async function mutateAdmin<T>(
  dependencies: AdminDependencies,
  auth: AuthContext,
  input: Readonly<{
    action: AdminIntentInput["action"];
    context: (
      dependencies: AdminDependencies,
      auth: AuthContext,
      action: AdminIntentInput["action"],
      targetId: string,
    ) => Promise<AdminMutationContext>;
    requestId: string;
    rpcArgs: Record<string, unknown>;
    rpcName: string | ((context: AdminMutationContext) => string);
    schema: {
      safeParse(value: unknown): { data: T; success: true } | { success: false };
    };
    targetId: string;
  }>,
): Promise<{ auditClosed: boolean; value: T }> {
  const context = await input.context(dependencies, auth, input.action, input.targetId);
  const intent: AdminIntentInput = {
    action: input.action,
    effectiveProfileId: context.effectiveProfileId,
    originalActorId: context.originalActorId,
    requestId: input.requestId,
    targetId: context.targetId,
    targetType: context.targetType,
  };
  const receipt = await verifiedIntent(dependencies, intent);
  let result;
  try {
    const rpcName =
      typeof input.rpcName === "string" ? input.rpcName : input.rpcName(context);
    result = await dependencies.rpc(rpcName, {
      ...input.rpcArgs,
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_request_id: input.requestId,
      ...receiptRpcArgs(receipt),
    });
  } catch {
    await appendFailureBestEffort(dependencies, intent, receipt, {});
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  if (result.error) {
    await appendFailureBestEffort(dependencies, intent, receipt, result.error);
    throw mapRpcError(result.error);
  }
  const parsed = input.schema.safeParse(firstRow(result.data));
  if (!parsed.success) {
    await appendFailureBestEffort(dependencies, intent, receipt, {});
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return {
    auditClosed: await completeSuccessOutcome(dependencies, intent, receipt),
    value: parsed.data,
  };
}

async function mutateProductAdmin<T>(
  dependencies: AdminDependencies,
  auth: AuthContext,
  input: Omit<Parameters<typeof mutateAdmin<T>>[2], "context">,
): Promise<{ auditClosed: boolean; value: T }> {
  return mutateAdmin(dependencies, auth, { ...input, context: productAuditContext });
}

async function mutateSupermarketAdmin<T>(
  dependencies: AdminDependencies,
  auth: AuthContext,
  input: Omit<Parameters<typeof mutateAdmin<T>>[2], "context">,
): Promise<{ auditClosed: boolean; value: T }> {
  return mutateAdmin(dependencies, auth, {
    ...input,
    context: supermarketAuditContext,
  });
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
    if (url.hash) throw new AdminHttpError("INVALID_INPUT", 400);
    const route = parseRoute(url);
    if (!route) throw new AdminHttpError("NOT_FOUND", 404);
    if (
      route.kind !== "barcode-corrections-list" &&
      route.kind !== "catalog-revisions-list" &&
      route.kind !== "supermarket-matching-rules-list" &&
      url.search
    ) {
      throw new AdminHttpError("INVALID_INPUT", 400);
    }
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
    if (route.kind === "barcode-corrections-list") {
      return jsonResponse(
        await listBarcodeCorrections(dependencies, auth, route),
        200,
        cors.headers,
      );
    }
    if (route.kind === "barcode-correction-detail") {
      return jsonResponse(
        await barcodeCorrectionDetail(dependencies, auth, route.correctionId),
        200,
        cors.headers,
      );
    }
    if (route.kind === "catalog-revisions-list") {
      return jsonResponse(
        await listCatalogRevisions(dependencies, auth, route),
        200,
        cors.headers,
      );
    }
    if (route.kind === "supermarket-matching-rules-list") {
      const result = await dependencies.rpc(
        "internal_admin_list_supermarket_matching_rules",
        {
          p_auth_session_id: auth.sessionId,
          p_auth_subject: auth.userId,
          p_catalog_revision_id: route.catalogRevisionId,
          p_cursor: route.cursor,
          p_limit: 51,
        },
      );
      if (result.error) throw mapRpcError(result.error);
      return jsonResponse(
        adminSupermarketMatchingRuleListFromRows(result.data),
        200,
        cors.headers,
      );
    }

    if (route.kind === "catalog-match-candidates") {
      const idempotencyKey = requireUuid(request.headers.get("idempotency-key"));
      const parsed = AdminCatalogMatchCandidatesRequestSchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
      const inputs = await dependencies.rpc("internal_admin_supermarket_match_inputs", {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        p_catalog_revision_id: route.catalogRevisionId,
        p_expected_version: parsed.data.expectedVersion,
      });
      if (inputs.error) throw mapRpcError(inputs.error);
      let batch: ReturnType<typeof supermarketMatchCandidateBatchFromRows>;
      try {
        batch = supermarketMatchCandidateBatchFromRows(inputs.data);
      } catch {
        throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
      }
      const mutation = await mutateSupermarketAdmin(dependencies, auth, {
        action: "catalog_match_candidates_generate",
        requestId: idempotencyKey,
        rpcArgs: {
          p_basket_seed_revision_id: batch.basketSeedRevisionId,
          p_candidates: batch.candidates,
          p_catalog_revision_id: route.catalogRevisionId,
          p_expected_version: parsed.data.expectedVersion,
          p_processed_skus: batch.processedSkus,
        },
        rpcName: "internal_admin_generate_supermarket_match_candidates",
        schema: AdminCatalogMatchCandidatesAckSchema,
        targetId: route.catalogRevisionId,
      });
      return jsonResponse(
        mutation.auditClosed
          ? mutation.value
          : { ...mutation.value, auditClosure: "pending" },
        mutation.auditClosed ? 201 : 202,
        cors.headers,
      );
    }

    if (
      route.kind === "barcode-correction-correct" ||
      route.kind === "barcode-correction-approve" ||
      route.kind === "barcode-correction-reject" ||
      route.kind === "supermarket-matching-rule-review" ||
      route.kind === "matching-rule-activate" ||
      route.kind === "catalog-publish" ||
      route.kind === "catalog-publication-hide"
    ) {
      requireRecentMfa(auth, dependencies.now());
      const idempotencyKey = requireUuid(request.headers.get("idempotency-key"));
      const body = await readJson(request);
      let mutation:
        | { auditClosed: boolean; value: AdminBarcodeCorrectionMutationAck }
        | { auditClosed: boolean; value: AdminCatalogMatchCandidatesAck }
        | { auditClosed: boolean; value: AdminMatchingRuleMutationAck }
        | { auditClosed: boolean; value: AdminCatalogPublicationMutationAck }
        | { auditClosed: boolean; value: AdminSupermarketMatchingRuleReviewAck };
      if (route.kind === "catalog-publish") {
        const parsed = AdminCatalogPublishRequestSchema.safeParse(body);
        if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
        mutation = await mutateSupermarketAdmin(dependencies, auth, {
          action: "catalog_revision_publish",
          requestId: idempotencyKey,
          rpcArgs: {
            p_catalog_revision_id: route.catalogRevisionId,
            p_expected_catalog_hash: bytea(parsed.data.expectedCatalogHash),
            p_expected_coverage_hash: bytea(parsed.data.expectedCoverageHash),
            p_expected_seed_hash: bytea(parsed.data.expectedSeedHash),
            p_expected_version: parsed.data.expectedVersion,
            p_source_use_decision: parsed.data.sourceUseDecision,
          },
          rpcName: "internal_admin_publish_supermarket_catalog",
          schema: AdminCatalogPublicationMutationAckSchema,
          targetId: route.catalogRevisionId,
        });
      } else if (route.kind === "catalog-publication-hide") {
        const parsed = AdminCatalogPublicationHideRequestSchema.safeParse(body);
        if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
        mutation = await mutateSupermarketAdmin(dependencies, auth, {
          action: "catalog_publication_hide",
          requestId: idempotencyKey,
          rpcArgs: {
            p_catalog_publication_id: route.catalogPublicationId,
            p_expected_version: parsed.data.expectedVersion,
          },
          rpcName: "internal_admin_hide_supermarket_catalog_publication",
          schema: AdminCatalogPublicationMutationAckSchema,
          targetId: route.catalogPublicationId,
        });
      } else if (route.kind === "supermarket-matching-rule-review") {
        const parsed = AdminSupermarketMatchingRuleReviewRequestSchema.safeParse(body);
        if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
        mutation = await mutateSupermarketAdmin(dependencies, auth, {
          action: "matching_rule_review",
          requestId: idempotencyKey,
          rpcArgs: {
            p_expected_version: parsed.data.expectedVersion,
            p_match_state: parsed.data.matchState,
            p_matching_rule_id: route.matchingRuleId,
          },
          rpcName: "internal_admin_review_supermarket_matching_rule",
          schema: AdminSupermarketMatchingRuleReviewAckSchema,
          targetId: route.matchingRuleId,
        });
      } else if (route.kind === "barcode-correction-correct") {
        const parsed = AdminBarcodeCorrectionRequestSchema.safeParse(body);
        if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
        const classification = classifyCommercialProductCompleteness(
          parsed.data.snapshot,
        );
        mutation = await mutateProductAdmin(dependencies, auth, {
          action: "barcode_correction_correct",
          requestId: idempotencyKey,
          rpcArgs: {
            p_completeness: classification.completeness,
            p_correction_id: route.correctionId,
            p_expected_version: parsed.data.expectedVersion,
            p_snapshot: parsed.data.snapshot,
            p_uncertainties: classification.uncertainties,
          },
          rpcName: "internal_admin_correct_barcode_correction",
          schema: AdminBarcodeCorrectionMutationAckSchema,
          targetId: route.correctionId,
        });
      } else if (route.kind === "barcode-correction-approve") {
        const parsed = AdminBarcodeCorrectionApproveRequestSchema.safeParse(body);
        if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
        mutation = await mutateProductAdmin(dependencies, auth, {
          action: "barcode_correction_approve",
          requestId: idempotencyKey,
          rpcArgs: {
            p_canonical_food_key: parsed.data.canonicalFoodKey,
            p_correction_id: route.correctionId,
            p_evidence: parsed.data.evidence,
            p_expected_version: parsed.data.expectedVersion,
            p_match_state: parsed.data.matchState,
          },
          rpcName: "internal_admin_approve_barcode_correction",
          schema: AdminBarcodeCorrectionMutationAckSchema,
          targetId: route.correctionId,
        });
      } else if (route.kind === "barcode-correction-reject") {
        const parsed = AdminBarcodeCorrectionRejectRequestSchema.safeParse(body);
        if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
        mutation = await mutateProductAdmin(dependencies, auth, {
          action: "barcode_correction_reject",
          requestId: idempotencyKey,
          rpcArgs: {
            p_correction_id: route.correctionId,
            p_expected_version: parsed.data.expectedVersion,
            p_reason: parsed.data.reason,
          },
          rpcName: "internal_admin_reject_barcode_correction",
          schema: AdminBarcodeCorrectionMutationAckSchema,
          targetId: route.correctionId,
        });
      } else {
        const parsed = AdminMatchingRuleActivateRequestSchema.safeParse(body);
        if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
        mutation = await mutateProductAdmin(dependencies, auth, {
          action: "matching_rule_activate",
          requestId: idempotencyKey,
          rpcArgs: {
            p_expected_version: parsed.data.expectedVersion,
            p_matching_rule_id: route.matchingRuleId,
          },
          rpcName: (context) =>
            context.mutationScope === "supermarket"
              ? "internal_admin_activate_supermarket_matching_rule"
              : "internal_admin_activate_product_matching_rule",
          schema: AdminMatchingRuleMutationAckSchema,
          targetId: route.matchingRuleId,
        });
      }
      return jsonResponse(
        mutation.auditClosed
          ? mutation.value
          : { ...mutation.value, auditClosure: "pending" },
        mutation.auditClosed ? 200 : 202,
        cors.headers,
      );
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
