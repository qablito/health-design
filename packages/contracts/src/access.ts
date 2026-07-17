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
