import {
  SHOPPING_HTTP_BODY_BYTES,
  ShoppingCatalogPageSchema,
  ShoppingCreateRequestSchema,
  ShoppingLeftoverRequestSchema,
  ShoppingMutationAckSchema,
  ShoppingPreferenceAckSchema,
  ShoppingPreferencePutSchema,
  ShoppingPreferenceReadResponseSchema,
  ShoppingProductSelectionRequestSchema,
  ShoppingResolutionInputSchema,
  ShoppingSnapshotResponseSchema,
  ShoppingSnapshotSchema,
  type ShoppingMutationAck,
  type ShoppingResolutionInput,
  type ShoppingSnapshot,
} from "@health-design/contracts";
import { SHOPPING_RESOLVER_VERSION } from "@health-design/engine/shopping";

import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,2048}$/;

type AuthContext = Readonly<{ sessionId: string; userId: string }>;
type RpcError = Readonly<{ code?: string; message?: string }>;
type RpcResult = Readonly<{ data: unknown; error: RpcError | null }>;

export interface CatalogConcurrencyGuard {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface ShoppingEdgeDependencies {
  authenticate(token: string): Promise<AuthContext>;
  catalogGuard: CatalogConcurrencyGuard;
  digestIp(ip: string): Promise<string>;
  environment: EdgeEnvironment;
  hashCanonical(value: unknown): Promise<string>;
  now(): string;
  randomUUID(): string;
  resolveShopping(input: ShoppingResolutionInput): Promise<ShoppingSnapshot>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}

type ShoppingRoute =
  | Readonly<{ kind: "catalog" }>
  | Readonly<{ kind: "preference-get"; profileId: string }>
  | Readonly<{ kind: "preference-put"; profileId: string }>
  | Readonly<{ kind: "shopping-create"; planVersionId: string }>
  | Readonly<{ kind: "snapshot-get"; snapshotId: string }>
  | Readonly<{ kind: "leftover"; snapshotId: string }>
  | Readonly<{ kind: "product-selection"; snapshotId: string }>;

type ErrorCode =
  | "CATALOG_NOT_PUBLISHED"
  | "DEPENDENCY_UNAVAILABLE"
  | "FORBIDDEN"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NUTRITION_MODULE_REQUIRED"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SHOPPING_SKU_MATCH_EXCLUDED"
  | "SHOPPING_SKU_MATCH_REVIEW_REQUIRED"
  | "SHOPPING_SKU_NOT_CALCULABLE"
  | "SHOPPING_SNAPSHOT_MISMATCH"
  | "STALE_PLAN_VERSION"
  | "UNAUTHENTICATED"
  | "VERSION_CONFLICT";

class ShoppingHttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

export function createCatalogConcurrencyGuard(limit = 4): CatalogConcurrencyGuard {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("invalid_catalog_limit");
  let active = 0;
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (active >= limit) throw new ShoppingHttpError("RATE_LIMITED", 429, 1);
      active += 1;
      try {
        return await operation();
      } finally {
        active -= 1;
      }
    },
  };
}

function privateHeaders(corsHeaders: Record<string, string>): Record<string, string> {
  const corsVary = corsHeaders.vary;
  return {
    "cache-control": "no-store, private",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    vary: corsVary ? `${corsVary}, Authorization` : "Authorization",
    "x-content-type-options": "nosniff",
    ...corsHeaders,
    ...(corsVary ? { vary: `${corsVary}, Authorization` } : {}),
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...privateHeaders(corsHeaders), ...extraHeaders },
    status,
  });
}

function errorResponse(
  error: ShoppingHttpError,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message_key: `shopping.${error.code.toLowerCase()}`,
        request_id: requestId,
        retryable:
          error.code === "DEPENDENCY_UNAVAILABLE" || error.code === "RATE_LIMITED",
      },
    },
    error.status,
    corsHeaders,
    error.status === 429
      ? { "retry-after": String(Math.max(1, Math.min(3600, error.retryAfter ?? 60))) }
      : {},
  );
}

