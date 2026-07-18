import { z } from "zod";

export * from "./access";
export * from "./admin";
export * from "./questionnaire";

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
