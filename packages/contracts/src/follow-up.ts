import { z } from "zod";

import { PlanCandidateAckSchema, PlanModuleSchema } from "./plans";

export const FOLLOW_UP_SCHEMA_VERSION = 1 as const;

const TimestampSchema = z.iso.datetime({ offset: true });
const DecimalSchema = z
  .string()
  .max(64)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const ScoreFiveSchema = z.number().int().min(1).max(5);
const ModuleListSchema = z
  .array(PlanModuleSchema)
  .min(1)
  .max(6)
  .refine((items) => new Set(items).size === items.length, "duplicate_module");

export const FollowUpScopeSchema = z.enum(["daily", "weekly", "four_week"]);
export const FollowUpCompletenessSchema = z.enum(["complete", "provisional"]);
export const FollowUpMaterialChangeSchema = z.enum([
  "clinical",
  "medication",
  "objective",
  "pregnancy_lactation",
  "training_structure",
]);

const ImportantSymptomSchema = z
  .object({
    modules: ModuleListSchema,
    severity: z.literal("important"),
  })
  .strict();

const CommonValuesSchema = z
  .object({
    adherence: ScoreFiveSchema,
    importantSymptoms: z.array(ImportantSymptomSchema).max(6),
    materialChanges: z
      .array(FollowUpMaterialChangeSchema)
      .max(5)
      .refine((items) => new Set(items).size === items.length, "duplicate_change"),
  })
  .strict();

const NutritionValuesSchema = z
  .object({
    adherence: ScoreFiveSchema.optional(),
    foodAnxiety: z
      .enum(["none", "sometimes", "frequent", "prefer_not_to_say"])
      .optional(),
    hunger: ScoreFiveSchema.optional(),
    satiety: ScoreFiveSchema.optional(),
  })
  .strict();

const TrainingValuesSchema = z
  .object({
    completedSessions: z.number().int().min(0).max(14).optional(),
    fatigue: ScoreFiveSchema.optional(),
    pain: z.enum(["none", "mild", "important"]).optional(),
    perceivedEffort: z.number().int().min(1).max(10).optional(),
    plannedSessions: z.number().int().min(0).max(14).optional(),
    volumeChangePercent: z.number().int().min(-100).max(100).optional(),
  })
  .strict();

const HydrationValuesSchema = z
  .object({
    averageMl: z.number().int().min(0).max(10_000).optional(),
    issues: z.enum(["none", "mild", "important"]).optional(),
  })
  .strict();

const SleepValuesSchema = z
  .object({
    averageHours: z.number().min(0).max(24).optional(),
    deepMinutes: z.number().int().min(0).max(1_440).optional(),
    lightMinutes: z.number().int().min(0).max(1_440).optional(),
    quality: ScoreFiveSchema.optional(),
    regularity: z.enum(["regular", "somewhat_variable", "very_variable"]).optional(),
    remMinutes: z.number().int().min(0).max(1_440).optional(),
  })
  .strict()
  .superRefine((values, context) => {
    const phases = [values.deepMinutes, values.lightMinutes, values.remMinutes];
    if (phases.every((value) => value === undefined)) return;
    if (values.averageHours === undefined) {
      context.addIssue({
        code: "custom",
        message: "sleep_total_required_for_phases",
        path: ["averageHours"],
      });
      return;
    }
    const phaseMinutes = phases.reduce<number>(
      (total, value) => total + (value ?? 0),
      0,
    );
    if (phaseMinutes > Math.round(values.averageHours * 60)) {
      context.addIssue({
        code: "custom",
        message: "sleep_phases_exceed_total",
        path: ["deepMinutes"],
      });
    }
  });

const MobilityValuesSchema = z
  .object({
    discomfort: z.enum(["none", "mild", "important"]).optional(),
    sessionsCompleted: z.number().int().min(0).max(14).optional(),
  })
  .strict();

