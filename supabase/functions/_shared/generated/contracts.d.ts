import type { z } from "zod";
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
export * from "./supplements.ts";
export * from "./training.ts";
export declare const RuntimeSmokeSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    kind: z.ZodLiteral<"runtime-smoke">;
    message: z.ZodLiteral<"contrato compartido">;
}, z.core.$strict>;
export type RuntimeSmokePayload = z.infer<typeof RuntimeSmokeSchema>;
export declare const RUNTIME_SMOKE_EXAMPLE: {
    readonly schemaVersion: 1;
    readonly kind: "runtime-smoke";
    readonly message: "contrato compartido";
};
export declare function isRuntimeSmokePayload(candidate: unknown): boolean;
