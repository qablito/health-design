import type { QuestionnaireAnswers } from "@health-design/domain";
import type { SleepPlanContract } from "@health-design/contracts";

type Answers = Partial<QuestionnaireAnswers> & Record<string, unknown>;
type SleepEngineInput = Answers | Readonly<{ answers: Answers }>;

const TARGET_WINDOW_HOURS = { min: 7, max: 9 } as const;

function asAnswers(input: SleepEngineInput): Answers {
  const record = input as Record<string, unknown>;
  return ("answers" in record ? record.answers : record) as Answers;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): T | null {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : null;
}

const REGULARITIES = ["regular", "somewhat_variable", "very_variable"] as const;
const QUALITIES = ["very_poor", "poor", "fair", "good", "very_good"] as const;

function emptyNotRequested(): SleepPlanContract {
  return {
    status: "not_requested",
    completeness: "complete",
    targetWindowHours: TARGET_WINDOW_HOURS,
    observedHours: null,
    durationBand: "missing",
    schedule: { bedTime: null, wakeTime: null },
    regularity: null,
    quality: null,
    phases: null,
    confidence: "high",
    confidenceFactors: [],
    strategies: [],
    uncertainties: [],
  };
}

export function generateSleepPlan(input: SleepEngineInput): SleepPlanContract {
  const answers = asAnswers(input);
  if (
    !Array.isArray(answers.activeModules) ||
    !answers.activeModules.includes("sleep")
  ) {
    return emptyNotRequested();
  }

  const observedHours = isNumber(answers.sleepHours) ? answers.sleepHours : null;
  const durationBand =
    observedHours === null
      ? "missing"
      : observedHours < TARGET_WINDOW_HOURS.min
        ? "below_window"
        : observedHours <= TARGET_WINDOW_HOURS.max
          ? "within_window"
          : "above_window";
  const regularity = nullableEnum(answers.sleepRegularity, REGULARITIES);
  const quality = nullableEnum(answers.sleepQuality, QUALITIES);
  const bedTime = nullableString(answers.sleepBedTime);
  const wakeTime = nullableString(answers.sleepWakeTime);

  const phasesValues = {
    remMinutes: isNumber(answers.sleepRemMinutes) ? answers.sleepRemMinutes : null,
    deepMinutes: isNumber(answers.sleepDeepMinutes) ? answers.sleepDeepMinutes : null,
    lightMinutes: isNumber(answers.sleepLightMinutes)
      ? answers.sleepLightMinutes
      : null,
  };
  const hasPhase = Object.values(phasesValues).some((value) => value !== null);
  const phases =
    answers.sleepTracking === true && hasPhase
      ? { source: "manual_estimate" as const, ...phasesValues }
      : null;

  const uncertainties: SleepPlanContract["uncertainties"] = [];
  const confidenceFactors: SleepPlanContract["confidenceFactors"] = [];
  if (observedHours === null) {
    uncertainties.push({
      code: "SLEEP_HOURS_MISSING",
      messageKey: "sleep.uncertainty.hours_missing",
    });
    confidenceFactors.push("sleep_hours_missing");
  }
  if (quality === null) {
    uncertainties.push({
      code: "SLEEP_QUALITY_MISSING",
      messageKey: "sleep.uncertainty.quality_missing",
    });
    confidenceFactors.push("sleep_quality_missing");
  }
  if (regularity === null) {
    uncertainties.push({
      code: "SLEEP_REGULARITY_MISSING",
      messageKey: "sleep.uncertainty.regularity_missing",
    });
    confidenceFactors.push("sleep_regularity_missing");
  }

  const strategies: SleepPlanContract["strategies"] = ["target_window_7_9h"];
  if (durationBand === "below_window") strategies.push("protect_sleep_opportunity");
  if (durationBand === "within_window") strategies.push("maintain_current_window");
  if (durationBand === "above_window") {
    strategies.push("review_long_duration_context");
    confidenceFactors.push("long_duration_context");
  }
  if (regularity === "somewhat_variable" || regularity === "very_variable") {
    strategies.push("stabilize_wake_time");
    confidenceFactors.push("regularity_variable");
  }
  if (quality === "poor" || quality === "very_poor") {
    strategies.push("review_routine_and_environment");
    confidenceFactors.push("quality_low");
  }
  if (phases !== null) {
    strategies.push("trend_manual_estimates_only");
    confidenceFactors.push("manual_phases");
  }
  if (bedTime === null || wakeTime === null) {
    strategies.push("record_schedule");
    confidenceFactors.push("schedule_missing");
  }

  const confidence =
    uncertainties.length > 0
      ? "low"
      : confidenceFactors.some((factor) =>
            [
              "quality_low",
              "regularity_variable",
              "manual_phases",
              "long_duration_context",
            ].includes(factor),
          )
        ? "medium"
        : "high";

  return {
    status: uncertainties.length === 0 ? "valid" : "provisional",
    completeness: uncertainties.length === 0 ? "complete" : "provisional",
    targetWindowHours: TARGET_WINDOW_HOURS,
    observedHours,
    durationBand,
    schedule: { bedTime, wakeTime },
    regularity,
    quality,
    phases,
    confidence,
    confidenceFactors,
    strategies,
    uncertainties,
  };
}
