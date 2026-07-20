import { createClient } from "@supabase/supabase-js";
import {
  EXPORT_MAX_ARTIFACT_BYTES,
  EXPORT_MAX_BODY_BYTES,
  EXPORT_RENDERER_VERSION,
  ExportArtifactAckSchema,
  ExportCreateRequestSchema,
  type ExportArtifactAck,
  type ExportCreateRequestContract,
} from "@health-design/contracts";
import { createExportModel, type ExportModel } from "@health-design/export/model";
import { renderPdf } from "@health-design/export/pdf";
import { renderXlsx } from "@health-design/export/xlsx";

import { canonicalJson, hashSha256Hex } from "../_shared/access-security.ts";
import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const BUCKET = "plan-exports";

type AuthContext = Readonly<{ sessionId: string; userId: string }>;
type RpcError = Readonly<{ code?: string; message?: string }>;
type RpcResult = Readonly<{ data: unknown; error: RpcError | null }>;

export interface ExportEdgeDependencies {
  authenticate(token: string): Promise<AuthContext>;
  authorizeService(token: string): boolean;
  digestIp(ip: string): Promise<string>;
  download(path: string): Promise<Uint8Array>;
  environment: EdgeEnvironment;
  randomUUID(): string;
  remove(paths: readonly string[]): Promise<void>;
  renderPdf(model: ExportModel): Promise<Uint8Array>;
  renderXlsx(model: ExportModel): Promise<Uint8Array>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  upload(path: string, mimeType: string, bytes: Uint8Array): Promise<void>;
}

type ExportRoute =
  | Readonly<{ kind: "create"; planVersionId: string }>
  | Readonly<{ artifactId: string; kind: "download" }>
  | Readonly<{ jobId: string; kind: "purge" }>;

type ErrorCode =
  | "ARTIFACT_TOO_LARGE"
  | "DEPENDENCY_UNAVAILABLE"
  | "EXPORT_IN_PROGRESS"
  | "FORBIDDEN"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED";

class ExportHttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

function responseHeaders(
  corsHeaders: Record<string, string>,
  contentType = "application/json; charset=utf-8",
): Record<string, string> {
  return {
    "cache-control": "no-store, private",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...corsHeaders,
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...responseHeaders(corsHeaders), ...extraHeaders },
    status,
  });
}

function errorResponse(
  error: ExportHttpError,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message_key: `export.${error.code.toLowerCase()}`,
        request_id: requestId,
        retryable:
          error.code === "DEPENDENCY_UNAVAILABLE" || error.code === "RATE_LIMITED",
      },
    },
    error.status,
    corsHeaders,
    error.retryAfter === undefined
      ? {}
      : { "retry-after": String(Math.max(1, Math.min(3600, error.retryAfter))) },
  );
}

function parseRoute(request: Request): ExportRoute | null {
  const url = new URL(request.url);
  if (url.search || url.hash) return null;
  const versionIndex = url.pathname.lastIndexOf("/v1/");
  if (versionIndex < 0) return null;
  const path = url.pathname.slice(versionIndex);

  const create = new RegExp(`^/v1/plans/(${UUID_PATTERN})/exports$`, "i").exec(path);
  if (create?.[1] && request.method === "POST") {
    return { kind: "create", planVersionId: create[1] };
  }

  const download = new RegExp(`^/v1/exports/(${UUID_PATTERN})/content$`, "i").exec(
    path,
  );
  if (download?.[1] && request.method === "GET") {
    return { artifactId: download[1], kind: "download" };
  }

  const purge = new RegExp(
    `^/v1/internal/deletion-jobs/(${UUID_PATTERN})/export-purge$`,
    "i",
  ).exec(path);
  if (purge?.[1] && request.method === "POST") {
    return { jobId: purge[1], kind: "purge" };
  }
  return null;
}

function bearerToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new ExportHttpError("UNAUTHENTICATED", 401);
  return match[1];
}

async function authenticate(
  request: Request,
  dependencies: ExportEdgeDependencies,
): Promise<AuthContext> {
  try {
    return await dependencies.authenticate(bearerToken(request));
  } catch (error) {
    if (error instanceof ExportHttpError) throw error;
    throw new ExportHttpError("UNAUTHENTICATED", 401);
  }
}

