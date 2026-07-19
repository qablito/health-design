import { z } from "zod";

import { ActionLevelSchema, ClinicalCoverageSchema } from "./clinical";

export const SUPPLEMENTS_SCHEMA_VERSION = 1 as const;

export const SupplementTierSchema = z.enum([
  "deficiency",
  "contextual",
  "experimental",
]);
export const SupplementEvidenceSchema = z.enum([
  "high",
  "moderate",
  "limited",
  "insufficient",
]);
export const SupplementConfidenceSchema = z.enum(["high", "medium", "low"]);
export const SupplementActionSchema = z.enum([
  "trial_candidate",
  "review_later",
  "review_required",
  "information_only",
]);
export const SupplementRecommendationStatusSchema = z.enum([
  "complete",
  "provisional",
  "not_requested",
]);
export const LabSummaryStatusSchema = z.enum([
  "recognized",
  "incomplete",
  "unrecognized",
]);

const TextSchema = z.string().min(1).max(500);
const ReferenceSchema = z.string().min(1).max(256);

const SupplementFichaBaseSchema = z
  .object({
    action: SupplementActionSchema,
    confidence: SupplementConfidenceSchema,
    contraindications: z.array(TextSchema).max(20),
    doseReference: TextSchema.nullable(),
    duration: TextSchema.nullable(),
    evidence: SupplementEvidenceSchema,
    evidenceRefs: z.array(ReferenceSchema).min(1).max(20),
    expectedBenefit: TextSchema,
    form: TextSchema,
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    interactions: z.array(TextSchema).max(20),
    metric: TextSchema,
    purpose: TextSchema,
    risks: z.array(TextSchema).max(20),
    stopCondition: TextSchema,
    tier: SupplementTierSchema,
  })
  .strict();

export const SupplementRecommendationSchema = SupplementFichaBaseSchema;
export const SupplementExperimentalOptionSchema = SupplementFichaBaseSchema.extend({
  confidence: z.literal("low"),
  tier: z.literal("experimental"),
}).strict();

export const SupplementNotRecommendedSchema = z
  .object({
    evidenceRefs: z.array(ReferenceSchema).min(1).max(20),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    reason: TextSchema,
  })
  .strict();

const LabReferenceRangeSchema = z
  .object({
    maximum: z.number().finite(),
    minimum: z.number().finite(),
    unit: z.string().min(1).max(40),
  })
  .strict()
  .refine(({ minimum, maximum }) => minimum <= maximum, "invalid_reference_range");

export const RecognizedLabSummarySchema = z
  .object({
    analyte: z.enum(["b12", "folate", "magnesium", "creatinine", "egfr"]),
    interpretation: z.enum(["below_range", "within_range", "above_range"]),
    name: z.string().min(1).max(120),
    referenceRange: LabReferenceRangeSchema,
    status: z.literal("recognized"),
    unit: z.string().min(1).max(40),
    value: z.number().finite(),
  })
  .strict();

export const IncompleteLabSummarySchema = z
  .object({
    name: z.string().min(1).max(120),
    reason: z.enum([
      "missing_value",
      "missing_unit",
      "missing_reference_range",
      "ambiguous_reference_range",
    ]),
    status: z.literal("incomplete"),
  })
  .strict();

export const UnrecognizedLabSummarySchema = z
  .object({
    name: z.string().min(1).max(120),
    reason: z.enum(["analyte", "unit", "value", "reference_range"]),
    status: z.literal("unrecognized"),
  })
  .strict();

export const LabSummarySchema = z.discriminatedUnion("status", [
  RecognizedLabSummarySchema,
  IncompleteLabSummarySchema,
  UnrecognizedLabSummarySchema,
]);

export const CurrentSupplementContextSchema = z
  .object({
    classification: z.enum(["known_context", "opaque_context"]),
    status: z.literal("recorded_context"),
  })
  .strict();

export const SupplementsPlanSchema = z
  .object({
    clinicalCoverage: ClinicalCoverageSchema,
    completeness: z.enum(["complete", "provisional"]),
    currentSupplements: z.array(CurrentSupplementContextSchema).max(50),
    experimentalOptions: z.array(SupplementExperimentalOptionSchema).max(20),
    labSummary: z.array(LabSummarySchema).max(50),
    notRecommended: z.array(SupplementNotRecommendedSchema).max(20),
    recommendations: z.array(SupplementRecommendationSchema).max(20),
    status: SupplementRecommendationStatusSchema,
    stopConditions: z.array(TextSchema).max(20),
    strictestActionLevel: ActionLevelSchema,
    uncertainties: z.array(TextSchema).max(50),
  })
  .strict()
  .superRefine((plan, context) => {
    const trialCandidates = [
      ...plan.recommendations,
      ...plan.experimentalOptions,
    ].filter(({ action }) => action === "trial_candidate");
    if (trialCandidates.length > 1) {
      context.addIssue({
        code: "custom",
        message: "supplements_only_one_trial_candidate",
        path: ["recommendations"],
      });
    }
    if (plan.status === "not_requested") {
      if (
        plan.completeness !== "complete" ||
        plan.recommendations.length > 0 ||
        plan.experimentalOptions.length > 0 ||
        plan.notRecommended.length > 0 ||
        plan.currentSupplements.length > 0 ||
        plan.labSummary.length > 0 ||
        plan.uncertainties.length > 0 ||
        plan.stopConditions.length > 0 ||
        plan.clinicalCoverage !== "modeled" ||
        plan.strictestActionLevel !== "information"
      ) {
        context.addIssue({
          code: "custom",
          message: "supplements_not_requested_must_be_neutral",
          path: ["status"],
        });
      }
      return;
    }
    if (plan.status === "complete" && plan.completeness !== "complete") {
      context.addIssue({
        code: "custom",
        message: "supplements_complete_requires_complete",
        path: ["status"],
      });
    }
    if (plan.status === "provisional" && plan.completeness !== "provisional") {
      context.addIssue({
        code: "custom",
        message: "supplements_provisional_requires_provisional",
        path: ["status"],
      });
    }
  });

export type SupplementRecommendation = z.infer<typeof SupplementRecommendationSchema>;
export type SupplementExperimentalOption = z.infer<
  typeof SupplementExperimentalOptionSchema
>;
export type SupplementNotRecommended = z.infer<typeof SupplementNotRecommendedSchema>;
export type LabSummary = z.infer<typeof LabSummarySchema>;
export type SupplementsPlanContract = z.infer<typeof SupplementsPlanSchema>;
