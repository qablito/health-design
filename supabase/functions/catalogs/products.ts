import {
  ProductConfirmationAckSchema,
  ProductConfirmationRequestSchema,
  ProductResolutionResponseSchema,
  type CommercialProductSnapshot,
  type ProductGtin,
  type ProductResolutionResponse,
  type ProductSymbology,
} from "@health-design/contracts";
import {
  classifyCommercialProductCompleteness,
  evaluateCommercialProductSnapshotCoherence,
  normalizeProductGtin,
  validateCommercialProductSnapshotLimits,
} from "@health-design/catalog/products";
import { normalizeDecimal } from "@health-design/engine";

import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const FOOD_KEY_PATTERN = /^food:[a-z0-9][a-z0-9._:-]{0,127}$/;
const MAX_CONFIRMATION_BODY_BYTES = 80 * 1_024;
const MAX_OFF_BODY_BYTES = 128 * 1_024;
const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_es",
  "brands",
  "nutrition_data_per",
  "nutriments",
  "ingredients",
  "allergens_tags",
  "traces_tags",
].join(",");

type AuthContext = Readonly<{ sessionId: string; userId: string }>;
type RpcResult = Readonly<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

export type OpenFoodFactsResult = Readonly<{
  availability: "available" | "not_found" | "unavailable";
  snapshot?: CommercialProductSnapshot;
}>;

export interface ProductCatalogDependencies {
  authenticate: (token: string) => Promise<AuthContext>;
  environment: EdgeEnvironment;
  fetchOpenFoodFacts: (gtin: ProductGtin) => Promise<OpenFoodFactsResult>;
  hashCanonical: (value: unknown) => Promise<string>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
}

type ProductRoute = Readonly<{
  canonicalFoodKey: string | null;
  code: string;
  kind: "confirm" | "resolve";
  profileId: string;
  symbology: ProductSymbology;
}>;

type ErrorCode =
  | "DEPENDENCY_UNAVAILABLE"
  | "DOMAIN_CONSTRAINT"
  | "FORBIDDEN"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "INVALID_GTIN"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED";

class ProductHttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

const externalLookups = new Map<string, Promise<OpenFoodFactsResult>>();

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
  error: ProductHttpError,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message_key: `commercial_products.${error.code.toLowerCase()}`,
        request_id: requestId,
        retryable:
          error.code === "DEPENDENCY_UNAVAILABLE" || error.code === "RATE_LIMITED",
      },
    },
    error.status,
    corsHeaders,
  );
}

function bearerToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new ProductHttpError("UNAUTHENTICATED", 401);
  return match[1];
}

function parseRoute(url: URL, method: string): ProductRoute | null {
  const marker = "/v1/profiles/";
  const markerIndex = url.pathname.lastIndexOf(marker);
  if (markerIndex < 0 || url.hash) return null;
  const path = url.pathname.slice(markerIndex);
  const match =
    /^\/v1\/profiles\/([0-9a-f-]{36})\/products\/barcode\/([^/]+)(\/confirm)?$/i.exec(
      path,
    );
  if (!match?.[1] || !match[2] || !UUID_PATTERN.test(match[1])) return null;
  const kind = match[3] === "/confirm" ? "confirm" : "resolve";
  if (
    (kind === "resolve" && method !== "GET") ||
    (kind === "confirm" && method !== "POST")
  ) {
    return null;
  }
  const symbology = url.searchParams.get("symbology");
  if (
    symbology !== "ean_8" &&
    symbology !== "ean_13" &&
    symbology !== "upc_a" &&
    symbology !== "upc_e" &&
    symbology !== "itf_14"
  ) {
    throw new ProductHttpError("INVALID_GTIN", 400);
  }
  const canonicalFoodKey = url.searchParams.get("canonicalFoodKey");
  const allowedParameters = new Set(["symbology", "canonicalFoodKey"]);
  if (
    [...url.searchParams.keys()].some((key) => !allowedParameters.has(key)) ||
    (canonicalFoodKey !== null && !FOOD_KEY_PATTERN.test(canonicalFoodKey))
  ) {
    throw new ProductHttpError("INVALID_INPUT", 422);
  }
  return {
    canonicalFoodKey,
    code: decodeURIComponent(match[2]),
    kind,
    profileId: match[1],
    symbology,
  };
}

