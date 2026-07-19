import {
  type ClinicalResult,
  type HydrationPlanContract,
} from "@health-design/contracts";
import type { QuestionnaireAnswers } from "@health-design/domain";

import { detectClinicalContext } from "../../clinical/index.ts";
import { resolveChoice, type ChoiceRule } from "../../index.ts";

type Answers = Partial<QuestionnaireAnswers> & Record<string, unknown>;

export type HydrationEngineInput = Readonly<{
  answers: Answers | QuestionnaireAnswers;
  clinical?: ClinicalResult;
}>;

const DEFAULT_ANCHORS = ["morning", "midday", "afternoon", "evening"] as const;
const ALCOHOL_WORDS = [
  "alcohol",
  "cerveza",
  "vino",
  "licor",
  "beer",
  "wine",
  "vodka",
  "whisky",
  "whiskey",
  "ron",
  "gin",
  "tequila",
] as const;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .trim();
}

function round50(value: number): number {
  return Math.round(value / 50) * 50;
}

function fixedRange(value: number) {
  return { center: value, maximum: value, minimum: value } as const;
}

function rangeFor(answers: Answers) {
  if (answers.pregnancyLactation === "pregnant") return fixedRange(2300);
  if (answers.pregnancyLactation === "lactating") return fixedRange(2700);
  if (answers.physiologicalSex === "female") return fixedRange(2000);
  if (answers.physiologicalSex === "male") return fixedRange(2500);
  return { center: 2250, maximum: 2500, minimum: 2000 } as const;
}

function isAlcohol(value: string): boolean {
  const normalized = normalize(value);
  return ALCOHOL_WORDS.some((word) => normalized === word || normalized.includes(word));
}

function anchorsFor(answers: Answers) {
  const selected = Array.isArray(answers.hydrationAnchors)
    ? answers.hydrationAnchors.filter(
        (anchor): anchor is string =>
          typeof anchor === "string" && anchor.trim().length > 0,
      )
    : [];
  return selected.length > 0
    ? { anchorSource: "selected" as const, anchors: selected.slice(0, 10) }
    : { anchorSource: "default" as const, anchors: [...DEFAULT_ANCHORS] };
}

function prolongedTraining(answers: Answers): boolean {
  const sessionMinutes =
    answers.ownTrainingSessionMinutes ?? answers.generatedTrainingSessionMinutes;
  return (
    typeof sessionMinutes === "number" &&
    sessionMinutes >= 60 &&
    (answers.trainingMode === "own" ||
      answers.trainingMode === "generated" ||
      answers.trainingMode === undefined)
  );
}

function asAnswers(
  input: HydrationEngineInput | Answers | QuestionnaireAnswers,
): Answers {
  const record = input as Record<string, unknown>;
  return ("answers" in record ? record.answers : record) as Answers;
}

function emptyNotRequested(): HydrationPlanContract {
  return {
    alcoholRecorded: false,
    anchorSource: "default",
    anchors: [...DEFAULT_ANCHORS],
    beverageBandMl: null,
    clinicalCoverage: "modeled",
    completeness: "complete",
    countedBeverages: [],
    electrolyteStrategy: "not_indicated",
    foodWaterEstimate: { center: 0.25, maximum: 0.3, minimum: 0.2 },
    proposedBeverages: [],
    reminders: false,
    safetyFindings: [],
    status: "not_requested",
    strategies: [],
    strictestActionLevel: "information",
    totalReferenceMl: fixedRange(2250),
    uncertainties: [],
  };
}

