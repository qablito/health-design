import {
  AdminImpersonationContextSchema,
  AdminProfileSummarySchema,
  type AdminImpersonationContext,
  type AdminProfileSummary,
} from "@health-design/contracts";

import { supabaseAuth } from "../../services/supabase";

type AdminErrorBody = {
  error?: {
    code?: string;
    message_key?: string;
    request_id?: string;
    retryable?: boolean;
  };
};

type Schema<T> = {
  safeParse(
    value: unknown,
  ): { data: T; success: true } | { error: unknown; success: false };
};

type AdminClientDependencies = {
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
};

export class AdminApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(status: number, body: AdminErrorBody) {
    const code = body.error?.code ?? "UNKNOWN_ERROR";
    super(body.error?.message_key ?? "admin.unknown_error");
    this.name = "AdminApiError";
    this.code = code;
    this.status = status;
    this.retryable = body.error?.retryable ?? false;
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

function validate<T>(schema: Schema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("invalid_admin_response");
  return parsed.data;
}

export function createAdminClient(dependencies: AdminClientDependencies) {
  async function request<T>(
    path: string,
    schema: Schema<T>,
    method: "GET" | "POST",
  ): Promise<T> {
    if (!path.startsWith("/v1/admin/") || path.includes("?") || path.includes("#")) {
      throw new Error("invalid_admin_path");
    }
    const accessToken = await dependencies.getAccessToken();
    const headers: Record<string, string> = {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-client-info": "health-design-web/admin-v1",
    };
    if (method === "POST") headers["idempotency-key"] = crypto.randomUUID();
    const fetcher = dependencies.fetcher;
    const response = await fetcher(`${dependencies.baseUrl}${path}`, {
      ...(method === "POST" ? { body: JSON.stringify({ schemaVersion: 1 }) } : {}),
      headers,
      method,
      referrerPolicy: "no-referrer",
    });
    const body = await parseJson(response);
    if (!response.ok) throw new AdminApiError(response.status, body ?? {});
    return validate(schema, body);
  }

  return {
    currentContext() {
      return request<AdminImpersonationContext>(
        "/v1/admin/context",
        AdminImpersonationContextSchema,
        "GET",
      );
    },
    endImpersonation(impersonationSessionId: string) {
      return request<AdminImpersonationContext>(
        `/v1/admin/impersonations/${impersonationSessionId}/end`,
        AdminImpersonationContextSchema,
        "POST",
      );
    },
    listProfiles() {
      return request<AdminProfileSummary[]>(
        "/v1/admin/profiles",
        AdminProfileSummarySchema.array(),
        "GET",
      );
    },
    startImpersonation(profileId: string) {
      return request<AdminImpersonationContext>(
        `/v1/admin/profiles/${profileId}/impersonations`,
        AdminImpersonationContextSchema,
        "POST",
      );
    },
  };
}

async function currentAccessToken(): Promise<string> {
  const { data, error } = await supabaseAuth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new AdminApiError(401, {});
  return accessToken;
}

export const adminClient = createAdminClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin`,
  fetcher: fetch,
  getAccessToken: currentAccessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

export type { AdminImpersonationContext, AdminProfileSummary };
