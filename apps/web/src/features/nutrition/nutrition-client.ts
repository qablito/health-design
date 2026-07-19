import {
  ContextSnapshotAckSchema,
  ContextSnapshotCreateRequestSchema,
  PlanGenerationRequestSchema,
  PlanMutationAckSchema,
  PlanMutationRequestSchema,
  PlanVersionDetailSchema,
  type ContextSnapshotAck,
  type PlanMutationAck,
  type PlanVersionDetail,
} from "@health-design/contracts";

type Dependencies = {
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
};

type ErrorBody = {
  error?: {
    code?: string | undefined;
    message_key?: string | undefined;
    request_id?: string | undefined;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorBody(value: unknown): ErrorBody {
  if (!isRecord(value)) return {};
  const error = value["error"];
  if (!isRecord(error)) return {};
  const field = (key: "code" | "message_key" | "request_id") => {
    const candidate = error[key];
    return typeof candidate === "string" ? candidate : undefined;
  };
  return {
    error: {
      code: field("code"),
      message_key: field("message_key"),
      request_id: field("request_id"),
    },
  };
}

export class NutritionPlanApiError extends Error {
  readonly code: string;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(status: number, body: ErrorBody) {
    super(body.error?.message_key ?? "nutrition_plan.unknown_error");
    this.name = "NutritionPlanApiError";
    this.code = body.error?.code ?? "UNKNOWN_ERROR";
    this.status = status;
    this.requestId = body.error?.request_id;
  }
}

async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export function createNutritionPlanClient(dependencies: Dependencies) {
  async function request<T>(input: {
    body?: unknown;
    expectedVersion?: number;
    method: "GET" | "POST";
    parse(value: unknown): T;
    path: string;
  }): Promise<T> {
    if (
      !input.path.startsWith("/v1/") ||
      input.path.includes("?") ||
      input.path.includes("#")
    ) {
      throw new Error("invalid_nutrition_plan_path");
    }
    const token = await dependencies.getAccessToken();
    const headers: Record<string, string> = {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${token}`,
      "x-client-info": "health-design-web/nutrition-v1",
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
    if (!response.ok) {
      throw new NutritionPlanApiError(response.status, errorBody(value));
    }
    return input.parse(value);
  }

  return {
    activateVersion(
      planId: string,
      versionId: string,
      expectedVersion: number,
    ): Promise<PlanMutationAck> {
      const body = PlanMutationRequestSchema.parse({
        expectedVersion,
        schemaVersion: 1,
      });
      return request({
        body,
        expectedVersion,
        method: "POST",
        parse: (value) => PlanMutationAckSchema.parse(value),
        path: `/v1/plans/${planId}/versions/${versionId}/activate`,
      });
    },
    createContext(
      profileId: string,
      expectedDraftVersion: number,
    ): Promise<ContextSnapshotAck> {
      const body = ContextSnapshotCreateRequestSchema.parse({
        expectedDraftVersion,
        schemaVersion: 1,
      });
      return request({
        body,
        expectedVersion: expectedDraftVersion,
        method: "POST",
        parse: (value) => ContextSnapshotAckSchema.parse(value),
        path: `/v1/profiles/${profileId}/contexts/snapshot`,
      });
    },
    generate(profileId: string, contextSnapshotId: string): Promise<PlanMutationAck> {
      const body = PlanGenerationRequestSchema.parse({
        contextSnapshotId,
        schemaVersion: 1,
      });
      return request({
        body,
        method: "POST",
        parse: (value) => PlanMutationAckSchema.parse(value),
        path: `/v1/profiles/${profileId}/plans/generate`,
      });
    },
    getVersion(planId: string, versionId: string): Promise<PlanVersionDetail> {
      return request({
        method: "GET",
        parse: (value) => PlanVersionDetailSchema.parse(value),
        path: `/v1/plans/${planId}/versions/${versionId}`,
      });
    },
  };
}

async function accessToken(): Promise<string> {
  const { supabaseAuth } = await import("../../services/supabase");
  const { data, error } = await supabaseAuth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new NutritionPlanApiError(401, {});
  return token;
}

export const nutritionPlanClient = createNutritionPlanClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plans`,
  fetcher: fetch,
  getAccessToken: accessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
