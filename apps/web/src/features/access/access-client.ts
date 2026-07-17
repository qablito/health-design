import {
  CodeLinkRequestSchema,
  DeviceLinkHandleSchema,
  DeviceSessionSummarySchema,
  InvitationRedeemRequestSchema,
  InvitationRedeemResponseSchema,
  PrivateCodeRotationResponseSchema,
  ProfileAccessSummarySchema,
  QrGrantResponseSchema,
  QrLinkRequestSchema,
  SessionRevokeResponseSchema,
  SessionTouchResponseSchema,
  type CodeLinkRequest,
  type DeviceLinkHandle,
  type DeviceSessionSummary,
  type InvitationRedeemRequest,
  type InvitationRedeemResponse,
  type PrivateCodeRotationResponse,
  type ProfileAccessSummary,
  type QrGrantResponse,
  type QrLinkRequest,
  type SessionRevokeResponse,
  type SessionTouchResponse,
} from "@health-design/contracts";

import { supabaseAuth } from "../../services/supabase";

type AccessErrorBody = {
  error?: {
    code?: string;
    message_key?: string;
    request_id?: string;
    retryable?: boolean;
  };
};

type AccessClientDependencies = {
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
};

type MutationOptions = {
  idempotencyKey?: string;
};

type Schema<T> = {
  safeParse(
    value: unknown,
  ): { data: T; success: true } | { error: unknown; success: false };
};

export class AccessApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly retryable: boolean;
  readonly status: number;

  constructor(status: number, body: AccessErrorBody, retryAfter: string | null) {
    const code = body.error?.code ?? "UNKNOWN_ERROR";
    super(body.error?.message_key ?? "access.unknown_error");
    this.name = "AccessApiError";
    this.code = code;
    this.status = status;
    this.retryable = body.error?.retryable ?? false;
    if (body.error?.request_id) this.requestId = body.error.request_id;
    const parsedRetry = retryAfter === null ? Number.NaN : Number(retryAfter);
    if (Number.isFinite(parsedRetry)) this.retryAfterSeconds = parsedRetry;
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
  if (!parsed.success) throw new Error("invalid_access_response");
  return parsed.data;
}

export function createAccessClient(dependencies: AccessClientDependencies) {
  async function request<T>(
    path: string,
    schema: Schema<T>,
    method: "GET" | "POST",
    payload?: unknown,
    options: MutationOptions = {},
  ): Promise<T> {
    if (!path.startsWith("/v1/") || path.includes("?") || path.includes("#")) {
      throw new Error("invalid_access_path");
    }
    const accessToken = await dependencies.getAccessToken();
    const headers: Record<string, string> = {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-client-info": "health-design-web/access-v1",
    };
    if (method === "POST") {
      headers["idempotency-key"] = options.idempotencyKey ?? crypto.randomUUID();
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
      throw new AccessApiError(
        response.status,
        body ?? {},
        response.headers.get("retry-after"),
      );
    }
    return validate(schema, body);
  }

  return {
    createQrGrant(profileId: string, options?: MutationOptions) {
      return request<QrGrantResponse>(
        `/v1/profiles/${profileId}/device-links/qr`,
        QrGrantResponseSchema,
        "POST",
        { schemaVersion: 1 },
        options,
      );
    },
    linkWithPrivateCode(input: CodeLinkRequest, options?: MutationOptions) {
      return request<DeviceLinkHandle>(
        "/v1/device-links/code/consume",
        DeviceLinkHandleSchema,
        "POST",
        CodeLinkRequestSchema.parse(input),
        options,
      );
    },
    linkWithQr(input: QrLinkRequest, options?: MutationOptions) {
      return request<DeviceLinkHandle>(
        "/v1/device-links/qr/consume",
        DeviceLinkHandleSchema,
        "POST",
        QrLinkRequestSchema.parse(input),
        options,
      );
    },
    listProfiles() {
      return request<ProfileAccessSummary[]>(
        "/v1/me/profiles",
        ProfileAccessSummarySchema.array(),
        "GET",
      );
    },
    listSessions(profileId: string) {
      return request<DeviceSessionSummary[]>(
        `/v1/profiles/${profileId}/sessions`,
        DeviceSessionSummarySchema.array(),
        "GET",
      );
    },
    redeemInvitation(input: InvitationRedeemRequest, options?: MutationOptions) {
      return request<InvitationRedeemResponse>(
        "/v1/invitations/redeem",
        InvitationRedeemResponseSchema,
        "POST",
        InvitationRedeemRequestSchema.parse(input),
        options,
      );
    },
    revokeSession(
      profileId: string,
      deviceSessionId: string,
      options?: MutationOptions,
    ) {
      return request<SessionRevokeResponse>(
        `/v1/profiles/${profileId}/sessions/${deviceSessionId}/revoke`,
        SessionRevokeResponseSchema,
        "POST",
        { schemaVersion: 1 },
        options,
      );
    },
    rotatePrivateCode(
      profileId: string,
      revokeOtherAccess: boolean,
      options?: MutationOptions,
    ) {
      return request<PrivateCodeRotationResponse>(
        `/v1/profiles/${profileId}/private-code/rotate`,
        PrivateCodeRotationResponseSchema,
        "POST",
        { revokeOtherAccess, schemaVersion: 1 },
        options,
      );
    },
    touchSession(options?: MutationOptions) {
      return request<SessionTouchResponse>(
        "/v1/me/session/touch",
        SessionTouchResponseSchema,
        "POST",
        { schemaVersion: 1 },
        options,
      );
    },
  };
}

async function currentAccessToken(): Promise<string> {
  const { data, error } = await supabaseAuth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) {
    throw new AccessApiError(
      401,
      {
        error: {
          code: "UNAUTHENTICATED",
          message_key: "common.unauthenticated",
          retryable: false,
        },
      },
      null,
    );
  }
  return accessToken;
}

export async function clearLocalIdentity(): Promise<void> {
  await supabaseAuth.signOut({ scope: "local" });
}

export async function ensureAnonymousIdentity(
  getCaptchaToken: () => Promise<string>,
): Promise<void> {
  const { data: existing } = await supabaseAuth.getSession();
  if (existing.session) return;
  const captchaToken = await getCaptchaToken();
  const { error } = await supabaseAuth.signInAnonymously({
    options: { captchaToken },
  });
  if (error) throw new AccessApiError(401, {}, null);
}

export const accessClient = createAccessClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/access`,
  fetcher: fetch,
  getAccessToken: currentAccessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

export type {
  DeviceLinkHandle,
  DeviceSessionSummary,
  InvitationRedeemResponse,
  PrivateCodeRotationResponse,
  ProfileAccessSummary,
  QrGrantResponse,
  SessionRevokeResponse,
  SessionTouchResponse,
};
