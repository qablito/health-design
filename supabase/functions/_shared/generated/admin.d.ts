import type { z } from "zod";
export declare const AdminMutationRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminProfileSummarySchema: z.ZodObject<{
    alias: z.ZodString;
    createdAt: z.ZodISODateTime;
    profileId: z.ZodUUID;
    status: z.ZodEnum<{
        active: "active";
        deletion_requested: "deletion_requested";
    }>;
}, z.core.$strict>;
export declare const AdminImpersonationContextSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    active: z.ZodLiteral<true>;
    auditClosure: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        closed: "closed";
    }>>;
    effectiveProfileId: z.ZodUUID;
    impersonationSessionId: z.ZodUUID;
    startedAt: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    active: z.ZodLiteral<false>;
    auditClosure: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        closed: "closed";
    }>>;
}, z.core.$strict>], "active">;
export declare const LedgerReceiptSchema: z.ZodObject<{
    environment: z.ZodEnum<{
        local: "local";
        development: "development";
        production: "production";
    }>;
    idempotencyHash: z.ZodString;
    keyVersion: z.ZodNumber;
    recordHash: z.ZodString;
    sequence: z.ZodNumber;
    signature: z.ZodString;
    stream: z.ZodLiteral<"admin-audit">;
    timestamp: z.ZodISODateTime;
}, z.core.$strict>;
export type AdminMutationRequest = z.infer<typeof AdminMutationRequestSchema>;
export type AdminProfileSummary = z.infer<typeof AdminProfileSummarySchema>;
export type AdminImpersonationContext = z.infer<typeof AdminImpersonationContextSchema>;
export type LedgerReceipt = z.infer<typeof LedgerReceiptSchema>;
