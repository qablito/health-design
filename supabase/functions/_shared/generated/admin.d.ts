import type { z } from "zod";
export declare const DELETION_JOB_STATES: readonly ["queued", "ledger_recorded", "purging", "purged", "failed"];
export declare const DELETION_JOB_STEPS: readonly ["ledger", "access", "exports", "storage", "profile_data", "auth", "verification"];
export declare const DELETION_ADMIN_ERROR_CODES: readonly ["ledger_unavailable", "ledger_verification_failed", "access_revocation_failed", "export_purge_failed", "storage_unavailable", "storage_verification_failed", "profile_purge_failed", "auth_cleanup_pending", "verification_failed"];
export declare const AdminPermanentDeletionRequestSchema: z.ZodObject<{
    confirmationPhrase: z.ZodLiteral<"PURGAR PERFIL PERMANENTEMENTE">;
    confirmed: z.ZodLiteral<true>;
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminDeletionJobSchema: z.ZodObject<{
    attempts: z.ZodNumber;
    completedAt: z.ZodNullable<z.ZodISODateTime>;
    errorCode: z.ZodNullable<z.ZodEnum<{
        ledger_unavailable: "ledger_unavailable";
        storage_unavailable: "storage_unavailable";
        auth_cleanup_pending: "auth_cleanup_pending";
        ledger_verification_failed: "ledger_verification_failed";
        access_revocation_failed: "access_revocation_failed";
        export_purge_failed: "export_purge_failed";
        storage_verification_failed: "storage_verification_failed";
        profile_purge_failed: "profile_purge_failed";
        verification_failed: "verification_failed";
    }>>;
    jobId: z.ZodUUID;
    profileId: z.ZodNullable<z.ZodUUID>;
    requestedAt: z.ZodISODateTime;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        queued: "queued";
        ledger_recorded: "ledger_recorded";
        purging: "purging";
        purged: "purged";
        failed: "failed";
    }>;
    steps: z.ZodArray<z.ZodObject<{
        completed: z.ZodBoolean;
        name: z.ZodEnum<{
            ledger: "ledger";
            access: "access";
            exports: "exports";
            storage: "storage";
            profile_data: "profile_data";
            auth: "auth";
            verification: "verification";
        }>;
    }, z.core.$strict>>;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminBackupCreateRequestSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        weekly: "weekly";
        precritical: "precritical";
    }>;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminBackupJobSchema: z.ZodObject<{
    backupId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    kind: z.ZodEnum<{
        weekly: "weekly";
        precritical: "precritical";
    }>;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        queued: "queued";
        failed: "failed";
        capturing: "capturing";
        verifying: "verifying";
        ready: "ready";
        pruned: "pruned";
    }>;
    verifiedAt: z.ZodNullable<z.ZodISODateTime>;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminBackupJobListSchema: z.ZodArray<z.ZodObject<{
    backupId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    kind: z.ZodEnum<{
        weekly: "weekly";
        precritical: "precritical";
    }>;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        queued: "queued";
        failed: "failed";
        capturing: "capturing";
        verifying: "verifying";
        ready: "ready";
        pruned: "pruned";
    }>;
    verifiedAt: z.ZodNullable<z.ZodISODateTime>;
    version: z.ZodNumber;
}, z.core.$strict>>;
export declare const AdminRestoreCreateRequestSchema: z.ZodObject<{
    backupId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
    targetFingerprint: z.ZodString;
}, z.core.$strict>;
export declare const AdminRestoreJobSchema: z.ZodObject<{
    backupId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    restoreId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        queued: "queued";
        failed: "failed";
        verifying: "verifying";
        restoring: "restoring";
        validating: "validating";
        ready_for_promotion: "ready_for_promotion";
        promoted: "promoted";
        blocked: "blocked";
    }>;
    verifiedAt: z.ZodNullable<z.ZodISODateTime>;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminRestoreJobListSchema: z.ZodArray<z.ZodObject<{
    backupId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    restoreId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        queued: "queued";
        failed: "failed";
        verifying: "verifying";
        restoring: "restoring";
        validating: "validating";
        ready_for_promotion: "ready_for_promotion";
        promoted: "promoted";
        blocked: "blocked";
    }>;
    verifiedAt: z.ZodNullable<z.ZodISODateTime>;
    version: z.ZodNumber;
}, z.core.$strict>>;
export declare const AdminRestorePromoteRequestSchema: z.ZodObject<{
    confirmationPhrase: z.ZodLiteral<"PROMOVER RESTAURACIÓN VERIFICADA">;
    confirmed: z.ZodLiteral<true>;
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminMutationRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminProfileSummarySchema: z.ZodObject<{
    alias: z.ZodString;
    createdAt: z.ZodISODateTime;
    deletionJobId: z.ZodOptional<z.ZodUUID>;
    deletionJobVersion: z.ZodOptional<z.ZodNumber>;
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
export declare const AdminCatalogRevisionSummarySchema: z.ZodObject<{
    activePublicationId: z.ZodNullable<z.ZodUUID>;
    basketSeedHash: z.ZodNullable<z.ZodString>;
    basketSeedRevisionId: z.ZodNullable<z.ZodUUID>;
    catalogHash: z.ZodString;
    catalogRevisionId: z.ZodUUID;
    chain: z.ZodEnum<{
        mercadona: "mercadona";
        dia: "dia";
        aldi: "aldi";
    }>;
    coverage: z.ZodNullable<z.ZodObject<{
        dynamicRequired: z.ZodLiteral<20>;
        dynamicUsable: z.ZodNumber;
        fixedRequired: z.ZodLiteral<60>;
        fixedUsable: z.ZodNumber;
        groups: z.ZodArray<z.ZodObject<{
            groupKey: z.ZodString;
            required: z.ZodNumber;
            usable: z.ZodNumber;
        }, z.core.$strict>>;
        publishable: z.ZodBoolean;
        totalRequired: z.ZodLiteral<80>;
        totalUsable: z.ZodNumber;
    }, z.core.$strict>>;
    coverageHash: z.ZodNullable<z.ZodString>;
    manifest: z.ZodObject<{
        errorCount: z.ZodNumber;
        licenseStatus: z.ZodEnum<{
            unknown: "unknown";
            approved: "approved";
            restricted: "restricted";
        }>;
        recordCount: z.ZodNumber;
        sourceTermsStatus: z.ZodEnum<{
            unknown: "unknown";
            approved: "approved";
            restricted: "restricted";
        }>;
    }, z.core.$strict>;
    publicationVersion: z.ZodNullable<z.ZodNumber>;
    qualityStatus: z.ZodEnum<{
        current: "current";
        review_due: "review_due";
        degraded: "degraded";
    }>;
    revisionNumber: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    sourceDecisionReady: z.ZodBoolean;
    state: z.ZodEnum<{
        published: "published";
        review: "review";
        publishable: "publishable";
        quarantine: "quarantine";
        hidden: "hidden";
    }>;
    usableCount: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminCatalogRevisionListSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        activePublicationId: z.ZodNullable<z.ZodUUID>;
        basketSeedHash: z.ZodNullable<z.ZodString>;
        basketSeedRevisionId: z.ZodNullable<z.ZodUUID>;
        catalogHash: z.ZodString;
        catalogRevisionId: z.ZodUUID;
        chain: z.ZodEnum<{
            mercadona: "mercadona";
            dia: "dia";
            aldi: "aldi";
        }>;
        coverage: z.ZodNullable<z.ZodObject<{
            dynamicRequired: z.ZodLiteral<20>;
            dynamicUsable: z.ZodNumber;
            fixedRequired: z.ZodLiteral<60>;
            fixedUsable: z.ZodNumber;
            groups: z.ZodArray<z.ZodObject<{
                groupKey: z.ZodString;
                required: z.ZodNumber;
                usable: z.ZodNumber;
            }, z.core.$strict>>;
            publishable: z.ZodBoolean;
            totalRequired: z.ZodLiteral<80>;
            totalUsable: z.ZodNumber;
        }, z.core.$strict>>;
        coverageHash: z.ZodNullable<z.ZodString>;
        manifest: z.ZodObject<{
            errorCount: z.ZodNumber;
            licenseStatus: z.ZodEnum<{
                unknown: "unknown";
                approved: "approved";
                restricted: "restricted";
            }>;
            recordCount: z.ZodNumber;
            sourceTermsStatus: z.ZodEnum<{
                unknown: "unknown";
                approved: "approved";
                restricted: "restricted";
            }>;
        }, z.core.$strict>;
        publicationVersion: z.ZodNullable<z.ZodNumber>;
        qualityStatus: z.ZodEnum<{
            current: "current";
            review_due: "review_due";
            degraded: "degraded";
        }>;
        revisionNumber: z.ZodNumber;
        schemaVersion: z.ZodLiteral<1>;
        sourceDecisionReady: z.ZodBoolean;
        state: z.ZodEnum<{
            published: "published";
            review: "review";
            publishable: "publishable";
            quarantine: "quarantine";
            hidden: "hidden";
        }>;
        usableCount: z.ZodNumber;
    }, z.core.$strict>>;
    nextCursor: z.ZodNullable<z.ZodUUID>;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminCatalogMatchCandidatesRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminCatalogMatchCandidatesAckSchema: z.ZodObject<{
    auditClosure: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        closed: "closed";
    }>>;
    candidatesCreated: z.ZodNumber;
    catalogRevisionId: z.ZodUUID;
    hasMore: z.ZodBoolean;
    schemaVersion: z.ZodLiteral<1>;
    skusProcessed: z.ZodNumber;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminSupermarketMatchingRuleSummarySchema: z.ZodObject<{
    canonicalFoodKey: z.ZodString;
    canonicalFoodName: z.ZodString;
    chain: z.ZodEnum<{
        mercadona: "mercadona";
        dia: "dia";
        aldi: "aldi";
    }>;
    criticalIssueOpen: z.ZodBoolean;
    externalSku: z.ZodString;
    foodState: z.ZodEnum<{
        cooked: "cooked";
        raw: "raw";
        unspecified: "unspecified";
    }>;
    gtinConsistency: z.ZodEnum<{
        consistent: "consistent";
        conflict: "conflict";
        not_available: "not_available";
    }>;
    matchState: z.ZodEnum<{
        exact: "exact";
        allowed: "allowed";
        review: "review";
        excluded: "excluded";
        insufficient: "insufficient";
    }>;
    matchingRuleId: z.ZodUUID;
    purchaseForm: z.ZodEnum<{
        dry: "dry";
        fresh: "fresh";
        drained: "drained";
        canned: "canned";
        natural: "natural";
        prepared: "prepared";
        marinated: "marinated";
    }>;
    reasons: z.ZodArray<z.ZodString>;
    reviewed: z.ZodBoolean;
    schemaVersion: z.ZodLiteral<1>;
    skuName: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        draft: "draft";
        superseded: "superseded";
        withdrawn: "withdrawn";
    }>;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminSupermarketMatchingRuleListSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        canonicalFoodKey: z.ZodString;
        canonicalFoodName: z.ZodString;
        chain: z.ZodEnum<{
            mercadona: "mercadona";
            dia: "dia";
            aldi: "aldi";
        }>;
        criticalIssueOpen: z.ZodBoolean;
        externalSku: z.ZodString;
        foodState: z.ZodEnum<{
            cooked: "cooked";
            raw: "raw";
            unspecified: "unspecified";
        }>;
        gtinConsistency: z.ZodEnum<{
            consistent: "consistent";
            conflict: "conflict";
            not_available: "not_available";
        }>;
        matchState: z.ZodEnum<{
            exact: "exact";
            allowed: "allowed";
            review: "review";
            excluded: "excluded";
            insufficient: "insufficient";
        }>;
        matchingRuleId: z.ZodUUID;
        purchaseForm: z.ZodEnum<{
            dry: "dry";
            fresh: "fresh";
            drained: "drained";
            canned: "canned";
            natural: "natural";
            prepared: "prepared";
            marinated: "marinated";
        }>;
        reasons: z.ZodArray<z.ZodString>;
        reviewed: z.ZodBoolean;
        schemaVersion: z.ZodLiteral<1>;
        skuName: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            draft: "draft";
            superseded: "superseded";
            withdrawn: "withdrawn";
        }>;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    nextCursor: z.ZodNullable<z.ZodUUID>;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminSupermarketMatchingRuleReviewRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    matchState: z.ZodEnum<{
        exact: "exact";
        allowed: "allowed";
        excluded: "excluded";
    }>;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminSupermarketMatchingRuleReviewAckSchema: z.ZodObject<{
    auditClosure: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        closed: "closed";
    }>>;
    matchState: z.ZodEnum<{
        exact: "exact";
        allowed: "allowed";
        excluded: "excluded";
    }>;
    matchingRuleId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodLiteral<"draft">;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminCatalogPublishRequestSchema: z.ZodObject<{
    expectedCatalogHash: z.ZodString;
    expectedCoverageHash: z.ZodString;
    expectedSeedHash: z.ZodString;
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    sourceUseDecision: z.ZodEnum<{
        development_approved: "development_approved";
        development_restricted_approved: "development_restricted_approved";
    }>;
}, z.core.$strict>;
export declare const AdminCatalogPublicationHideRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminCatalogPublicationMutationAckSchema: z.ZodObject<{
    auditClosure: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        closed: "closed";
    }>>;
    catalogPublicationId: z.ZodUUID;
    chain: z.ZodEnum<{
        mercadona: "mercadona";
        dia: "dia";
        aldi: "aldi";
    }>;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        active: "active";
        hidden: "hidden";
    }>;
    version: z.ZodNumber;
}, z.core.$strict>;
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
    stream: z.ZodEnum<{
        "admin-audit": "admin-audit";
        deletions: "deletions";
    }>;
    timestamp: z.ZodISODateTime;
}, z.core.$strict>;
export type AdminMutationRequest = z.infer<typeof AdminMutationRequestSchema>;
export type AdminCatalogRevisionSummary = z.infer<typeof AdminCatalogRevisionSummarySchema>;
export type AdminCatalogRevisionList = z.infer<typeof AdminCatalogRevisionListSchema>;
export type AdminCatalogMatchCandidatesAck = z.infer<typeof AdminCatalogMatchCandidatesAckSchema>;
export type AdminSupermarketMatchingRuleList = z.infer<typeof AdminSupermarketMatchingRuleListSchema>;
export type AdminSupermarketMatchingRuleReviewAck = z.infer<typeof AdminSupermarketMatchingRuleReviewAckSchema>;
export type AdminCatalogPublicationMutationAck = z.infer<typeof AdminCatalogPublicationMutationAckSchema>;
export type AdminProfileSummary = z.infer<typeof AdminProfileSummarySchema>;
export type AdminImpersonationContext = z.infer<typeof AdminImpersonationContextSchema>;
export type LedgerReceipt = z.infer<typeof LedgerReceiptSchema>;
export type AdminDeletionJob = z.infer<typeof AdminDeletionJobSchema>;
export type AdminBackupJob = z.infer<typeof AdminBackupJobSchema>;
export type AdminBackupJobList = z.infer<typeof AdminBackupJobListSchema>;
export type AdminRestoreCreateRequest = z.infer<typeof AdminRestoreCreateRequestSchema>;
export type AdminRestoreJob = z.infer<typeof AdminRestoreJobSchema>;
export type AdminRestoreJobList = z.infer<typeof AdminRestoreJobListSchema>;
