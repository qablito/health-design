import { z } from "zod";

export * from "./access";
export * from "./ai";
export * from "./admin";
export * from "./clinical";
export * from "./follow-up";
export * from "./hydration";
export * from "./mobility";
export * from "./nutrition";
export * from "./plans";
export * from "./questionnaire";
export * from "./sleep";
export * from "./supplements";
export * from "./training";

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