function normalizeRouteGtin(route: ProductRoute): ProductGtin {
  try {
    return normalizeProductGtin({ code: route.code, symbology: route.symbology });
  } catch {
    throw new ProductHttpError("INVALID_GTIN", 400);
  }
}

function requestId(request: Request, required: boolean): string {
  const candidate = request.headers.get("idempotency-key");
  if (candidate && UUID_PATTERN.test(candidate)) return candidate;
  if (required) throw new ProductHttpError("INVALID_INPUT", 422);
  return crypto.randomUUID();
}

async function authenticate(
  request: Request,
  dependencies: ProductCatalogDependencies,
): Promise<AuthContext> {
  try {
    return await dependencies.authenticate(bearerToken(request));
  } catch (error) {
    if (error instanceof ProductHttpError) throw error;
    throw new ProductHttpError("UNAUTHENTICATED", 401);
  }
}

function mapRpcError(error: { code?: string; message?: string }): ProductHttpError {
  if (error.message === "profile_access_denied" || error.code === "42501") {
    return new ProductHttpError("FORBIDDEN", 403);
  }
  if (error.message === "idempotency_key_reused") {
    return new ProductHttpError("IDEMPOTENCY_KEY_REUSED", 409);
  }
  if (error.message === "product_rate_limited" || error.code === "PT429") {
    return new ProductHttpError("RATE_LIMITED", 429);
  }
  if (error.code === "PT409" || error.code === "23505" || error.code === "22023") {
    return new ProductHttpError("DOMAIN_CONSTRAINT", 409);
  }
  if (error.code === "P0002") return new ProductHttpError("NOT_FOUND", 404);
  return new ProductHttpError("DEPENDENCY_UNAVAILABLE", 503);
}

async function callRpc(
  dependencies: ProductCatalogDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let result: RpcResult;
  try {
    result = await dependencies.rpc(name, args);
  } catch {
    throw new ProductHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  if (result.error) throw mapRpcError(result.error);
  return result.data;
}

async function readConfirmation(request: Request): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new ProductHttpError("INVALID_INPUT", 422);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONFIRMATION_BODY_BYTES) {
    throw new ProductHttpError("PAYLOAD_TOO_LARGE", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_CONFIRMATION_BODY_BYTES) {
    throw new ProductHttpError("PAYLOAD_TOO_LARGE", 413);
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ProductHttpError("INVALID_INPUT", 422);
  }
}

async function hashCanonical(
  dependencies: ProductCatalogDependencies,
  value: unknown,
): Promise<string> {
  const hash = await dependencies.hashCanonical(value);
  if (!HASH_PATTERN.test(hash)) {
    throw new ProductHttpError("DEPENDENCY_UNAVAILABLE", 503);
  }
  return hash;
}

function manualResolution(
  gtin: ProductGtin,
  availability: "not_found" | "unavailable",
  uncertainty = "product_snapshot_missing",
): ProductResolutionResponse {
  return {
    completeness: "insufficient",
    confirmedForProfile: false,
    contentHash: null,
    gtin,
    matching: null,
    revisionId: null,
    schemaVersion: 1,
    snapshot: null,
    source: "manual_blank",
    sourceAvailability: availability,
    uncertainties: [uncertainty],
  };
}

async function singleFlightLookup(
  gtin: ProductGtin,
  dependencies: ProductCatalogDependencies,
): Promise<OpenFoodFactsResult> {
  const existing = externalLookups.get(gtin.gtin14);
  if (existing) return existing;
  const pending = dependencies.fetchOpenFoodFacts(gtin);
  externalLookups.set(gtin.gtin14, pending);
  try {
    return await pending;
  } finally {
    if (externalLookups.get(gtin.gtin14) === pending) {
      externalLookups.delete(gtin.gtin14);
    }
  }
}

