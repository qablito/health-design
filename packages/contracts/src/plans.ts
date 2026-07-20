import { z } from "zod";

import {
  CHANGE_IMPACTS,
  CONTEXT_CANONICALIZATION_VERSION as DOMAIN_CONTEXT_CANONICALIZATION_VERSION,
  CONTEXT_NORMALIZATION_VERSION as DOMAIN_CONTEXT_NORMALIZATION_VERSION,
  PLAN_CANDIDATE_STATUSES,
  PLAN_COMPLETENESS,
  PLAN_VALIDATION_STATUSES,
  PLAN_VERSION_STATUSES,
  QUESTIONNAIRE_MODULES,
  detectContextChange as detectDomainContextChange,
} from "@health-design/domain";

import { QuestionnaireAnswersSchema } from "./questionnaire";

export const PLAN_SCHEMA_VERSION = 1 as const;
export const CONTEXT_SOURCE_SCHEMA_VERSIONS = [1, 2] as const;
export const CONTEXT_NORMALIZATION_VERSION = DOMAIN_CONTEXT_NORMALIZATION_VERSION;
export const CONTEXT_CANONICALIZATION_VERSION = DOMAIN_CONTEXT_CANONICALIZATION_VERSION;

const HexSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const VersionNameSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const JsonObjectSchema = z.record(z.string(), z.unknown());
const JsonArraySchema = z.array(z.unknown());
const TimestampSchema = z.iso.datetime({ offset: true });
const ContextSourceSchemaVersionSchema = z.union([
  z.literal(CONTEXT_SOURCE_SCHEMA_VERSIONS[0]),
  z.literal(CONTEXT_SOURCE_SCHEMA_VERSIONS[1]),
]);

export const PlanModuleSchema = z.enum(QUESTIONNAIRE_MODULES);
export const PlanVersionStatusSchema = z.enum(PLAN_VERSION_STATUSES);
export const PlanCompletenessSchema = z.enum(PLAN_COMPLETENESS);
export const PlanValidationStatusSchema = z.enum(PLAN_VALIDATION_STATUSES);
export const PlanCandidateStatusSchema = z.enum(PLAN_CANDIDATE_STATUSES);
export const ChangeImpactSchema = z.enum(CHANGE_IMPACTS);

export type PlanContextChange = Readonly<{
  affectedModules: Array<z.infer<typeof PlanModuleSchema>>;
  changedFields: string[];
  impact: z.infer<typeof ChangeImpactSchema>;
}>;

export function detectPlanContextChange(
  previous: z.infer<typeof QuestionnaireAnswersSchema>,
  current: z.infer<typeof QuestionnaireAnswersSchema>,
): PlanContextChange {
  return detectDomainContextChange(previous, current);
}

export const ContextSnapshotCreateRequestSchema = z
  .object({
    expectedDraftVersion: z.number().int().min(1),
    schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  })
  .strict();

export const PlanGenerationRequestSchema = z
  .object({
    contextSnapshotId: z.uuid(),
    schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  })
  .strict();

export const PlanCandidateCreateRequestSchema = z
  .object({
    baseVersionId: z.uuid(),
    contextSnapshotId: z.uuid(),
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  })
  .strict();

export const PlanMutationRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  })
  .strict();

export const ContextSnapshotAckSchema = z
  .object({
    canonicalizationVersion: z.literal(CONTEXT_CANONICALIZATION_VERSION),
    completeness: PlanCompletenessSchema,
    createdAt: TimestampSchema,
    effectiveAt: TimestampSchema,
    id: z.uuid(),
    inputHash: HexSha256Schema,
    normalizationVersion: z.literal(CONTEXT_NORMALIZATION_VERSION),
    profileId: z.uuid(),
    schemaVersion: ContextSourceSchemaVersionSchema,
    sourceDraftId: z.uuid(),
    sourceDraftVersion: z.number().int().min(1),
  })
  .strict();

export const ContextSnapshotInternalSchema = ContextSnapshotAckSchema.extend({
  answers: QuestionnaireAnswersSchema,
}).strict();

export const PlanModuleResultInputSchema = z
  .object({
    confidence: z.enum(["high", "medium", "low", "unknown"]),
    module: PlanModuleSchema,
    payload: JsonObjectSchema,
    status: z.enum(["valid", "provisional", "invalid", "not_requested"]),
    uncertainties: JsonArraySchema.max(100),
  })
  .strict();

export const PlanSafetyFindingInputSchema = z
  .object({
    actionLevel: z.enum([
      "information",
      "adjustment",
      "priority_review",
      "immediate_conservative",
    ]),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    evidenceRef: z.string().min(1).max(256),
    messageKey: z.string().min(1).max(160),
    module: PlanModuleSchema,
  })
  .strict();

