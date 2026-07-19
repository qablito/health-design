import { z } from "zod";

import {
  ActionLevelSchema,
  ClinicalCoverageSchema,
  ClinicalUncertaintySchema,
} from "./clinical";

export const HydrationMlRangeSchema = z
  .object({
    center: z.number().int().min(0).multipleOf(50),
    maximum: z.number().int().min(0).multipleOf(50),
    minimum: z.number().int().min(0).multipleOf(50),
  })
  .strict()
  .refine(
    ({ minimum, center, maximum }) => minimum <= center && center <= maximum,
    "invalid_ml_range",
  );

const FoodWaterEstimateSchema = z
  .object({
    center: z.literal(0.25),
    maximum: z.literal(0.3),
    minimum: z.literal(0.2),
  })
  .strict();

export const HydrationPlanSchema = z
  .object({
    alcoholRecorded: z.boolean(),
    anchorSource: z.enum(["default", "selected"]),
    anchors: z.array(z.string().min(1).max(80)).max(10),
    beverageBandMl: HydrationMlRangeSchema.nullable(),
    clinicalCoverage: ClinicalCoverageSchema,
    completeness: z.enum(["complete", "provisional"]),
    countedBeverages: z.array(z.string().min(1).max(120)).max(50),
    electrolyteStrategy: z.enum(["not_indicated", "contextual_review"]),
    foodWaterEstimate: FoodWaterEstimateSchema,
    habitualWaterMl: z.number().int().min(0).max(10_000).nullable(),
    proposedBeverages: z.array(z.string().min(1).max(120)).max(20),
    reminders: z.boolean(),
    safetyFindings: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)).max(20),
    status: z.enum(["valid", "provisional", "not_requested"]),
    strategies: z.array(z.string().min(1).max(120)).max(20),
    strictestActionLevel: ActionLevelSchema,
    totalReferenceMl: HydrationMlRangeSchema,
    uncertainties: z.array(ClinicalUncertaintySchema).max(20),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.status === "valid") {
      if (
        plan.completeness !== "complete" ||
        plan.uncertainties.length > 0 ||
        plan.beverageBandMl === null ||
        plan.anchors.length === 0 ||
        plan.proposedBeverages.length === 0 ||
        plan.safetyFindings.length > 0 ||
        plan.habitualWaterMl === null
      ) {
        context.addIssue({
          code: "custom",
          message: "hydration_valid_requires_complete",
          path: ["status"],
        });
      }
      return;
    }
    if (plan.status === "provisional") {
      if (plan.completeness !== "provisional" || plan.uncertainties.length === 0) {
        context.addIssue({
          code: "custom",
          message: "hydration_provisional_requires_uncertainty",
          path: ["status"],
        });
      }
      return;
    }
    if (
      plan.completeness !== "complete" ||
      plan.uncertainties.length > 0 ||
      plan.beverageBandMl !== null ||
      plan.anchors.length > 0 ||
      plan.habitualWaterMl !== null ||
      plan.alcoholRecorded ||
      plan.clinicalCoverage !== "modeled" ||
      plan.anchorSource !== "default" ||
      plan.totalReferenceMl.center !== 2250 ||
      plan.totalReferenceMl.maximum !== 2500 ||
      plan.totalReferenceMl.minimum !== 2000 ||
      plan.foodWaterEstimate.center !== 0.25 ||
      plan.foodWaterEstimate.maximum !== 0.3 ||
      plan.foodWaterEstimate.minimum !== 0.2 ||
      plan.countedBeverages.length > 0 ||
      plan.proposedBeverages.length > 0 ||
      plan.strategies.length > 0 ||
      plan.safetyFindings.length > 0 ||
      plan.reminders ||
      plan.electrolyteStrategy !== "not_indicated" ||
      plan.strictestActionLevel !== "information"
    ) {
      context.addIssue({
        code: "custom",
        message: "hydration_not_requested_must_have_no_operational_plan",
        path: ["status"],
      });
    }
  });

export type HydrationPlanContract = z.infer<typeof HydrationPlanSchema>;
export type HydrationMlRange = HydrationPlanContract["totalReferenceMl"];
