import { z } from "zod";

export const AI_EXPLANATION_SCHEMA_VERSION = 1 as const;
export const AI_EXPLANATION_SLOTS = [
  "summary",
  "nutrition",
  "training",
  "hydration",
  "sleep",
  "mobility",
  "supplements",
  "term",
] as const;

const HexSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const MessageKeySchema = z.string().regex(/^[a-z][a-z0-9_.-]{2,159}$/);
const VariantIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);

export const AIExplanationSlotSchema = z.enum(AI_EXPLANATION_SLOTS);

export const AIExplanationVariantSchema = z
  .object({
    id: VariantIdSchema,
    text: z.string().trim().min(1).max(320),
  })
  .strict();

export const AIExplanationInputSlotSchema = z
  .object({
    messageKey: MessageKeySchema,
    signal: z.string().regex(/^[a-z][a-z0-9_]{2,79}$/),
    slot: AIExplanationSlotSchema,
    variants: z
      .array(AIExplanationVariantSchema)
      .min(1)
      .max(3)
      .refine(
        (variants) => new Set(variants.map(({ id }) => id)).size === variants.length,
        "duplicate_variant",
      ),
  })
  .strict();

export const AIExplanationInputSchema = z
  .object({
    locale: z.literal("es-ES"),
    planOutputHash: HexSha256Schema,
    planVersionId: z.uuid(),
    schemaVersion: z.literal(AI_EXPLANATION_SCHEMA_VERSION),
    slots: z
      .array(AIExplanationInputSlotSchema)
      .min(1)
      .max(AI_EXPLANATION_SLOTS.length)
      .refine(
        (slots) => new Set(slots.map(({ slot }) => slot)).size === slots.length,
        "duplicate_slot",
      ),
  })
  .strict();

export const AIProviderSelectionSchema = z
  .object({
    messageKey: MessageKeySchema,
    slot: AIExplanationSlotSchema,
    variantId: VariantIdSchema,
  })
  .strict();

export const AIProviderOutputSchema = z
  .object({
    schemaVersion: z.literal(AI_EXPLANATION_SCHEMA_VERSION),
    selections: z
      .array(AIProviderSelectionSchema)
      .min(1)
      .max(AI_EXPLANATION_SLOTS.length),
  })
  .strict();

export const AIExplanationSegmentSchema = z
  .object({
    messageKey: MessageKeySchema,
    slot: AIExplanationSlotSchema,
    text: z.string().trim().min(1).max(320),
  })
  .strict();

export const AIExplanationResponseSchema = z
  .object({
    planOutputHash: HexSha256Schema,
    planVersionId: z.uuid(),
    schemaVersion: z.literal(AI_EXPLANATION_SCHEMA_VERSION),
    segments: z
      .array(AIExplanationSegmentSchema)
      .min(1)
      .max(AI_EXPLANATION_SLOTS.length),
    source: z.enum(["luna", "deterministic_fallback"]),
  })
  .strict();

export const AIExplanationRequestSchema = z
  .object({ schemaVersion: z.literal(AI_EXPLANATION_SCHEMA_VERSION) })
  .strict();

export type AIExplanationInput = z.infer<typeof AIExplanationInputSchema>;
export type AIExplanationResponse = z.infer<typeof AIExplanationResponseSchema>;
export type AIProviderOutput = z.infer<typeof AIProviderOutputSchema>;

function fallback(input: AIExplanationInput): AIExplanationResponse {
  return AIExplanationResponseSchema.parse({
    planOutputHash: input.planOutputHash,
    planVersionId: input.planVersionId,
    schemaVersion: AI_EXPLANATION_SCHEMA_VERSION,
    segments: input.slots.map(({ messageKey, slot, variants }) => ({
      messageKey,
      slot,
      text: variants[0]?.text,
    })),
    source: "deterministic_fallback",
  });
}

export function resolveAIExplanation(
  inputValue: unknown,
  providerValue: unknown,
): AIExplanationResponse {
  const input = AIExplanationInputSchema.parse(inputValue);
  const provider = AIProviderOutputSchema.safeParse(providerValue);
  if (!provider.success || provider.data.selections.length !== input.slots.length) {
    return fallback(input);
  }

  const selections = new Map(
    provider.data.selections.map((selection) => [selection.slot, selection]),
  );
  if (selections.size !== input.slots.length) return fallback(input);

  const segments = input.slots.map(({ messageKey, slot, variants }) => {
    const selection = selections.get(slot);
    const variant = variants.find(({ id }) => id === selection?.variantId);
    if (!selection || selection.messageKey !== messageKey || !variant) return null;
    return { messageKey, slot, text: variant.text };
  });
  if (segments.some((segment) => segment === null)) return fallback(input);

  return AIExplanationResponseSchema.parse({
    planOutputHash: input.planOutputHash,
    planVersionId: input.planVersionId,
    schemaVersion: AI_EXPLANATION_SCHEMA_VERSION,
    segments,
    source: "luna",
  });
}