function parseRoute(request: Request): ShoppingRoute | null {
  const url = new URL(request.url);
  if (url.hash) return null;
  const index = url.pathname.lastIndexOf("/v1/");
  if (index < 0) return null;
  const path = url.pathname.slice(index);
  if (path === "/v1/catalogs" && request.method === "GET") {
    return { kind: "catalog" };
  }
  if (url.search) return null;
  const preference = /^\/v1\/profiles\/([0-9a-f-]{36})\/shopping-preference$/i.exec(
    path,
  );
  if (preference?.[1] && UUID_PATTERN.test(preference[1])) {
    if (request.method === "GET") {
      return { kind: "preference-get", profileId: preference[1] };
    }
    if (request.method === "PUT") {
      return { kind: "preference-put", profileId: preference[1] };
    }
  }
  const create = /^\/v1\/plans\/([0-9a-f-]{36})\/shopping$/i.exec(path);
  if (create?.[1] && UUID_PATTERN.test(create[1]) && request.method === "POST") {
    return { kind: "shopping-create", planVersionId: create[1] };
  }
  const snapshot = /^\/v1\/shopping\/([0-9a-f-]{36})$/i.exec(path);
  if (snapshot?.[1] && UUID_PATTERN.test(snapshot[1]) && request.method === "GET") {
    return { kind: "snapshot-get", snapshotId: snapshot[1] };
  }
  const mutation =
    /^\/v1\/shopping\/([0-9a-f-]{36})\/(leftovers|product-selection)$/i.exec(path);
  if (
    mutation?.[1] &&
    mutation[2] &&
    UUID_PATTERN.test(mutation[1]) &&
    request.method === "POST"
  ) {
    return mutation[2] === "leftovers"
      ? { kind: "leftover", snapshotId: mutation[1] }
      : { kind: "product-selection", snapshotId: mutation[1] };
  }
  return null;
}

function bearerToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new ShoppingHttpError("UNAUTHENTICATED", 401);
  return match[1];
}

async function authenticate(
  request: Request,
  dependencies: ShoppingEdgeDependencies,
): Promise<AuthContext> {
  try {
    return await dependencies.authenticate(bearerToken(request));
  } catch (error) {
    if (error instanceof ShoppingHttpError) throw error;
    throw new ShoppingHttpError("UNAUTHENTICATED", 401);
  }
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw new ShoppingHttpError("INVALID_INPUT", 422);
  }
  return key;
}

function clientIp(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return (direct || forwarded || "unknown").slice(0, 128).toLowerCase();
}

