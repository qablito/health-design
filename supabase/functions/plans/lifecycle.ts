import {
  ContextSnapshotAckSchema,
  ContextSnapshotCreateRequestSchema,
  ContextSnapshotInternalSchema,
  CONTEXT_CANONICALIZATION_VERSION,
  CONTEXT_NORMALIZATION_VERSION,
  FollowUpCreateRequestSchema,
  FollowUpEntrySchema,
  FollowUpHistorySchema,
  FollowUpMutationAckSchema,
  LabBatchCreateRequestSchema,
  LabBatchRecordAckSchema,
  LabMutationAckSchema,
  LabObservationListSchema,
  PlanCandidateAckSchema,
  PlanCandidateCreateRequestSchema,
  PlanEngineResultSchema,
  PlanGenerationRequestSchema,
  PlanHistorySchema,
  PlanMutationAckSchema,
  PlanMutationRequestSchema,
  PlanVersionDetailSchema,
  QuestionnaireDraftSchema,
  detectPlanContextChange,
  type ContextSnapshotInternal,
  type PlanContextChange,
  type PlanEngineResult,
  type PlanModuleResultInput,
} from "@health-design/contracts";
import { analyzeFollowUpImpact } from "@health-design/engine";

import { canonicalJson, hashSha256Hex } from "../_shared/access-security.ts";
import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";
import {
  applyFollowUpToAnswers,
  applyLabsToAnswers,
  buildLabHistory,
  enrichLabObservations,
} from "./follow-up.ts";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_DEPTH = 12;
const MAX_KEYS = 2_000;
const MAX_ARRAY_LENGTH = 500;
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

type AuthContext = { sessionId: string; userId: string };
type RpcError = { code?: string; message?: string };
type RpcResult = { data: unknown; error: RpcError | null };

export type PlanEngineInput = Readonly<{
  baseContext: ContextSnapshotInternal | null;
  baseModuleResults: readonly PlanModuleResultInput[] | null;
  change: PlanContextChange | null;
  context: ContextSnapshotInternal;
}>;

export interface PlanLifecycleDependencies {
  authenticate(token: string): Promise<AuthContext>;
  environment: EdgeEnvironment;
  now(): Date;
  randomUUID(): string;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  runEngine(input: PlanEngineInput): Promise<PlanEngineResult>;
}

type PlanRoute =
  | { kind: "context-snapshot"; profileId: string }
  | { kind: "profile-current-plan"; profileId: string }
  | { kind: "plan-generate"; profileId: string }
  | { kind: "plan-versions"; planId: string }
  | { kind: "plan-version"; planId: string; versionId: string }
  | { kind: "plan-version-activate"; planId: string; versionId: string }
  | { kind: "follow-up-list"; profileId: string }
  | { kind: "follow-up-create"; profileId: string }
  | { kind: "lab-list"; profileId: string }
  | { kind: "lab-create"; profileId: string }
  | { kind: "candidate-create"; planId: string }
  | { candidateId: string; kind: "candidate-activate" }
  | { candidateId: string; kind: "candidate-discard" };

type ErrorCode =
  | "DEPENDENCY_UNAVAILABLE"
  | "DRAFT_NOT_SUBMITTED"
  | "ENGINE_UNAVAILABLE"
  | "FORBIDDEN"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "NO_CONTEXT_CHANGE"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "PLAN_CANDIDATE_INVALID"
  | "PLAN_VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "VERSION_CONFLICT";

class PlanHttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

function responseHeaders(corsHeaders: Record<string, string>): Record<string, string> {
  return {
    "cache-control": "no-store, private",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...corsHeaders,
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    headers: responseHeaders(corsHeaders),
    status,
  });
}

function errorResponse(
  error: PlanHttpError,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message_key: `plan.${error.code.toLowerCase()}`,
        request_id: requestId,
        retryable:
          error.code === "DEPENDENCY_UNAVAILABLE" ||
          error.code === "ENGINE_UNAVAILABLE",
      },
    },
    error.status,
    corsHeaders,
  );
}

