import { createClient } from "@supabase/supabase-js";

import {
  CodeLinkRequestSchema,
  DeletionRequestCreateSchema,
  DeletionRequestStatusSchema,
  DeviceLinkHandleSchema,
  DeviceSessionSummarySchema,
  InvitationRedeemRequestSchema,
  InvitationRedeemResponseSchema,
  PrivateCodeRotationResponseSchema,
  ProfileAccessSummarySchema,
  QrGrantRequestSchema,
  QrGrantResponseSchema,
  QrLinkRequestSchema,
  RotatePrivateCodeRequestSchema,
  SessionRevokeRequestSchema,
  SessionRevokeResponseSchema,
  SessionTouchRequestSchema,
  SessionTouchResponseSchema,
} from "@health-design/contracts";
import {
  canonicalJson,
  constantTimeEqualHex,
  decryptAccessResponse,
  encryptAccessResponse,
  generatePrivateCode,
  generateQrPayload,
  hashSha256Hex,
  hmacSha256Hex,
  normalizePrivateCode,
  parseAccessRoute,
  stripEphemeralAccessTokens,
  type AccessRoute,
} from "../_shared/access-security.ts";
import {
  recordAccessAudit,
  type AccessAuditAction,
  type AuditRpc,
} from "../_shared/audit.ts";
import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";
import { verifyTurnstile } from "../_shared/turnstile.ts";

const MAX_BODY_BYTES = 8_192;
const SECRET_HEADERS = [
  "x-invitation-secret",
  "x-private-code",
  "x-qr-payload",
] as const;

type RpcError = { code?: string; message?: string };
type RpcResult = { data: unknown; error: RpcError | null };

type AuthContext = {
  accessToken: string;
  sessionId: string;
  userId: string;
};

export interface AccessDependencies {
  authenticate(token: string): Promise<AuthContext>;
  config: {
    deletionMarkerKey: string;
    deletionMarkerKeyVersion: number;
    idempotencyEncryptionKey: string;
    privateCodePepper: string;
    rateLimitPepper: string;
  };
  environment: EdgeEnvironment;
  now(): Date;
  randomUUID(): string;
  rpc: AuditRpc;
  verifyChallenge(input: {
    action: "access_invitation" | "access_link";
    remoteIp: string;
    token: string;
  }): Promise<boolean>;
}

type ErrorCode =
  | "ACCESS_NOT_GRANTED"
  | "CHALLENGE_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE"
  | "DOMAIN_CONSTRAINT"
  | "FORBIDDEN"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED";

const MESSAGE_KEYS: Readonly<Record<ErrorCode, string>> = {
  ACCESS_NOT_GRANTED: "access.not_granted",
  CHALLENGE_REQUIRED: "access.challenge_required",
  DEPENDENCY_UNAVAILABLE: "common.dependency_unavailable",
  DOMAIN_CONSTRAINT: "common.domain_constraint",
  FORBIDDEN: "common.forbidden",
  IDEMPOTENCY_KEY_REUSED: "common.idempotency_key_reused",
  INTERNAL_ERROR: "common.internal_error",
  INVALID_INPUT: "common.invalid_input",
  NOT_FOUND: "common.not_found",
  RATE_LIMITED: "common.rate_limited",
  UNAUTHENTICATED: "common.unauthenticated",
};

class AccessHttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly retryAfterSeconds?: number,
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

function responseWithCors(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...jsonHeaders(), ...corsHeaders, ...additionalHeaders },
    status,
  });
}

function errorResponse(
  error: AccessHttpError,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  const headers =
    error.retryAfterSeconds === undefined
      ? {}
      : { "retry-after": String(error.retryAfterSeconds) };
  return responseWithCors(
    {
      error: {
        code: error.code,
        message_key: MESSAGE_KEYS[error.code],
        request_id: requestId,
        retryable:
          error.code === "DEPENDENCY_UNAVAILABLE" || error.code === "RATE_LIMITED",
      },
    },
    error.status,
    corsHeaders,
    headers,
  );
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
  if (!match?.[1]) throw new AccessHttpError("UNAUTHENTICATED", 401);
  return match[1];
}

