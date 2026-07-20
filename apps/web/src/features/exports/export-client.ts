import {
  ExportArtifactAckSchema,
  ExportCreateRequestSchema,
  type ExportArtifactAck,
  type ExportCreateRequestContract,
} from "@health-design/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ExportFormat = ExportArtifactAck["format"];

type Dependencies = Readonly<{
  baseUrl: string;
  createObjectURL(blob: Blob): string;
  fetcher: typeof fetch;
  getAccessToken(): Promise<string>;
  publishableKey: string;
  revokeObjectURL(url: string): void;
  triggerDownload(url: string, filename: string): void;
}>;

type ErrorBody = Readonly<{
  error?: Readonly<{
    code?: string;
    message_key?: string;
    request_id?: string;
  }>;
}>;

export class ExportApiError extends Error {
  readonly code: string;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(status: number, body: ErrorBody) {
    super(body.error?.message_key ?? "export.unknown_error");
    this.name = "ExportApiError";
    this.code = body.error?.code ?? "UNKNOWN_ERROR";
    this.requestId = body.error?.request_id;
    this.status = status;
  }
}

function assertIdentifier(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error("invalid_export_identifier");
}

function errorBody(value: unknown): ErrorBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const error = (value as Record<string, unknown>)["error"];
  if (!error || typeof error !== "object" || Array.isArray(error)) return {};
  const record = error as Record<string, unknown>;
  const text = (name: string) =>
    typeof record[name] === "string" ? record[name] : undefined;
  const code = text("code");
  const messageKey = text("message_key");
  const requestId = text("request_id");
  return {
    error: {
      ...(code ? { code } : {}),
      ...(messageKey ? { message_key: messageKey } : {}),
      ...(requestId ? { request_id: requestId } : {}),
    },
  };
}

function expectedMime(format: ExportFormat): string {
  return format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export function createExportClient(dependencies: Dependencies) {
  const baseUrl = dependencies.baseUrl.replace(/\/$/, "");

  async function headers(): Promise<Record<string, string>> {
    const token = await dependencies.getAccessToken();
    return {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${token}`,
      "x-client-info": "health-design-web/exports-v1",
    };
  }

  return {
    async create(
      planVersionId: string,
      input: ExportCreateRequestContract,
    ): Promise<ExportArtifactAck> {
      assertIdentifier(planVersionId);
      const body = ExportCreateRequestSchema.parse(input);
      const response = await dependencies.fetcher(
        `${baseUrl}/v1/plans/${planVersionId}/exports`,
        {
          body: JSON.stringify(body),
          headers: {
            ...(await headers()),
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          method: "POST",
          redirect: "error",
          referrerPolicy: "no-referrer",
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ExportApiError(response.status, errorBody(value));
      return ExportArtifactAckSchema.parse(value);
    },

    async download(artifactId: string, format: ExportFormat): Promise<void> {
      assertIdentifier(artifactId);
      const response = await dependencies.fetcher(
        `${baseUrl}/v1/exports/${artifactId}/content`,
        {
          headers: await headers(),
          method: "GET",
          redirect: "error",
          referrerPolicy: "no-referrer",
        },
      );
      if (
        response.redirected ||
        response.headers.has("location") ||
        (response.status >= 300 && response.status < 400)
      ) {
        throw new Error("export_redirect_rejected");
      }
      if (!response.ok) {
        const value: unknown = await response.json().catch(() => null);
        throw new ExportApiError(response.status, errorBody(value));
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0];
      if (contentType !== expectedMime(format)) {
        throw new Error("export_content_type_mismatch");
      }
      const blob = await response.blob();
      const url = dependencies.createObjectURL(blob);
      try {
        dependencies.triggerDownload(url, `plan-${artifactId}.${format}`);
      } finally {
        dependencies.revokeObjectURL(url);
      }
    },
  };
}

async function accessToken(): Promise<string> {
  const { supabaseAuth } = await import("../../services/supabase");
  const { data, error } = await supabaseAuth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new ExportApiError(401, {});
  return token;
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export const exportClient = createExportClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exports`,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  fetcher: (input, init) => fetch(input, init),
  getAccessToken: accessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  triggerDownload,
});
