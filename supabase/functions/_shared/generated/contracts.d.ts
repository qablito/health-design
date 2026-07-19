import type { z } from "zod";
export * from "./access";
export * from "./admin";
export * from "./nutrition";
export * from "./plans";
export * from "./questionnaire";
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