function parseRoute(url: URL, method: string): PlanRoute | null {
  if (url.search || url.hash) return null;
  const versionIndex = url.pathname.lastIndexOf("/v1/");
  if (versionIndex < 0) return null;
  const path = url.pathname.slice(versionIndex);

  const trackingMatch = new RegExp(
    `^/v1/profiles/(${UUID_PATTERN})/(follow-ups|labs)$`,
    "i",
  ).exec(path);
  if (trackingMatch?.[1] && trackingMatch[2]) {
    if (trackingMatch[2] === "follow-ups" && method === "GET") {
      return { kind: "follow-up-list", profileId: trackingMatch[1] };
    }
    if (trackingMatch[2] === "follow-ups" && method === "POST") {
      return { kind: "follow-up-create", profileId: trackingMatch[1] };
    }
    if (trackingMatch[2] === "labs" && method === "GET") {
      return { kind: "lab-list", profileId: trackingMatch[1] };
    }
    if (trackingMatch[2] === "labs" && method === "POST") {
      return { kind: "lab-create", profileId: trackingMatch[1] };
    }
  }

  const profileMatch = new RegExp(
    `^/v1/profiles/(${UUID_PATTERN})/(contexts/snapshot|plans/generate)$`,
    "i",
  ).exec(path);
  if (profileMatch?.[1] && profileMatch[2] && method === "POST") {
    return {
      kind:
        profileMatch[2] === "contexts/snapshot" ? "context-snapshot" : "plan-generate",
      profileId: profileMatch[1],
    };
  }

  const currentPlanMatch = new RegExp(
    `^/v1/profiles/(${UUID_PATTERN})/plans/current$`,
    "i",
  ).exec(path);
  if (currentPlanMatch?.[1] && method === "GET") {
    return { kind: "profile-current-plan", profileId: currentPlanMatch[1] };
  }

  const candidateAction = new RegExp(
    `^/v1/candidates/(${UUID_PATTERN})/(activate|discard)$`,
    "i",
  ).exec(path);
  if (candidateAction?.[1] && candidateAction[2] && method === "POST") {
    return {
      candidateId: candidateAction[1],
      kind:
        candidateAction[2] === "activate" ? "candidate-activate" : "candidate-discard",
    };
  }

  const candidateCreate = new RegExp(
    `^/v1/plans/(${UUID_PATTERN})/candidates$`,
    "i",
  ).exec(path);
  if (candidateCreate?.[1] && method === "POST") {
    return { kind: "candidate-create", planId: candidateCreate[1] };
  }

  const versionMatch = new RegExp(
    `^/v1/plans/(${UUID_PATTERN})/versions(?:/(${UUID_PATTERN})(/activate)?)?$`,
    "i",
  ).exec(path);
  if (!versionMatch?.[1]) return null;
  if (!versionMatch[2] && method === "GET") {
    return { kind: "plan-versions", planId: versionMatch[1] };
  }
  if (versionMatch[2] && !versionMatch[3] && method === "GET") {
    return {
      kind: "plan-version",
      planId: versionMatch[1],
      versionId: versionMatch[2],
    };
  }
  if (versionMatch[2] && versionMatch[3] && method === "POST") {
    return {
      kind: "plan-version-activate",
      planId: versionMatch[1],
      versionId: versionMatch[2],
    };
  }
  return null;
}

function bearerToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new PlanHttpError("UNAUTHENTICATED", 401);
  return match[1];
}

function assertJsonShape(value: unknown): void {
  let keys = 0;
  const visit = (candidate: unknown, depth: number) => {
    if (depth > MAX_DEPTH) throw new PlanHttpError("INVALID_INPUT", 422);
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_ARRAY_LENGTH) {
        throw new PlanHttpError("INVALID_INPUT", 422);
      }
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (candidate !== null && typeof candidate === "object") {
      const entries = Object.entries(candidate as Record<string, unknown>);
      keys += entries.length;
      if (keys > MAX_KEYS) throw new PlanHttpError("INVALID_INPUT", 422);
      for (const [, item] of entries) visit(item, depth + 1);
    }
  };
  visit(value, 1);
}

async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new PlanHttpError("INVALID_INPUT", 422);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new PlanHttpError("PAYLOAD_TOO_LARGE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new PlanHttpError("INVALID_INPUT", 422);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      reader.cancel().catch(() => undefined);
      throw new PlanHttpError("PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new PlanHttpError("INVALID_INPUT", 422);
  }
  assertJsonShape(parsed);
  return parsed;
}

function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new PlanHttpError("INVALID_INPUT", 422);
  }
}

function parseDependency<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new PlanHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
}