async function readJsonBody(request: Request): Promise<unknown> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new AccessHttpError("INVALID_INPUT", 400);
  }

  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null && Number(lengthHeader) > MAX_BODY_BYTES) {
    throw new AccessHttpError("INVALID_INPUT", 400);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new AccessHttpError("INVALID_INPUT", 400);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      reader.releaseLock();
      throw new AccessHttpError("INVALID_INPUT", 400);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AccessHttpError("INVALID_INPUT", 400);
  }
}

function parseWithSchema<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new AccessHttpError("INVALID_INPUT", 400);
  }
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const candidate: unknown = Array.isArray(data) ? (data as unknown[])[0] : data;
  return candidate !== null && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : null;
}

function bytea(hex: string): string {
  return `\\x${hex}`;
}

function expectedMethod(route: AccessRoute): "GET" | "POST" {
  return route.kind === "profiles-list" ||
    route.kind === "sessions-list" ||
    route.kind === "deletion-request-status"
    ? "GET"
    : "POST";
}

function hexToBase64Url(value: string): string {
  const bytes = Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function deletionPublicError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("ledger_")) return "ledger_unavailable";
  if (
    value === "storage_unavailable" ||
    value === "storage_verification_failed" ||
    value === "export_purge_failed"
  ) {
    return "storage_unavailable";
  }
  if (value === "auth_cleanup_pending") return value;
  return "purge_incomplete";
}

function routeOperation(route: AccessRoute): string {
  return canonicalJson(route);
}

function remoteIp(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip");
  if (direct) return direct;
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
}

function mapRpcError(error: RpcError, accessSensitive = false): AccessHttpError {
  if (
    error.message?.includes("idempotency_key_reused") ||
    error.message?.includes("idempotency_conflict")
  ) {
    return new AccessHttpError("IDEMPOTENCY_KEY_REUSED", 409);
  }
  if (error.message?.includes("unauthenticated")) {
    return new AccessHttpError("UNAUTHENTICATED", 401);
  }
  if (accessSensitive || error.message?.includes("access_not_granted")) {
    return new AccessHttpError("ACCESS_NOT_GRANTED", 403);
  }
  if (error.message?.includes("forbidden") || error.code === "42501") {
    return new AccessHttpError("FORBIDDEN", 403);
  }
  if (error.code === "23505" || error.code === "23514") {
    return new AccessHttpError("DOMAIN_CONSTRAINT", 422);
  }
  return new AccessHttpError("DEPENDENCY_UNAVAILABLE", 503);
}

async function rpc(
  dependencies: AccessDependencies,
  name: string,
  args: Record<string, unknown>,
  accessSensitive = false,
): Promise<unknown> {
  const result: RpcResult = await dependencies.rpc(name, args);
  if (result.error) throw mapRpcError(result.error, accessSensitive);
  return result.data;
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new AccessHttpError("INVALID_INPUT", 400);
  }
  return key;
}

async function mutationDigests(
  request: Request,
  route: AccessRoute,
  body: unknown,
): Promise<{ keyDigest: string; requestDigest: string }> {
  return {
    keyDigest: await hashSha256Hex(idempotencyKey(request)),
    requestDigest: await hashSha256Hex(
      canonicalJson({ body: stripEphemeralAccessTokens(body), route }),
    ),
  };
}

