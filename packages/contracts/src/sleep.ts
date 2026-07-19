import { z } from "zod";

const SleepUncertaintySchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    messageKey: z.string().min(1).max(160),
  })
  .strict();

const SleepPhasesSchema = z
  .object({
    source: z.literal("manual_estimate"),
    remMinutes: z.number().int().min(0).max(1_440).nullable(),
    deepMinutes: z.number().int().min(0).max(1_440).nullable(),
    lightMinutes: z.number().int().min(0).max(1_440).nullable(),
  })
  .strict();

const SleepStrategySchema = z.enum([
  "target_window_7_9h",
  "protect_sleep_opportunity",
  "maintain_current_window",
  "review_long_duration_context",
  "stabilize_wake_time",
  "review_routine_and_environment",
  "trend_manual_estimates_only",
  "record_schedule",
]);

const ClockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const SleepConfidenceFactorSchema = z.enum([
  "sleep_hours_missing",
  "sleep_quality_missing",
  "sleep_regularity_missing",
  "quality_low",
  "regularity_variable",
  "manual_phases",
  "long_duration_context",
  "schedule_missing",
]);

export const SleepPlanSchema = z
  .object({
    status: z.enum(["valid", "provisional", "not_requested"]),
    completeness: z.enum(["complete", "provisional"]),
    targetWindowHours: z.object({ min: z.literal(7), max: z.literal(9) }).strict(),
    observedHours: z.number().min(0).max(24).nullable(),
    durationBand: z.enum(["missing", "below_window", "within_window", "above_window"]),
    schedule: z
      .object({
        bedTime: ClockTimeSchema.nullable(),
        wakeTime: ClockTimeSchema.nullable(),
      })
      .strict(),
    regularity: z.enum(["regular", "somewhat_variable", "very_variable"]).nullable(),
    quality: z.enum(["very_poor", "poor", "fair", "good", "very_good"]).nullable(),
    phases: SleepPhasesSchema.nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    confidenceFactors: z.array(SleepConfidenceFactorSchema).max(20),
    strategies: z.array(SleepStrategySchema).max(20),
    uncertainties: z.array(SleepUncertaintySchema).max(20),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.status === "valid") {
      if (
        plan.completeness !== "complete" ||
        plan.observedHours === null ||
        plan.regularity === null ||
        plan.quality === null ||
        plan.durationBand === "missing" ||
        plan.uncertainties.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "sleep_valid_requires_complete_critical_data",
          path: ["status"],
        });
      }
      return;
    }
    if (plan.status === "provisional") {
      if (plan.completeness !== "provisional" || plan.uncertainties.length === 0) {
        context.addIssue({
          code: "custom",
          message: "sleep_provisional_requires_uncertainty",
          path: ["status"],
        });
      }
      return;
    }
    if (
      plan.completeness !== "complete" ||
      plan.observedHours !== null ||
      plan.durationBand !== "missing" ||
      plan.schedule.bedTime !== null ||
      plan.schedule.wakeTime !== null ||
      plan.regularity !== null ||
      plan.quality !== null ||
      plan.phases !== null ||
      plan.confidence !== "high" ||
      plan.confidenceFactors.length > 0 ||
      plan.strategies.length > 0 ||
      plan.uncertainties.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "sleep_not_requested_must_be_neutral",
        path: ["status"],
      });
    }
  });

export type SleepPlanContract = z.infer<typeof SleepPlanSchema>;
