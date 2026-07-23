import { z } from "zod";

import { PROFILE_STATUSES } from "@health-design/domain";
import { CatalogCoverageSchema, SUPERMARKET_CHAINS } from "./shopping.ts";

const UuidSchema = z.uuid();
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const Ed25519SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const OperationsVersionSchema = z.number().int().positive();
const OperationsTimestampSchema = z.iso.datetime({ offset: true });

export const DELETION_JOB_STATES = [
  "queued",
  "ledger_recorded",
  "purging",
  "purged",
  "failed",
] as const;
export const DELETION_JOB_STEPS = [
  "ledger",
  "access",
  "exports",
  "storage",
  "profile_data",
  "auth",
  "verification",
] as const;
export const DELETION_ADMIN_ERROR_CODES = [
  "ledger_unavailable",
  "ledger_verification_failed",
  "access_revocation_failed",
  "export_purge_failed",
  "storage_unavailable",
  "storage_verification_failed",
  "profile_purge_failed",
  "auth_cleanup_pending",
  "verification_failed",
] as const;

export const AdminPermanentDeletionRequestSchema = z
  .object({
    confirmationPhrase: z.literal("PURGAR PERFIL PERMANENTEMENTE"),
    confirmed: z.literal(true),
    expectedVersion: OperationsVersionSchema,
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminDeletionJobSchema = z
  .object({
    attempts: z.number().int().min(0),
    completedAt: OperationsTimestampSchema.nullable(),
    errorCode: z.enum(DELETION_ADMIN_ERROR_CODES).nullable(),
    jobId: UuidSchema,
    profileId: UuidSchema.nullable(),
    requestedAt: OperationsTimestampSchema,
    schemaVersion: z.literal(1),
    status: z.enum(DELETION_JOB_STATES),
    steps: z
      .array(
        z
          .object({
            completed: z.boolean(),
            name: z.enum(DELETION_JOB_STEPS),
          })
          .strict(),
      )
      .length(DELETION_JOB_STEPS.length),
    version: OperationsVersionSchema,
  })
  .strict();

export const AdminBackupCreateRequestSchema = z
  .object({
    kind: z.enum(["weekly", "precritical"]),
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminBackupJobSchema = z
  .object({
    backupId: UuidSchema,
    createdAt: OperationsTimestampSchema,
    kind: z.enum(["weekly", "precritical"]),
    schemaVersion: z.literal(1),
    status: z.enum(["queued", "capturing", "verifying", "ready", "failed", "pruned"]),
    verifiedAt: OperationsTimestampSchema.nullable(),
    version: OperationsVersionSchema,
  })
  .strict();

export const AdminRestoreJobSchema = z
  .object({
    backupId: UuidSchema,
    createdAt: OperationsTimestampSchema,
    restoreId: UuidSchema,
    schemaVersion: z.literal(1),
    status: z.enum([
      "queued",
      "verifying",
      "restoring",
      "validating",
      "ready_for_promotion",
      "promoted",
      "blocked",
      "failed",
    ]),
    verifiedAt: OperationsTimestampSchema.nullable(),
    version: OperationsVersionSchema,
  })
  .strict();

export const AdminRestorePromoteRequestSchema = z
  .object({
    confirmationPhrase: z.literal("PROMOVER RESTAURACIÓN VERIFICADA"),
    confirmed: z.literal(true),
    expectedVersion: OperationsVersionSchema,
    schemaVersion: z.literal(1),
  })
  .strict();

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

const AdminCatalogStateSchema = z.enum([
  "quarantine",
  "review",
  "publishable",
  "published",
  "hidden",
]);

const AdminCatalogManifestStateSchema = z
  .object({
    errorCount: z.number().int().min(0).max(100_000),
    licenseStatus: z.enum(["approved", "restricted", "unknown"]),
    recordCount: z.number().int().min(0).max(100_000),
    sourceTermsStatus: z.enum(["approved", "restricted", "unknown"]),
  })
  .strict();

export const AdminCatalogRevisionSummarySchema = z
  .object({
    activePublicationId: UuidSchema.nullable(),
    basketSeedHash: Sha256HexSchema.nullable(),
    basketSeedRevisionId: UuidSchema.nullable(),
    catalogHash: Sha256HexSchema,
    catalogRevisionId: UuidSchema,
    chain: z.enum(SUPERMARKET_CHAINS),
    coverage: CatalogCoverageSchema.nullable(),
    coverageHash: Sha256HexSchema.nullable(),
    manifest: AdminCatalogManifestStateSchema,
    publicationVersion: z.number().int().min(1).nullable(),
    qualityStatus: z.enum(["current", "review_due", "degraded"]),
    revisionNumber: z.number().int().min(1),
    schemaVersion: z.literal(1),
    sourceDecisionReady: z.boolean(),
    state: AdminCatalogStateSchema,
    usableCount: z.number().int().min(0).max(100_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.usableCount > value.manifest.recordCount) {
      context.addIssue({ code: "custom", message: "usable_exceeds_records" });
    }
    if ((value.coverage === null) !== (value.coverageHash === null)) {
      context.addIssue({ code: "custom", message: "coverage_hash_pair_required" });
    }
    if ((value.activePublicationId === null) !== (value.publicationVersion === null)) {
      context.addIssue({
        code: "custom",
        message: "publication_version_pair_required",
      });
    }
  });

export const AdminCatalogRevisionListSchema = z
  .object({
    items: z.array(AdminCatalogRevisionSummarySchema).max(50),
    nextCursor: UuidSchema.nullable(),
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminCatalogMatchCandidatesRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminCatalogMatchCandidatesAckSchema = z
  .object({
    auditClosure: z.enum(["closed", "pending"]).optional(),
    candidatesCreated: z.number().int().min(0).max(100_000),
    catalogRevisionId: UuidSchema,
    hasMore: z.boolean(),
    schemaVersion: z.literal(1),
    skusProcessed: z.number().int().min(0).max(250),
    version: z.number().int().min(1),
  })
  .strict();

export const AdminSupermarketMatchingRuleSummarySchema = z
  .object({
    canonicalFoodKey: z.string().min(1).max(160),
    canonicalFoodName: z.string().min(1).max(500),
    chain: z.enum(SUPERMARKET_CHAINS),
    criticalIssueOpen: z.boolean(),
    externalSku: z.string().min(1).max(240),
    foodState: z.enum(["raw", "cooked", "unspecified"]),
    gtinConsistency: z.enum(["consistent", "conflict", "not_available"]),
    matchState: z.enum(["exact", "allowed", "review", "excluded", "insufficient"]),
    matchingRuleId: UuidSchema,
    purchaseForm: z.enum([
      "dry",
      "fresh",
      "drained",
      "canned",
      "natural",
      "prepared",
      "marinated",
    ]),
    reasons: z.array(z.string().min(1).max(120)).max(10),
    reviewed: z.boolean(),
    schemaVersion: z.literal(1),
    skuName: z.string().min(1).max(500),
    status: z.enum(["draft", "active", "superseded", "withdrawn"]),
    version: z.number().int().min(1),
  })
  .strict();

export const AdminSupermarketMatchingRuleListSchema = z
  .object({
    items: z.array(AdminSupermarketMatchingRuleSummarySchema).max(50),
    nextCursor: UuidSchema.nullable(),
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminSupermarketMatchingRuleReviewRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    matchState: z.enum(["exact", "allowed", "excluded"]),
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminSupermarketMatchingRuleReviewAckSchema = z
  .object({
    auditClosure: z.enum(["closed", "pending"]).optional(),
    matchState: z.enum(["exact", "allowed", "excluded"]),
    matchingRuleId: UuidSchema,
    schemaVersion: z.literal(1),
    status: z.literal("draft"),
    version: z.number().int().min(1),
  })
  .strict();

export const AdminCatalogPublishRequestSchema = z
  .object({
    expectedCatalogHash: Sha256HexSchema,
    expectedCoverageHash: Sha256HexSchema,
    expectedSeedHash: Sha256HexSchema,
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(1),
    sourceUseDecision: z.enum([
      "development_approved",
      "development_restricted_approved",
    ]),
  })
  .strict();

export const AdminCatalogPublicationHideRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminCatalogPublicationMutationAckSchema = z
  .object({
    auditClosure: z.enum(["closed", "pending"]).optional(),
    catalogPublicationId: UuidSchema,
    chain: z.enum(SUPERMARKET_CHAINS),
    schemaVersion: z.literal(1),
    status: z.enum(["active", "hidden"]),
    version: z.number().int().min(1),
  })
  .strict();

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
export type AdminCatalogRevisionSummary = z.infer<
  typeof AdminCatalogRevisionSummarySchema
>;
export type AdminCatalogRevisionList = z.infer<typeof AdminCatalogRevisionListSchema>;
export type AdminCatalogMatchCandidatesAck = z.infer<
  typeof AdminCatalogMatchCandidatesAckSchema
>;
export type AdminSupermarketMatchingRuleList = z.infer<
  typeof AdminSupermarketMatchingRuleListSchema
>;
export type AdminSupermarketMatchingRuleReviewAck = z.infer<
  typeof AdminSupermarketMatchingRuleReviewAckSchema
>;
export type AdminCatalogPublicationMutationAck = z.infer<
  typeof AdminCatalogPublicationMutationAckSchema
>;
export type AdminProfileSummary = z.infer<typeof AdminProfileSummarySchema>;
export type AdminImpersonationContext = z.infer<typeof AdminImpersonationContextSchema>;
export type LedgerReceipt = z.infer<typeof LedgerReceiptSchema>;
export type AdminDeletionJob = z.infer<typeof AdminDeletionJobSchema>;
export type AdminBackupJob = z.infer<typeof AdminBackupJobSchema>;
export type AdminRestoreJob = z.infer<typeof AdminRestoreJobSchema>;
