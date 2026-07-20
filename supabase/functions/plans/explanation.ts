import {
  AIExplanationInputSchema,
  AIExplanationRequestSchema,
  AIExplanationResponseSchema,
  resolveAIExplanation,
  type AIExplanationInput,
} from "@health-design/contracts";

import { canonicalJson, hashSha256Hex } from "../_shared/access-security.ts";
import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MODULES = [
  "nutrition",
  "training",
  "hydration",
  "sleep",
  "mobility",
  "supplements",
] as const;
type Module = (typeof MODULES)[number];
type AuthContext = { sessionId: string; userId: string };
type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

type ProviderConfig = Readonly<{
  maxInputTokens: number;
  maxOutputTokens: number;
  model: "gpt-5.6-luna";
  reasoningEffort: "none";
  timeoutMs: 8000;
}>;

type ProviderResult = Readonly<{
  inputTokens: number;
  output: unknown;
  outputTokens: number;
}>;

export interface AIExplanationDependencies {
  authenticate(token: string): Promise<AuthContext>;
  callProvider(
    input: AIExplanationInput,
    config: ProviderConfig,
  ): Promise<ProviderResult>;
  environment: EdgeEnvironment;
  randomUUID(): string;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}

export class AIProviderCallError extends Error {
  constructor(
    message: string,
    readonly costUncertain: boolean,
  ) {
    super(message);
    this.name = "AIProviderCallError";
  }
}

type ExplanationContext = Readonly<{
  completeness: "complete" | "provisional";
  modules: readonly Readonly<{
    confidence: "high" | "medium" | "low" | "unknown";
    module: Module;
    status: "valid" | "provisional" | "invalid" | "not_requested";
    uncertaintyCount: number;
  }>[];
  outputHash: string;
  planVersionId: string;
  profileId: string;
}>;

const COPY: Record<Module, Readonly<{ label: string; valid: string }>> = {
  hydration: {
    label: "La hidratación",
    valid: "La pauta de hidratación está validada para el contexto registrado.",
  },
  mobility: {
    label: "La movilidad",
    valid: "La pauta de movilidad está validada para el contexto registrado.",
  },
  nutrition: {
    label: "La alimentación",
    valid: "La alimentación está validada para el contexto registrado.",
  },
  sleep: {
    label: "El descanso",
    valid: "La pauta de descanso está validada para el contexto registrado.",
  },
  supplements: {
    label: "La suplementación",
    valid: "La sección de suplementación está validada para el contexto registrado.",
  },
  training: {
    label: "El entrenamiento",
    valid: "El entrenamiento está validado para el contexto registrado.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseContext(value: unknown): ExplanationContext {
  if (!isRecord(value) || !Array.isArray(value.modules)) {
    throw new Error("invalid_explanation_context");
  }
  const completeness = value.completeness;
  const outputHash = value.outputHash;
  const planVersionId = value.planVersionId;
  const profileId = value.profileId;
  if (
    (completeness !== "complete" && completeness !== "provisional") ||
    typeof outputHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(outputHash) ||
    typeof planVersionId !== "string" ||
    typeof profileId !== "string"
  ) {
    throw new Error("invalid_explanation_context");
  }
  const modules = value.modules.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("invalid_explanation_context");
    const module = candidate.module;
    const status = candidate.status;
    const confidence = candidate.confidence;
    const uncertaintyCount = candidate.uncertaintyCount;
    if (
      typeof module !== "string" ||
      !MODULES.includes(module as Module) ||
      typeof status !== "string" ||
      !["valid", "provisional", "invalid", "not_requested"].includes(status) ||
      typeof confidence !== "string" ||
      !["high", "medium", "low", "unknown"].includes(confidence) ||
      !Number.isInteger(uncertaintyCount) ||
      (uncertaintyCount as number) < 0
    ) {
      throw new Error("invalid_explanation_context");
    }
    return {
      confidence: confidence as ExplanationContext["modules"][number]["confidence"],
      module: module as Module,
      status: status as ExplanationContext["modules"][number]["status"],
      uncertaintyCount: uncertaintyCount as number,
    };
  });
  return { completeness, modules, outputHash, planVersionId, profileId };
}

