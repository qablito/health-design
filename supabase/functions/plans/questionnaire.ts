import {
  evaluateQuestionnaire,
  QUESTIONNAIRE_PUBLIC_SCHEMA_V2,
  QuestionnaireDraftAckSchema,
  QuestionnaireDraftSaveRequestSchema,
  QuestionnaireDraftSchema,
  QuestionnaireDraftSubmitRequestSchema,
} from "@health-design/contracts";

import { canonicalJson, hashSha256Hex } from "../_shared/access-security.ts";
import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_DEPTH = 12;
const MAX_KEYS = 2_000;
const MAX_ARRAY_LENGTH = 500;
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

type AuthContext = { sessionId: string; userId: string };
type RpcError = { code?: string; message?: string };
type RpcResult = { data: unknown; error: RpcError | null };

export interface QuestionnaireDependencies {
  authenticate(token: string): Promise<AuthContext>;
  environment: EdgeEnvironment;
  now(): Date;
  randomUUID(): string;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}

type QuestionnaireRoute =
  | { kind: "schema" }
  | { kind: "draft-get" | "draft-put" | "draft-submit"; profileId: string };

type ErrorCode =
  | "DEPENDENCY_UNAVAILABLE"
  | "FORBIDDEN"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "QUESTIONNAIRE_INCOMPLETE"
  | "UNAUTHENTICATED"
  | "VERSION_CONFLICT";

class QuestionnaireHttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

function headers(corsHeaders: Record<string, string>): Record<string, string> {
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
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...headers(corsHeaders), ...additionalHeaders },
    status,
  });
}

function errorResponse(
  error: QuestionnaireHttpError,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message_key: `questionnaire.${error.code.toLowerCase()}`,
        request_id: requestId,
        retryable: error.code === "DEPENDENCY_UNAVAILABLE",
      },
    },
    error.status,
    corsHeaders,
  );
}

function parseRoute(url: URL, method: string): QuestionnaireRoute | null {
  if (url.search || url.hash) return null;
  const versionIndex = url.pathname.lastIndexOf("/v1/");
  if (versionIndex < 0) return null;
  const path = url.pathname.slice(versionIndex);
  if (path === "/v1/questionnaire/schema" && method === "GET") {
    return { kind: "schema" };
  }
  const match = new RegExp(
    `^/v1/profiles/(${UUID_PATTERN})/draft(/submit)?$`,
    "i",
  ).exec(path);
  if (!match?.[1]) return null;
  if (match[2] === "/submit" && method === "POST") {
    return { kind: "draft-submit", profileId: match[1] };
  }
  if (!match[2] && method === "GET") return { kind: "draft-get", profileId: match[1] };
  if (!match[2] && method === "PUT") return { kind: "draft-put", profileId: match[1] };
  return null;
}

function bearerToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new QuestionnaireHttpError("UNAUTHENTICATED", 401);
  return match[1];
}

function assertJsonShape(value: unknown): void {
  let keys = 0;
  const visit = (candidate: unknown, depth: number) => {
    if (depth > MAX_DEPTH) throw new QuestionnaireHttpError("INVALID_INPUT", 422);
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_ARRAY_LENGTH) {
        throw new QuestionnaireHttpError("INVALID_INPUT", 422);
      }
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (candidate !== null && typeof candidate === "object") {
      const entries = Object.entries(candidate as Record<string, unknown>);
      keys += entries.length;
      if (keys > MAX_KEYS) throw new QuestionnaireHttpError("INVALID_INPUT", 422);
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
    throw new QuestionnaireHttpError("INVALID_INPUT", 422);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new QuestionnaireHttpError("PAYLOAD_TOO_LARGE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new QuestionnaireHttpError("INVALID_INPUT", 422);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      reader.cancel().catch(() => undefined);
      throw new QuestionnaireHttpError("PAYLOAD_TOO_LARGE", 413);
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
    throw new QuestionnaireHttpError("INVALID_INPUT", 422);
  }
  assertJsonShape(parsed);
  return parsed;
}

function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new QuestionnaireHttpError("INVALID_INPUT", 422);
  }
}

function firstRow(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

function mapRpcError(error: RpcError): QuestionnaireHttpError {
  if (error.message?.includes("idempotency_key_reused")) {
    return new QuestionnaireHttpError("IDEMPOTENCY_KEY_REUSED", 409);
  }
  if (error.message?.includes("version_conflict")) {
    return new QuestionnaireHttpError("VERSION_CONFLICT", 409);
  }
  if (error.message?.includes("draft_not_found") || error.code === "P0002") {
    return new QuestionnaireHttpError("NOT_FOUND", 404);
  }
  if (error.message?.includes("access_not_granted") || error.code === "42501") {
    return new QuestionnaireHttpError("FORBIDDEN", 403);
  }
  if (error.message?.includes("unauthenticated")) {
    return new QuestionnaireHttpError("UNAUTHENTICATED", 401);
  }
  return new QuestionnaireHttpError("DEPENDENCY_UNAVAILABLE", 503);
}

async function rpc(
  dependencies: QuestionnaireDependencies,
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
    throw new QuestionnaireHttpError("INVALID_INPUT", 422);
  }
  return key;
}

