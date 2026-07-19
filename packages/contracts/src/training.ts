import { z } from "zod";

const ExerciseIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const ShortTextSchema = z.string().min(1).max(240);

export const ExerciseAlternativeSchema = z
  .object({
    exerciseId: ExerciseIdSchema,
    name: z.string().min(1).max(100),
  })
  .strict();

export const ExercisePrescriptionSchema = z
  .object({
    alternatives: z.array(ExerciseAlternativeSchema).min(0).max(3),
    durationSeconds: z.number().int().min(5).max(1_800).optional(),
    exerciseId: ExerciseIdSchema,
    name: z.string().min(1).max(100),
    progression: ShortTextSchema,
    repetitions: z.string().min(1).max(40).optional(),
    restSeconds: z.number().int().min(0).max(600),
    rir: z.number().int().min(0).max(5).optional(),
    rpe: z.number().min(1).max(10).optional(),
    sets: z.number().int().min(1).max(10),
    steps: z.array(ShortTextSchema).min(2).max(6),
    technique: ShortTextSchema,
    technicalTerms: z
      .array(
        z
          .object({
            explanation: ShortTextSchema,
            term: z.string().min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    tempo: z.string().min(1).max(80),
    visual: z
      .object({
        alt: ShortTextSchema,
        src: z.string().regex(/^\/assets\/exercises\/[a-z0-9-]+\.svg$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((exercise, context) => {
    if (exercise.durationSeconds === undefined && exercise.repetitions === undefined) {
      context.addIssue({ code: "custom", message: "exercise_dose_required" });
    }
    if (exercise.durationSeconds !== undefined && exercise.repetitions !== undefined) {
      context.addIssue({
        code: "custom",
        message: "exercise_dose_must_be_unambiguous",
      });
    }
    if ((exercise.rpe === undefined) !== (exercise.rir === undefined)) {
      context.addIssue({
        code: "custom",
        message: "exercise_rpe_rir_pair_required",
        path: [exercise.rpe === undefined ? "rpe" : "rir"],
      });
    }
  });

type TrainingDoseEstimateExercise = Readonly<{
  durationSeconds?: number | undefined;
  repetitions?: string | undefined;
  restSeconds: number;
  sets: number;
  tempo: string;
}>;

function tempoSeconds(tempo: string): number {
  const match = /^\s*(\d+)(?:-(\d+))?(?:-(\d+))?/.exec(tempo);
  if (!match) return 4;
  return match
    .slice(1)
    .filter((value): value is string => value !== undefined)
    .reduce((total, value) => total + Number(value), 0);
}

function repetitionCount(repetitions: string | undefined): number {
  if (!repetitions) return 1;
  const values = repetitions.match(/\d+/g)?.map(Number) ?? [1];
  const maximum = Math.max(...values);
  return /por lado/i.test(repetitions) ? maximum * 2 : maximum;
}

function prescriptionSeconds(exercise: TrainingDoseEstimateExercise): number {
  const workPerSet =
    exercise.durationSeconds ??
    repetitionCount(exercise.repetitions) * tempoSeconds(exercise.tempo);
  return (
    workPerSet * exercise.sets +
    exercise.restSeconds * Math.max(0, exercise.sets - 1) +
    20
  );
}

export function estimateTrainingSessionMinutes(session: {
  cooldown: readonly TrainingDoseEstimateExercise[];
  main: readonly TrainingDoseEstimateExercise[];
  warmup: readonly TrainingDoseEstimateExercise[];
}): number {
  const seconds = [session.warmup, session.main, session.cooldown]
    .flat()
    .reduce((total, exercise) => total + prescriptionSeconds(exercise), 60);
  return Math.max(1, Math.ceil(seconds / 60));
}

export const TrainingSessionSchema = z
  .object({
    cooldown: z.array(ExercisePrescriptionSchema).min(1).max(6),
    day: z.number().int().min(1).max(7),
    durationMinutes: z.number().int().min(1).max(240),
    focus: z.string().min(1).max(120),
    id: z.string().regex(/^week-[1-4]-session-[1-7]$/),
    main: z.array(ExercisePrescriptionSchema).min(1).max(12),
    progression: ShortTextSchema,
    recoveryRole: z.enum(["reduced_load", "standard"]),
    warmup: z.array(ExercisePrescriptionSchema).min(1).max(6),
    week: z.number().int().min(1).max(4),
  })
  .strict();

const TrainingUncertaintySchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    messageKey: z.string().min(1).max(160),
  })
  .strict();

export const GeneratedTrainingPlanSchema = z
  .object({
    availability: z
      .object({
        daysPerWeek: z.number().int().min(1).max(7),
        durationBasis: z.literal("dose_estimate_v1"),
        equipment: z.array(z.string().min(1).max(80)).min(1).max(20),
        level: z.enum(["beginner", "intermediate", "advanced", "unknown"]),
        otherStyle: ShortTextSchema.nullable(),
        requestedSessionMinutes: z.number().int().min(10).max(240),
        primaryObjective: z.string().min(1).max(80).nullable(),
        sessionMinutes: z.number().int().min(1).max(240),
        styles: z.array(z.string().min(1).max(80)).min(1).max(20),
      })
      .strict(),
    completeness: z.enum(["complete", "provisional"]),
    mode: z.literal("generated"),
    routineGenerated: z.literal(true),
    uncertainties: z.array(TrainingUncertaintySchema).max(20),
    weeks: z
      .array(
        z
          .object({
            sessions: z.array(TrainingSessionSchema).min(1).max(7),
            week: z.number().int().min(1).max(4),
          })
          .strict(),
      )
      .length(4),
  })
  .strict()
  .superRefine((plan, context) => {
    if ((plan.completeness === "complete") !== (plan.uncertainties.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "training_completeness_uncertainty_mismatch",
        path: ["completeness"],
      });
    }
    const durations: number[] = [];
    for (const [weekIndex, week] of plan.weeks.entries()) {
      const expectedWeek = weekIndex + 1;
      if (week.week !== expectedWeek) {
        context.addIssue({
          code: "custom",
          message: "training_week_sequence_mismatch",
          path: ["weeks", weekIndex, "week"],
        });
      }
      if (week.sessions.length !== plan.availability.daysPerWeek) {
        context.addIssue({
          code: "custom",
          message: "training_session_count_mismatch",
          path: ["weeks", weekIndex, "sessions"],
        });
      }
      for (const [sessionIndex, session] of week.sessions.entries()) {
        durations.push(session.durationMinutes);
        const expectedDay = sessionIndex + 1;
        if (
          session.week !== expectedWeek ||
          session.day !== expectedDay ||
          session.id !== `week-${expectedWeek}-session-${expectedDay}`
        ) {
          context.addIssue({
            code: "custom",
            message: "training_session_identity_mismatch",
            path: ["weeks", weekIndex, "sessions", sessionIndex],
          });
        }
        if (session.durationMinutes > plan.availability.requestedSessionMinutes) {
          context.addIssue({
            code: "custom",
            message: "training_session_exceeds_availability",
            path: ["weeks", weekIndex, "sessions", sessionIndex, "durationMinutes"],
          });
        }
        if (session.durationMinutes !== estimateTrainingSessionMinutes(session)) {
          context.addIssue({
            code: "custom",
            message: "training_session_duration_estimate_mismatch",
            path: ["weeks", weekIndex, "sessions", sessionIndex, "durationMinutes"],
          });
        }
      }
    }
    if (Math.max(...durations) !== plan.availability.sessionMinutes) {
      context.addIssue({
        code: "custom",
        message: "training_maximum_duration_mismatch",
        path: ["availability", "sessionMinutes"],
      });
    }
  });

export const OwnTrainingPlanSchema = z
  .object({
    adaptations: z
      .object({
        hydration: z.string().min(1).max(240),
        mobility: z.string().min(1).max(240),
        nutrition: z.string().min(1).max(240),
        sleep: z.string().min(1).max(240),
      })
      .strict(),
    completeness: z.enum(["complete", "provisional"]),
    mode: z.literal("own"),
    routineGenerated: z.literal(false),
    sessions: z.array(z.never()).length(0),
    uncertainties: z.array(TrainingUncertaintySchema).max(20),
    weeklyContext: z
      .object({
        daysPerWeek: z.number().int().min(1).max(7).nullable(),
        anchors: z.array(z.string().min(1).max(80)).max(10),
        intensity: z.enum(["low", "moderate", "high", "variable"]).nullable(),
        sessionMinutes: z.number().int().min(5).max(480).nullable(),
        types: z.array(z.string().min(1).max(80)).max(20),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    if ((plan.completeness === "complete") !== (plan.uncertainties.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "own_training_completeness_uncertainty_mismatch",
        path: ["completeness"],
      });
    }
  });

export const NoTrainingPlanSchema = z
  .object({
    mode: z.literal("none"),
    reason: z.literal("training_disabled_by_user"),
    routineGenerated: z.literal(false),
    sessions: z.array(z.never()).length(0),
  })
  .strict();

export const TrainingPlanSchema = z.union([
  GeneratedTrainingPlanSchema,
  OwnTrainingPlanSchema,
  NoTrainingPlanSchema,
]);

export type ExercisePrescriptionContract = z.infer<typeof ExercisePrescriptionSchema>;
export type GeneratedTrainingPlanContract = z.infer<typeof GeneratedTrainingPlanSchema>;
export type TrainingPlanContract = z.infer<typeof TrainingPlanSchema>;