async function resolveExternal(
  gtin: ProductGtin,
  dependencies: ProductCatalogDependencies,
): Promise<ProductResolutionResponse> {
  let result: OpenFoodFactsResult;
  try {
    result = await singleFlightLookup(gtin, dependencies);
  } catch {
    return manualResolution(gtin, "unavailable", "open_food_facts_unavailable");
  }
  if (result.availability !== "available") {
    return manualResolution(
      gtin,
      result.availability,
      `open_food_facts_${result.availability}`,
    );
  }
  if (!result.snapshot) {
    return manualResolution(gtin, "unavailable", "open_food_facts_invalid");
  }
  const parsed = ProductConfirmationRequestSchema.shape.snapshot.safeParse(
    result.snapshot,
  );
  if (
    !parsed.success ||
    parsed.data.gtin.gtin14 !== gtin.gtin14 ||
    !validateCommercialProductSnapshotLimits(parsed.data).valid ||
    evaluateCommercialProductSnapshotCoherence(parsed.data).status !== "valid"
  ) {
    return manualResolution(gtin, "unavailable", "open_food_facts_invalid");
  }
  const classification = classifyCommercialProductCompleteness(parsed.data);
  return {
    completeness: classification.completeness,
    confirmedForProfile: false,
    contentHash: await hashCanonical(dependencies, parsed.data),
    gtin,
    matching: null,
    revisionId: null,
    schemaVersion: 1,
    snapshot: parsed.data,
    source: "open_food_facts",
    sourceAvailability: "available",
    uncertainties: [...classification.uncertainties],
  };
}