function firstRow(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

function mapRpcError(error: RpcError): PlanHttpError {
  if (error.message?.includes("idempotency_key_reused")) {
    return new PlanHttpError("IDEMPOTENCY_KEY_REUSED", 409);
  }
  if (error.message?.includes("version_conflict") || error.code === "PT409") {
    return new PlanHttpError("VERSION_CONFLICT", 409);
  }
  if (
    error.message?.includes("plan_already_exists") ||
    error.message?.includes("initial_plan_already_active") ||
    error.message?.includes("base_plan_not_active") ||
    error.message?.includes("plan_candidate_not_pending")
  ) {
    return new PlanHttpError("VERSION_CONFLICT", 409);
  }
  if (error.message?.includes("plan_version_invalid")) {
    return new PlanHttpError("PLAN_VALIDATION_FAILED", 422);
  }
  if (error.message?.includes("plan_candidate_invalid")) {
    return new PlanHttpError("PLAN_CANDIDATE_INVALID", 422);
  }
  if (error.code === "PT422") {
    return new PlanHttpError("PLAN_VALIDATION_FAILED", 422);
  }
  if (error.message?.includes("draft_not_submitted")) {
    return new PlanHttpError("DRAFT_NOT_SUBMITTED", 422);
  }
  if (error.code === "22023" || error.message?.includes("invalid_input")) {
    return new PlanHttpError("INVALID_INPUT", 422);
  }
  if (error.message?.includes("not_found") || error.code === "P0002") {
    return new PlanHttpError("NOT_FOUND", 404);
  }
  if (error.message?.includes("access_not_granted") || error.code === "42501") {
    return new PlanHttpError("FORBIDDEN", 403);
  }
  if (error.message?.includes("unauthenticated")) {
    return new PlanHttpError("UNAUTHENTICATED", 401);
  }
  return new PlanHttpError("DEPENDENCY_UNAVAILABLE", 503);
}

async function rpc(
  dependencies: PlanLifecycleDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await dependencies.rpc(name, args);
  if (result.error) throw mapRpcError(result.error);
  return result.data;
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new PlanHttpError("INVALID_INPUT", 422);
  }
  return key;
}

async function mutationDigests(request: Request, body: unknown, route: PlanRoute) {
  return {
    keyDigest: `\\x${await hashSha256Hex(idempotencyKey(request))}`,
    requestDigest: `\\x${await hashSha256Hex(canonicalJson({ body, route }))}`,
  };
}

function requireMatchingVersionHeader(request: Request, expectedVersion: number): void {
  if (request.headers.get("if-match") !== `"${expectedVersion}"`) {
    throw new PlanHttpError("VERSION_CONFLICT", 409);
  }
}

function authArgs(auth: AuthContext) {
  return {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
  };
}

async function getContext(
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
  profileId: string,
  contextSnapshotId: string,
): Promise<ContextSnapshotInternal> {
  return parseDependency(
    ContextSnapshotInternalSchema,
    firstRow(
      await rpc(dependencies, "internal_get_context_snapshot", {
        ...authArgs(auth),
        p_context_snapshot_id: contextSnapshotId,
        p_profile_id: profileId,
      }),
    ),
  );
}