async function mutationDigests(
  request: Request,
  body: unknown,
  route: QuestionnaireRoute,
) {
  return {
    keyDigest: `\\x${await hashSha256Hex(idempotencyKey(request))}`,
    requestDigest: `\\x${await hashSha256Hex(canonicalJson({ body, route }))}`,
  };
}

function requireMatchingVersionHeader(request: Request, expectedVersion: number): void {
  if (request.headers.get("if-match") !== `"${expectedVersion}"`) {
    throw new QuestionnaireHttpError("VERSION_CONFLICT", 409);
  }
}

function authArgs(auth: AuthContext, profileId: string) {
  return {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
    p_profile_id: profileId,
  };
}

async function getDraft(
  dependencies: QuestionnaireDependencies,
  auth: AuthContext,
  profileId: string,
) {
  const row = firstRow(
    await rpc(
      dependencies,
      "internal_get_questionnaire_draft",
      authArgs(auth, profileId),
    ),
  );
  if (row === null || row === undefined) return null;
  return parse(QuestionnaireDraftSchema, row);
}

async function dispatch(
  request: Request,
  route: QuestionnaireRoute,
  dependencies: QuestionnaireDependencies,
  auth: AuthContext,
): Promise<unknown> {
  if (route.kind === "schema") return QUESTIONNAIRE_PUBLIC_SCHEMA_V2;
  if (route.kind === "draft-get") return getDraft(dependencies, auth, route.profileId);
  if (route.kind === "draft-put") {
    const body = parse(QuestionnaireDraftSaveRequestSchema, await readJson(request));
    requireMatchingVersionHeader(request, body.expectedVersion);
    const evaluation = evaluateQuestionnaire(body.answers);
    const digests = await mutationDigests(request, body, route);
    const row = firstRow(
      await rpc(dependencies, "internal_put_questionnaire_draft", {
        ...authArgs(auth, route.profileId),
        p_answers: body.answers,
        p_completeness: evaluation.completeness,
        p_confirmed_block_ids: body.confirmedBlockIds,
        p_current_block_id: body.currentBlockId,
        p_expected_version: body.expectedVersion,
        p_hard_errors: evaluation.hardErrors,
        p_idempotency_key_digest: digests.keyDigest,
        p_request_digest: digests.requestDigest,
        p_schema_version: body.schemaVersion,
        p_uncertainties: evaluation.uncertainties,
      }),
    );
    return parse(QuestionnaireDraftAckSchema, row);
  }

  const body = parse(QuestionnaireDraftSubmitRequestSchema, await readJson(request));
  requireMatchingVersionHeader(request, body.expectedVersion);
  const draft = await getDraft(dependencies, auth, route.profileId);
  if (!draft) throw new QuestionnaireHttpError("NOT_FOUND", 404);
  const evaluation = evaluateQuestionnaire(draft.answers);
  if (evaluation.hardErrors.length) {
    throw new QuestionnaireHttpError("QUESTIONNAIRE_INCOMPLETE", 422);
  }
  const digests = await mutationDigests(request, body, route);
  const row = firstRow(
    await rpc(dependencies, "internal_submit_questionnaire_draft", {
      ...authArgs(auth, route.profileId),
      p_completeness: evaluation.completeness,
      p_expected_version: body.expectedVersion,
      p_hard_errors: evaluation.hardErrors,
      p_idempotency_key_digest: digests.keyDigest,
      p_request_digest: digests.requestDigest,
      p_schema_version: body.schemaVersion,
      p_uncertainties: evaluation.uncertainties,
    }),
  );
  return parse(QuestionnaireDraftAckSchema, row);
}

export async function handleQuestionnaire(
  request: Request,
  dependencies: QuestionnaireDependencies,
): Promise<Response> {
  const requestId = dependencies.randomUUID();
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(
      new QuestionnaireHttpError("FORBIDDEN", 403),
      requestId,
      cors.headers,
    );
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...cors.headers,
        "access-control-allow-headers":
          "authorization, apikey, content-type, idempotency-key, if-match, x-client-info",
        "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
        "access-control-max-age": "600",
        "cache-control": "no-store, private",
        "referrer-policy": "no-referrer",
      },
      status: 204,
    });
  }
  try {
    const route = parseRoute(new URL(request.url), request.method);
    if (!route) throw new QuestionnaireHttpError("NOT_FOUND", 404);
    let auth: AuthContext;
    try {
      auth = await dependencies.authenticate(bearerToken(request));
    } catch (error) {
      if (error instanceof QuestionnaireHttpError) throw error;
      throw new QuestionnaireHttpError("UNAUTHENTICATED", 401);
    }
    return jsonResponse(
      await dispatch(request, route, dependencies, auth),
      200,
      cors.headers,
    );
  } catch (error) {
    return errorResponse(
      error instanceof QuestionnaireHttpError
        ? error
        : new QuestionnaireHttpError("INTERNAL_ERROR", 500),
      requestId,
      cors.headers,
    );
  }
}