async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new ExportHttpError("INVALID_INPUT", 422);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > EXPORT_MAX_BODY_BYTES) {
    throw new ExportHttpError("PAYLOAD_TOO_LARGE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ExportHttpError("INVALID_INPUT", 422);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > EXPORT_MAX_BODY_BYTES) {
      reader.releaseLock();
      throw new ExportHttpError("PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ExportHttpError("INVALID_INPUT", 422);
  }
}

function parseConfig(value: unknown): ExportCreateRequestContract {
  try {
    return ExportCreateRequestSchema.parse(value);
  } catch {
    throw new ExportHttpError("INVALID_INPUT", 422);
  }
}

function firstRow(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return value as Record<string, unknown>;
}

function textField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return value;
}

function parseSource(value: unknown, planVersionId: string) {
  const record = asRecord(firstRow(value));
  const returnedVersionId = textField(record, "planVersionId");
  const outputHash = textField(record, "outputHash");
  if (returnedVersionId !== planVersionId || !HEX_64_PATTERN.test(outputHash)) {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return { nutrition: record.nutrition, outputHash };
}

type InternalArtifact = Readonly<{
  artifactId: string;
  createdAt: string;
  detail: "compact" | "complete";
  format: "pdf" | "xlsx";
  mimeType: string;
  outcome: "failed" | "pending" | "ready" | "reserved";
  planVersionId: string;
  presentation: "ingredients" | "preparation";
  schemaVersion: 1;
  status: "failed" | "pending" | "ready";
  storagePath: string;
}>;

function parseArtifact(value: unknown): InternalArtifact {
  const record = asRecord(firstRow(value));
  const artifact = {
    artifactId: textField(record, "artifactId"),
    createdAt: textField(record, "createdAt"),
    detail: textField(record, "detail"),
    format: textField(record, "format"),
    mimeType: textField(record, "mimeType"),
    outcome: textField(record, "outcome"),
    planVersionId: textField(record, "planVersionId"),
    presentation: textField(record, "presentation"),
    schemaVersion: record.schemaVersion,
    status: textField(record, "status"),
    storagePath: textField(record, "storagePath"),
  };
  if (
    !new RegExp(`^${UUID_PATTERN}$`, "i").test(artifact.artifactId) ||
    !new RegExp(`^${UUID_PATTERN}$`, "i").test(artifact.planVersionId) ||
    !["compact", "complete"].includes(artifact.detail) ||
    !["pdf", "xlsx"].includes(artifact.format) ||
    !["ingredients", "preparation"].includes(artifact.presentation) ||
    !["failed", "pending", "ready", "reserved"].includes(artifact.outcome) ||
    !["failed", "pending", "ready"].includes(artifact.status) ||
    artifact.schemaVersion !== 1 ||
    artifact.storagePath.includes("..")
  ) {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return artifact as InternalArtifact;
}

function ack(artifact: InternalArtifact): ExportArtifactAck {
  try {
    return ExportArtifactAckSchema.parse({
      artifactId: artifact.artifactId,
      createdAt: artifact.createdAt,
      detail: artifact.detail,
      format: artifact.format,
      planVersionId: artifact.planVersionId,
      presentation: artifact.presentation,
      schemaVersion: artifact.schemaVersion,
      status: "ready",
    });
  } catch {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
}

function mapRpcError(error: RpcError): ExportHttpError {
  if (error.message?.includes("idempotency_key_reused")) {
    return new ExportHttpError("IDEMPOTENCY_KEY_REUSED", 409);
  }
  if (error.code === "PT429" || error.message?.includes("export_rate_limited")) {
    return new ExportHttpError("RATE_LIMITED", 429, 3600);
  }
  if (error.message?.includes("not_found") || error.code === "P0002") {
    return new ExportHttpError("NOT_FOUND", 404);
  }
  if (error.code === "42501" || error.message?.includes("access_denied")) {
    return new ExportHttpError("FORBIDDEN", 403);
  }
  if (error.code === "28000" || error.message?.includes("unauthenticated")) {
    return new ExportHttpError("UNAUTHENTICATED", 401);
  }
  if (error.code === "22023" || error.message?.includes("invalid_input")) {
    return new ExportHttpError("INVALID_INPUT", 422);
  }
  return new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
}

async function rpc(
  dependencies: ExportEdgeDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await dependencies.rpc(name, args);
  if (result.error) throw mapRpcError(result.error);
  return result.data;
}

function authArgs(auth: AuthContext) {
  return {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
  };
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw new ExportHttpError("INVALID_INPUT", 422);
  }
  return key;
}

function clientIp(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const value = direct || forwarded || "unknown";
  return value.slice(0, 128);
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function hashBytesSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function safeFail(
  dependencies: ExportEdgeDependencies,
  auth: AuthContext,
  artifactId: string,
): Promise<void> {
  try {
    await rpc(dependencies, "internal_fail_plan_export", {
      ...authArgs(auth),
      p_artifact_id: artifactId,
    });
  } catch {
    // La respuesta original conserva su código; el pendiente queda visible para soporte.
  }
}

async function createArtifact(
  request: Request,
  route: Extract<ExportRoute, { kind: "create" }>,
  dependencies: ExportEdgeDependencies,
  auth: AuthContext,
): Promise<ExportArtifactAck> {
  const config = parseConfig(await readJson(request));
  const source = parseSource(
    await rpc(dependencies, "internal_get_plan_export_source", {
      ...authArgs(auth),
      p_plan_version_id: route.planVersionId,
    }),
    route.planVersionId,
  );
  const requestDigest = await hashSha256Hex(canonicalJson({ config, route }));
  const configDigest = await hashSha256Hex(
    canonicalJson({ ...config, rendererVersion: EXPORT_RENDERER_VERSION }),
  );
  const keyDigest = await hashSha256Hex(idempotencyKey(request));
  const ipDigest = await dependencies.digestIp(clientIp(request));
  if (!HEX_64_PATTERN.test(ipDigest)) {
    throw new ExportHttpError("INTERNAL_ERROR", 500);
  }

  const reserved = parseArtifact(
    await rpc(dependencies, "internal_reserve_plan_export", {
      ...authArgs(auth),
      p_config: config,
      p_config_digest: `\\x${configDigest}`,
      p_idempotency_key_digest: `\\x${keyDigest}`,
      p_ip_digest: `\\x${ipDigest}`,
      p_plan_version_id: route.planVersionId,
      p_renderer_version: EXPORT_RENDERER_VERSION,
      p_request_digest: `\\x${requestDigest}`,
    }),
  );
  if (reserved.outcome === "pending") {
    throw new ExportHttpError("EXPORT_IN_PROGRESS", 409);
  }
  if (reserved.outcome === "ready" && reserved.status === "ready") {
    return ack(reserved);
  }
  if (reserved.outcome !== "reserved" || reserved.status !== "pending") {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }

  let uploaded = false;
  try {
    const model = createExportModel({
      config,
      nutrition: source.nutrition,
      planOutputHash: source.outputHash,
      planVersionId: route.planVersionId,
      rendererVersion: EXPORT_RENDERER_VERSION,
    });
    const bytes =
      config.format === "pdf"
        ? await dependencies.renderPdf(model)
        : await dependencies.renderXlsx(model);
    if (bytes.byteLength < 1 || bytes.byteLength > EXPORT_MAX_ARTIFACT_BYTES) {
      throw new ExportHttpError("ARTIFACT_TOO_LARGE", 422);
    }
    await dependencies.upload(reserved.storagePath, reserved.mimeType, bytes);
    uploaded = true;
    const completed = parseArtifact(
      await rpc(dependencies, "internal_complete_plan_export", {
        ...authArgs(auth),
        p_artifact_id: reserved.artifactId,
        p_content_digest: `\\x${await hashBytesSha256Hex(bytes)}`,
        p_size_bytes: bytes.byteLength,
      }),
    );
    if (completed.status !== "ready") {
      throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    return ack(completed);
  } catch (error) {
    if (uploaded) {
      try {
        await dependencies.remove([reserved.storagePath]);
      } catch {
        // La reserva continúa bloqueando la purga hasta que el borrado sea reintentado.
      }
    }
    await safeFail(dependencies, auth, reserved.artifactId);
    if (error instanceof ExportHttpError) throw error;
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
}

async function downloadArtifact(
  route: Extract<ExportRoute, { kind: "download" }>,
  dependencies: ExportEdgeDependencies,
  auth: AuthContext,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const artifact = parseArtifact(
    await rpc(dependencies, "internal_get_plan_export", {
      ...authArgs(auth),
      p_artifact_id: route.artifactId,
    }),
  );
  if (artifact.status !== "ready" || artifact.artifactId !== route.artifactId) {
    throw new ExportHttpError("NOT_FOUND", 404);
  }
  let bytes: Uint8Array;
  try {
    bytes = await dependencies.download(artifact.storagePath);
  } catch {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const extension = artifact.format === "pdf" ? "pdf" : "xlsx";
  return new Response(arrayBuffer(bytes), {
    headers: {
      ...responseHeaders(corsHeaders, artifact.mimeType),
      "content-disposition": `attachment; filename="plan-${artifact.artifactId}.${extension}"`,
    },
    status: 200,
  });
}

function parsePurgePaths(value: unknown): string[] {
  const rows = firstRow(value);
  if (!Array.isArray(rows) || rows.length > 1000) {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return rows.map((row) => {
    const path = textField(asRecord(row), "storagePath");
    if (path.includes("..") || path.startsWith("/")) {
      throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    return path;
  });
}

async function purgeExports(
  request: Request,
  route: Extract<ExportRoute, { kind: "purge" }>,
  dependencies: ExportEdgeDependencies,
): Promise<Readonly<{ removedCount: number }>> {
  const token = bearerToken(request);
  if (!dependencies.authorizeService(token)) {
    throw new ExportHttpError("FORBIDDEN", 403);
  }
  const paths = parsePurgePaths(
    await rpc(dependencies, "internal_list_profile_export_purge_paths", {
      p_job_id: route.jobId,
    }),
  );
  try {
    if (paths.length > 0) await dependencies.remove(paths);
  } catch {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const removed = firstRow(
    await rpc(dependencies, "internal_confirm_profile_export_purge", {
      p_job_id: route.jobId,
      p_removed_paths: paths,
    }),
  );
  if (typeof removed !== "number" || !Number.isInteger(removed) || removed < 0) {
    throw new ExportHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return { removedCount: removed };
}

export async function handlePlanExports(
  request: Request,
  dependencies: ExportEdgeDependencies,
): Promise<Response> {
  const requestId = dependencies.randomUUID();
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(
      new ExportHttpError("FORBIDDEN", 403),
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
    const route = parseRoute(request);
    if (!route) throw new ExportHttpError("NOT_FOUND", 404);
    if (route.kind === "purge") {
      return jsonResponse(
        await purgeExports(request, route, dependencies),
        200,
        cors.headers,
      );
    }
    const auth = await authenticate(request, dependencies);
    if (route.kind === "download") {
      return await downloadArtifact(route, dependencies, auth, cors.headers);
    }
    return jsonResponse(
      await createArtifact(request, route, dependencies, auth),
      200,
      cors.headers,
    );
  } catch (error) {
    return errorResponse(
      error instanceof ExportHttpError
        ? error
        : new ExportHttpError("INTERNAL_ERROR", 500),
      requestId,
      cors.headers,
    );
  }
}

function runtimeValue(name: string): string | undefined {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: { get(key: string): string | undefined } };
    }
  ).Deno;
  return deno?.env?.get(name);
}

function secret(name: string, fallback?: string): string {
  const value = runtimeValue(name) ?? fallback;
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function decodeSessionId(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid_token");
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = JSON.parse(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
  ) as Record<string, unknown>;
  if (typeof decoded.session_id !== "string") throw new Error("missing_session");
  return decoded.session_id;
}

async function hmacSha256Hex(secretValue: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretValue),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dependencies(): ExportEdgeDependencies {
  const url = secret("SUPABASE_URL");
  const publishableKey =
    runtimeValue("SUPABASE_PUBLISHABLE_KEY") ?? secret("SUPABASE_ANON_KEY");
  const serviceRoleKey = secret("SUPABASE_SERVICE_ROLE_KEY");
  const authClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const serviceClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const bucket = serviceClient.storage.from(BUCKET);
  const environment = secret("APP_ENV", "local");
  if (!["local", "development", "production"].includes(environment)) {
    throw new Error("invalid_environment");
  }
  return {
    authenticate: async (token) => {
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) throw new Error("unauthenticated");
      return { sessionId: decodeSessionId(token), userId: data.user.id };
    },
    authorizeService: (token) => token === serviceRoleKey,
    digestIp: (ip) => hmacSha256Hex(secret("ACCESS_RATE_LIMIT_PEPPER"), ip),
    download: async (path) => {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw new Error("storage_download_failed");
      return new Uint8Array(await data.arrayBuffer());
    },
    environment: environment as EdgeEnvironment,
    randomUUID: () => crypto.randomUUID(),
    remove: async (paths) => {
      const { error } = await bucket.remove([...paths]);
      if (error) throw new Error("storage_remove_failed");
    },
    renderPdf: (model) => renderPdf(model),
    renderXlsx: (model) => Promise.resolve(renderXlsx(model)),
    rpc: async (name, args) => {
      const result: unknown = await serviceClient.rpc(name as never, args as never);
      const { data, error } = result as {
        data: unknown;
        error: RpcError | null;
      };
      return { data, error };
    },
    upload: async (path, mimeType, bytes) => {
      const { error } = await bucket.upload(path, bytes, {
        cacheControl: "0",
        contentType: mimeType,
        upsert: false,
      });
      if (error) throw new Error("storage_upload_failed");
    },
  };
}

export default {
  fetch(request: Request) {
    return handlePlanExports(request, dependencies());
  },
};
