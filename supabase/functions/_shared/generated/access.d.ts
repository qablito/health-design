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
export declare const InvitationRedeemRequestSchema: z.ZodObject<{
    adultAttested: z.ZodLiteral<true>;
    alias: z.ZodString;
    captchaToken: z.ZodString;
    deviceLabel: z.ZodString;
    invitationSecret: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    timezone: z.ZodString;
}, z.core.$strict>;
export declare const CodeLinkRequestSchema: z.ZodObject<{
    alias: z.ZodString;
    challengeToken: z.ZodOptional<z.ZodString>;
    deviceLabel: z.ZodString;
    privateCode: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const QrLinkRequestSchema: z.ZodObject<{
    challengeToken: z.ZodOptional<z.ZodString>;
    deviceLabel: z.ZodString;
    qrPayload: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const RotatePrivateCodeRequestSchema: z.ZodObject<{
    revokeOtherAccess: z.ZodDefault<z.ZodBoolean>;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const QrGrantRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const SessionRevokeRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const SessionTouchRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const DeviceLinkHandleSchema: z.ZodObject<{
    accessScope: z.ZodEnum<{
        owner: "owner";
    }>;
    alias: z.ZodString;
    profileAccessId: z.ZodUUID;
    profileId: z.ZodUUID;
}, z.core.$strict>;
export declare const InvitationRedeemResponseSchema: z.ZodObject<{
    accessScope: z.ZodEnum<{
        owner: "owner";
    }>;
    alias: z.ZodString;
    profileAccessId: z.ZodUUID;
    profileId: z.ZodUUID;
    deviceSessionId: z.ZodUUID;
    privateCode: z.ZodString;
}, z.core.$strict>;
export declare const QrGrantResponseSchema: z.ZodObject<{
    expiresAt: z.ZodISODateTime;
    qrPayload: z.ZodString;
}, z.core.$strict>;
export declare const PrivateCodeRotationResponseSchema: z.ZodObject<{
    privateCode: z.ZodString;
    revokedOtherAccess: z.ZodBoolean;
}, z.core.$strict>;
export declare const DeviceSessionSummarySchema: z.ZodObject<{
    createdAt: z.ZodISODateTime;
    deviceSessionId: z.ZodUUID;
    isCurrent: z.ZodBoolean;
    label: z.ZodString;
    lastSeenAt: z.ZodISODateTime;
}, z.core.$strict>;
export declare const SessionTouchResponseSchema: z.ZodObject<{
    absoluteExpiresAt: z.ZodISODateTime;
    deviceSessionId: z.ZodUUID;
    idleExpiresAt: z.ZodISODateTime;
}, z.core.$strict>;
export declare const SessionRevokeResponseSchema: z.ZodObject<{
    revoked: z.ZodLiteral<true>;
}, z.core.$strict>;
export type InvitationRedeemRequest = z.infer<typeof InvitationRedeemRequestSchema>;
export type CodeLinkRequest = z.infer<typeof CodeLinkRequestSchema>;
export type QrLinkRequest = z.infer<typeof QrLinkRequestSchema>;
export type RotatePrivateCodeRequest = z.infer<typeof RotatePrivateCodeRequestSchema>;
export type DeviceLinkHandle = z.infer<typeof DeviceLinkHandleSchema>;
export type InvitationRedeemResponse = z.infer<typeof InvitationRedeemResponseSchema>;
export type QrGrantResponse = z.infer<typeof QrGrantResponseSchema>;
export type PrivateCodeRotationResponse = z.infer<typeof PrivateCodeRotationResponseSchema>;
export type DeviceSessionSummary = z.infer<typeof DeviceSessionSummarySchema>;
export type SessionTouchResponse = z.infer<typeof SessionTouchResponseSchema>;
export type SessionRevokeResponse = z.infer<typeof SessionRevokeResponseSchema>;