export async function handleProductCatalog(
  request: Request,
  dependencies: ProductCatalogDependencies,
): Promise<Response> {
  const fallbackRequestId = requestId(request, false);
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(
      new ProductHttpError("FORBIDDEN", 403),
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
    if (!route) throw new ProductHttpError("NOT_FOUND", 404);
    const gtin = normalizeRouteGtin(route);
    const auth = await authenticate(request, dependencies);
    const authArgs = {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
      p_profile_id: route.profileId,
    };

    if (route.kind === "resolve") {
      const internal = await callRpc(
        dependencies,
        "internal_commercial_product_resolve",
        {
          ...authArgs,
          p_canonical_food_key: route.canonicalFoodKey,
          p_gtin14: gtin.gtin14,
        },
      );
      if (internal !== null) {
        const parsed = ProductResolutionResponseSchema.safeParse(internal);
        if (!parsed.success) {
          throw new ProductHttpError("DEPENDENCY_UNAVAILABLE", 503);
        }
        return jsonResponse(parsed.data, 200, cors.headers);
      }
      const external = await resolveExternal(gtin, dependencies);
      return jsonResponse(
        ProductResolutionResponseSchema.parse(external),
        200,
        cors.headers,
      );
    }

    const mutationId = requestId(request, true);
    const parsedBody = ProductConfirmationRequestSchema.safeParse(
      await readConfirmation(request),
    );
    if (!parsedBody.success) throw new ProductHttpError("INVALID_INPUT", 422);
    const body = parsedBody.data;
    const limits = validateCommercialProductSnapshotLimits(body.snapshot);
    const coherence = evaluateCommercialProductSnapshotCoherence(body.snapshot);
    if (
      !limits.valid ||
      coherence.status !== "valid" ||
      body.snapshot.gtin.gtin14 !== gtin.gtin14 ||
      body.snapshot.gtin.displayGtin !== gtin.displayGtin ||
      body.snapshot.gtin.symbology !== gtin.symbology
    ) {
      throw new ProductHttpError("INVALID_INPUT", 422);
    }
    const classification = classifyCommercialProductCompleteness(body.snapshot);
    const snapshotHash = await hashCanonical(dependencies, body.snapshot);
    const requestDigest = await hashCanonical(dependencies, body);
    const data = await callRpc(dependencies, "internal_commercial_product_confirm", {
      ...authArgs,
      p_base_revision_id: body.baseRevisionId ?? null,
      p_completeness: classification.completeness,
      p_expected_content_hash: body.expectedContentHash
        ? `\\x${body.expectedContentHash}`
        : null,
      p_gtin14: gtin.gtin14,
      p_request_digest: `\\x${requestDigest}`,
      p_request_id: mutationId,
      p_snapshot: body.snapshot,
      p_snapshot_content_hash: `\\x${snapshotHash}`,
      p_uncertainties: classification.uncertainties,
    });
    const ack = ProductConfirmationAckSchema.safeParse(data);
    if (!ack.success) throw new ProductHttpError("DEPENDENCY_UNAVAILABLE", 503);
    return jsonResponse(ack.data, 201, cors.headers);
  } catch (error) {
    return errorResponse(
      error instanceof ProductHttpError
        ? error
        : new ProductHttpError("INTERNAL_ERROR", 500),
      fallbackRequestId,
      cors.headers,
    );
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value
    .flatMap((entry) => (typeof entry === "string" ? [entry.trim()] : []))
    .filter(Boolean)
    .slice(0, 100);
  return values;
}

function nutrient(value: unknown, unit: "g" | "kcal") {
  if (typeof value !== "number" && typeof value !== "string") {
    return { state: "unknown" } as const;
  }
  try {
    const normalized = normalizeDecimal(String(value));
    if (normalized.startsWith("-")) return { state: "unknown" } as const;
    return { state: "known", unit, value: normalized } as const;
  } catch {
    return { state: "unknown" } as const;
  }
}

function structuredList(values: string[] | null) {
  return values === null
    ? ({ state: "unknown" } as const)
    : ({ state: "known", values } as const);
}

function mapOpenFoodFactsProduct(
  gtin: ProductGtin,
  payload: unknown,
): CommercialProductSnapshot | null {
  const root = record(payload);
  const product = record(root?.product);
  const nutriments = record(product?.nutriments);
  const name = text(product?.product_name_es) ?? text(product?.product_name);
  if (!root || root.status !== 1 || !product || !nutriments || !name) return null;
  const ingredients = Array.isArray(product.ingredients)
    ? product.ingredients
        .flatMap((entry) => {
          const ingredient = record(entry);
          const label = text(ingredient?.text);
          return label ? [label] : [];
        })
        .slice(0, 100)
    : null;
  return {
    basis: product.nutrition_data_per === "100ml" ? "per_100_ml" : "per_100_g",
    ...(text(product.brands) ? { brand: text(product.brands) } : {}),
    gtin,
    name,
    nutrients: {
      carbohydratesG: nutrient(nutriments.carbohydrates_100g, "g"),
      clinical: {},
      energyKcal: nutrient(nutriments["energy-kcal_100g"], "kcal"),
      fatG: nutrient(nutriments.fat_100g, "g"),
      fiberG: nutrient(nutriments.fiber_100g, "g"),
      proteinG: nutrient(nutriments.proteins_100g, "g"),
      saltG: nutrient(nutriments.salt_100g, "g"),
      saturatedFatG: nutrient(nutriments["saturated-fat_100g"], "g"),
      sugarsG: nutrient(nutriments.sugars_100g, "g"),
    },
    safety: {
      allergens: structuredList(stringList(product.allergens_tags)),
      crossContactAllergens: structuredList(stringList(product.traces_tags)),
      ingredients: structuredList(ingredients),
    },
    schemaVersion: 1,
  };
}

export async function fetchOpenFoodFactsProduct(
  gtin: ProductGtin,
  options: Readonly<{
    fetch?: typeof fetch;
    timeoutMs?: number;
    userAgent?: string;
  }> = {},
): Promise<OpenFoodFactsResult> {
  if (!options.userAgent) return { availability: "unavailable" };
  const fetchImplementation = options.fetch ?? fetch;
  const url = new URL(
    `https://world.openfoodfacts.org/api/v2/product/${gtin.gtin14}.json`,
  );
  url.searchParams.set("fields", OFF_FIELDS);
  try {
    const response = await fetchImplementation(url, {
      headers: { Accept: "application/json", "User-Agent": options.userAgent },
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 3_500),
    });
    if (response.status === 404) return { availability: "not_found" };
    if (!response.ok) return { availability: "unavailable" };
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_OFF_BODY_BYTES) {
      return { availability: "unavailable" };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_OFF_BODY_BYTES) return { availability: "unavailable" };
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const snapshot = mapOpenFoodFactsProduct(gtin, payload);
    return snapshot
      ? { availability: "available", snapshot }
      : { availability: record(payload)?.status === 0 ? "not_found" : "unavailable" };
  } catch {
    return { availability: "unavailable" };
  }
}
