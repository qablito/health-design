import {
  FollowUpCreateRequestSchema,
  FollowUpHistorySchema,
  FollowUpMutationAckSchema,
  LabBatchCreateRequestSchema,
  LabHistorySchema,
  LabMutationAckSchema,
  PlanCandidateAckSchema,
  PlanMutationRequestSchema,
  type FollowUpCreateRequest,
  type LabObservationInput,
  type PlanCandidateAck,
} from "@health-design/contracts";

type Dependencies = {
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
};

type ErrorBody = {
  error?: {
    code?: string;
    message_key?: string;
    request_id?: string;
  };
};

export class FollowUpApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status: number;

  constructor(status: number, body: ErrorBody) {
    super(body.error?.message_key ?? "follow_up.unknown_error");
    this.name = "FollowUpApiError";
    this.code = body.error?.code ?? "UNKNOWN_ERROR";
    this.status = status;
    if (body.error?.request_id) this.requestId = body.error.request_id;
  }
}

async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export function createFollowUpClient(dependencies: Dependencies) {
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
      throw new Error("invalid_follow_up_path");
    }
    const token = await dependencies.getAccessToken();
    const headers: Record<string, string> = {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${token}`,
      "x-client-info": "health-design-web/follow-up-v1",
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
    if (!response.ok) throw new FollowUpApiError(response.status, value ?? {});
    return input.parse(value);
  }

  function candidateAction(
    candidateId: string,
    expectedVersion: number,
    action: "activate" | "discard",
  ): Promise<PlanCandidateAck> {
    const body = PlanMutationRequestSchema.parse({
      expectedVersion,
      schemaVersion: 1,
    });
    return request({
      body,
      expectedVersion,
      method: "POST",
      parse: (value) => PlanCandidateAckSchema.parse(value),
      path: `/v1/candidates/${candidateId}/${action}`,
    });
  }

  return {
    activateCandidate(candidateId: string, expectedVersion: number) {
      return candidateAction(candidateId, expectedVersion, "activate");
    },
    createFollowUp(profileId: string, input: FollowUpCreateRequest) {
      const body = FollowUpCreateRequestSchema.parse(input);
      return request({
        body,
        method: "POST",
        parse: (value) => FollowUpMutationAckSchema.parse(value),
        path: `/v1/profiles/${profileId}/follow-ups`,
      });
    },
    createLabs(
      profileId: string,
      basePlanVersionId: string,
      observations: readonly LabObservationInput[],
      requestRecalculation = false,
    ) {
      const body = LabBatchCreateRequestSchema.parse({
        basePlanVersionId,
        observations: [...observations],
        requestRecalculation,
        schemaVersion: 1,
      });
      return request({
        body,
        method: "POST",
        parse: (value) => LabMutationAckSchema.parse(value),
        path: `/v1/profiles/${profileId}/labs`,
      });
    },
    discardCandidate(candidateId: string, expectedVersion: number) {
      return candidateAction(candidateId, expectedVersion, "discard");
    },
    getFollowUps(profileId: string) {
      return request({
        method: "GET",
        parse: (value) => FollowUpHistorySchema.parse(value),
        path: `/v1/profiles/${profileId}/follow-ups`,
      });
    },
    getLabs(profileId: string) {
      return request({
        method: "GET",
        parse: (value) => LabHistorySchema.parse(value),
        path: `/v1/profiles/${profileId}/labs`,
      });
    },
  };
}

async function accessToken(): Promise<string> {
  const { supabaseAuth } = await import("../../services/supabase");
  const { data, error } = await supabaseAuth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new FollowUpApiError(401, {});
  return token;
}

export const followUpClient = createFollowUpClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plans`,
  fetcher: fetch,
  getAccessToken: accessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