export function buildAIExplanationInput(
  context: ExplanationContext,
): AIExplanationInput {
  const slots: AIExplanationInput["slots"] = [
    {
      messageKey: `ai.explanation.summary.${context.completeness}`,
      signal: `plan_${context.completeness}`,
      slot: "summary",
      variants:
        context.completeness === "complete"
          ? [
              {
                id: "clear",
                text: "Tu plan está completo y ha superado la validación interna.",
              },
              {
                id: "calm",
                text: "Esta versión está completa y validada para el contexto registrado.",
              },
            ]
          : [
              {
                id: "clear",
                text: "Tu plan es provisional porque todavía contiene incertidumbres visibles.",
              },
              {
                id: "calm",
                text: "Puedes usar esta versión provisional teniendo en cuenta sus incertidumbres.",
              },
            ],
    },
  ];
  for (const item of context.modules) {
    if (item.status === "not_requested") continue;
    const copy = COPY[item.module];
    const provisional = `${copy.label} se mantiene provisional y conserva sus incertidumbres visibles.`;
    const invalid = `${copy.label} necesita revisión antes de considerarse validada.`;
    const text =
      item.status === "valid"
        ? copy.valid
        : item.status === "invalid"
          ? invalid
          : provisional;
    slots.push({
      messageKey: `ai.explanation.${item.module}.${item.status}`,
      signal: `${item.module}_${item.status}`,
      slot: item.module,
      variants: [
        { id: "direct", text },
        {
          id: "calm",
          text:
            item.status === "valid"
              ? `${copy.label} está lista dentro de esta versión del plan.`
              : text,
        },
      ],
    });
  }
  return AIExplanationInputSchema.parse({
    locale: "es-ES",
    planOutputHash: context.outputHash,
    planVersionId: context.planVersionId,
    schemaVersion: 1,
    slots,
  });
}

function headers(cors: Record<string, string>): Record<string, string> {
  return {
    "cache-control": "no-store, private",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...cors,
  };
}

function response(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { headers: headers(cors), status });
}

function token(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new Error("unauthenticated");
  return match[1];
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(value)) throw new Error("invalid_input");
  return value;
}

async function rpc(
  dependencies: AIExplanationDependencies,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await dependencies.rpc(name, args);
  if (result.error) throw new Error(result.error.message ?? "dependency_unavailable");
  return result.data;
}

function reservation(value: unknown) {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error("invalid_reservation");
  }
  return value;
}

async function parseBody(request: Request): Promise<void> {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    throw new Error("invalid_input");
  }
  const text = await request.text();
  if (text.length > 1024) throw new Error("invalid_input");
  AIExplanationRequestSchema.parse(JSON.parse(text) as unknown);
}