async function runEngine(
  dependencies: PlanLifecycleDependencies,
  input: PlanEngineInput,
): Promise<PlanEngineResult> {
  let result: unknown;
  try {
    result = await dependencies.runEngine(input);
  } catch {
    throw new PlanHttpError("ENGINE_UNAVAILABLE", 503);
  }
  try {
    return PlanEngineResultSchema.parse(result);
  } catch {
    throw new PlanHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
}

async function createSnapshot(
  request: Request,
  route: Extract<PlanRoute, { kind: "context-snapshot" }>,
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const body = parse(ContextSnapshotCreateRequestSchema, await readJson(request));
  requireMatchingVersionHeader(request, body.expectedDraftVersion);
  const draft = parseDependency(
    QuestionnaireDraftSchema,
    firstRow(
      await rpc(dependencies, "internal_get_questionnaire_draft", {
        ...authArgs(auth),
        p_profile_id: route.profileId,
      }),
    ),
  );
  if (draft.status !== "submitted") {
    throw new PlanHttpError("DRAFT_NOT_SUBMITTED", 422);
  }
  if (draft.version !== body.expectedDraftVersion) {
    throw new PlanHttpError("VERSION_CONFLICT", 409);
  }
  const inputHash = await hashSha256Hex(
    canonicalJson({
      answers: draft.answers,
      canonicalizationVersion: CONTEXT_CANONICALIZATION_VERSION,
      normalizationVersion: CONTEXT_NORMALIZATION_VERSION,
      schemaVersion: draft.schemaVersion,
    }),
  );
  const digests = await mutationDigests(request, body, route);
  return parseDependency(
    ContextSnapshotAckSchema,
    firstRow(
      await rpc(dependencies, "internal_create_context_snapshot", {
        ...authArgs(auth),
        p_canonicalization_version: CONTEXT_CANONICALIZATION_VERSION,
        p_expected_draft_version: body.expectedDraftVersion,
        p_idempotency_key_digest: digests.keyDigest,
        p_input_hash: `\\x${inputHash}`,
        p_normalization_version: CONTEXT_NORMALIZATION_VERSION,
        p_profile_id: route.profileId,
        p_request_digest: digests.requestDigest,
      }),
    ),
  );
}

function engineRpcArgs(result: PlanEngineResult) {
  return {
    p_canonicalization_version: result.canonicalizationVersion,
    p_engine_completeness: result.completeness,
    p_engine_version: result.engineVersion,
    p_input_hash: `\\x${result.inputHash}`,
    p_module_results: result.moduleResults,
    p_output_hash: `\\x${result.outputHash}`,
    p_rule_set_revision_id: result.ruleSetRevisionId,
    p_safety_findings: result.safetyFindings,
    p_source_manifest_id: result.sourceManifestId,
    p_validation: { ...result.validation, completeness: result.completeness },
    p_validation_status: result.validationStatus,
  };
}

async function generatePlan(
  request: Request,
  route: Extract<PlanRoute, { kind: "plan-generate" }>,
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const body = parse(PlanGenerationRequestSchema, await readJson(request));
  const context = await getContext(
    dependencies,
    auth,
    route.profileId,
    body.contextSnapshotId,
  );
  const result = await runEngine(dependencies, {
    baseContext: null,
    baseModuleResults: null,
    change: null,
    context,
  });
  if (result.validationStatus !== "valid") {
    throw new PlanHttpError("PLAN_VALIDATION_FAILED", 422);
  }
  const digests = await mutationDigests(request, body, route);
  const ack = parseDependency(
    PlanMutationAckSchema,
    firstRow(
      await rpc(dependencies, "internal_create_plan_draft", {
        ...authArgs(auth),
        ...engineRpcArgs(result),
        p_context_snapshot_id: body.contextSnapshotId,
        p_idempotency_key_digest: digests.keyDigest,
        p_profile_id: route.profileId,
        p_request_digest: digests.requestDigest,
      }),
    ),
  );
  if (
    ack.completeness !==
    (context.completeness === "complete" && result.completeness === "complete"
      ? "complete"
      : "provisional")
  ) {
    throw new PlanHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return ack;
}

async function createCandidate(
  request: Request,
  route: Extract<PlanRoute, { kind: "candidate-create" }>,
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const body = parse(PlanCandidateCreateRequestSchema, await readJson(request));
  requireMatchingVersionHeader(request, body.expectedVersion);
  const history = parseDependency(
    PlanHistorySchema,
    firstRow(
      await rpc(dependencies, "internal_list_plan_versions", {
        ...authArgs(auth),
        p_plan_id: route.planId,
      }),
    ),
  );
  const baseVersionSummary = history.versions.find(
    ({ id }) => id === body.baseVersionId,
  );
  if (!baseVersionSummary) throw new PlanHttpError("NOT_FOUND", 404);
  const baseVersion = parseDependency(
    PlanVersionDetailSchema,
    firstRow(
      await rpc(dependencies, "internal_get_plan_version", {
        ...authArgs(auth),
        p_plan_id: route.planId,
        p_plan_version_id: body.baseVersionId,
      }),
    ),
  );
  const [baseContext, context] = await Promise.all([
    getContext(dependencies, auth, history.profileId, baseVersion.contextSnapshotId),
    getContext(dependencies, auth, history.profileId, body.contextSnapshotId),
  ]);
  const change = detectPlanContextChange(baseContext.answers, context.answers);
  if (change.impact === "unaffected") {
    throw new PlanHttpError("NO_CONTEXT_CHANGE", 422);
  }
  const baseModuleResults = baseVersion.moduleResults.map((moduleResult) => ({
    confidence: moduleResult.confidence,
    module: moduleResult.module,
    payload: moduleResult.payload,
    status: moduleResult.status,
    uncertainties: moduleResult.uncertainties,
  }));
  const result = await runEngine(dependencies, {
    baseContext,
    baseModuleResults,
    change,
    context,
  });
  const digests = await mutationDigests(request, body, route);
  const ack = parseDependency(
    PlanCandidateAckSchema,
    firstRow(
      await rpc(dependencies, "internal_create_plan_candidate", {
        ...authArgs(auth),
        ...engineRpcArgs(result),
        p_base_version_id: body.baseVersionId,
        p_change_kind: "context_changed",
        p_change_payload: { changedFields: change.changedFields },
        p_context_snapshot_id: body.contextSnapshotId,
        p_diff: {
          affectedModules: change.affectedModules,
          changedFields: change.changedFields,
        },
        p_expected_version: body.expectedVersion,
        p_idempotency_key_digest: digests.keyDigest,
        p_impact: change.impact,
        p_plan_id: route.planId,
        p_request_digest: digests.requestDigest,
      }),
    ),
  );
  if (
    ack.completeness !==
    (context.completeness === "complete" && result.completeness === "complete"
      ? "complete"
      : "provisional")
  ) {
    throw new PlanHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return ack;
}

type PlanHistory = ReturnType<typeof PlanHistorySchema.parse>;
type PlanVersionDetail = ReturnType<typeof PlanVersionDetailSchema.parse>;

async function loadPlanBase(
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
  profileId: string,
  baseVersionId: string,
): Promise<{
  baseContext: ContextSnapshotInternal;
  baseVersion: PlanVersionDetail;
  history: PlanHistory;
}> {
  const history = parseDependency(
    PlanHistorySchema,
    firstRow(
      await rpc(dependencies, "internal_get_profile_current_plan", {
        ...authArgs(auth),
        p_profile_id: profileId,
      }),
    ),
  );
  if (!history.versions.some(({ id }) => id === baseVersionId)) {
    throw new PlanHttpError("NOT_FOUND", 404);
  }
  const baseVersion = parseDependency(
    PlanVersionDetailSchema,
    firstRow(
      await rpc(dependencies, "internal_get_plan_version", {
        ...authArgs(auth),
        p_plan_id: history.planId,
        p_plan_version_id: baseVersionId,
      }),
    ),
  );
  return {
    baseContext: await getContext(
      dependencies,
      auth,
      profileId,
      baseVersion.contextSnapshotId,
    ),
    baseVersion,
    history,
  };
}

async function createDerivedContext(
  input: Readonly<{
    answers: ContextSnapshotInternal["answers"];
    auth: AuthContext;
    baseContext: ContextSnapshotInternal;
    baseVersionId: string;
    completeness: "complete" | "provisional";
    dependencies: PlanLifecycleDependencies;
    effectiveAt: string;
    profileId: string;
    sourceId: string;
    sourceKind: "follow_up" | "lab_batch";
  }>,
): Promise<ContextSnapshotInternal> {
  const inputHash = await hashSha256Hex(
    canonicalJson({
      answers: input.answers,
      baseContextSnapshotId: input.baseContext.id,
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
    }),
  );
  const ack = parseDependency(
    ContextSnapshotAckSchema,
    firstRow(
      await rpc(input.dependencies, "internal_create_derived_context_snapshot", {
        ...authArgs(input.auth),
        p_answers: input.answers,
        p_base_plan_version_id: input.baseVersionId,
        p_completeness: input.completeness,
        p_effective_at: input.effectiveAt,
        p_input_hash: `\\x${inputHash}`,
        p_profile_id: input.profileId,
        p_source_id: input.sourceId,
        p_source_kind: input.sourceKind,
      }),
    ),
  );
  return ContextSnapshotInternalSchema.parse({ ...ack, answers: input.answers });
}

async function addConservativeFollowUpReview(
  result: PlanEngineResult,
  conservativeModules: readonly string[],
  reasons: readonly string[],
): Promise<PlanEngineResult> {
  if (conservativeModules.length === 0) return result;
  const conservative = new Set(conservativeModules);
  const moduleResults = result.moduleResults.map((moduleResult) =>
    conservative.has(moduleResult.module) && moduleResult.status !== "not_requested"
      ? {
          ...moduleResult,
          confidence: "low" as const,
          status: "provisional" as const,
          uncertainties: [
            ...moduleResult.uncertainties,
            {
              code: "FOLLOW_UP_IMPORTANT_SIGNAL",
              messageKey: "follow_up.uncertainty.important_signal",
              module: moduleResult.module,
            },
          ],
        }
      : moduleResult,
  );
  const safetyFindings = [
    ...result.safetyFindings,
    ...moduleResults
      .filter(
        ({ module, status }) => conservative.has(module) && status !== "not_requested",
      )
      .map(({ module }) => ({
        actionLevel: "immediate_conservative" as const,
        code: "FOLLOW_UP_IMPORTANT_SIGNAL",
        evidenceRef: "internal:follow-up-v1",
        messageKey: "follow_up.safety.important_signal",
        module,
      })),
  ];
  const validation = {
    ...result.validation,
    completeness: "provisional",
    followUpReview: [...reasons],
  };
  const outputHash = await hashSha256Hex(
    canonicalJson({
      moduleResults,
      safetyFindings,
      validation,
      validationStatus: result.validationStatus,
    }),
  );
  return PlanEngineResultSchema.parse({
    ...result,
    completeness: "provisional",
    moduleResults,
    outputHash,
    safetyFindings,
    validation,
  });
}

async function createTrackingCandidate(
  input: Readonly<{
    auth: AuthContext;
    baseContext: ContextSnapshotInternal;
    baseVersion: PlanVersionDetail;
    change: PlanContextChange;
    changeKind: "follow_up_changed" | "lab_result_changed";
    changePayload: Record<string, unknown>;
    context: ContextSnapshotInternal;
    dependencies: PlanLifecycleDependencies;
    digests: Awaited<ReturnType<typeof mutationDigests>>;
    history: PlanHistory;
    reasons: readonly string[];
    conservativeModules?: readonly string[];
  }>,
): Promise<ReturnType<typeof PlanCandidateAckSchema.parse>> {
  const baseModuleResults = input.baseVersion.moduleResults.map((moduleResult) => ({
    confidence: moduleResult.confidence,
    module: moduleResult.module,
    payload: moduleResult.payload,
    status: moduleResult.status,
    uncertainties: moduleResult.uncertainties,
  }));
  const engineResult = await runEngine(input.dependencies, {
    baseContext: input.baseContext,
    baseModuleResults,
    change: input.change,
    context: input.context,
  });
  const result = await addConservativeFollowUpReview(
    engineResult,
    input.conservativeModules ?? [],
    input.reasons,
  );
  const ack = parseDependency(
    PlanCandidateAckSchema,
    firstRow(
      await rpc(input.dependencies, "internal_create_plan_candidate", {
        ...authArgs(input.auth),
        ...engineRpcArgs(result),
        p_base_version_id: input.baseVersion.id,
        p_change_kind: input.changeKind,
        p_change_payload: input.changePayload,
        p_context_snapshot_id: input.context.id,
        p_diff: {
          affectedModules: input.change.affectedModules,
          changedFields: input.change.changedFields,
        },
        p_expected_version: input.history.aggregateVersion,
        p_idempotency_key_digest: input.digests.keyDigest,
        p_impact: input.change.impact,
        p_plan_id: input.history.planId,
        p_request_digest: input.digests.requestDigest,
      }),
    ),
  );
  if (
    ack.completeness !==
    (input.context.completeness === "complete" && result.completeness === "complete"
      ? "complete"
      : "provisional")
  ) {
    throw new PlanHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return ack;
}

async function createFollowUp(
  request: Request,
  route: Extract<PlanRoute, { kind: "follow-up-create" }>,
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const body = parse(FollowUpCreateRequestSchema, await readJson(request));
  const digests = await mutationDigests(request, body, route);
  const { baseContext, baseVersion, history } = await loadPlanBase(
    dependencies,
    auth,
    route.profileId,
    body.basePlanVersionId,
  );
  const impact = analyzeFollowUpImpact({
    activeModules: baseContext.answers.activeModules ?? [],
    requestRecalculation: body.requestRecalculation ?? false,
    scope: body.scope,
    values: body.values,
  });
  const contextUpdateRequired = (body.values.common?.materialChanges.length ?? 0) > 0;
  const entry = parseDependency(
    FollowUpEntrySchema,
    firstRow(
      await rpc(dependencies, "internal_record_follow_up", {
        ...authArgs(auth),
        p_base_plan_version_id: body.basePlanVersionId,
        p_completeness: contextUpdateRequired ? "provisional" : "complete",
        p_idempotency_key_digest: digests.keyDigest,
        p_observed_at: body.observedAt,
        p_profile_id: route.profileId,
        p_request_digest: digests.requestDigest,
        p_request_recalculation: body.requestRecalculation ?? false,
        p_scope: body.scope,
        p_values: body.values,
      }),
    ),
  );

  let candidate: ReturnType<typeof PlanCandidateAckSchema.parse> | null = null;
  if (
    impact.candidateRequired &&
    !contextUpdateRequired &&
    impact.affectedModules.length > 0
  ) {
    const answers = applyFollowUpToAnswers(baseContext.answers, body.values);
    const context = await createDerivedContext({
      answers,
      auth,
      baseContext,
      baseVersionId: body.basePlanVersionId,
      completeness:
        impact.conservativeModules.length > 0
          ? "provisional"
          : baseContext.completeness,
      dependencies,
      effectiveAt: body.observedAt,
      profileId: route.profileId,
      sourceId: entry.id,
      sourceKind: "follow_up",
    });
    candidate = await createTrackingCandidate({
      auth,
      baseContext,
      baseVersion,
      change: {
        affectedModules: impact.affectedModules,
        changedFields: impact.reasons,
        impact: impact.impact,
      },
      changeKind: "follow_up_changed",
      changePayload: {
        followUpId: entry.id,
        reasons: impact.reasons,
        scope: body.scope,
      },
      conservativeModules: impact.conservativeModules,
      context,
      dependencies,
      digests,
      history,
      reasons: impact.reasons,
    });
  }
  return FollowUpMutationAckSchema.parse({
    candidate,
    contextUpdateRequired,
    entry,
    impact,
  });
}

async function listLabs(
  route: Extract<PlanRoute, { kind: "lab-list" }>,
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const history = parseDependency(
    PlanHistorySchema,
    firstRow(
      await rpc(dependencies, "internal_get_profile_current_plan", {
        ...authArgs(auth),
        p_profile_id: route.profileId,
      }),
    ),
  );
  if (!history.activeVersionId) throw new PlanHttpError("NOT_FOUND", 404);
  const { baseContext } = await loadPlanBase(
    dependencies,
    auth,
    route.profileId,
    history.activeVersionId,
  );
  const stored = parseDependency(
    LabObservationListSchema,
    firstRow(
      await rpc(dependencies, "internal_list_lab_observations", {
        ...authArgs(auth),
        p_limit: 500,
        p_profile_id: route.profileId,
      }),
    ),
  );
  return buildLabHistory({
    answers: baseContext.answers,
    now: dependencies.now().toISOString(),
    observations: stored.observations,
    profileId: route.profileId,
  });
}

async function createLabBatch(
  request: Request,
  route: Extract<PlanRoute, { kind: "lab-create" }>,
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const body = parse(LabBatchCreateRequestSchema, await readJson(request));
  const digests = await mutationDigests(request, body, route);
  const { baseContext, baseVersion, history } = await loadPlanBase(
    dependencies,
    auth,
    route.profileId,
    body.basePlanVersionId,
  );
  const batch = parseDependency(
    LabBatchRecordAckSchema,
    firstRow(
      await rpc(dependencies, "internal_record_lab_batch", {
        ...authArgs(auth),
        p_base_plan_version_id: body.basePlanVersionId,
        p_idempotency_key_digest: digests.keyDigest,
        p_observations: enrichLabObservations(body.observations),
        p_profile_id: route.profileId,
        p_request_digest: digests.requestDigest,
        p_request_recalculation: body.requestRecalculation ?? false,
      }),
    ),
  );
  const stored = parseDependency(
    LabObservationListSchema,
    firstRow(
      await rpc(dependencies, "internal_list_lab_observations", {
        ...authArgs(auth),
        p_limit: 500,
        p_profile_id: route.profileId,
      }),
    ),
  );
  const labHistory = buildLabHistory({
    answers: baseContext.answers,
    now: dependencies.now().toISOString(),
    observations: stored.observations,
    profileId: route.profileId,
  });
  const inserted = new Set(batch.observations.map(({ id }) => id));
  const outOfRange = labHistory.items.filter(
    ({ interpretation, latestObservationId }) =>
      inserted.has(latestObservationId) &&
      (interpretation === "above_range" || interpretation === "below_range"),
  );
  const activeModules = new Set(baseContext.answers.activeModules ?? []);
  const affectedModules: PlanContextChange["affectedModules"] = activeModules.has(
    "supplements",
  )
    ? ["supplements"]
    : [];
  let candidate: ReturnType<typeof PlanCandidateAckSchema.parse> | null = null;
  if (
    affectedModules.length > 0 &&
    (outOfRange.length > 0 || body.requestRecalculation === true)
  ) {
    const answers = applyLabsToAnswers(baseContext.answers, batch.observations);
    const context = await createDerivedContext({
      answers,
      auth,
      baseContext,
      baseVersionId: body.basePlanVersionId,
      completeness: baseContext.completeness,
      dependencies,
      effectiveAt: dependencies.now().toISOString(),
      profileId: route.profileId,
      sourceId: batch.batchId,
      sourceKind: "lab_batch",
    });
    candidate = await createTrackingCandidate({
      auth,
      baseContext,
      baseVersion,
      change: {
        affectedModules,
        changedFields: ["labValues"],
        impact: "module_only",
      },
      changeKind: "lab_result_changed",
      changePayload: {
        batchId: batch.batchId,
        outOfRangeAnalytes: outOfRange.map(({ analyte }) => analyte),
        recalculationRequested: body.requestRecalculation ?? false,
      },
      context,
      dependencies,
      digests,
      history,
      reasons: ["lab_values_updated"],
    });
  }
  return LabMutationAckSchema.parse({ candidate, history: labHistory });
}

async function dispatch(
  request: Request,
  route: PlanRoute,
  dependencies: PlanLifecycleDependencies,
  auth: AuthContext,
): Promise<unknown> {
  if (route.kind === "context-snapshot") {
    return createSnapshot(request, route, dependencies, auth);
  }
  if (route.kind === "profile-current-plan") {
    return parseDependency(
      PlanHistorySchema,
      firstRow(
        await rpc(dependencies, "internal_get_profile_current_plan", {
          ...authArgs(auth),
          p_profile_id: route.profileId,
        }),
      ),
    );
  }
  if (route.kind === "plan-generate") {
    return generatePlan(request, route, dependencies, auth);
  }
  if (route.kind === "follow-up-list") {
    return parseDependency(
      FollowUpHistorySchema,
      firstRow(
        await rpc(dependencies, "internal_list_follow_ups", {
          ...authArgs(auth),
          p_limit: 500,
          p_profile_id: route.profileId,
        }),
      ),
    );
  }
  if (route.kind === "follow-up-create") {
    return createFollowUp(request, route, dependencies, auth);
  }
  if (route.kind === "lab-list") {
    return listLabs(route, dependencies, auth);
  }
  if (route.kind === "lab-create") {
    return createLabBatch(request, route, dependencies, auth);
  }
  if (route.kind === "plan-versions") {
    return parseDependency(
      PlanHistorySchema,
      firstRow(
        await rpc(dependencies, "internal_list_plan_versions", {
          ...authArgs(auth),
          p_plan_id: route.planId,
        }),
      ),
    );
  }
  if (route.kind === "plan-version") {
    return parseDependency(
      PlanVersionDetailSchema,
      firstRow(
        await rpc(dependencies, "internal_get_plan_version", {
          ...authArgs(auth),
          p_plan_id: route.planId,
          p_plan_version_id: route.versionId,
        }),
      ),
    );
  }
  if (route.kind === "candidate-create") {
    return createCandidate(request, route, dependencies, auth);
  }

  const body = parse(PlanMutationRequestSchema, await readJson(request));
  requireMatchingVersionHeader(request, body.expectedVersion);
  const digests = await mutationDigests(request, body, route);
  if (route.kind === "plan-version-activate") {
    return parseDependency(
      PlanMutationAckSchema,
      firstRow(
        await rpc(dependencies, "internal_activate_plan_version", {
          ...authArgs(auth),
          p_expected_version: body.expectedVersion,
          p_idempotency_key_digest: digests.keyDigest,
          p_plan_id: route.planId,
          p_plan_version_id: route.versionId,
          p_request_digest: digests.requestDigest,
        }),
      ),
    );
  }
  return parseDependency(
    PlanCandidateAckSchema,
    firstRow(
      await rpc(
        dependencies,
        route.kind === "candidate-activate"
          ? "internal_activate_plan_candidate"
          : "internal_discard_plan_candidate",
        {
          ...authArgs(auth),
          p_candidate_id: route.candidateId,
          p_expected_version: body.expectedVersion,
          p_idempotency_key_digest: digests.keyDigest,
          p_request_digest: digests.requestDigest,
        },
      ),
    ),
  );
}

export async function handlePlanLifecycle(
  request: Request,
  dependencies: PlanLifecycleDependencies,
): Promise<Response> {
  const requestId = dependencies.randomUUID();
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(new PlanHttpError("FORBIDDEN", 403), requestId, cors.headers);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...cors.headers,
        "access-control-allow-headers":
          "authorization, apikey, content-type, idempotency-key, if-match, x-client-info",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-max-age": "600",
        "cache-control": "no-store, private",
        "referrer-policy": "no-referrer",
      },
      status: 204,
    });
  }
  try {
    const route = parseRoute(new URL(request.url), request.method);
    if (!route) throw new PlanHttpError("NOT_FOUND", 404);
    let auth: AuthContext;
    try {
      auth = await dependencies.authenticate(bearerToken(request));
    } catch (error) {
      if (error instanceof PlanHttpError) throw error;
      throw new PlanHttpError("UNAUTHENTICATED", 401);
    }
    return jsonResponse(
      await dispatch(request, route, dependencies, auth),
      200,
      cors.headers,
    );
  } catch (error) {
    return errorResponse(
      error instanceof PlanHttpError ? error : new PlanHttpError("INTERNAL_ERROR", 500),
      requestId,
      cors.headers,
    );
  }
}
