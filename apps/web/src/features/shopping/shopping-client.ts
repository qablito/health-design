import {
  SHOPPING_HTTP_BODY_BYTES,
  SUPERMARKET_CHAINS,
  ShoppingCatalogPageSchema,
  ShoppingCreateRequestSchema,
  ShoppingLeftoverRequestSchema,
  ShoppingMutationAckSchema,
  ShoppingPreferenceAckSchema,
  ShoppingPreferencePutSchema,
  ShoppingPreferenceReadResponseSchema,
  ShoppingProductSelectionRequestSchema,
  ShoppingSnapshotResponseSchema,
  type ShoppingCreateRequest,
  type ShoppingLeftoverRequest,
  type ShoppingMutationAck,
  type ShoppingPreferencePut,
  type ShoppingProductSelectionRequest,
  type SupermarketChain,
} from "@health-design/contracts";

type Dependencies = Readonly<{
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
}>;

type MutationOptions = Readonly<{ idempotencyKey?: string | undefined }>;
type ErrorBody = Readonly<{
  error?: Readonly<{
    code?: string;
    message_key?: string;
    request_id?: string;
    retryable?: boolean;
  }>;
}>;
type Schema<T> = Readonly<{
  safeParse(value: unknown): { data: T; success: true } | { success: false };
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ShoppingApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly retryable: boolean;
  readonly status: number;

  constructor(status: number, body: ErrorBody, retryAfter: string | null) {
    super(body.error?.message_key ?? "shopping.unknown_error");
    this.name = "ShoppingApiError";
    this.code = body.error?.code ?? "UNKNOWN_ERROR";
    this.status = status;
    this.retryable = body.error?.retryable ?? false;
    if (body.error?.request_id) this.requestId = body.error.request_id;
    const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    if (Number.isFinite(seconds)) this.retryAfterSeconds = seconds;
  }
}