const SupplementsValuesSchema = z
  .object({
    adverseEffects: z.enum(["none", "mild", "important"]).optional(),
    benefit: z.enum(["none", "unclear", "positive"]).optional(),
    change: z.enum(["none", "started", "stopped"]).optional(),
  })
  .strict();

export const FollowUpValuesSchema = z
  .object({
    common: CommonValuesSchema.optional(),
    hydration: HydrationValuesSchema.optional(),
    mobility: MobilityValuesSchema.optional(),
    nutrition: NutritionValuesSchema.optional(),
    sleep: SleepValuesSchema.optional(),
    supplements: SupplementsValuesSchema.optional(),
    training: TrainingValuesSchema.optional(),
  })
  .strict();

export const FollowUpCreateRequestSchema = z
  .object({
    basePlanVersionId: z.uuid(),
    observedAt: TimestampSchema,
    requestRecalculation: z.boolean().optional(),
    schemaVersion: z.literal(FOLLOW_UP_SCHEMA_VERSION),
    scope: FollowUpScopeSchema,
    values: FollowUpValuesSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (Object.keys(request.values).length === 0) {
      context.addIssue({
        code: "custom",
        message: "follow_up_values_required",
        path: ["values"],
      });
    }
    if (request.scope !== "daily" && request.values.common === undefined) {
      context.addIssue({
        code: "custom",
        message: "weekly_common_values_required",
        path: ["values", "common"],
      });
    }
  });

export const FollowUpEntrySchema = z
  .object({
    basePlanVersionId: z.uuid(),
    completeness: FollowUpCompletenessSchema,
    createdAt: TimestampSchema,
    id: z.uuid(),
    observedAt: TimestampSchema,
    planId: z.uuid(),
    profileId: z.uuid(),
    requestRecalculation: z.boolean(),
    scope: FollowUpScopeSchema,
    values: FollowUpValuesSchema,
  })
  .strict();

export const FollowUpHistorySchema = z
  .object({
    entries: z.array(FollowUpEntrySchema).max(500),
    pendingCandidates: z.array(PlanCandidateAckSchema).max(50),
    profileId: z.uuid(),
  })
  .strict();

export const FollowUpEntryListSchema = z
  .object({
    entries: z.array(FollowUpEntrySchema).max(500),
    profileId: z.uuid(),
  })
  .strict();

export const LabAnalyteSchema = z.enum([
  "b12",
  "folate",
  "magnesium",
  "creatinine",
  "egfr",
  "other",
]);

export const LabMeasurementSchema = z.discriminatedUnion("kind", [
  z.object({ date: z.iso.date(), kind: z.literal("exact") }).strict(),
  z
    .object({
      from: z.iso.date(),
      kind: z.literal("range"),
      to: z.iso.date(),
    })
    .strict()
    .refine(({ from, to }) => from <= to, "invalid_measurement_range"),
  z.object({ kind: z.literal("unknown") }).strict(),
]);

export const LabReferenceRangeSchema = z
  .object({
    maximum: DecimalSchema.optional(),
    minimum: DecimalSchema.optional(),
    unit: z.string().trim().min(1).max(32).optional(),
  })
  .strict()
  .refine(
    ({ maximum, minimum }) => maximum !== undefined || minimum !== undefined,
    "reference_bound_required",
  )
  .refine(
    ({ maximum, minimum }) =>
      maximum === undefined ||
      minimum === undefined ||
      Number(minimum) <= Number(maximum),
    "invalid_reference_range",
  );

export const LabObservationInputSchema = z
  .object({
    analyte: LabAnalyteSchema,
    measurement: LabMeasurementSchema,
    name: z.string().trim().min(1).max(80),
    referenceRange: LabReferenceRangeSchema.optional(),
    source: z.enum(["laboratory", "device", "self_reported"]),
    unit: z.string().trim().min(1).max(32).optional(),
    value: DecimalSchema,
  })
  .strict();

