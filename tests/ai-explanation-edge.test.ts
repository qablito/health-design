import { describe, expect, it } from "vitest";

import {
  AIProviderCallError,
  handleAIExplanation,
  handleAIProviderAdmin,
  type AIExplanationDependencies,
} from "../supabase/functions/plans/explanation";

const versionId = "10000000-0000-4000-8000-000000001401";
const profileId = "20000000-0000-4000-8000-000000001401";
const userId = "30000000-0000-4000-8000-000000001401";
const sessionId = "40000000-0000-4000-8000-000000001401";
const eventId = "50000000-0000-4000-8000-000000001401";
const requestId = "60000000-0000-4000-8000-000000001401";
const providerRevisionId = "70000000-0000-4000-8000-000000001401";
const pricingRevisionId = "80000000-0000-4000-8000-000000001401";
const outputHash = "12".repeat(32);

function request(body: unknown = { schemaVersion: 1 }) {
  return new Request(`https://api.test/plans/v1/plans/${versionId}/explanation`, {
    body: JSON.stringify(body),
    headers: {
      authorization: "Bearer valid-user-jwt",
      "content-type": "application/json",
      "idempotency-key": "explanation-request-0001",
      origin: "http://127.0.0.1:5173",
    },
    method: "POST",
  });
}

function adminRequest() {
  return new Request(
    `https://api.test/plans/v1/admin/ai-provider-revisions/${providerRevisionId}/activate`,
    {
      body: JSON.stringify({ schemaVersion: 1 }),
      headers: {
        authorization: "Bearer valid-admin-jwt",
        "content-type": "application/json",
        "idempotency-key": requestId,
        origin: "http://127.0.0.1:5173",
      },
      method: "POST",
    },
  );
}

function setup(options?: {
  providerError?: AIProviderCallError;
  providerOutput?: unknown;
  reservationStatus?: "rejected" | "reserved";
}) {
  const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
  const providerInputs: unknown[] = [];
  const dependencies: AIExplanationDependencies = {
    authenticate: () => Promise.resolve({ sessionId, userId }),
    callProvider: (input) => {
      providerInputs.push(input);
      if (options?.providerError) return Promise.reject(options.providerError);
      return Promise.resolve({
        inputTokens: 100,
        output: options?.providerOutput ?? {
          schemaVersion: 1,
          selections: [
            {
              messageKey: "ai.explanation.summary.complete",
              slot: "summary",
              variantId: "clear",
            },
            {
              messageKey: "ai.explanation.nutrition.valid",
              slot: "nutrition",
              variantId: "direct",
            },
          ],
        },
        outputTokens: 20,
      });
    },
    environment: "local",
    randomUUID: () => requestId,
    rpc: (name, args) => {
      calls.push({ args, name });
      const data: Record<string, unknown> = {
        internal_ai_get_explanation_context: {
          completeness: "complete",
          modules: [
            {
              confidence: "high",
              module: "nutrition",
              status: "valid",
              uncertaintyCount: 0,
            },
          ],
          outputHash,
          planVersionId: versionId,
          profileId,
        },
        internal_ai_mark_pending: { eventId, status: "pending_reconciliation" },
        internal_ai_release_usage: { eventId, status: "released" },
        internal_ai_reserve_explanation:
          options?.reservationStatus === "rejected"
            ? { eventId, reason: "daily_profile_quota", status: "rejected" }
            : {
                eventId,
                maxInputTokens: 2048,
                maxOutputTokens: 256,
                model: "gpt-5.6-luna",
                pricingRevisionId,
                providerRevisionId,
                reasoningEffort: "none",
                reservedUpperBoundEur: "0.001",
                status: "reserved",
                timeoutMs: 8000,
              },
        internal_ai_settle_usage: {
          actualEur: "0.0002",
          eventId,
          status: "settled",
        },
        internal_ai_store_explanation: {
          explanationId: "90000000-0000-4000-8000-000000001401",
          status: "stored",
        },
        internal_admin_activate_ai_provider_revision_requested: {
          revisionId: providerRevisionId,
          status: "active",
        },
      };
      return Promise.resolve({ data: data[name], error: null });
    },
  };
  return { calls, dependencies, providerInputs };
}

describe("Explicación opcional del plan", () => {
  it("permite a Luna escoger únicamente texto preaprobado", async () => {
    const current = setup();
    const response = await handleAIExplanation(request(), current.dependencies);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      planOutputHash: outputHash,
      source: "luna",
    });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_ai_get_explanation_context",
      "internal_ai_reserve_explanation",
      "internal_ai_settle_usage",
      "internal_ai_store_explanation",
    ]);
    expect(JSON.stringify(current.providerInputs)).not.toContain("redacted");
  });

  it("descarta cualquier texto inventado por el proveedor", async () => {
    const current = setup({
      providerOutput: {
        schemaVersion: 1,
        selections: [
          {
            messageKey: "ai.explanation.summary.complete",
            slot: "summary",
            text: "Toma 50 mg",
            variantId: "clear",
          },
        ],
      },
    });
    const response = await handleAIExplanation(request(), current.dependencies);

    expect(await response.json()).toMatchObject({
      source: "deterministic_fallback",
    });
    expect(current.calls.map(({ name }) => name)).toContain("internal_ai_settle_usage");
  });

  it("no llama a Luna cuando se agota la cuota diaria", async () => {
    const current = setup({ reservationStatus: "rejected" });
    const response = await handleAIExplanation(request(), current.dependencies);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: "deterministic_fallback",
    });
    expect(current.providerInputs).toEqual([]);
  });

  it("conserva la reserva para reconciliar un timeout sin reintentar", async () => {
    const current = setup({
      providerError: new AIProviderCallError("timeout", true),
    });
    const response = await handleAIExplanation(request(), current.dependencies);

    expect(response.status).toBe(200);
    expect(current.providerInputs).toHaveLength(1);
    expect(current.calls.map(({ name }) => name)).toContain("internal_ai_mark_pending");
    expect(current.calls.map(({ name }) => name)).not.toContain(
      "internal_ai_release_usage",
    );
  });

  it("libera la reserva cuando el proveedor rechaza antes de procesar", async () => {
    const current = setup({
      providerError: new AIProviderCallError("provider_rejected", false),
    });
    await handleAIExplanation(request(), current.dependencies);

    expect(current.calls.map(({ name }) => name)).toContain(
      "internal_ai_release_usage",
    );
  });

  it("activa la revisión preparada mediante una solicitud AAL2 registrada", async () => {
    const current = setup();
    const response = await handleAIProviderAdmin(adminRequest(), current.dependencies);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revisionId: providerRevisionId,
      status: "active",
    });
    expect(current.calls.at(-1)).toEqual({
      args: {
        p_auth_session_id: sessionId,
        p_auth_subject: userId,
        p_request_id: requestId,
        p_revision_id: providerRevisionId,
      },
      name: "internal_admin_activate_ai_provider_revision_requested",
    });
  });

  it("expone el rechazo AAL1 sin activar la revisión", async () => {
    const current = setup();
    current.dependencies.rpc = (name, args) => {
      current.calls.push({ args, name });
      return Promise.resolve({
        data: null,
        error: { code: "42501", message: "aal2_required" },
      });
    };
    const response = await handleAIProviderAdmin(adminRequest(), current.dependencies);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "AAL2_REQUIRED" },
    });
  });
});