export function generateHydrationPlan(
  input: HydrationEngineInput | Answers | QuestionnaireAnswers,
): HydrationPlanContract {
  const answers = asAnswers(input);
  const selected =
    Array.isArray(answers.activeModules) && answers.activeModules.includes("hydration");
  if (!selected) return emptyNotRequested();

  const clinical =
    "clinical" in (input as Record<string, unknown>)
      ? ((input as HydrationEngineInput).clinical ?? detectClinicalContext(answers))
      : detectClinicalContext(answers);
  const totalReferenceMl = rangeFor(answers);
  const declaredBeverages = Array.isArray(answers.habitualBeverages)
    ? answers.habitualBeverages.filter(
        (beverage): beverage is string =>
          typeof beverage === "string" && beverage.trim().length > 0,
      )
    : [];
  const countedBeverages = declaredBeverages.filter((beverage) => !isAlcohol(beverage));
  const alcoholRecorded = declaredBeverages.some(isAlcohol);
  const { anchors, anchorSource } = anchorsFor(answers);
  const uncertainties = [...clinical.uncertainties];
  if (
    answers.physiologicalSex === undefined &&
    answers.pregnancyLactation !== "pregnant" &&
    answers.pregnancyLactation !== "lactating"
  ) {
    uncertainties.push({
      code: "SEX_REFERENCE_UNAVAILABLE",
      messageKey: "hydration.uncertainty.sex_reference_unavailable",
    });
  }

  const highContext =
    answers.hydrationClimate === "hot" ||
    answers.hydrationSweat === "high" ||
    clinical.detected.anabolic;
  const electrolyteActive =
    (answers.hydrationClimate === "hot" && answers.hydrationSweat === "high") ||
    prolongedTraining(answers);
  const limitMissing =
    clinical.detected.renal ||
    clinical.detected.cardiac ||
    clinical.detected.hyponatremia;
  const bandUnavailable =
    clinical.detected.fluidRestriction ||
    (limitMissing && !clinical.detected.fluidRestriction);

  const choiceRules: ChoiceRule<"high_side" | "standard">[] = [
    {
      actionLevel: clinical.detected.fluidRestriction
        ? "immediate_conservative"
        : "information",
      allowed: ["standard", "high_side"],
      id: "rule.hydration-safe-band@1.0.0",
      kind: "mandatory",
    },
    {
      actionLevel: highContext ? "adjustment" : "information",
      id: "rule.hydration-high-side@1.0.0",
      kind: "preferential",
      order: highContext ? ["high_side", "standard"] : ["standard", "high_side"],
    },
  ];
  const sideChoice = resolveChoice({
    options: ["standard", "high_side"],
    rules: choiceRules,
  }).choice;

  const beverageMaximum = round50(totalReferenceMl.maximum * 0.8);
  const beverageBandMl = bandUnavailable
    ? null
    : {
        center:
          sideChoice === "high_side"
            ? beverageMaximum
            : round50(totalReferenceMl.center * 0.75),
        maximum: beverageMaximum,
        minimum: round50(totalReferenceMl.minimum * 0.7),
      };
  const strategies = [
    "total_reference",
    "food_water_estimate",
    "flexible_anchors",
    "alcohol_excluded",
  ];
  if (sideChoice === "high_side") strategies.push("high_side_only");
  if (bandUnavailable) strategies.push("clinical_limit_precedes_reference");
  const planUncertainties = [
    ...new Map(uncertainties.map((item) => [item.code, item])).values(),
  ];
  const completeness = planUncertainties.length === 0 ? "complete" : "provisional";

  return {
    alcoholRecorded,
    anchorSource,
    anchors,
    beverageBandMl,
    clinicalCoverage: clinical.coverage,
    completeness,
    countedBeverages,
    electrolyteStrategy: electrolyteActive ? "contextual_review" : "not_indicated",
    foodWaterEstimate: { center: 0.25, maximum: 0.3, minimum: 0.2 },
    proposedBeverages: ["agua"],
    reminders: answers.hydrationReminders === true,
    safetyFindings: clinical.safetyFindings.map(({ code }) => code),
    status: completeness === "complete" ? "valid" : "provisional",
    strategies,
    strictestActionLevel: clinical.strictestActionLevel,
    totalReferenceMl,
    uncertainties: planUncertainties,
  };
}

export default generateHydrationPlan;