const UniqueModuleResultsSchema = z
  .array(PlanModuleResultInputSchema)
  .max(QUESTIONNAIRE_MODULES.length)
  .refine(
    (results) => new Set(results.map(({ module }) => module)).size === results.length,
    "duplicate_module_result",
  );

export const PlanEngineResultSchema = z
  .object({
    canonicalizationVersion: VersionNameSchema,
    completeness: PlanCompletenessSchema,
    engineVersion: VersionNameSchema,
    inputHash: HexSha256Schema,
    moduleResults: UniqueModuleResultsSchema,
    outputHash: HexSha256Schema,
    ruleSetRevisionId: z.uuid(),
    safetyFindings: z.array(PlanSafetyFindingInputSchema).max(100),
    sourceManifestId: z.uuid(),
    validation: JsonObjectSchema,
    validationStatus: PlanValidationStatusSchema,
  })
  .strict();

export const PlanMutationAckSchema = z
  .object({
    activatedAt: TimestampSchema.nullable(),
    activeVersionId: z.uuid().nullable(),
    aggregateVersion: z.number().int().min(1),
    archivedAt: TimestampSchema.nullable(),
    completeness: PlanCompletenessSchema,
    contextSnapshotId: z.uuid(),
    createdAt: TimestampSchema,
    ordinal: z.number().int().min(1),
    planId: z.uuid(),
    planVersionId: z.uuid(),
    status: PlanVersionStatusSchema,
    validationStatus: PlanValidationStatusSchema,
  })
  .strict();

export const PlanCandidateAckSchema = PlanMutationAckSchema.extend({
  baseVersionId: z.uuid(),
  candidateId: z.uuid(),
  candidateStatus: PlanCandidateStatusSchema,
  changeEventId: z.uuid(),
  diff: z
    .object({
      affectedModules: z.array(PlanModuleSchema).max(QUESTIONNAIRE_MODULES.length),
      changedFields: z.array(z.string().min(1).max(80)).max(100),
    })
    .strict(),
  impact: ChangeImpactSchema,
  resolvedAt: TimestampSchema.nullable(),
  validation: JsonObjectSchema,
}).strict();

export const PlanVersionSchema = z
  .object({
    activatedAt: TimestampSchema.nullable(),
    archivedAt: TimestampSchema.nullable(),
    canonicalizationVersion: VersionNameSchema,
    completeness: PlanCompletenessSchema,
    contextSnapshotId: z.uuid(),
    createdAt: TimestampSchema,
    engineVersion: VersionNameSchema,
    hashAlgorithm: z.literal("sha256"),
    id: z.uuid(),
    inputHash: HexSha256Schema,
    ordinal: z.number().int().min(1),
    outputHash: HexSha256Schema,
    planId: z.uuid(),
    ruleSetRevisionId: z.uuid(),
    sourceManifestId: z.uuid(),
    status: PlanVersionStatusSchema,
    validatedAt: TimestampSchema,
    validation: JsonObjectSchema,
    validationStatus: PlanValidationStatusSchema,
  })
  .strict();

export const PlanModuleResultSchema = PlanModuleResultInputSchema.extend({
  createdAt: TimestampSchema,
  id: z.uuid(),
}).strict();

export const PlanSafetyFindingSchema = PlanSafetyFindingInputSchema.extend({
  createdAt: TimestampSchema,
  id: z.uuid(),
}).strict();

export const PlanVersionDetailSchema = PlanVersionSchema.extend({
  moduleResults: z.array(PlanModuleResultSchema).max(QUESTIONNAIRE_MODULES.length),
  safetyFindings: z.array(PlanSafetyFindingSchema).max(100),
}).strict();

export const PlanHistorySchema = z
  .object({
    activeVersionId: z.uuid().nullable(),
    aggregateVersion: z.number().int().min(1),
    planId: z.uuid(),
    profileId: z.uuid(),
    versions: z.array(PlanVersionSchema),
  })
  .strict();

export type ContextSnapshotCreateRequest = z.infer<
  typeof ContextSnapshotCreateRequestSchema
>;
export type ContextSnapshotAck = z.infer<typeof ContextSnapshotAckSchema>;
export type ContextSnapshotInternal = z.infer<typeof ContextSnapshotInternalSchema>;
export type PlanCandidateAck = z.infer<typeof PlanCandidateAckSchema>;
export type PlanCandidateCreateRequest = z.infer<
  typeof PlanCandidateCreateRequestSchema
>;
export type PlanEngineResult = z.infer<typeof PlanEngineResultSchema>;
export type PlanModuleResultInput = z.infer<typeof PlanModuleResultInputSchema>;
export type PlanGenerationRequest = z.infer<typeof PlanGenerationRequestSchema>;
export type PlanMutationRequest = z.infer<typeof PlanMutationRequestSchema>;
export type PlanMutationAck = z.infer<typeof PlanMutationAckSchema>;
export type PlanVersionDetail = z.infer<typeof PlanVersionDetailSchema>;
