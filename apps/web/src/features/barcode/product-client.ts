import {
  PlanCandidateAckSchema,
  ProductApplicationRequestSchema,
  ProductConfirmationAckSchema,
  ProductConfirmationRequestSchema,
  ProductGtinSchema,
  ProductResolutionResponseSchema,
  type PlanCandidateAck,
  type ProductApplicationRequest,
  type ProductConfirmationAck,
  type ProductConfirmationRequest,
  type ProductGtin,
  type ProductResolutionResponse,
} from "@health-design/contracts";

type ProductClientDependencies = Readonly<{
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
}>;

type ErrorBody = Readonly<{
  error?: Readonly<{
    code?: string;
    message_key?: string;
    request_id?: string;
    retryable?: boolean;
  }>;
}>;

type Schema<T> = Readonly<{
  safeParse(
    value: unknown,
  ): { data: T; success: true } | { error: unknown; success: false };
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FOOD_KEY_PATTERN = /^food:[a-z0-9][a-z0-9._:-]{0,127}$/;

export class ProductApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(status: number, body: ErrorBody) {
    super(body.error?.message_key ?? "commercial_products.unknown_error");
    this.name = "ProductApiError";
    this.code = body.error?.code ?? "UNKNOWN_ERROR";
    this.retryable = body.error?.retryable ?? false;
    this.status = status;
    if (body.error?.request_id) this.requestId = body.error.request_id;
  }
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error("invalid_product_identifier");
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorBody(value: unknown): ErrorBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return {};
  return { error };
}

function parse<T>(schema: Schema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("invalid_product_response");
  return parsed.data;
}

export function createProductClient(dependencies: ProductClientDependencies) {
  async function request<T>(
    input: Readonly<{
      body?: unknown;
      expectedVersion?: number;
      method: "GET" | "POST";
      parse(value: unknown): T;
      path: string;
    }>,
  ): Promise<T> {
    if (!input.path.startsWith("/") || input.path.includes("#")) {
      throw new Error("invalid_product_path");
    }
    const token = await dependencies.getAccessToken();
    const headers: Record<string, string> = {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${token}`,
      "x-client-info": "health-design-web/products-v1",
    };
    if (input.method === "POST") {
      headers["content-type"] = "application/json";
      headers["idempotency-key"] = crypto.randomUUID();
      if (input.expectedVersion !== undefined) {
        headers["if-match"] = `"${input.expectedVersion}"`;
      }
    }
    const fetcher = dependencies.fetcher;
    const response = await fetcher(`${dependencies.baseUrl}${input.path}`, {
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      headers,
      method: input.method,
      referrerPolicy: "no-referrer",
    });
    const value = await json(response);
    if (!response.ok) throw new ProductApiError(response.status, errorBody(value));
    return input.parse(value);
  }

  return {
    apply(planId: string, input: ProductApplicationRequest): Promise<PlanCandidateAck> {
      requireUuid(planId);
      const body = ProductApplicationRequestSchema.parse(input);
      return request({
        body,
        expectedVersion: body.expectedVersion,
        method: "POST",
        parse: (value) => parse(PlanCandidateAckSchema, value),
        path: `/plans/v1/plans/${planId}/product-applications`,
      });
    },
    confirm(
      profileId: string,
      gtinInput: ProductGtin,
      input: ProductConfirmationRequest,
    ): Promise<ProductConfirmationAck> {
      requireUuid(profileId);
      const gtin = ProductGtinSchema.parse(gtinInput);
      const body = ProductConfirmationRequestSchema.parse(input);
      const query = new URLSearchParams({ symbology: gtin.symbology });
      return request({
        body,
        method: "POST",
        parse: (value) => parse(ProductConfirmationAckSchema, value),
        path: `/catalogs/v1/profiles/${profileId}/products/barcode/${gtin.displayGtin}/confirm?${query.toString()}`,
      });
    },
    resolve(
      profileId: string,
      gtinInput: ProductGtin,
      canonicalFoodKey: string,
    ): Promise<ProductResolutionResponse> {
      requireUuid(profileId);
      if (!FOOD_KEY_PATTERN.test(canonicalFoodKey)) {
        throw new Error("invalid_canonical_food_key");
      }
      const gtin = ProductGtinSchema.parse(gtinInput);
      const query = new URLSearchParams({
        symbology: gtin.symbology,
        canonicalFoodKey,
      });
      return request({
        method: "GET",
        parse: (value) => parse(ProductResolutionResponseSchema, value),
        path: `/catalogs/v1/profiles/${profileId}/products/barcode/${gtin.displayGtin}?${query.toString()}`,
      });
    },
  };
}

async function accessToken(): Promise<string> {
  const { supabaseAuth } = await import("../../services/supabase");
  const { data, error } = await supabaseAuth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new ProductApiError(401, {});
  return token;
}

export const productClient = createProductClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`,
  fetcher: fetch,
  getAccessToken: accessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
