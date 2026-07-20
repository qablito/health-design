import { describe, expect, it, vi } from "vitest";
import { AIExplanationInputSchema } from "@health-design/contracts";

import { createOpenAIProviderCaller } from "../supabase/functions/plans/openai-provider";

const input = AIExplanationInputSchema.parse({
  locale: "es-ES",
  planOutputHash: "12".repeat(32),
  planVersionId: "10000000-0000-4000-8000-000000001402",
  schemaVersion: 1,
  slots: [
    {
      messageKey: "ai.explanation.summary.complete",
      signal: "plan_complete",
      slot: "summary",
      variants: [{ id: "clear", text: "Plan validado." }],
    },
  ],
});
const config = {
  maxInputTokens: 2048,
  maxOutputTokens: 256,
  model: "gpt-5.6-luna",
  reasoningEffort: "none",
  timeoutMs: 8000,
} as const;

describe("Adaptador de Responses API", () => {
  it("envía el contrato cerrado sin persistencia ni reintentos", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    text: JSON.stringify({
                      schemaVersion: 1,
                      selections: [
                        {
                          messageKey: "ai.explanation.summary.complete",
                          slot: "summary",
                          variantId: "clear",
                        },
                      ],
                    }),
                    type: "output_text",
                  },
                ],
              },
            ],
            usage: { input_tokens: 80, output_tokens: 12 },
          }),
          { status: 200 },
        ),
      ),
    );
    const call = createOpenAIProviderCaller(() => "development-secret", fetcher);

    const result = await call(input, config);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(typeof init?.body).toBe("string");
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({
      max_output_tokens: 256,
      model: "gpt-5.6-luna",
      reasoning: { effort: "none" },
      store: false,
    });
    expect(init?.headers).toMatchObject({
      authorization: "Bearer development-secret",
    });
    expect(result).toMatchObject({ inputTokens: 80, outputTokens: 12 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("distingue un rechazo definitivo de un estado de coste incierto", async () => {
    const rejected = createOpenAIProviderCaller(
      () => "development-secret",
      () => Promise.resolve(new Response(null, { status: 400 })),
    );
    const uncertain = createOpenAIProviderCaller(
      () => "development-secret",
      () => Promise.resolve(new Response(null, { status: 500 })),
    );

    await expect(rejected(input, config)).rejects.toMatchObject({
      costUncertain: false,
    });
    await expect(uncertain(input, config)).rejects.toMatchObject({
      costUncertain: true,
    });
  });

  it("no inicia la petición si falta la clave del proveedor", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const call = createOpenAIProviderCaller(() => {
      throw new Error("missing_openai_api_key");
    }, fetcher);

    await expect(call(input, config)).rejects.toThrow("missing_openai_api_key");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
