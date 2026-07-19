import { z } from "zod";

const MobilityItemSchema = z
  .object({
    alternatives: z
      .array(
        z
          .object({
            exerciseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            name: z.string().min(1).max(100),
          })
          .strict(),
      )
      .min(0)
      .max(3),
    durationSeconds: z.number().int().min(5).max(300),
    exerciseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1).max(100),
    steps: z.array(z.string().min(1).max(240)).min(2).max(6),
    technique: z.string().min(1).max(240),
    visual: z
      .object({
        alt: z.string().min(1).max(240),
        src: z.string().regex(/^\/assets\/exercises\/[a-z0-9-]+\.svg$/),
      })
      .strict(),
  })
  .strict();

const MobilityUncertaintySchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    messageKey: z.string().min(1).max(160),
  })
  .strict();

export const MobilityPlanSchema = z
  .object({
    completeness: z.enum(["complete", "provisional"]),
    core: z.array(MobilityItemSchema).min(1).max(6),
    coreMinutes: z.literal(5),
    extensions: z
      .array(
        z
          .object({
            exercises: z.array(MobilityItemSchema).min(1).max(6),
            label: z.string().min(1).max(100),
            minutes: z.literal(5),
          })
          .strict(),
      )
      .max(2),
    suggestedAnchors: z
      .array(
        z.enum([
          "after_training",
          "before_training",
          "daily_break",
          "evening",
          "morning",
        ]),
      )
      .min(1)
      .max(5),
    anchorSource: z.enum(["default", "selected"]),
    totalMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    uncertainties: z.array(MobilityUncertaintySchema).max(20),
  })
  .strict()
  .superRefine((plan, context) => {
    if ((plan.completeness === "complete") !== (plan.uncertainties.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "mobility_completeness_uncertainty_mismatch",
        path: ["completeness"],
      });
    }
    if (plan.extensions.length !== (plan.totalMinutes - plan.coreMinutes) / 5) {
      context.addIssue({
        code: "custom",
        message: "mobility_extension_count_mismatch",
        path: ["extensions"],
      });
    }
    const blocks = [plan.core, ...plan.extensions.map(({ exercises }) => exercises)];
    for (const [index, exercises] of blocks.entries()) {
      if (
        exercises.reduce(
          (seconds, exercise) => seconds + exercise.durationSeconds,
          0,
        ) !== 300
      ) {
        context.addIssue({
          code: "custom",
          message: "mobility_block_duration_mismatch",
          path: index === 0 ? ["core"] : ["extensions", index - 1, "exercises"],
        });
      }
    }
  });

export type MobilityPlanContract = z.infer<typeof MobilityPlanSchema>;