export const LabBatchCreateRequestSchema = z
  .object({
    basePlanVersionId: z.uuid(),
    observations: z.array(LabObservationInputSchema).min(1).max(4),
    requestRecalculation: z.boolean().optional(),
    schemaVersion: z.literal(FOLLOW_UP_SCHEMA_VERSION),
  })
  .strict();

export const LabObservationSchema = LabObservationInputSchema.extend({
  confidence: z.enum(["high", "medium", "low", "unknown"]),
  createdAt: TimestampSchema,
  id: z.uuid(),
  measuredFrom: z.iso.date().nullable(),
  measuredTo: z.iso.date().nullable(),
  profileId: z.uuid(),
}).strict();

export const LabBatchRecordAckSchema = z
  .object({
    batchId: z.uuid(),
    observations: z.array(LabObservationSchema).min(1).max(4),
    requestRecalculation: z.boolean(),
  })
  .strict();

export const LabObservationListSchema = z
  .object({
    observations: z.array(LabObservationSchema).max(500),
    profileId: z.uuid(),
  })
  .strict();

export const LabTrendSchema = z.enum(["up", "down", "stable", "insufficient"]);
export const LabInterpretationSchema = z.enum([
  "above_range",
  "below_range",
  "within_range",
  "unknown",
]);

export const LabFreshnessSchema = z
  .object({
    ageDays: z.number().int().min(0).nullable(),
    confidence: z.enum(["high", "medium", "low", "unknown"]),
    evidenceRef: z.string().max(256).nullable(),
    reviewAfterDays: z.number().int().positive().nullable(),
    ruleId: z.string().max(80).nullable(),
  })
  .strict();

export const LabHistoryItemSchema = z
  .object({
    analyte: LabAnalyteSchema,
    freshness: LabFreshnessSchema,
    interpretation: LabInterpretationSchema,
    latestObservationId: z.uuid(),
    latestValue: DecimalSchema,
    name: z.string().min(1).max(80),
    trend: LabTrendSchema,
    unit: z.string().min(1).max(32).nullable(),
  })
  .strict();

export const LabHistorySchema = z
  .object({
    items: z.array(LabHistoryItemSchema).max(100),
    observations: z.array(LabObservationSchema).max(500),
    pendingCandidates: z.array(PlanCandidateAckSchema).max(50),
    profileId: z.uuid(),
  })
  .strict();

export const TrackingCandidateListSchema = z
  .object({
    candidates: z.array(PlanCandidateAckSchema).max(50),
    profileId: z.uuid(),
  })
  .strict();

export const FollowUpImpactSchema = z
  .object({
    affectedModules: z.array(PlanModuleSchema).max(6),
    candidateRequired: z.boolean(),
    conservativeModules: z.array(PlanModuleSchema).max(6),
    impact: z.enum(["unaffected", "module_only", "dependent_modules", "structural"]),
    minorTrainingAdjustmentPercent: z.number().int().min(-10).max(10).nullable(),
    reasons: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)).max(20),
  })
  .strict();

export const FollowUpMutationAckSchema = z
  .object({
    candidate: PlanCandidateAckSchema.nullable(),
    contextUpdateRequired: z.boolean(),
    entry: FollowUpEntrySchema,
    impact: FollowUpImpactSchema,
  })
  .strict();

export const LabMutationAckSchema = z
  .object({
    candidate: PlanCandidateAckSchema.nullable(),
    history: LabHistorySchema,
  })
  .strict();

export type FollowUpCreateRequest = z.infer<typeof FollowUpCreateRequestSchema>;
export type FollowUpEntry = z.infer<typeof FollowUpEntrySchema>;
export type FollowUpImpact = z.infer<typeof FollowUpImpactSchema>;
export type FollowUpValues = z.infer<typeof FollowUpValuesSchema>;
export type LabAnalyte = z.infer<typeof LabAnalyteSchema>;
export type LabHistory = z.infer<typeof LabHistorySchema>;
export type LabObservation = z.infer<typeof LabObservationSchema>;
export type LabObservationInput = z.infer<typeof LabObservationInputSchema>;
