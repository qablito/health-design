import {
  QuestionnaireDraftAckSchema,
  QuestionnaireDraftSaveRequestSchema,
  QuestionnaireDraftSchema,
  QuestionnaireDraftSubmitRequestSchema,
  QuestionnairePublicSchemaResponseSchema,
  type QuestionnaireDraft,
  type QuestionnaireDraftAck,
  type QuestionnaireDraftSaveRequest,
  type QuestionnaireDraftSubmitRequest,
} from "@health-design/contracts";

type Dependencies = {
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
};

type MutationOptions = { idempotencyKey?: string };
type ErrorBody = {
  error?: { code?: string; message_key?: string; request_id?: string };
};
type Schema<T> = {
  safeParse(value: unknown): { data: T; success: true } | { success: false };
};

export class QuestionnaireApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status: number;

  constructor(status: number, body: ErrorBody) {
    super(body.error?.message_key ?? "questionnaire.unknown_error");
    this.name = "QuestionnaireApiError";
    this.code = body.error?.code ?? "UNKNOWN_ERROR";
    this.status = status;
    if (body.error?.request_id) this.requestId = body.error.request_id;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createQuestionnaireClient(dependencies: Dependencies) {
  async function request<T>(
    path: string,
    schema: Schema<T>,
    method: "GET" | "POST" | "PUT",
    payload?: { expectedVersion?: number } & Record<string, unknown>,
    options: MutationOptions = {},
  ): Promise<T> {
    if (!path.startsWith("/v1/") || path.includes("?") || path.includes("#")) {
      throw new Error("invalid_questionnaire_path");
    }
    const accessToken = await dependencies.getAccessToken();
    const headers: Record<string, string> = {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${accessToken}`,
      "x-client-info": "health-design-web/questionnaire-v1",
    };
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      headers["idempotency-key"] = options.idempotencyKey ?? crypto.randomUUID();
      if (payload?.expectedVersion !== undefined) {
        headers["if-match"] = `"${payload.expectedVersion}"`;
      }
    }
    const fetcher = dependencies.fetcher;
    const response = await fetcher(`${dependencies.baseUrl}${path}`, {
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      headers,
      method,
      referrerPolicy: "no-referrer",
    });
    const body = await parseJson(response);
    if (!response.ok) {
      throw new QuestionnaireApiError(response.status, body ?? {});
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new Error("invalid_questionnaire_response");
    return parsed.data;
  }

  return {
    getDraft(profileId: string) {
      return request<QuestionnaireDraft | null>(
        `/v1/profiles/${profileId}/draft`,
        QuestionnaireDraftSchema.nullable(),
        "GET",
      );
    },
    getSchema() {
      return request(
        "/v1/questionnaire/schema",
        QuestionnairePublicSchemaResponseSchema,
        "GET",
      );
    },
    saveDraft(
      profileId: string,
      input: QuestionnaireDraftSaveRequest,
      options?: MutationOptions,
    ) {
      const payload = QuestionnaireDraftSaveRequestSchema.parse(input);
      return request<QuestionnaireDraftAck>(
        `/v1/profiles/${profileId}/draft`,
        QuestionnaireDraftAckSchema,
        "PUT",
        payload,
        options,
      );
    },
    submitDraft(
      profileId: string,
      input: QuestionnaireDraftSubmitRequest,
      options?: MutationOptions,
    ) {
      const payload = QuestionnaireDraftSubmitRequestSchema.parse(input);
      return request<QuestionnaireDraftAck>(
        `/v1/profiles/${profileId}/draft/submit`,
        QuestionnaireDraftAckSchema,
        "POST",
        payload,
        options,
      );
    },
  };
}

async function accessToken(): Promise<string> {
  const { supabaseAuth } = await import("../../services/supabase");
  const { data, error } = await supabaseAuth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new QuestionnaireApiError(401, {});
  return token;
}

export const questionnaireClient = createQuestionnaireClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plans`,
  fetcher: fetch,
  getAccessToken: accessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
