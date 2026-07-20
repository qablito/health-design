import type { AIExplanationInput } from "@health-design/contracts";

import { AIProviderCallError } from "./explanation.ts";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function outputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) throw new Error("missing_provider_output");
  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }
  throw new Error("missing_provider_output");
}

function usage(response: Record<string, unknown>) {
  if (!isRecord(response.usage)) throw new Error("missing_provider_usage");
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)) {
    throw new Error("invalid_provider_usage");
  }
  return { inputTokens: inputTokens as number, outputTokens: outputTokens as number };
}

export function createOpenAIProviderCaller(
  apiKey: () => string,
  fetcher: typeof fetch = fetch,
) {
  return async function callOpenAI(
    input: AIExplanationInput,
    config: ProviderConfig,
  ): Promise<ProviderResult> {
    const key = apiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      response = await fetcher("https://api.openai.com/v1/responses", {
        body: JSON.stringify({
          input: [
            {
              content: [
                {
                  text:
                    "Selecciona exactamente una variante preaprobada por cada slot. " +
                    "No añadas texto, cifras ni campos.",
                  type: "input_text",
                },
              ],
              role: "system",
            },
            {
              content: [{ text: JSON.stringify(input), type: "input_text" }],
              role: "user",
            },
          ],
          max_output_tokens: config.maxOutputTokens,
          model: config.model,
          reasoning: { effort: config.reasoningEffort },
          store: false,
          text: {
            format: {
              name: "health_design_ai_explanation_selection",
              schema: {
                additionalProperties: false,
                properties: {
                  schemaVersion: { const: 1, type: "integer" },
                  selections: {
                    items: {
                      additionalProperties: false,
                      properties: {
                        messageKey: {
                          pattern: "^[a-z][a-z0-9_.-]{2,159}$",
                          type: "string",
                        },
                        slot: {
                          enum: [
                            "summary",
                            "nutrition",
                            "training",
                            "hydration",
                            "sleep",
                            "mobility",
                            "supplements",
                            "term",
                          ],
                          type: "string",
                        },
                        variantId: {
                          pattern: "^[a-z][a-z0-9-]{2,63}$",
                          type: "string",
                        },
                      },
                      required: ["messageKey", "slot", "variantId"],
                      type: "object",
                    },
                    maxItems: 8,
                    minItems: 1,
                    type: "array",
                  },
                },
                required: ["schemaVersion", "selections"],
                type: "object",
              },
              strict: true,
              type: "json_schema",
            },
          },
          truncation: "disabled",
        }),
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });
    } catch {
      throw new AIProviderCallError("provider_transport_uncertain", true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new AIProviderCallError(
        "provider_rejected",
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new AIProviderCallError("provider_response_uncertain", true);
    }
    if (!isRecord(value)) {
      throw new AIProviderCallError("provider_response_uncertain", true);
    }
    try {
      return {
        ...usage(value),
        output: JSON.parse(outputText(value)) as unknown,
      };
    } catch {
      const tokens = usage(value);
      return { ...tokens, output: null };
    }
  };
}