async function encryptedMutation<T>(
  dependencies: AccessDependencies,
  auth: AuthContext,
  operation: string,
  requestDigest: string,
  payload: T,
  schema: { parse(value: unknown): T },
  rpcName: string,
  rpcArgs: Record<string, unknown>,
  accessSensitive = false,
): Promise<{ payload: T; resultCode: string }> {
  const additionalData = `${auth.userId}:${operation}:${requestDigest}`;
  const encrypted = await encryptAccessResponse(
    payload,
    dependencies.config.idempotencyEncryptionKey,
    additionalData,
  );
  const result = firstRow(
    await rpc(
      dependencies,
      rpcName,
      {
        ...rpcArgs,
        p_response_ciphertext: encrypted.ciphertext,
        p_response_nonce: encrypted.nonce,
      },
      accessSensitive,
    ),
  );
  const ciphertext = result?.response_ciphertext;
  const nonce = result?.response_nonce;
  if (typeof ciphertext !== "string" || typeof nonce !== "string") {
    throw new AccessHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  let decrypted: unknown;
  try {
    decrypted = await decryptAccessResponse(
      { ciphertext, nonce },
      dependencies.config.idempotencyEncryptionKey,
      additionalData,
    );
  } catch {
    throw new AccessHttpError("INTERNAL_ERROR", 500);
  }
  return {
    payload: parseWithSchema(schema, decrypted),
    resultCode:
      result && typeof result.result_code === "string"
        ? result.result_code
        : "completed",
  };
}

async function verifyChallengeOrThrow(
  dependencies: AccessDependencies,
  request: Request,
  token: string | undefined,
  action: "access_invitation" | "access_link",
): Promise<void> {
  if (
    !token ||
    !(await dependencies.verifyChallenge({
      action,
      remoteIp: remoteIp(request),
      token,
    }))
  ) {
    throw new AccessHttpError("CHALLENGE_REQUIRED", 403);
  }
}

type AttemptKind = "code" | "invitation" | "qr";

async function startAttempt(
  dependencies: AccessDependencies,
  request: Request,
  auth: AuthContext,
  kind: AttemptKind,
  candidate: string,
  challengeToken: string | undefined,
  challengeAlways: boolean,
): Promise<string> {
  let challengePassed = false;
  if (challengeAlways) {
    await verifyChallengeOrThrow(
      dependencies,
      request,
      challengeToken,
      "access_invitation",
    );
    challengePassed = true;
  }

  const args = {
    p_attempt_kind: kind,
    p_candidate_digest: bytea(
      await hmacSha256Hex(candidate, dependencies.config.rateLimitPepper),
    ),
    p_challenge_passed: challengePassed,
    p_ip_digest: bytea(
      await hmacSha256Hex(remoteIp(request), dependencies.config.rateLimitPepper),
    ),
    p_subject_digest: bytea(
      await hmacSha256Hex(auth.userId, dependencies.config.rateLimitPepper),
    ),
  };
  let decision = firstRow(
    await rpc(dependencies, "internal_start_access_attempt", args),
  );
  if (decision?.decision === "challenge") {
    await verifyChallengeOrThrow(dependencies, request, challengeToken, "access_link");
    decision = firstRow(
      await rpc(dependencies, "internal_start_access_attempt", {
        ...args,
        p_challenge_passed: true,
      }),
    );
  }
  if (decision?.decision === "rate-limited") {
    const retry = decision.retry_after_seconds;
    throw new AccessHttpError(
      "RATE_LIMITED",
      429,
      typeof retry === "number" ? retry : 900,
    );
  }
  if (decision?.decision !== "allow" || typeof decision.event_id !== "string") {
    throw new AccessHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return decision.event_id;
}

async function finishAttempt(
  dependencies: AccessDependencies,
  eventId: string,
  succeeded: boolean,
): Promise<void> {
  await rpc(dependencies, "internal_finish_access_attempt", {
    p_event_id: eventId,
    p_succeeded: succeeded,
  });
}

async function audit(
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
  action: AccessAuditAction,
  result: "denied" | "success",
  targetType: "profile" | "profile_access" | "session",
  targetId?: string,
): Promise<void> {
  try {
    await recordAccessAudit(dependencies.rpc, {
      action,
      authSubject: auth.userId,
      requestId,
      result,
      targetType,
      ...(targetId === undefined ? {} : { targetId }),
    });
  } catch {
    throw new AccessHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
}

async function withAttempt<T>(
  dependencies: AccessDependencies,
  eventId: string,
  operation: () => Promise<T>,
): Promise<T> {
  let succeeded = false;
  try {
    const result = await operation();
    succeeded = true;
    return result;
  } finally {
    await finishAttempt(dependencies, eventId, succeeded);
  }
}

async function handleInvitationRedeem(
  request: Request,
  route: AccessRoute,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<unknown> {
  const body = parseWithSchema<{
    adultAttested: true;
    alias: string;
    captchaToken: string;
    deviceLabel: string;
    invitationSecret: string;
    schemaVersion: 1;
    timezone: string;
  }>(InvitationRedeemRequestSchema, await readJsonBody(request));
  const digests = await mutationDigests(request, route, body);
  let eventId: string | undefined;
  try {
    eventId = await startAttempt(
      dependencies,
      request,
      auth,
      "invitation",
      body.invitationSecret,
      body.captchaToken,
      true,
    );
    const profileId = dependencies.randomUUID();
    const profileAccessId = dependencies.randomUUID();
    const deviceSessionId = dependencies.randomUUID();
    const privateCode = generatePrivateCode();
    const codeDigest = await hmacSha256Hex(
      normalizePrivateCode(privateCode),
      dependencies.config.privateCodePepper,
    );
    const invitationHash = await hashSha256Hex(body.invitationSecret);
    const payload = parseWithSchema(InvitationRedeemResponseSchema, {
      accessScope: "owner",
      alias: body.alias,
      deviceSessionId,
      privateCode,
      profileAccessId,
      profileId,
    });
    const mutation = await withAttempt(dependencies, eventId, () =>
      encryptedMutation(
        dependencies,
        auth,
        routeOperation(route),
        digests.requestDigest,
        payload,
        InvitationRedeemResponseSchema,
        "internal_redeem_invitation",
        {
          p_adult_attested_at: dependencies.now().toISOString(),
          p_alias: body.alias,
          p_auth_session_id: auth.sessionId,
          p_auth_subject: auth.userId,
          p_code_digest: bytea(codeDigest),
          p_code_key_version: 1,
          p_device_label: body.deviceLabel,
          p_device_session_id: deviceSessionId,
          p_idempotency_key_digest: bytea(digests.keyDigest),
          p_invitation_hash: bytea(invitationHash),
          p_profile_access_id: profileAccessId,
          p_profile_id: profileId,
          p_request_digest: bytea(digests.requestDigest),
          p_timezone: body.timezone,
        },
        true,
      ),
    );
    await audit(
      dependencies,
      auth,
      requestId,
      "invitation_redeem",
      "success",
      "profile",
      mutation.payload.profileId,
    );
    return mutation.payload;
  } catch (error) {
    await audit(
      dependencies,
      auth,
      requestId,
      "invitation_redeem",
      "denied",
      "profile",
    );
    throw error;
  }
}

async function handleCodeConsume(
  request: Request,
  route: AccessRoute,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<unknown> {
  const body = parseWithSchema(CodeLinkRequestSchema, await readJsonBody(request));
  const digests = await mutationDigests(request, route, body);
  try {
    const eventId = await startAttempt(
      dependencies,
      request,
      auth,
      "code",
      body.alias,
      body.challengeToken,
      false,
    );
    const result = await withAttempt(dependencies, eventId, async () => {
      const candidate = firstRow(
        await rpc(
          dependencies,
          "internal_private_code_candidate",
          { p_alias: body.alias },
          true,
        ),
      );
      const submittedDigest = await hmacSha256Hex(
        normalizePrivateCode(body.privateCode),
        dependencies.config.privateCodePepper,
      );
      const expectedDigest = candidate?.secret_digest_hex;
      if (
        typeof expectedDigest !== "string" ||
        !constantTimeEqualHex(submittedDigest, expectedDigest) ||
        typeof candidate?.profile_id !== "string" ||
        typeof candidate.profile_alias !== "string"
      ) {
        throw new AccessHttpError("ACCESS_NOT_GRANTED", 403);
      }

      const profileAccessId = dependencies.randomUUID();
      const deviceSessionId = dependencies.randomUUID();
      const payload = parseWithSchema(DeviceLinkHandleSchema, {
        accessScope: "owner",
        alias: candidate.profile_alias,
        profileAccessId,
        profileId: candidate.profile_id,
      });
      return encryptedMutation(
        dependencies,
        auth,
        routeOperation(route),
        digests.requestDigest,
        payload,
        DeviceLinkHandleSchema,
        "internal_consume_private_code",
        {
          p_auth_session_id: auth.sessionId,
          p_auth_subject: auth.userId,
          p_device_label: body.deviceLabel,
          p_device_session_id: deviceSessionId,
          p_expected_digest: bytea(submittedDigest),
          p_idempotency_key_digest: bytea(digests.keyDigest),
          p_profile_access_id: profileAccessId,
          p_profile_id: candidate.profile_id,
          p_request_digest: bytea(digests.requestDigest),
        },
        true,
      );
    });
    await audit(
      dependencies,
      auth,
      requestId,
      "code_consume",
      "success",
      "profile_access",
      result.payload.profileAccessId,
    );
    return result.payload;
  } catch (error) {
    await audit(
      dependencies,
      auth,
      requestId,
      "code_consume",
      "denied",
      "profile_access",
    );
    throw error;
  }
}

async function handleQrConsume(
  request: Request,
  route: AccessRoute,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<unknown> {
  const body = parseWithSchema(QrLinkRequestSchema, await readJsonBody(request));
  const digests = await mutationDigests(request, route, body);
  try {
    const eventId = await startAttempt(
      dependencies,
      request,
      auth,
      "qr",
      body.qrPayload,
      body.challengeToken,
      false,
    );
    const result = await withAttempt(dependencies, eventId, async () => {
      const tokenHash = await hashSha256Hex(body.qrPayload);
      const candidate = firstRow(
        await rpc(
          dependencies,
          "internal_qr_candidate",
          { p_token_hash: bytea(tokenHash) },
          true,
        ),
      );
      if (
        typeof candidate?.profile_id !== "string" ||
        typeof candidate.profile_alias !== "string"
      ) {
        throw new AccessHttpError("ACCESS_NOT_GRANTED", 403);
      }
      const profileAccessId = dependencies.randomUUID();
      const deviceSessionId = dependencies.randomUUID();
      const payload = parseWithSchema(DeviceLinkHandleSchema, {
        accessScope: "owner",
        alias: candidate.profile_alias,
        profileAccessId,
        profileId: candidate.profile_id,
      });
      return encryptedMutation(
        dependencies,
        auth,
        routeOperation(route),
        digests.requestDigest,
        payload,
        DeviceLinkHandleSchema,
        "internal_consume_qr_grant",
        {
          p_auth_session_id: auth.sessionId,
          p_auth_subject: auth.userId,
          p_device_label: body.deviceLabel,
          p_device_session_id: deviceSessionId,
          p_idempotency_key_digest: bytea(digests.keyDigest),
          p_profile_access_id: profileAccessId,
          p_request_digest: bytea(digests.requestDigest),
          p_token_hash: bytea(tokenHash),
        },
        true,
      );
    });
    await audit(
      dependencies,
      auth,
      requestId,
      "qr_consume",
      "success",
      "profile_access",
      result.payload.profileAccessId,
    );
    return result.payload;
  } catch (error) {
    await audit(
      dependencies,
      auth,
      requestId,
      "qr_consume",
      "denied",
      "profile_access",
    );
    throw error;
  }
}

async function handleQrCreate(
  request: Request,
  route: Extract<AccessRoute, { kind: "qr-create" }>,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<unknown> {
  const body = parseWithSchema<{ schemaVersion: 1 }>(
    QrGrantRequestSchema,
    await readJsonBody(request),
  );
  const digests = await mutationDigests(request, route, body);
  const qrPayload = generateQrPayload();
  const expiresAt = new Date(dependencies.now().getTime() + 5 * 60_000).toISOString();
  const payload = parseWithSchema(QrGrantResponseSchema, { expiresAt, qrPayload });
  try {
    const result = await encryptedMutation(
      dependencies,
      auth,
      routeOperation(route),
      digests.requestDigest,
      payload,
      QrGrantResponseSchema,
      "internal_create_qr_grant",
      {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        p_expires_at: expiresAt,
        p_grant_id: dependencies.randomUUID(),
        p_idempotency_key_digest: bytea(digests.keyDigest),
        p_profile_id: route.profileId,
        p_request_digest: bytea(digests.requestDigest),
        p_token_hash: bytea(await hashSha256Hex(qrPayload)),
      },
    );
    await audit(
      dependencies,
      auth,
      requestId,
      "qr_create",
      "success",
      "profile",
      route.profileId,
    );
    return result.payload;
  } catch (error) {
    await audit(
      dependencies,
      auth,
      requestId,
      "qr_create",
      "denied",
      "profile",
      route.profileId,
    );
    throw error;
  }
}

async function handlePrivateCodeRotate(
  request: Request,
  route: Extract<AccessRoute, { kind: "private-code-rotate" }>,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<unknown> {
  const body = parseWithSchema<{ revokeOtherAccess: boolean; schemaVersion: 1 }>(
    RotatePrivateCodeRequestSchema,
    await readJsonBody(request),
  );
  const digests = await mutationDigests(request, route, body);
  const privateCode = generatePrivateCode();
  const payload = parseWithSchema(PrivateCodeRotationResponseSchema, {
    privateCode,
    revokedOtherAccess: body.revokeOtherAccess,
  });
  try {
    const result = await encryptedMutation(
      dependencies,
      auth,
      routeOperation(route),
      digests.requestDigest,
      payload,
      PrivateCodeRotationResponseSchema,
      "internal_rotate_private_access_code",
      {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        p_idempotency_key_digest: bytea(digests.keyDigest),
        p_new_code_id: dependencies.randomUUID(),
        p_new_digest: bytea(
          await hmacSha256Hex(
            normalizePrivateCode(privateCode),
            dependencies.config.privateCodePepper,
          ),
        ),
        p_profile_id: route.profileId,
        p_request_digest: bytea(digests.requestDigest),
        p_revoke_other_access: body.revokeOtherAccess,
      },
    );
    await audit(
      dependencies,
      auth,
      requestId,
      "private_code_rotate",
      "success",
      "profile",
      route.profileId,
    );
    return result.payload;
  } catch (error) {
    await audit(
      dependencies,
      auth,
      requestId,
      "private_code_rotate",
      "denied",
      "profile",
      route.profileId,
    );
    throw error;
  }
}

async function handleSessionRevoke(
  request: Request,
  route: Extract<AccessRoute, { kind: "session-revoke" }>,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<unknown> {
  const body = parseWithSchema<{ schemaVersion: 1 }>(
    SessionRevokeRequestSchema,
    await readJsonBody(request),
  );
  const digests = await mutationDigests(request, route, body);
  const payload = parseWithSchema(SessionRevokeResponseSchema, { revoked: true });
  try {
    const result = await encryptedMutation(
      dependencies,
      auth,
      routeOperation(route),
      digests.requestDigest,
      payload,
      SessionRevokeResponseSchema,
      "internal_revoke_profile_session",
      {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        p_idempotency_key_digest: bytea(digests.keyDigest),
        p_profile_id: route.profileId,
        p_request_digest: bytea(digests.requestDigest),
        p_target_device_session_id: route.sessionId,
      },
    );
    await audit(
      dependencies,
      auth,
      requestId,
      "session_revoke",
      "success",
      "session",
      route.sessionId,
    );
    return result.payload;
  } catch (error) {
    await audit(
      dependencies,
      auth,
      requestId,
      "session_revoke",
      "denied",
      "session",
      route.sessionId,
    );
    throw error;
  }
}

async function handleProfilesList(
  dependencies: AccessDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const data = await rpc(dependencies, "internal_list_actor_profiles", {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
  });
  const rows = Array.isArray(data) ? data : [];
  return parseWithSchema(
    ProfileAccessSummarySchema.array(),
    rows.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        accessScope: row.access_scope,
        alias: row.alias,
        profileId: row.profile_id,
        status: row.status,
      };
    }),
  );
}

async function handleSessionsList(
  route: Extract<AccessRoute, { kind: "sessions-list" }>,
  dependencies: AccessDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const data = await rpc(dependencies, "internal_list_profile_sessions", {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
    p_profile_id: route.profileId,
  });
  const rows = Array.isArray(data) ? data : [];
  return parseWithSchema(
    DeviceSessionSummarySchema.array(),
    rows.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        createdAt: row.created_at,
        deviceSessionId: row.device_session_id,
        isCurrent: row.is_current,
        label: row.label,
        lastSeenAt: row.last_seen_at,
      };
    }),
  );
}

async function handleSessionTouch(
  request: Request,
  route: AccessRoute,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<unknown> {
  const body = parseWithSchema<{ schemaVersion: 1 }>(
    SessionTouchRequestSchema,
    await readJsonBody(request),
  );
  await mutationDigests(request, route, body);
  try {
    const row = firstRow(
      await rpc(dependencies, "internal_touch_device_session", {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
      }),
    );
    const payload = parseWithSchema(SessionTouchResponseSchema, {
      absoluteExpiresAt: row?.absolute_expires_at,
      deviceSessionId: row?.device_session_id,
      idleExpiresAt: row?.idle_expires_at,
    });
    await audit(
      dependencies,
      auth,
      requestId,
      "session_touch",
      "success",
      "session",
      payload.deviceSessionId,
    );
    return payload;
  } catch (error) {
    await audit(dependencies, auth, requestId, "session_touch", "denied", "session");
    throw error;
  }
}

async function handleDeletionRequestCreate(
  request: Request,
  route: Extract<AccessRoute, { kind: "deletion-request-create" }>,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<unknown> {
  const body = parseWithSchema(
    DeletionRequestCreateSchema,
    await readJsonBody(request),
  );
  const digests = await mutationDigests(request, route, body);
  const rawHandle = hexToBase64Url(
    await hmacSha256Hex(idempotencyKey(request), dependencies.config.deletionMarkerKey),
  );
  const data = await rpc(
    dependencies,
    "internal_request_profile_deletion",
    {
      p_alias_normalized: body.alias.trim().replace(/ +/g, " ").toLowerCase(),
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_idempotency_key_digest: bytea(digests.keyDigest),
      p_profile_id: route.profileId,
      p_profile_marker: bytea(
        await hmacSha256Hex(route.profileId, dependencies.config.deletionMarkerKey),
      ),
      p_profile_marker_key_version: dependencies.config.deletionMarkerKeyVersion,
      p_request_digest: bytea(digests.requestDigest),
      p_request_handle_hash: bytea(await hashSha256Hex(rawHandle)),
    },
    true,
  );
  const row = firstRow(data);
  const response = parseWithSchema(DeletionRequestStatusSchema, {
    completedAt: row?.completedAt ?? null,
    errorCode: deletionPublicError(row?.errorCode),
    handle: rawHandle,
    requestedAt: row?.requestedAt,
    schemaVersion: 1,
    status: row?.status,
  });
  await audit(
    dependencies,
    auth,
    requestId,
    "profile_deletion_request",
    "success",
    "profile",
    route.profileId,
  );
  return response;
}

async function handleDeletionRequestStatus(
  route: Extract<AccessRoute, { kind: "deletion-request-status" }>,
  dependencies: AccessDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const row = firstRow(
    await rpc(
      dependencies,
      "internal_get_deletion_request",
      {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        p_request_handle_hash: bytea(await hashSha256Hex(route.handle)),
      },
      true,
    ),
  );
  if (!row) throw new AccessHttpError("NOT_FOUND", 404);
  return parseWithSchema(DeletionRequestStatusSchema, {
    completedAt: row.completedAt ?? null,
    errorCode: deletionPublicError(row.errorCode),
    handle: route.handle,
    requestedAt: row.requestedAt,
    schemaVersion: 1,
    status: row.status,
  });
}

async function dispatch(
  request: Request,
  route: AccessRoute,
  dependencies: AccessDependencies,
  auth: AuthContext,
  requestId: string,
): Promise<{ body: unknown; status: number }> {
  switch (route.kind) {
    case "invitation-redeem":
      return {
        body: await handleInvitationRedeem(
          request,
          route,
          dependencies,
          auth,
          requestId,
        ),
        status: 201,
      };
    case "code-consume":
      return {
        body: await handleCodeConsume(request, route, dependencies, auth, requestId),
        status: 201,
      };
    case "qr-consume":
      return {
        body: await handleQrConsume(request, route, dependencies, auth, requestId),
        status: 201,
      };
    case "qr-create":
      return {
        body: await handleQrCreate(request, route, dependencies, auth, requestId),
        status: 201,
      };
    case "private-code-rotate":
      return {
        body: await handlePrivateCodeRotate(
          request,
          route,
          dependencies,
          auth,
          requestId,
        ),
        status: 200,
      };
    case "profiles-list":
      return { body: await handleProfilesList(dependencies, auth), status: 200 };
    case "sessions-list":
      return { body: await handleSessionsList(route, dependencies, auth), status: 200 };
    case "session-revoke":
      return {
        body: await handleSessionRevoke(request, route, dependencies, auth, requestId),
        status: 200,
      };
    case "session-touch":
      return {
        body: await handleSessionTouch(request, route, dependencies, auth, requestId),
        status: 200,
      };
    case "deletion-request-create":
      return {
        body: await handleDeletionRequestCreate(
          request,
          route,
          dependencies,
          auth,
          requestId,
        ),
        status: 202,
      };
    case "deletion-request-status":
      return {
        body: await handleDeletionRequestStatus(route, dependencies, auth),
        status: 200,
      };
  }
}

export async function handleAccess(
  request: Request,
  dependencies: AccessDependencies,
): Promise<Response> {
  const requestId = dependencies.randomUUID();
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(
      new AccessHttpError("FORBIDDEN", 403),
      requestId,
      cors.headers,
    );
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...cors.headers,
        "access-control-allow-headers":
          "authorization, apikey, content-type, idempotency-key, x-client-info",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-max-age": "600",
        "cache-control": "no-store, private",
        "referrer-policy": "no-referrer",
      },
      status: 204,
    });
  }

  try {
    const url = new URL(request.url);
    if (url.search !== "" || url.hash !== "") {
      throw new AccessHttpError("INVALID_INPUT", 400);
    }
    if (SECRET_HEADERS.some((header) => request.headers.has(header))) {
      throw new AccessHttpError("INVALID_INPUT", 400);
    }
    const route = parseAccessRoute(url);
    if (!route) throw new AccessHttpError("NOT_FOUND", 404);
    if (request.method !== expectedMethod(route)) {
      return responseWithCors(
        {
          error: {
            code: "INVALID_INPUT",
            message_key: MESSAGE_KEYS.INVALID_INPUT,
            request_id: requestId,
            retryable: false,
          },
        },
        405,
        cors.headers,
        { allow: expectedMethod(route) },
      );
    }
    const token = bearerToken(request);
    let auth: AuthContext;
    try {
      auth = await dependencies.authenticate(token);
    } catch {
      throw new AccessHttpError("UNAUTHENTICATED", 401);
    }
    const result = await dispatch(request, route, dependencies, auth, requestId);
    return responseWithCors(result.body, result.status, cors.headers);
  } catch (error) {
    return errorResponse(
      error instanceof AccessHttpError
        ? error
        : new AccessHttpError("INTERNAL_ERROR", 500),
      requestId,
      cors.headers,
    );
  }
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

function decodeSessionId(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid_token");
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = JSON.parse(atob(padded)) as Record<string, unknown>;
  if (typeof decoded.session_id !== "string") throw new Error("missing_session");
  return decoded.session_id;
}

function runtimeDependencies(): AccessDependencies {
  const supabaseUrl = runtimeSecret("SUPABASE_URL");
  const publishableKey =
    runtimeOptionalSecret("SUPABASE_PUBLISHABLE_KEY") ??
    runtimeSecret("SUPABASE_ANON_KEY");
  const serviceRoleKey = runtimeSecret("SUPABASE_SERVICE_ROLE_KEY");
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const turnstileSecret = runtimeSecret("TURNSTILE_SECRET_KEY");
  const expectedHostname = runtimeSecret("TURNSTILE_EXPECTED_HOSTNAME", "localhost");

  return {
    authenticate: async (token) => {
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) throw new Error("unauthenticated");
      return {
        accessToken: token,
        sessionId: decodeSessionId(token),
        userId: data.user.id,
      };
    },
    config: {
      deletionMarkerKey: runtimeSecret("TOMBSTONE_HMAC_KEY"),
      deletionMarkerKeyVersion: Number(
        runtimeSecret("TOMBSTONE_HMAC_KEY_VERSION", "1"),
      ),
      idempotencyEncryptionKey: runtimeSecret("ACCESS_IDEMPOTENCY_ENCRYPTION_KEY"),
      privateCodePepper: runtimeSecret("PRIVATE_ACCESS_CODE_PEPPER"),
      rateLimitPepper: runtimeSecret("ACCESS_RATE_LIMIT_PEPPER"),
    },
    environment: runtimeEnvironment(),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
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
    verifyChallenge: async ({ action, remoteIp: clientIp, token }) =>
      (
        await verifyTurnstile({
          expectedAction: action,
          expectedHostname,
          secret: turnstileSecret,
          token,
          ...(clientIp === "unknown" ? {} : { remoteIp: clientIp }),
        })
      ).ok,
  };
}

export default {
  fetch(request: Request) {
    return handleAccess(request, runtimeDependencies());
  },
};
