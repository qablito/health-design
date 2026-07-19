import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";

const MAX_BODY_BYTES = 512 * 1_024;
const MAX_DEPTH = 16;
const MAX_KEYS = 20_000;
const MAX_ARRAY_LENGTH = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

type AuthContext = Readonly<{
  aal: "aal1" | "aal2";
  sessionId: string;
  userId: string;
}>;
type RpcResult = Readonly<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

export interface NutritionCatalogDependencies {
  authenticate: (token: string) => Promise<AuthContext>;
  environment: EdgeEnvironment;
  hashCanonical: (value: unknown) => Promise<string>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
}

type Route =
  | { kind: "imports-stage" }
  | { kind: "review-open" }
  | { kind: "reviews-list" }
  | { kind: "review-resolve"; reviewId: string }
  | { kind: "revision-activate"; revisionId: string }
  | { kind: "revision-validate"; revisionId: string };

type ErrorCode =
  | "AAL2_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE"
  | "DOMAIN_CONSTRAINT"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "REVIEW_OPEN"
  | "UNAUTHENTICATED";

class CatalogHttpError extends Error {
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
  error: CatalogHttpError,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message_key: `nutrition_catalog.${error.code.toLowerCase()}`,
        request_id: requestId,
        retryable: error.code === "DEPENDENCY_UNAVAILABLE",
      },
    },
    error.status,
    corsHeaders,
  );
}

function parseRoute(url: URL, method: string): Route | null {
  if (url.search || url.hash) return null;
  const marker = "/v1/admin/nutrition/";
  const markerIndex = url.pathname.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const path = url.pathname.slice(markerIndex);
  if (path === "/v1/admin/nutrition/imports" && method === "POST") {
    return { kind: "imports-stage" };
  }
  if (path === "/v1/admin/nutrition/reviews/open" && method === "GET") {
    return { kind: "reviews-list" };
  }
  if (path === "/v1/admin/nutrition/reviews" && method === "POST") {
    return { kind: "review-open" };
  }
  const review = /^\/v1\/admin\/nutrition\/reviews\/([0-9a-f-]{36})\/resolve$/i.exec(
    path,
  );
  if (review?.[1] && UUID_PATTERN.test(review[1]) && method === "POST") {
    return { kind: "review-resolve", reviewId: review[1] };
  }
  const revision =
    /^\/v1\/admin\/nutrition\/revisions\/([0-9a-f-]{36})\/(validate|activate)$/i.exec(
      path,
    );
  if (
    revision?.[1] &&
    revision[2] &&
    UUID_PATTERN.test(revision[1]) &&
    method === "POST"
  ) {
    return revision[2] === "validate"
      ? { kind: "revision-validate", revisionId: revision[1] }
      : { kind: "revision-activate", revisionId: revision[1] };
  }
  return null;
}

function bearerToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new CatalogHttpError("UNAUTHENTICATED", 401);
  return match[1];
}

function mutationRequestId(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value || !UUID_PATTERN.test(value)) {
    throw new CatalogHttpError("INVALID_INPUT", 422);
  }
  return value;
}

function assertJsonShape(value: unknown): void {
  let keys = 0;
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw new CatalogHttpError("INVALID_INPUT", 422);
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_ARRAY_LENGTH) {
        throw new CatalogHttpError("INVALID_INPUT", 422);
      }
      candidate.forEach((entry) => visit(entry, depth + 1));
    } else if (candidate !== null && typeof candidate === "object") {
      const entries = Object.entries(candidate as Record<string, unknown>);
      keys += entries.length;
      if (keys > MAX_KEYS) throw new CatalogHttpError("INVALID_INPUT", 422);
      entries.forEach(([, entry]) => visit(entry, depth + 1));
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
    throw new CatalogHttpError("INVALID_INPUT", 422);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new CatalogHttpError("PAYLOAD_TOO_LARGE", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new CatalogHttpError("PAYLOAD_TOO_LARGE", 413);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new CatalogHttpError("INVALID_INPUT", 422);
  }
  assertJsonShape(value);
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogHttpError("INVALID_INPUT", 422);
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new CatalogHttpError("INVALID_INPUT", 422);
  }
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CatalogHttpError("INVALID_INPUT", 422);
  }
  return value;
}

function validateStageBatch(value: unknown): Record<string, unknown> {
  const batch = object(value);
  if (
    batch.status !== "quarantined" ||
    batch.publicationCount !== 0 ||
    !Array.isArray(batch.violations) ||
    batch.violations.length !== 0 ||
    !Array.isArray(batch.revisions) ||
    batch.revisions.length === 0 ||
    batch.manifest === null ||
    typeof batch.manifest !== "object" ||
    Array.isArray(batch.manifest)
  ) {
    throw new CatalogHttpError("INVALID_INPUT", 422);
  }
  return batch;
}

function resolutionContext(value: unknown): Record<string, unknown> {
  const context = object(value);
  if (
    (context.basis !== "per_100_g" &&
      context.basis !== "per_100_ml" &&
      context.basis !== "per_serving") ||
    (context.foodState !== "raw" &&
      context.foodState !== "cooked" &&
      context.foodState !== "unspecified") ||
    !/^[a-z][a-z0-9_]{0,95}$/.test(boundedText(context.ediblePart, 96))
  ) {
    throw new CatalogHttpError("INVALID_INPUT", 422);
  }
  boundedText(context.method, 160);
  return context;
}

