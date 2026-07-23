import { createClient } from "@supabase/supabase-js";

import { classifyCommercialProductCompleteness } from "@health-design/catalog/products";
import {
  AdminBarcodeCorrectionApproveRequestSchema,
  AdminBarcodeCorrectionDetailSchema,
  AdminBarcodeCorrectionListSchema,
  AdminBarcodeCorrectionMutationAckSchema,
  AdminBarcodeCorrectionRejectRequestSchema,
  AdminBarcodeCorrectionRequestSchema,
  AdminBackupCreateRequestSchema,
  AdminBackupJobListSchema,
  AdminBackupJobSchema,
  AdminCatalogMatchCandidatesAckSchema,
  AdminCatalogMatchCandidatesRequestSchema,
  AdminCatalogPublicationHideRequestSchema,
  AdminCatalogPublicationMutationAckSchema,
  AdminCatalogPublishRequestSchema,
  AdminImpersonationContextSchema,
  AdminDeletionJobSchema,
  AdminPermanentDeletionRequestSchema,
  AdminMatchingRuleActivateRequestSchema,
  AdminMatchingRuleMutationAckSchema,
  AdminMutationRequestSchema,
  AdminProfileSummarySchema,
  AdminRestoreCreateRequestSchema,
  AdminRestoreJobListSchema,
  AdminRestoreJobSchema,
  AdminRestorePromoteRequestSchema,
  AdminSupermarketMatchingRuleReviewAckSchema,
  AdminSupermarketMatchingRuleReviewRequestSchema,
  LedgerReceiptSchema,
  type AdminBarcodeCorrectionMutationAck,
  type AdminBackupJob,
  type AdminCatalogMatchCandidatesAck,
  type AdminCatalogPublicationMutationAck,
  type AdminImpersonationContext,
  type AdminDeletionJob,
  type AdminMatchingRuleMutationAck,
  type AdminRestoreJob,
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
  appendDeletionTombstone?(input: {
    markerKeyVersion: number;
    operationId: string;
    profileMarker: string;
  }): Promise<LedgerReceipt>;
  appendFailureOutcome(input: AdminFailureOutcomeInput): Promise<LedgerReceipt>;
  appendIntent(input: AdminIntentInput): Promise<LedgerReceipt>;
  appendSuccessOutcome(input: AdminSuccessOutcomeInput): Promise<LedgerReceipt>;
  authenticate(token: string): Promise<AuthContext>;
  deleteAuthUser?(authSubject: string): Promise<void>;
  deletePrivateObjects?(paths: readonly string[]): Promise<void>;
  environment: EdgeEnvironment;
  now(): Date;
  rpc: AuditRpc;
  verifyIntentReceipt(
    receipt: LedgerReceipt,
    input: AdminIntentInput,
  ): Promise<boolean>;
  verifyDeletionReceipt?(
    receipt: LedgerReceipt,
    input: {
      markerKeyVersion: number;
      operationId: string;
      profileMarker: string;
    },
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
  | { kind: "backups" }
  | { kind: "impersonation-end"; impersonationSessionId: string }
  | { kind: "impersonation-start"; profileId: string }
  | { jobId: string; kind: "deletion-job-detail" }
  | { kind: "profile-permanent-delete"; profileId: string }
  | { kind: "restores" }
  | { kind: "restore-promote"; restoreId: string }
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
  if (path.endsWith("/v1/admin/backups")) return { kind: "backups" };
  if (path.endsWith("/v1/admin/restores")) return { kind: "restores" };
  const restorePromotion = path.match(
    /\/v1\/admin\/restores\/([0-9a-f-]{36})\/promote$/i,
  );
  if (restorePromotion?.[1] && UUID_PATTERN.test(restorePromotion[1])) {
    return { kind: "restore-promote", restoreId: restorePromotion[1] };
  }
  const deletionJob = path.match(/\/v1\/admin\/deletion-jobs\/([0-9a-f-]{36})$/i);
  if (deletionJob?.[1] && UUID_PATTERN.test(deletionJob[1])) {
    return { jobId: deletionJob[1], kind: "deletion-job-detail" };
  }
  const permanentDeletion = path.match(
    /\/v1\/admin\/profiles\/([0-9a-f-]{36})\/permanent$/i,
  );
  if (permanentDeletion?.[1] && UUID_PATTERN.test(permanentDeletion[1])) {
    return {
      kind: "profile-permanent-delete",
      profileId: permanentDeletion[1],
    };
  }
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

function expectedMethod(route: AdminRoute): "DELETE" | "GET" | "POST" {
  if (route.kind === "profile-permanent-delete") return "DELETE";
  return route.kind === "context" ||
    route.kind === "profiles-list" ||
    route.kind === "barcode-corrections-list" ||
    route.kind === "barcode-correction-detail" ||
    route.kind === "catalog-revisions-list" ||
    route.kind === "supermarket-matching-rules-list" ||
    route.kind === "deletion-job-detail"
    ? "GET"
    : "POST";
}

function methodAllowed(route: AdminRoute, method: string): boolean {
  if (route.kind === "backups" || route.kind === "restores") {
    return method === "GET" || method === "POST";
  }
  return method === expectedMethod(route);
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
  const summaries = await Promise.all(
    result.data.map(async (row: unknown) => {
      const candidate = firstRow(row);
      let deletionJob: AdminDeletionJob | undefined;
      if (
        candidate?.status === "deletion_requested" &&
        typeof candidate.profile_id === "string"
      ) {
        const secret = firstRow(
          await deletionRpc(
            dependencies,
            "internal_admin_get_profile_deletion_secret",
            {
              p_auth_session_id: auth.sessionId,
              p_auth_subject: auth.userId,
              p_profile_id: candidate.profile_id,
            },
          ),
        );
        deletionJob = deletionJobFrom(secret?.job);
      }
      return {
        alias: candidate?.alias,
        createdAt: candidate?.created_at,
        ...(deletionJob
          ? {
              deletionJobId: deletionJob.jobId,
              deletionJobVersion: deletionJob.version,
            }
          : {}),
        profileId: candidate?.profile_id,
        status: candidate?.status,
      };
    }),
  );
  const parsed = AdminProfileSummarySchema.array().safeParse(summaries);
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

function deletionJobFrom(value: unknown): AdminDeletionJob {
  const row = firstRow(value);
  const parsed = AdminDeletionJobSchema.safeParse({
    ...row,
    schemaVersion: 1,
  });
  if (!parsed.success) throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

function backupJobFrom(value: unknown): AdminBackupJob {
  const parsed = AdminBackupJobSchema.safeParse(firstRow(value));
  if (!parsed.success) throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

function restoreJobFrom(value: unknown): AdminRestoreJob {
  const parsed = AdminRestoreJobSchema.safeParse(firstRow(value));
  if (!parsed.success) throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

async function t18OperationMutation<T>(
  dependencies: AdminDependencies,
  auth: AuthContext,
  input: {
    action: "backup_create" | "restore_create" | "restore_promote";
    parse(value: unknown): T;
    requestId: string;
    rpcArgs: Record<string, unknown>;
    rpcName: string;
    targetId: string;
    targetType: "backup_job" | "restore_job";
  },
): Promise<{ auditClosed: boolean; value: T }> {
  const intent: AdminIntentInput = {
    action: input.action,
    effectiveProfileId: null,
    originalActorId: await authorize(dependencies, auth),
    requestId: input.requestId,
    targetId: input.targetId,
    targetType: input.targetType,
  };
  const receipt = await verifiedIntent(dependencies, intent);
  try {
    await deletionRpc(dependencies, "internal_record_t18_admin_intent", {
      p_action: intent.action,
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_effective_profile_id: null,
      p_request_id: intent.requestId,
      p_target_id: intent.targetId,
      p_target_type: intent.targetType,
      ...receiptRpcArgs(receipt),
    });
    const value = input.parse(
      await deletionRpc(dependencies, input.rpcName, {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        ...input.rpcArgs,
      }),
    );
    return {
      auditClosed: await completeSuccessOutcome(dependencies, intent, receipt),
      value,
    };
  } catch (error) {
    await appendFailureBestEffort(dependencies, intent, receipt, {});
    if (error instanceof AdminHttpError) throw error;
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
}

function completedDeletionSteps(job: AdminDeletionJob): Set<string> {
  return new Set(job.steps.filter((step) => step.completed).map((step) => step.name));
}

async function deletionRpc(
  dependencies: AdminDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await dependencies.rpc(name, args);
  if (result.error) throw mapRpcError(result.error);
  return result.data;
}

async function completeDeletionStep(
  dependencies: AdminDependencies,
  auth: AuthContext,
  job: AdminDeletionJob,
  step: string,
  receiptSource: unknown,
): Promise<AdminDeletionJob> {
  return deletionJobFrom(
    await deletionRpc(dependencies, "internal_admin_complete_deletion_step", {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_expected_version: job.version,
      p_job_id: job.jobId,
      p_receipt_digest: bytea(await sha256Hex(JSON.stringify(receiptSource))),
      p_step_name: step,
    }),
  );
}

async function transitionDeletionJob(
  dependencies: AdminDependencies,
  auth: AuthContext,
  job: AdminDeletionJob,
  nextStatus: "failed" | "ledger_recorded" | "purged" | "purging" | "queued",
  errorCode: string | null = null,
): Promise<AdminDeletionJob> {
  return deletionJobFrom(
    await deletionRpc(dependencies, "internal_admin_transition_deletion_job", {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_error_code: errorCode,
      p_expected_version: job.version,
      p_job_id: job.jobId,
      p_next_status: nextStatus,
    }),
  );
}

async function permanentDeleteProfile(
  dependencies: AdminDependencies,
  auth: AuthContext,
  profileId: string,
  requestId: string,
  expectedVersion: number,
): Promise<{ auditClosed: boolean; job: AdminDeletionJob }> {
  if (
    !dependencies.appendDeletionTombstone ||
    !dependencies.verifyDeletionReceipt ||
    !dependencies.deletePrivateObjects ||
    !dependencies.deleteAuthUser
  ) {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const originalActorId = await authorize(dependencies, auth);
  const secret = firstRow(
    await deletionRpc(dependencies, "internal_admin_get_profile_deletion_secret", {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_profile_id: profileId,
    }),
  );
  if (
    !secret ||
    typeof secret.profileMarker !== "string" ||
    !/^[a-f0-9]{64}$/.test(secret.profileMarker) ||
    !Number.isInteger(secret.profileMarkerKeyVersion)
  ) {
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  let job = deletionJobFrom(secret.job);
  if (job.version !== expectedVersion) {
    throw new AdminHttpError("DOMAIN_CONSTRAINT", 409);
  }
  const intent: AdminIntentInput = {
    action:
      job.status === "failed"
        ? "profile_deletion_resume"
        : "profile_deletion_permanent",
    effectiveProfileId: profileId,
    originalActorId,
    requestId,
    targetId: job.jobId,
    targetType: "deletion_job",
  };
  const intentReceipt = await verifiedIntent(dependencies, intent);

  try {
    await deletionRpc(dependencies, "internal_record_t18_admin_intent", {
      p_action: intent.action,
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_effective_profile_id: intent.effectiveProfileId,
      p_request_id: intent.requestId,
      p_target_id: intent.targetId,
      p_target_type: intent.targetType,
      ...receiptRpcArgs(intentReceipt),
    });

    let steps = completedDeletionSteps(job);
    if (job.status === "failed") {
      const resumeStatus = steps.has("ledger")
        ? steps.has("access")
          ? "purging"
          : "ledger_recorded"
        : "queued";
      job = await transitionDeletionJob(dependencies, auth, job, resumeStatus);
    }

    if (!steps.has("ledger")) {
      const tombstoneInput = {
        markerKeyVersion: secret.profileMarkerKeyVersion as number,
        operationId: job.jobId,
        profileMarker: secret.profileMarker,
      };
      const tombstoneReceipt = LedgerReceiptSchema.parse(
        await dependencies.appendDeletionTombstone(tombstoneInput),
      );
      if (
        tombstoneReceipt.stream !== "deletions" ||
        !(await dependencies.verifyDeletionReceipt(tombstoneReceipt, tombstoneInput))
      ) {
        throw new Error("ledger_verification_failed");
      }
      job = await completeDeletionStep(
        dependencies,
        auth,
        job,
        "ledger",
        tombstoneReceipt,
      );
      steps = completedDeletionSteps(job);
    }
    if (job.status === "queued") {
      job = await transitionDeletionJob(dependencies, auth, job, "ledger_recorded");
    }

    if (!steps.has("access")) {
      await deletionRpc(dependencies, "internal_admin_revoke_profile_access", {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        p_expected_version: job.version,
        p_job_id: job.jobId,
      });
      job = await completeDeletionStep(dependencies, auth, job, "access", {
        jobId: job.jobId,
        step: "access",
      });
      steps = completedDeletionSteps(job);
    }
    if (job.status === "ledger_recorded") {
      job = await transitionDeletionJob(dependencies, auth, job, "purging");
    }

    if (!steps.has("exports") || !steps.has("storage")) {
      const purgeEntries = await deletionRpc(
        dependencies,
        "internal_list_profile_export_purge_paths",
        { p_job_id: job.jobId },
      );
      if (!Array.isArray(purgeEntries)) {
        throw new Error("storage_verification_failed");
      }
      const paths = purgeEntries.map((entry) => {
        const row = firstRow(entry);
        if (typeof row?.storagePath !== "string") {
          throw new Error("storage_verification_failed");
        }
        return row.storagePath;
      });
      await dependencies.deletePrivateObjects(paths);
      await deletionRpc(dependencies, "internal_confirm_profile_export_purge", {
        p_job_id: job.jobId,
        p_removed_paths: paths,
      });
      if (!steps.has("exports")) {
        job = await completeDeletionStep(dependencies, auth, job, "exports", {
          paths: await Promise.all(paths.map((path) => sha256Hex(path))),
          step: "exports",
        });
      }
      if (!steps.has("storage")) {
        job = await completeDeletionStep(dependencies, auth, job, "storage", {
          count: paths.length,
          step: "storage",
        });
      }
      steps = completedDeletionSteps(job);
    }

    if (!steps.has("profile_data")) {
      await deletionRpc(dependencies, "internal_admin_purge_profile_data", {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        p_expected_version: job.version,
        p_job_id: job.jobId,
      });
      job = await completeDeletionStep(dependencies, auth, job, "profile_data", {
        jobId: job.jobId,
        step: "profile_data",
      });
      steps = completedDeletionSteps(job);
    }

    if (!steps.has("auth")) {
      const authSubjects = await deletionRpc(
        dependencies,
        "internal_admin_list_orphan_auth_subjects",
        {
          p_auth_session_id: auth.sessionId,
          p_auth_subject: auth.userId,
          p_job_id: job.jobId,
        },
      );
      if (
        !Array.isArray(authSubjects) ||
        authSubjects.some(
          (authSubject) =>
            typeof authSubject !== "string" || !UUID_PATTERN.test(authSubject),
        )
      ) {
        throw new Error("auth_cleanup_pending");
      }
      for (const authSubject of authSubjects) {
        await dependencies.deleteAuthUser(authSubject as string);
      }
      job = await completeDeletionStep(dependencies, auth, job, "auth", {
        deleted: authSubjects.length,
        step: "auth",
      });
      steps = completedDeletionSteps(job);
    }

    if (!steps.has("verification")) {
      const verified = await deletionRpc(
        dependencies,
        "internal_admin_verify_profile_purge",
        {
          p_auth_session_id: auth.sessionId,
          p_auth_subject: auth.userId,
          p_job_id: job.jobId,
        },
      );
      if (verified !== true) throw new Error("verification_failed");
      job = await completeDeletionStep(dependencies, auth, job, "verification", {
        verified: true,
      });
    }
    job = await transitionDeletionJob(dependencies, auth, job, "purged");
    return {
      auditClosed: await completeSuccessOutcome(dependencies, intent, intentReceipt),
      job,
    };
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        "auth_cleanup_pending",
        "ledger_verification_failed",
        "storage_verification_failed",
        "verification_failed",
      ].includes(error.message)
        ? error.message
        : "profile_purge_failed";
    try {
      if (job.status !== "failed" && job.status !== "purged") {
        job = await transitionDeletionJob(dependencies, auth, job, "failed", code);
      }
    } catch {
      // El job conserva el último punto confirmado y sigue siendo reanudable.
    }
    await appendFailureBestEffort(dependencies, intent, intentReceipt, {});
    throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
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
        "access-control-allow-methods": "DELETE, GET, POST, OPTIONS",
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
    if (!methodAllowed(route, request.method)) {
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

    if (route.kind === "backups") {
      if (request.method === "GET") {
        const rows = await deletionRpc(
          dependencies,
          "internal_admin_list_backup_jobs",
          {
            p_auth_session_id: auth.sessionId,
            p_auth_subject: auth.userId,
          },
        );
        const parsed = AdminBackupJobListSchema.safeParse(rows);
        if (!parsed.success) {
          throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
        }
        return jsonResponse(parsed.data, 200, cors.headers);
      }
      if (dependencies.environment === "production") {
        throw new AdminHttpError("DOMAIN_CONSTRAINT", 409);
      }
      requireRecentMfa(auth, dependencies.now());
      const idempotencyKey = requireUuid(request.headers.get("idempotency-key"));
      const parsed = AdminBackupCreateRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
      const mutation = await t18OperationMutation(dependencies, auth, {
        action: "backup_create",
        parse: backupJobFrom,
        requestId: idempotencyKey,
        rpcArgs: {
          p_job_id: idempotencyKey,
          p_kind: parsed.data.kind,
          p_schema_version: parsed.data.schemaVersion,
          p_source_environment: dependencies.environment,
        },
        rpcName: "internal_admin_create_backup_job",
        targetId: idempotencyKey,
        targetType: "backup_job",
      });
      return jsonResponse(
        mutation.value,
        mutation.auditClosed ? 201 : 202,
        cors.headers,
      );
    }
    if (route.kind === "restores") {
      if (request.method === "GET") {
        const rows = await deletionRpc(
          dependencies,
          "internal_admin_list_restore_jobs",
          {
            p_auth_session_id: auth.sessionId,
            p_auth_subject: auth.userId,
          },
        );
        const parsed = AdminRestoreJobListSchema.safeParse(rows);
        if (!parsed.success) {
          throw new AdminHttpError("DEPENDENCY_UNAVAILABLE", 503);
        }
        return jsonResponse(parsed.data, 200, cors.headers);
      }
      if (dependencies.environment === "production") {
        throw new AdminHttpError("DOMAIN_CONSTRAINT", 409);
      }
      requireRecentMfa(auth, dependencies.now());
      const idempotencyKey = requireUuid(request.headers.get("idempotency-key"));
      const parsed = AdminRestoreCreateRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
      const mutation = await t18OperationMutation(dependencies, auth, {
        action: "restore_create",
        parse: restoreJobFrom,
        requestId: idempotencyKey,
        rpcArgs: {
          p_backup_job_id: parsed.data.backupId,
          p_job_id: idempotencyKey,
          p_target_fingerprint: bytea(parsed.data.targetFingerprint),
        },
        rpcName: "internal_admin_create_restore_job",
        targetId: idempotencyKey,
        targetType: "restore_job",
      });
      return jsonResponse(
        mutation.value,
        mutation.auditClosed ? 201 : 202,
        cors.headers,
      );
    }
    if (route.kind === "restore-promote") {
      if (dependencies.environment === "production") {
        throw new AdminHttpError("DOMAIN_CONSTRAINT", 409);
      }
      requireRecentMfa(auth, dependencies.now());
      const idempotencyKey = requireUuid(request.headers.get("idempotency-key"));
      const parsed = AdminRestorePromoteRequestSchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
      const mutation = await t18OperationMutation(dependencies, auth, {
        action: "restore_promote",
        parse: restoreJobFrom,
        requestId: idempotencyKey,
        rpcArgs: {
          p_expected_version: parsed.data.expectedVersion,
          p_job_id: route.restoreId,
        },
        rpcName: "internal_admin_promote_restore_job",
        targetId: route.restoreId,
        targetType: "restore_job",
      });
      return jsonResponse(
        mutation.value,
        mutation.auditClosed ? 200 : 202,
        cors.headers,
      );
    }
    if (route.kind === "deletion-job-detail") {
      return jsonResponse(
        deletionJobFrom(
          await deletionRpc(dependencies, "internal_admin_get_deletion_job", {
            p_auth_session_id: auth.sessionId,
            p_auth_subject: auth.userId,
            p_job_id: route.jobId,
          }),
        ),
        200,
        cors.headers,
      );
    }
    if (route.kind === "profile-permanent-delete") {
      requireRecentMfa(auth, dependencies.now());
      const idempotencyKey = requireUuid(request.headers.get("idempotency-key"));
      const parsed = AdminPermanentDeletionRequestSchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success) throw new AdminHttpError("INVALID_INPUT", 400);
      const result = await permanentDeleteProfile(
        dependencies,
        auth,
        route.profileId,
        idempotencyKey,
        parsed.data.expectedVersion,
      );
      return jsonResponse(result.job, result.auditClosed ? 200 : 202, cors.headers);
    }

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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
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

  async function appendLedger(
    body: Record<string, unknown>,
    path = "/v1/admin-audit/append",
    idempotencyKey = String(body.requestId),
  ): Promise<LedgerReceipt> {
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
        "idempotency-key": idempotencyKey,
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
    appendDeletionTombstone: (input) => {
      const body = {
        markerKeyVersion: input.markerKeyVersion,
        operationId: input.operationId,
        profileMarker: input.profileMarker,
        recordType: "profile_deletion",
        schemaVersion: 1,
        stream: "deletions",
      };
      return appendLedger(
        body,
        "/v1/deletions/append",
        `${input.operationId}:profile_deletion:${input.markerKeyVersion}`,
      );
    },
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
    deleteAuthUser: async (authSubject) => {
      const { error } = await serviceClient.auth.admin.deleteUser(authSubject, false);
      if (error) throw new Error("auth_cleanup_pending");
    },
    deletePrivateObjects: async (paths) => {
      if (paths.length === 0) return;
      const bucket = serviceClient.storage.from("plan-exports");
      const { error } = await bucket.remove([...paths]);
      if (error) throw new Error("storage_unavailable");
      for (const path of paths) {
        const separator = path.lastIndexOf("/");
        const prefix = separator < 0 ? "" : path.slice(0, separator);
        const name = separator < 0 ? path : path.slice(separator + 1);
        const { data, error: listError } = await bucket.list(prefix, {
          limit: 2,
          search: name,
        });
        if (listError || data?.some((entry) => entry.name === name)) {
          throw new Error("storage_verification_failed");
        }
      }
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
    verifyDeletionReceipt: async (receipt, input) => {
      const body = {
        markerKeyVersion: input.markerKeyVersion,
        operationId: input.operationId,
        profileMarker: input.profileMarker,
        recordType: "profile_deletion",
        schemaVersion: 1,
        stream: "deletions",
      };
      if (
        receipt.environment !== environment ||
        receipt.stream !== "deletions" ||
        receipt.idempotencyHash !==
          (await sha256Hex(canonicalJson({ environment, ...body })))
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