async function digest(
  dependencies: ShoppingEdgeDependencies,
  value: unknown,
): Promise<string> {
  const result = await dependencies.hashCanonical(value);
  if (!HEX_64_PATTERN.test(result)) {
    throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return result;
}

async function ipDigest(
  request: Request,
  dependencies: ShoppingEdgeDependencies,
): Promise<string> {
  const result = await dependencies.digestIp(clientIp(request));
  if (!HEX_64_PATTERN.test(result)) {
    throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return result;
}

async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new ShoppingHttpError("INVALID_INPUT", 422);
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > SHOPPING_HTTP_BODY_BYTES) {
    throw new ShoppingHttpError("PAYLOAD_TOO_LARGE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ShoppingHttpError("INVALID_INPUT", 422);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > SHOPPING_HTTP_BODY_BYTES) {
      reader.releaseLock();
      throw new ShoppingHttpError("PAYLOAD_TOO_LARGE", 413);
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
    throw new ShoppingHttpError("INVALID_INPUT", 422);
  }
}

function firstRow(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return value as Record<string, unknown>;
}

function mapRpcError(error: RpcError): ShoppingHttpError {
  const message = error.message;
  if (
    message === "access_not_granted" ||
    message === "profile_access_denied" ||
    error.code === "42501"
  ) {
    return new ShoppingHttpError("NOT_FOUND", 404);
  }
  if (message === "idempotency_key_reused") {
    return new ShoppingHttpError("IDEMPOTENCY_KEY_REUSED", 409);
  }
  if (message === "stale_plan_version") {
    return new ShoppingHttpError("STALE_PLAN_VERSION", 409);
  }
  if (message === "stale_shopping_snapshot") {
    return new ShoppingHttpError("SHOPPING_SNAPSHOT_MISMATCH", 409);
  }
  if (
    message === "stale_shopping_preference" ||
    message === "shopping_preference_required"
  ) {
    return new ShoppingHttpError("VERSION_CONFLICT", 409);
  }
  if (message === "catalog_not_published") {
    return new ShoppingHttpError("CATALOG_NOT_PUBLISHED", 409);
  }
  if (message === "nutrition_module_required") {
    return new ShoppingHttpError("NUTRITION_MODULE_REQUIRED", 422);
  }
  if (message === "shopping_selection_not_calculable") {
    return new ShoppingHttpError("SHOPPING_SKU_NOT_CALCULABLE", 422);
  }
  if (message === "shopping_sku_match_review_required") {
    return new ShoppingHttpError("SHOPPING_SKU_MATCH_REVIEW_REQUIRED", 422);
  }
  if (
    message === "shopping_sku_match_excluded" ||
    message === "shopping_selection_not_eligible"
  ) {
    return new ShoppingHttpError("SHOPPING_SKU_MATCH_EXCLUDED", 422);
  }
  if (message === "stale_catalog_cursor") {
    return new ShoppingHttpError("INVALID_INPUT", 422);
  }
  if (message?.endsWith("rate_limited") || error.code === "54000") {
    return new ShoppingHttpError("RATE_LIMITED", 429, 60);
  }
  if (error.code === "P0002") return new ShoppingHttpError("NOT_FOUND", 404);
  if (message === "active_basket_seed_required") {
    return new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  if (error.code === "22023") return new ShoppingHttpError("INVALID_INPUT", 422);
  return new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
}

async function rpc(
  dependencies: ShoppingEdgeDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let result: RpcResult;
  try {
    result = await dependencies.rpc(name, args);
  } catch {
    throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  if (result.error) throw mapRpcError(result.error);
  return firstRow(result.data);
}

function authArgs(auth: AuthContext): Record<string, unknown> {
  return {
    p_auth_session_id: auth.sessionId,
    p_auth_subject: auth.userId,
  };
}

function base64UrlEncode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): unknown {
  if (!CURSOR_PATTERN.test(value)) throw new ShoppingHttpError("INVALID_INPUT", 422);
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ShoppingHttpError("INVALID_INPUT", 422);
  }
}

function catalogQuery(url: URL): {
  chain: "mercadona" | "dia" | "aldi";
  cursorPublicationId: string | null;
  cursorSkuId: string | null;
  limit: number;
} {
  const allowed = new Set(["chain", "cursor", "limit"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new ShoppingHttpError("INVALID_INPUT", 422);
  }
  const chain = url.searchParams.get("chain");
  if (chain !== "mercadona" && chain !== "dia" && chain !== "aldi") {
    throw new ShoppingHttpError("INVALID_INPUT", 422);
  }
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ShoppingHttpError("INVALID_INPUT", 422);
  }
  const encodedCursor = url.searchParams.get("cursor");
  if (encodedCursor === null) {
    return { chain, cursorPublicationId: null, cursorSkuId: null, limit };
  }
  const cursor = record(base64UrlDecode(encodedCursor));
  if (
    Object.keys(cursor).sort().join(",") !== "publicationId,skuId,v" ||
    cursor.v !== 1 ||
    typeof cursor.publicationId !== "string" ||
    typeof cursor.skuId !== "string" ||
    !UUID_PATTERN.test(cursor.publicationId) ||
    !UUID_PATTERN.test(cursor.skuId)
  ) {
    throw new ShoppingHttpError("INVALID_INPUT", 422);
  }
  return {
    chain,
    cursorPublicationId: cursor.publicationId,
    cursorSkuId: cursor.skuId,
    limit,
  };
}

async function catalogPage(
  request: Request,
  dependencies: ShoppingEdgeDependencies,
  auth: AuthContext,
): Promise<unknown> {
  const query = catalogQuery(new URL(request.url));
  const digestValue = await ipDigest(request, dependencies);
  return dependencies.catalogGuard.run(async () => {
    const raw = record(
      await rpc(dependencies, "internal_list_shopping_catalog", {
        ...authArgs(auth),
        p_chain: query.chain,
        p_cursor_publication_id: query.cursorPublicationId,
        p_cursor_sku_id: query.cursorSkuId,
        p_ip_digest: `\\x${digestValue}`,
        p_limit: query.limit,
      }),
    );
    if (
      typeof raw.publicationId !== "string" ||
      !Array.isArray(raw.items) ||
      typeof raw.hasMore !== "boolean"
    ) {
      throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    const items: unknown[] = raw.items;
    const last = items.at(-1);
    const lastSku =
      last !== null && typeof last === "object" && !Array.isArray(last)
        ? (last as Record<string, unknown>).skuId
        : null;
    if (raw.hasMore && typeof lastSku !== "string") {
      throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    const parsed = ShoppingCatalogPageSchema.safeParse({
      chain: query.chain,
      items,
      nextCursor: raw.hasMore
        ? base64UrlEncode({ publicationId: raw.publicationId, skuId: lastSku, v: 1 })
        : null,
      publicationId: raw.publicationId,
      schemaVersion: 1,
    });
    if (!parsed.success) throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
    return parsed.data;
  });
}

async function readPreference(
  dependencies: ShoppingEdgeDependencies,
  auth: AuthContext,
  profileId: string,
): Promise<unknown> {
  const parsed = ShoppingPreferenceReadResponseSchema.safeParse(
    await rpc(dependencies, "internal_get_shopping_preference", {
      ...authArgs(auth),
      p_profile_id: profileId,
    }),
  );
  if (!parsed.success) throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

async function putPreference(
  request: Request,
  dependencies: ShoppingEdgeDependencies,
  auth: AuthContext,
  profileId: string,
): Promise<unknown> {
  const body = ShoppingPreferencePutSchema.safeParse(await readJson(request));
  if (!body.success) throw new ShoppingHttpError("INVALID_INPUT", 422);
  const key = await digest(dependencies, { key: idempotencyKey(request) });
  const requestHash = await digest(dependencies, {
    body: body.data,
    profileId,
    route: "shopping-preference-put",
  });
  const parsed = ShoppingPreferenceAckSchema.safeParse(
    await rpc(dependencies, "internal_put_shopping_preference", {
      ...authArgs(auth),
      p_compared_chains: body.data.comparedChains,
      p_expected_version: body.data.expectedVersion,
      p_key_digest: `\\x${key}`,
      p_mode: body.data.mode,
      p_preferred_chain: body.data.preferredChain,
      p_profile_id: profileId,
      p_request_digest: `\\x${requestHash}`,
      p_sorting: body.data.sorting,
    }),
  );
  if (!parsed.success) throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return parsed.data;
}

function resolutionInput(
  rawSource: unknown,
  dependencies: ShoppingEdgeDependencies,
): {
  context: { leftovers: unknown[]; selections: unknown[] };
  input: ShoppingResolutionInput;
} {
  const source = record(rawSource);
  const shoppingList = source.shoppingList;
  if (
    !Array.isArray(shoppingList) ||
    !Array.isArray(source.leftoversForPersistence) ||
    !Array.isArray(source.selectionsForPersistence) ||
    typeof source.createdBy !== "string" ||
    typeof source.expectedRevision !== "number" ||
    (typeof source.supersedesId !== "string" && source.supersedesId !== null)
  ) {
    throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const metadata = {
    createdAt: dependencies.now(),
    createdBy: source.createdBy,
    id: dependencies.randomUUID(),
    itemIds: shoppingList.map((line) => ({
      canonicalFoodKey: record(line).canonicalFoodKey,
      shoppingItemId: dependencies.randomUUID(),
    })),
    resolverVersion: SHOPPING_RESOLVER_VERSION,
    revision: source.expectedRevision + 1,
    supersedesId: source.supersedesId,
  };
  const parsed = ShoppingResolutionInputSchema.safeParse({
    basketSeedRevisionId: source.basketSeedRevisionId,
    catalogItems: source.catalogItems,
    catalogPublicationIds: source.catalogPublicationIds,
    leftovers: source.leftovers,
    manualSelections: source.manualSelections,
    planVersionId: source.planVersionId,
    preferenceRevision: source.preferenceRevision,
    profileId: source.profileId,
    resolutionMetadata: metadata,
    schemaVersion: 1,
    shoppingList,
  });
  if (!parsed.success) throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return {
    context: {
      leftovers: source.leftoversForPersistence,
      selections: source.selectionsForPersistence,
    },
    input: parsed.data,
  };
}

async function resolveAndPersist(
  request: Request,
  route: Extract<
    ShoppingRoute,
    { kind: "shopping-create" | "leftover" | "product-selection" }
  >,
  dependencies: ShoppingEdgeDependencies,
  auth: AuthContext,
): Promise<ShoppingMutationAck> {
  let body: unknown;
  let baseSnapshotId: string | null = null;
  let operation:
    "shopping-leftover-set" | "shopping-product-select" | "shopping-snapshot-create";
  let planVersionId: string;
  if (route.kind === "shopping-create") {
    const parsed = ShoppingCreateRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ShoppingHttpError("INVALID_INPUT", 422);
    body = parsed.data;
    operation = "shopping-snapshot-create";
    planVersionId = route.planVersionId;
  } else {
    const schema =
      route.kind === "leftover"
        ? ShoppingLeftoverRequestSchema
        : ShoppingProductSelectionRequestSchema;
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new ShoppingHttpError("INVALID_INPUT", 422);
    body = parsed.data;
    operation =
      route.kind === "leftover" ? "shopping-leftover-set" : "shopping-product-select";
    baseSnapshotId = route.snapshotId;
    const current = ShoppingSnapshotResponseSchema.safeParse(
      await rpc(dependencies, "internal_get_shopping_snapshot", {
        ...authArgs(auth),
        p_snapshot_id: route.snapshotId,
      }),
    );
    if (!current.success) throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
    planVersionId = current.data.snapshot.planVersionId;
  }

  const keyHash = await digest(dependencies, { key: idempotencyKey(request) });
  const requestHash = await digest(dependencies, { body, operation, planVersionId });
  const ipHash = await ipDigest(request, dependencies);
  const prepared = record(
    await rpc(dependencies, "internal_prepare_shopping_resolution", {
      ...authArgs(auth),
      p_base_snapshot_id: baseSnapshotId,
      p_ip_digest: `\\x${ipHash}`,
      p_key_digest: `\\x${keyHash}`,
      p_mutation: body,
      p_operation: operation,
      p_plan_version_id: planVersionId,
      p_request_digest: `\\x${requestHash}`,
    }),
  );
  if (prepared.replay === true) {
    const replay = ShoppingMutationAckSchema.safeParse(prepared.response);
    if (!replay.success) throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
    return replay.data;
  }
  if (prepared.replay !== false) {
    throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const { context, input } = resolutionInput(prepared.source, dependencies);
  let snapshot: ShoppingSnapshot;
  try {
    snapshot = ShoppingSnapshotSchema.parse(await dependencies.resolveShopping(input));
  } catch {
    throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const snapshotHash = await digest(dependencies, snapshot);
  const ack = ShoppingMutationAckSchema.safeParse(
    await rpc(dependencies, "internal_persist_shopping_resolution", {
      ...authArgs(auth),
      p_basket_seed_revision_id: input.basketSeedRevisionId,
      p_catalog_publication_ids: input.catalogPublicationIds,
      p_context: context,
      p_expected_revision: input.resolutionMetadata.revision - 1,
      p_input_digest: `\\x${snapshot.inputDigest}`,
      p_key_digest: `\\x${keyHash}`,
      p_operation: operation,
      p_plan_version_id: input.planVersionId,
      p_preference_revision_id: input.preferenceRevision.id,
      p_request_digest: `\\x${requestHash}`,
      p_resolver_version: SHOPPING_RESOLVER_VERSION,
      p_snapshot: snapshot,
      p_snapshot_hash: `\\x${snapshotHash}`,
      p_snapshot_id: snapshot.id,
    }),
  );
  if (!ack.success) throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
  return ack.data;
}

export async function handleShoppingCatalog(
  request: Request,
  dependencies: ShoppingEdgeDependencies,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(
      new ShoppingHttpError("FORBIDDEN", 403),
      requestId,
      cors.headers,
    );
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...cors.headers,
        "access-control-allow-headers":
          "authorization, content-type, idempotency-key, apikey",
        "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
        "cache-control": "no-store",
        vary: cors.headers.vary
          ? `${cors.headers.vary}, Authorization`
          : "Authorization",
      },
      status: 204,
    });
  }
  try {
    const route = parseRoute(request);
    if (!route) throw new ShoppingHttpError("NOT_FOUND", 404);
    const auth = await authenticate(request, dependencies);
    let result: unknown;
    if (route.kind === "catalog") {
      result = await catalogPage(request, dependencies, auth);
    } else if (route.kind === "preference-get") {
      result = await readPreference(dependencies, auth, route.profileId);
    } else if (route.kind === "preference-put") {
      result = await putPreference(request, dependencies, auth, route.profileId);
    } else if (route.kind === "snapshot-get") {
      const parsed = ShoppingSnapshotResponseSchema.safeParse(
        await rpc(dependencies, "internal_get_shopping_snapshot", {
          ...authArgs(auth),
          p_snapshot_id: route.snapshotId,
        }),
      );
      if (!parsed.success) throw new ShoppingHttpError("DEPENDENCY_UNAVAILABLE", 503);
      result = parsed.data;
    } else {
      result = await resolveAndPersist(request, route, dependencies, auth);
    }
    return jsonResponse(result, 200, cors.headers);
  } catch (error) {
    return errorResponse(
      error instanceof ShoppingHttpError
        ? error
        : new ShoppingHttpError("INTERNAL_ERROR", 500),
      requestId,
      cors.headers,
    );
  }
}