function identifier(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error("invalid_shopping_identifier");
  return value;
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parse<T>(schema: Schema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("invalid_shopping_response");
  return result.data;
}

export function createShoppingClient(dependencies: Dependencies) {
  async function request<T>(
    input: Readonly<{
      body?: unknown;
      idempotencyKey?: string | undefined;
      method: "GET" | "POST" | "PUT";
      path: string;
      schema: Schema<T>;
    }>,
  ): Promise<T> {
    if (!input.path.startsWith("/v1/") || input.path.includes("#")) {
      throw new Error("invalid_shopping_path");
    }
    const token = await dependencies.getAccessToken();
    const headers: Record<string, string> = {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${token}`,
      "x-client-info": "health-design-web/shopping-v1",
    };
    let encodedBody: string | undefined;
    if (input.method !== "GET") {
      encodedBody = JSON.stringify(input.body);
      if (new TextEncoder().encode(encodedBody).byteLength > SHOPPING_HTTP_BODY_BYTES) {
        throw new Error("shopping_payload_too_large");
      }
      headers["content-type"] = "application/json";
      headers["idempotency-key"] = input.idempotencyKey ?? crypto.randomUUID();
    }
    const fetcher = dependencies.fetcher;
    const response = await fetcher(`${dependencies.baseUrl}${input.path}`, {
      ...(encodedBody === undefined ? {} : { body: encodedBody }),
      headers,
      method: input.method,
      referrerPolicy: "no-referrer",
    });
    const value = await json(response);
    if (!response.ok) {
      throw new ShoppingApiError(
        response.status,
        (value ?? {}) as ErrorBody,
        response.headers.get("retry-after"),
      );
    }
    return parse(input.schema, value);
  }

  function mutation<T>(
    input: Readonly<{
      body: unknown;
      options?: MutationOptions | undefined;
      path: string;
      schema: Schema<T>;
      method?: "POST" | "PUT";
    }>,
  ): Promise<T> {
    return request({
      body: input.body,
      idempotencyKey: input.options?.idempotencyKey,
      method: input.method ?? "POST",
      path: input.path,
      schema: input.schema,
    });
  }

  const client = {
    clearLeftover(
      snapshotId: string,
      input: Extract<ShoppingLeftoverRequest, { action: "clear" }>,
      options?: MutationOptions,
    ) {
      return mutation<ShoppingMutationAck>({
        body: ShoppingLeftoverRequestSchema.parse(input),
        options,
        path: `/v1/shopping/${identifier(snapshotId)}/leftovers`,
        schema: ShoppingMutationAckSchema,
      });
    },
    createSnapshot(
      planVersionId: string,
      input: ShoppingCreateRequest,
      options?: MutationOptions,
    ) {
      return mutation<ShoppingMutationAck>({
        body: ShoppingCreateRequestSchema.parse(input),
        options,
        path: `/v1/plans/${identifier(planVersionId)}/shopping`,
        schema: ShoppingMutationAckSchema,
      });
    },
    getCatalogPage(chain: SupermarketChain, limit = 50, cursor?: string) {
      const selectedChain = SUPERMARKET_CHAINS.find((value) => value === chain);
      if (!selectedChain || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("invalid_shopping_catalog_query");
      }
      const query = new URLSearchParams({ chain: selectedChain, limit: String(limit) });
      if (cursor) query.set("cursor", cursor);
      return request({
        method: "GET",
        path: `/v1/catalogs?${query.toString()}`,
        schema: ShoppingCatalogPageSchema,
      });
    },
    getPreference(profileId: string) {
      return request({
        method: "GET",
        path: `/v1/profiles/${identifier(profileId)}/shopping-preference`,
        schema: ShoppingPreferenceReadResponseSchema,
      });
    },
    getSnapshot(snapshotId: string) {
      return request({
        method: "GET",
        path: `/v1/shopping/${identifier(snapshotId)}`,
        schema: ShoppingSnapshotResponseSchema,
      });
    },
    putPreference(
      profileId: string,
      input: ShoppingPreferencePut,
      options?: MutationOptions,
    ) {
      return mutation({
        body: ShoppingPreferencePutSchema.parse(input),
        method: "PUT",
        options,
        path: `/v1/profiles/${identifier(profileId)}/shopping-preference`,
        schema: ShoppingPreferenceAckSchema,
      });
    },
    selectProduct(
      snapshotId: string,
      input: ShoppingProductSelectionRequest,
      options?: MutationOptions,
    ) {
      return mutation<ShoppingMutationAck>({
        body: ShoppingProductSelectionRequestSchema.parse(input),
        options,
        path: `/v1/shopping/${identifier(snapshotId)}/product-selection`,
        schema: ShoppingMutationAckSchema,
      });
    },
    setLeftover(
      snapshotId: string,
      input: Extract<ShoppingLeftoverRequest, { action: "set" }>,
      options?: MutationOptions,
    ) {
      return mutation<ShoppingMutationAck>({
        body: ShoppingLeftoverRequestSchema.parse(input),
        options,
        path: `/v1/shopping/${identifier(snapshotId)}/leftovers`,
        schema: ShoppingMutationAckSchema,
      });
    },
  };

  return {
    ...client,
    async discoverAvailableChains(): Promise<SupermarketChain[]> {
      const results = await Promise.all(
        SUPERMARKET_CHAINS.map(async (chain) => {
          try {
            await client.getCatalogPage(chain, 1);
            return chain;
          } catch (error) {
            if (
              error instanceof ShoppingApiError &&
              error.code === "CATALOG_NOT_PUBLISHED"
            ) {
              return null;
            }
            throw error;
          }
        }),
      );
      return results.filter((chain): chain is SupermarketChain => chain !== null);
    },
  };
}

async function accessToken(): Promise<string> {
  const { supabaseAuth } = await import("../../services/supabase");
  const { data, error } = await supabaseAuth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new ShoppingApiError(401, {}, null);
  return token;
}

export const shoppingClient = createShoppingClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalogs`,
  fetcher: fetch,
  getAccessToken: accessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
