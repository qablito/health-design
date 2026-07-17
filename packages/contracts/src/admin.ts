import { z } from "zod";

import { PROFILE_STATUSES } from "@health-design/domain";

const UuidSchema = z.uuid();
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const Ed25519SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);

export const AdminMutationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminProfileSummarySchema = z
  .object({
    alias: z.string().min(1).max(64),
    createdAt: z.iso.datetime({ offset: true }),
    profileId: UuidSchema,
    status: z.enum(PROFILE_STATUSES),
  })
  .strict();

const ActiveAdminImpersonationContextSchema = z
  .object({
    active: z.literal(true),
    auditClosure: z.enum(["closed", "pending"]).optional(),
    effectiveProfileId: UuidSchema,
    impersonationSessionId: UuidSchema,
    startedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const InactiveAdminImpersonationContextSchema = z
  .object({
    active: z.literal(false),
    auditClosure: z.enum(["closed", "pending"]).optional(),
  })
  .strict();

export const AdminImpersonationContextSchema = z.discriminatedUnion("active", [
  ActiveAdminImpersonationContextSchema,
  InactiveAdminImpersonationContextSchema,
]);

export const LedgerReceiptSchema = z
  .object({
    environment: z.enum(["development", "local", "production"]),
    idempotencyHash: Sha256HexSchema,
    keyVersion: z.number().int().positive(),
    recordHash: Sha256HexSchema,
    sequence: z.number().int().positive(),
    signature: Ed25519SignatureSchema,
    stream: z.literal("admin-audit"),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AdminMutationRequest = z.infer<typeof AdminMutationRequestSchema>;
export type AdminProfileSummary = z.infer<typeof AdminProfileSummarySchema>;
export type AdminImpersonationContext = z.infer<typeof AdminImpersonationContextSchema>;
export type LedgerReceipt = z.infer<typeof LedgerReceiptSchema>;
