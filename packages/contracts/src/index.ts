import { z } from "zod";

export * from "./access.ts";
export * from "./ai.ts";
export * from "./admin.ts";
export * from "./clinical.ts";
export * from "./follow-up.ts";
export * from "./exports.ts";
export * from "./hydration.ts";
export * from "./mobility.ts";
export * from "./nutrition.ts";
export * from "./plans.ts";
export * from "./products.ts";
export * from "./questionnaire.ts";
export * from "./sleep.ts";
export * from "./shopping.ts";
export * from "./supplements.ts";
export * from "./training.ts";

export const RuntimeSmokeSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("runtime-smoke"),
    message: z.literal("contrato compartido"),
  })
  .strict();

export type RuntimeSmokePayload = z.infer<typeof RuntimeSmokeSchema>;

export const RUNTIME_SMOKE_EXAMPLE = {
  schemaVersion: 1,
  kind: "runtime-smoke",
  message: "contrato compartido",
} as const satisfies RuntimeSmokePayload;

export function isRuntimeSmokePayload(candidate: unknown): boolean {
  return RuntimeSmokeSchema.safeParse(candidate).success;
}