function mapRpcError(error: { code?: string; message?: string }): CatalogHttpError {
  if (error.message === "aal2_required") {
    return new CatalogHttpError("AAL2_REQUIRED", 403);
  }
  if (error.message === "superadmin_required" || error.code === "42501") {
    return new CatalogHttpError("FORBIDDEN", 403);
  }
  if (error.message === "nutrition_review_open") {
    return new CatalogHttpError("REVIEW_OPEN", 409);
  }
  if (error.message === "idempotency_key_reused") {
    return new CatalogHttpError("DOMAIN_CONSTRAINT", 409);
  }
  if (error.code === "22023" || error.code === "55000" || error.code === "PT409") {
    return new CatalogHttpError("DOMAIN_CONSTRAINT", 409);
  }
  if (error.code === "P0002") return new CatalogHttpError("NOT_FOUND", 404);
  return new CatalogHttpError("DEPENDENCY_UNAVAILABLE", 503);
}

async function callRpc(
  dependencies: NutritionCatalogDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let result: RpcResult;
  try {
    result = await dependencies.rpc(name, args);
  } catch {
    throw new CatalogHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  if (result.error) throw mapRpcError(result.error);
  return result.data;
}

export async function handleNutritionCatalog(
  request: Request,
  dependencies: NutritionCatalogDependencies,
): Promise<Response> {
  const requestedId = request.headers.get("idempotency-key");
  const fallbackRequestId =
    requestedId && UUID_PATTERN.test(requestedId) ? requestedId : crypto.randomUUID();
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(
      new CatalogHttpError("FORBIDDEN", 403),
      fallbackRequestId,
      cors.headers,
    );
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
    const route = parseRoute(new URL(request.url), request.method);
    if (!route) throw new CatalogHttpError("NOT_FOUND", 404);
    let auth: AuthContext;
    try {
      auth = await dependencies.authenticate(bearerToken(request));
    } catch (error) {
      if (error instanceof CatalogHttpError) throw error;
      throw new CatalogHttpError("UNAUTHENTICATED", 401);
    }
    if (auth.aal !== "aal2") throw new CatalogHttpError("AAL2_REQUIRED", 403);
    const authArgs = {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
    };

    if (route.kind === "reviews-list") {
      const data = await callRpc(dependencies, "internal_nutrition_list_reviews", {
        ...authArgs,
        p_status: "open",
      });
      if (!Array.isArray(data)) {
        throw new CatalogHttpError("DEPENDENCY_UNAVAILABLE", 503);
      }
      return jsonResponse({ reviews: data }, 200, cors.headers);
    }

    const requestId = mutationRequestId(request);
    const payload = await readJson(request);
    if (route.kind === "imports-stage") {
      const data = await callRpc(dependencies, "internal_nutrition_stage_batch", {
        ...authArgs,
        p_batch: validateStageBatch(payload),
        p_request_id: requestId,
      });
      return jsonResponse(data, 201, cors.headers);
    }
    if (route.kind === "revision-validate") {
      const body = object(payload);
      const data = await callRpc(dependencies, "internal_nutrition_validate_revision", {
        ...authArgs,
        p_justification: boundedText(body.justification, 2_000),
        p_request_id: requestId,
        p_revision_id: route.revisionId,
      });
      return jsonResponse(data, 200, cors.headers);
    }
    if (route.kind === "review-open") {
      const body = object(payload);
      if (
        body.reviewKind !== "manual_review" &&
        body.reviewKind !== "priority_review"
      ) {
        throw new CatalogHttpError("INVALID_INPUT", 422);
      }
      const nutrientKey =
        body.nutrientKey === null ? null : boundedText(body.nutrientKey, 64);
      if (nutrientKey !== null && !/^[a-z][a-z0-9_]{0,63}$/.test(nutrientKey)) {
        throw new CatalogHttpError("INVALID_INPUT", 422);
      }
      const comparison = object(body.comparison);
      if (new TextEncoder().encode(JSON.stringify(comparison)).byteLength > 65_536) {
        throw new CatalogHttpError("INVALID_INPUT", 422);
      }
      const data = await callRpc(dependencies, "internal_nutrition_open_review", {
        ...authArgs,
        p_anchor_revision_id: uuid(body.anchorRevisionId),
        p_candidate_revision_id: uuid(body.candidateRevisionId),
        p_comparison: comparison,
        p_nutrient_key: nutrientKey,
        p_reason: boundedText(body.reason, 1_000),
        p_request_id: requestId,
        p_review_kind: body.reviewKind,
      });
      return jsonResponse(data, 201, cors.headers);
    }
    if (route.kind === "review-resolve") {
      const body = object(payload);
      if (body.resolution !== "approved" && body.resolution !== "rejected") {
        throw new CatalogHttpError("INVALID_INPUT", 422);
      }
      const data = await callRpc(dependencies, "internal_nutrition_resolve_review", {
        ...authArgs,
        p_decision: boundedText(body.decision, 160),
        p_justification: boundedText(body.justification, 2_000),
        p_request_id: requestId,
        p_resolution: body.resolution,
        p_review_id: route.reviewId,
      });
      return jsonResponse(data, 200, cors.headers);
    }

    const body = object(payload);
    const context = resolutionContext(body.resolutionContext);
    const hash = await dependencies.hashCanonical(context);
    if (!HASH_PATTERN.test(hash)) {
      throw new CatalogHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    const data = await callRpc(dependencies, "internal_nutrition_activate_revision", {
      ...authArgs,
      p_precedence_reason: boundedText(body.precedenceReason, 1_000),
      p_request_id: requestId,
      p_resolution_context: context,
      p_resolution_context_hash: `\\x${hash}`,
      p_revision_id: route.revisionId,
    });
    return jsonResponse(data, 200, cors.headers);
  } catch (error) {
    return errorResponse(
      error instanceof CatalogHttpError
        ? error
        : new CatalogHttpError("INTERNAL_ERROR", 500),
      fallbackRequestId,
      cors.headers,
    );
  }
}