export async function handleAIExplanation(
  request: Request,
  dependencies: AIExplanationDependencies,
): Promise<Response> {
  const requestId = dependencies.randomUUID();
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed)
    return response({ error: { code: "FORBIDDEN", requestId } }, 403, cors.headers);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...cors.headers,
        "access-control-allow-headers":
          "authorization, apikey, content-type, idempotency-key, x-client-info",
        "access-control-allow-methods": "POST, OPTIONS",
        "cache-control": "no-store, private",
      },
      status: 204,
    });
  }
  try {
    const path = new URL(request.url).pathname;
    const versionIndex = path.lastIndexOf("/v1/");
    const match = new RegExp(`^/v1/plans/(${UUID_PATTERN})/explanation$`, "i").exec(
      versionIndex < 0 ? "" : path.slice(versionIndex),
    );
    if (request.method !== "POST" || !match?.[1]) throw new Error("not_found");
    await parseBody(request);
    const auth = await dependencies.authenticate(token(request));
    const authArgs = {
      p_auth_session_id: auth.sessionId,
      p_auth_subject: auth.userId,
    };
    const context = parseContext(
      await rpc(dependencies, "internal_ai_get_explanation_context", {
        ...authArgs,
        p_plan_version_id: match[1],
      }),
    );
    const input = buildAIExplanationInput(context);
    const fallback = resolveAIExplanation(input, null);
    const keyDigest = `\\x${await hashSha256Hex(idempotencyKey(request))}`;
    const reserved = reservation(
      await rpc(dependencies, "internal_ai_reserve_explanation", {
        ...authArgs,
        p_idempotency_key_digest: keyDigest,
        p_plan_version_id: context.planVersionId,
        p_profile_id: context.profileId,
        p_request_id: requestId,
      }),
    );
    if (reserved.status !== "reserved") return response(fallback, 200, cors.headers);
    const eventId = reserved.eventId;
    if (
      typeof eventId !== "string" ||
      reserved.model !== "gpt-5.6-luna" ||
      reserved.reasoningEffort !== "none" ||
      reserved.timeoutMs !== 8000 ||
      !Number.isInteger(reserved.maxInputTokens) ||
      !Number.isInteger(reserved.maxOutputTokens)
    ) {
      throw new Error("invalid_reservation");
    }

    let provider: ProviderResult;
    try {
      provider = await dependencies.callProvider(input, {
        maxInputTokens: reserved.maxInputTokens as number,
        maxOutputTokens: reserved.maxOutputTokens as number,
        model: "gpt-5.6-luna",
        reasoningEffort: "none",
        timeoutMs: 8000,
      });
    } catch (error) {
      await rpc(
        dependencies,
        error instanceof AIProviderCallError && error.costUncertain
          ? "internal_ai_mark_pending"
          : "internal_ai_release_usage",
        { p_event_id: eventId, p_request_id: requestId },
      ).catch(() => undefined);
      return response(fallback, 200, cors.headers);
    }

    const settled = reservation(
      await rpc(dependencies, "internal_ai_settle_usage", {
        p_event_id: eventId,
        p_input_tokens: provider.inputTokens,
        p_output_tokens: provider.outputTokens,
        p_request_id: requestId,
      }),
    );
    if (settled.status !== "settled") return response(fallback, 200, cors.headers);
    const explanation = resolveAIExplanation(input, provider.output);
    await rpc(dependencies, "internal_ai_store_explanation", {
      p_event_id: eventId,
      p_input_manifest_hash: `\\x${await hashSha256Hex(canonicalJson(input))}`,
      p_output_segments: explanation.segments,
      p_request_id: requestId,
    });
    return response(AIExplanationResponseSchema.parse(explanation), 200, cors.headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    const status = message.includes("unauthenticated")
      ? 401
      : message.includes("not_found")
        ? 404
        : message.includes("invalid")
          ? 422
          : 503;
    return response(
      { error: { code: message.toUpperCase(), request_id: requestId } },
      status,
      cors.headers,
    );
  }
}

export async function handleAIProviderAdmin(
  request: Request,
  dependencies: AIExplanationDependencies,
): Promise<Response> {
  const requestId = request.headers.get("idempotency-key") ?? "";
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed)
    return response({ error: { code: "FORBIDDEN" } }, 403, cors.headers);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...cors.headers,
        "access-control-allow-headers":
          "authorization, apikey, content-type, idempotency-key, x-client-info",
        "access-control-allow-methods": "POST, OPTIONS",
        "cache-control": "no-store, private",
      },
      status: 204,
    });
  }
  try {
    const path = new URL(request.url).pathname;
    const versionIndex = path.lastIndexOf("/v1/");
    const match = new RegExp(
      `^/v1/admin/ai-provider-revisions/(${UUID_PATTERN})/activate$`,
      "i",
    ).exec(versionIndex < 0 ? "" : path.slice(versionIndex));
    if (request.method !== "POST" || !match?.[1]) throw new Error("not_found");
    if (!new RegExp(`^${UUID_PATTERN}$`, "i").test(requestId)) {
      throw new Error("invalid_input");
    }
    await parseBody(request);
    const auth = await dependencies.authenticate(token(request));
    const result = await dependencies.rpc(
      "internal_admin_activate_ai_provider_revision_requested",
      {
        p_auth_session_id: auth.sessionId,
        p_auth_subject: auth.userId,
        p_request_id: requestId,
        p_revision_id: match[1],
      },
    );
    if (result.error) {
      if (result.error.message?.includes("aal2_required")) {
        return response(
          { error: { code: "AAL2_REQUIRED", request_id: requestId } },
          403,
          cors.headers,
        );
      }
      throw new Error(result.error.message ?? "dependency_unavailable");
    }
    return response(result.data, 200, cors.headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    const status = message.includes("unauthenticated")
      ? 401
      : message.includes("not_found")
        ? 404
        : message.includes("invalid")
          ? 422
          : 503;
    return response(
      { error: { code: message.toUpperCase(), request_id: requestId } },
      status,
      cors.headers,
    );
  }
}
