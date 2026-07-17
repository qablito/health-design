import type { z } from "zod";
export declare const ActorRoleSchema: z.ZodEnum<{
    device: "device";
    superadmin: "superadmin";
}>;
export declare const ProfileStatusSchema: z.ZodEnum<{
    active: "active";
    deletion_requested: "deletion_requested";
}>;
export declare const AccessScopeSchema: z.ZodEnum<{
    owner: "owner";
}>;
export declare const ProfileAccessSummarySchema: z.ZodObject<{
    accessScope: z.ZodEnum<{
        owner: "owner";
    }>;
    alias: z.ZodString;
    profileId: z.ZodUUID;
    status: z.ZodEnum<{
        active: "active";
        deletion_requested: "deletion_requested";
    }>;
}, z.core.$strict>;
export type ProfileAccessSummary = z.infer<typeof ProfileAccessSummarySchema>;
