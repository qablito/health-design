import { z } from "zod";

import { ACCESS_SCOPES, ACTOR_ROLES, PROFILE_STATUSES } from "@health-design/domain";

export const ActorRoleSchema = z.enum(ACTOR_ROLES);
export const ProfileStatusSchema = z.enum(PROFILE_STATUSES);
export const AccessScopeSchema = z.enum(ACCESS_SCOPES);

export const ProfileAccessSummarySchema = z
  .object({
    accessScope: AccessScopeSchema,
    alias: z.string().min(1),
    profileId: z.uuid(),
    status: ProfileStatusSchema,
  })
  .strict();

export type ProfileAccessSummary = z.infer<typeof ProfileAccessSummarySchema>;

const AliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9 _-]+$/);
const DeviceLabelSchema = z.string().trim().min(1).max(64);
const TurnstileTokenSchema = z.string().min(1).max(2_048);
const PrivateCodeSchema = z
  .string()
  .trim()
  .regex(/^(?:[A-Fa-f0-9]{4}-){7}[A-Fa-f0-9]{4}$/);
const QrPayloadSchema = z.string().regex(/^healthdesign-link-v1\.[A-Za-z0-9_-]{22}$/);
const DeletionHandleSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const DELETION_PUBLIC_ERROR_CODES = [
  "authorization_failed",
  "ledger_unavailable",
  "storage_unavailable",
  "purge_incomplete",
  "auth_cleanup_pending",
] as const;

export const DeletionRequestCreateSchema = z
  .object({
    alias: AliasSchema,
    confirmationPhrase: z.literal("BORRAR MI PERFIL PERMANENTEMENTE"),
    irreversible: z.literal(true),
    schemaVersion: z.literal(1),
  })
  .strict();

export const DeletionRequestStatusSchema = z
  .object({
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    errorCode: z.enum(DELETION_PUBLIC_ERROR_CODES).nullable(),
    handle: DeletionHandleSchema,
    requestedAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal(1),
    status: z.enum(["queued", "ledger_recorded", "purging", "purged", "failed"]),
  })
  .strict();

export const InvitationRedeemRequestSchema = z
  .object({
    adultAttested: z.literal(true),
    alias: AliasSchema,
    captchaToken: TurnstileTokenSchema,
    deviceLabel: DeviceLabelSchema,
    invitationSecret: z.string().min(22).max(256),
    schemaVersion: z.literal(1),
    timezone: z.string().trim().min(1).max(64),
  })
  .strict();

export const CodeLinkRequestSchema = z
  .object({
    alias: AliasSchema,
    challengeToken: TurnstileTokenSchema.optional(),
    deviceLabel: DeviceLabelSchema,
    privateCode: PrivateCodeSchema,
    schemaVersion: z.literal(1),
  })
  .strict();

export const QrLinkRequestSchema = z
  .object({
    challengeToken: TurnstileTokenSchema.optional(),
    deviceLabel: DeviceLabelSchema,
    qrPayload: QrPayloadSchema,
    schemaVersion: z.literal(1),
  })
  .strict();

export const RotatePrivateCodeRequestSchema = z
  .object({
    revokeOtherAccess: z.boolean().default(false),
    schemaVersion: z.literal(1),
  })
  .strict();

export const QrGrantRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
  })
  .strict();

export const SessionRevokeRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
  })
  .strict();

export const SessionTouchRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
  })
  .strict();

export const DeviceLinkHandleSchema = z
  .object({
    accessScope: AccessScopeSchema,
    alias: AliasSchema,
    profileAccessId: z.uuid(),
    profileId: z.uuid(),
  })
  .strict();

export const InvitationRedeemResponseSchema = DeviceLinkHandleSchema.extend({
  deviceSessionId: z.uuid(),
  privateCode: PrivateCodeSchema,
}).strict();

export const QrGrantResponseSchema = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }),
    qrPayload: QrPayloadSchema,
  })
  .strict();

export const PrivateCodeRotationResponseSchema = z
  .object({
    privateCode: PrivateCodeSchema,
    revokedOtherAccess: z.boolean(),
  })
  .strict();

export const DeviceSessionSummarySchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    deviceSessionId: z.uuid(),
    isCurrent: z.boolean(),
    label: DeviceLabelSchema,
    lastSeenAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const SessionTouchResponseSchema = z
  .object({
    absoluteExpiresAt: z.iso.datetime({ offset: true }),
    deviceSessionId: z.uuid(),
    idleExpiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const SessionRevokeResponseSchema = z
  .object({
    revoked: z.literal(true),
  })
  .strict();

export type InvitationRedeemRequest = z.infer<typeof InvitationRedeemRequestSchema>;
export type CodeLinkRequest = z.infer<typeof CodeLinkRequestSchema>;
export type QrLinkRequest = z.infer<typeof QrLinkRequestSchema>;
export type RotatePrivateCodeRequest = z.infer<typeof RotatePrivateCodeRequestSchema>;
export type DeviceLinkHandle = z.infer<typeof DeviceLinkHandleSchema>;
export type InvitationRedeemResponse = z.infer<typeof InvitationRedeemResponseSchema>;
export type QrGrantResponse = z.infer<typeof QrGrantResponseSchema>;
export type PrivateCodeRotationResponse = z.infer<
  typeof PrivateCodeRotationResponseSchema
>;
export type DeviceSessionSummary = z.infer<typeof DeviceSessionSummarySchema>;
export type SessionTouchResponse = z.infer<typeof SessionTouchResponseSchema>;
export type SessionRevokeResponse = z.infer<typeof SessionRevokeResponseSchema>;
export type DeletionRequestCreate = z.infer<typeof DeletionRequestCreateSchema>;
export type DeletionRequestStatus = z.infer<typeof DeletionRequestStatusSchema>;
