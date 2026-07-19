export const QUESTIONNAIRE_SCHEMA_VERSION = 2 as const;

export const NUTRITION_MODES = ["simple", "balanced"] as const;
export type NutritionMode = (typeof NUTRITION_MODES)[number];

export const DIETARY_PATTERNS = [
  "omnivore",
  "pescetarian",
  "vegetarian",
  "vegan",
] as const;
export type DietaryPattern = (typeof DIETARY_PATTERNS)[number];

export const NUTRITION_MEAL_ANCHORS = [
  "wake_up",
  "mid_morning",
  "midday",
  "afternoon",
  "evening",
  "pre_sleep",
  "pre_training",
  "post_training",
] as const;
export type NutritionMealAnchor = (typeof NUTRITION_MEAL_ANCHORS)[number];

export const QUESTIONNAIRE_MODULES = [
  "nutrition",
  "training",
  "hydration",
  "sleep",
  "mobility",
  "supplements",
] as const;
export type QuestionnaireModule = (typeof QUESTIONNAIRE_MODULES)[number];

export const OBJECTIVE_IDS = [
  "body_composition_lose_fat",
  "body_composition_gain_muscle",
  "body_composition_recomposition",
  "body_composition_maintain",
  "performance_strength",
  "performance_hypertrophy",
  "performance_endurance",
  "performance_general_fitness",
  "wellbeing_sleep",
  "wellbeing_energy",
  "wellbeing_stress",
  "wellbeing_healthy_habits",
] as const;
export type ObjectiveId = (typeof OBJECTIVE_IDS)[number];

export const QUESTIONNAIRE_BLOCK_IDS = [
  "core",
  "goals",
  "modules",
  "nutrition",
  "training",
  "hydration",
  "sleep",
  "mobility",
  "supplements",
  "clinical",
  "labs",
  "summary",
] as const;
export type QuestionnaireBlockId = (typeof QUESTIONNAIRE_BLOCK_IDS)[number];

export type NamedEntry = { name: string; note?: string | undefined };
export type MedicationEntry = NamedEntry & {
  dose?: string | undefined;
  frequency?: string | undefined;
  route?: string | undefined;
  schedule?: string | undefined;
};
export type IntoleranceEntry = NamedEntry & {
  severity: "mild" | "moderate" | "severe";
  toleratedAmount?: string | undefined;
};
export type LabValueEntry = {
  dateApproximate: string;
  name: string;
  referenceRange?: string | undefined;
  source?: "laboratory" | "device" | "self_reported" | undefined;
  unit: string;
  value: string;
};

type QuestionnaireAnswerValues = {
  activeModules?: QuestionnaireModule[];
  activityLevel?: "sedentary" | "light" | "moderate" | "high" | "very_high";
  age?: number;
  country?: "ES";
  dailySchedule?: "regular" | "variable" | "shift_work";
  dietaryPattern?: DietaryPattern;
  excludedFoods?: string[];
  generatedTrainingDaysPerWeek?: number;
  generatedTrainingEquipment?: string[];
  generatedTrainingExperience?: "advanced" | "beginner" | "intermediate";
  generatedTrainingOtherStyle?: string;
  generatedTrainingSessionMinutes?: number;
  generatedTrainingStyles?: string[];
  hasConditions?: boolean;
  hasCurrentSupplements?: boolean;
  hasLabValues?: boolean;
  hasMedications?: boolean;
  hasIndirectCalorimetry?: boolean;
  heightCm?: number;
  habitualBeverages?: string[];
  habitualWaterMl?: number;
  hydrationAnchors?: string[];
  hydrationClimate?: "temperate" | "hot" | "cold" | "variable";
  hydrationFluidRestriction?: boolean | "none" | "declared" | "unknown";
  hydrationReminders?: boolean;
  hydrationSweat?: "low" | "medium" | "high" | "unknown";
  labValues?: LabValueEntry[];
  mealsPerDay?: number;
  medications?: MedicationEntry[];
  menopauseStage?: "not_applicable" | "pre" | "peri" | "post" | "unknown";
  mobilityAreas?: string[];
  mobilityAnchors?: string[];
  mobilityDiscomfortDetails?: string[];
  mobilityDiscomfortStatus?: "none" | "declared" | "unknown";
  mobilityMinutes?: 5 | 10 | 15;
  nutritionAllergies?: NamedEntry[];
  nutritionAllergiesStatus?: "none" | "declared" | "unknown";
  nutritionFoodAnxiety?: "no" | "sometimes" | "frequent" | "prefer_not_to_say";
  nutritionIntolerances?: IntoleranceEntry[];
  nutritionIntolerancesStatus?: "none" | "declared" | "unknown";
  nutritionMealAnchors?: NutritionMealAnchor[];
  nutritionMode?: NutritionMode;
  ownTrainingDaysPerWeek?: number;
  ownTrainingAnchors?: string[];
  ownTrainingIntensity?: "low" | "moderate" | "high" | "variable";
  ownTrainingSessionMinutes?: number;
  ownTrainingTypes?: string[];
  physiologicalSex?: "female" | "male" | "intersex" | "prefer_not_to_say";
  pregnancyLactation?:
    | "not_applicable"
    | "none"
    | "pregnant"
    | "lactating"
    | "trying_to_conceive"
    | "unknown";
  preferredFoods?: string[];
  preferredSupermarket?: string;
  primaryObjective?: ObjectiveId;
  proteinPreference?: "food_only" | "usual_powder" | "optional_substitution";
  indirectCalorimetryDate?: string;
  indirectCalorimetryRmrKcal?: number;
  indirectCalorimetrySource?: "clinical_service" | "sports_service" | "other";
  secondaryObjectives?: ObjectiveId[];
  sleepBedTime?: string;
  sleepDeepMinutes?: number;
  sleepHours?: number;
  sleepLightMinutes?: number;
  sleepQuality?: "very_poor" | "poor" | "fair" | "good" | "very_good";
  sleepRegularity?: "regular" | "somewhat_variable" | "very_variable";
  sleepRemMinutes?: number;
  sleepTracking?: boolean;
  sleepWakeTime?: string;
  supplementGoals?: string[];
  supplementRecommendationPreference?: "only_deficiencies" | "contextual" | "none";
  compareSupermarkets?: boolean;
  targetWeightKg?: number;
  currentSupplements?: MedicationEntry[];
  trainingLimitations?: string[];
  trainingLimitationsStatus?: "none" | "declared" | "unknown";
  trainingMode?: "generated" | "own" | "none";
  weightKg?: number;
  conditions?: NamedEntry[];
};

export type QuestionnaireAnswers = {
  [Key in keyof QuestionnaireAnswerValues]?: QuestionnaireAnswerValues[Key] | undefined;
};

type HardError = {
  answerId: "activeModules" | "primaryObjective" | "secondaryObjectives";
  code:
    "modules_required" | "primary_objective_required" | "secondary_objectives_limit";
};

export type QuestionnaireUncertainty = {
  affectedModules: QuestionnaireModule[];
  answerId: keyof QuestionnaireAnswers;
  blockId: QuestionnaireBlockId;
  reason: string;
};

type CriticalRule = {
  answerId: keyof QuestionnaireAnswers;
  blockId: QuestionnaireBlockId;
  modules: readonly QuestionnaireModule[];
  when?: (answers: QuestionnaireAnswers) => boolean;
};

const ALL_MODULES = QUESTIONNAIRE_MODULES;
const BODY_DEPENDENT_MODULES = ["nutrition", "training", "hydration"] as const;

const CRITICAL_RULES: readonly CriticalRule[] = [
  { answerId: "age", blockId: "core", modules: ALL_MODULES },
  { answerId: "physiologicalSex", blockId: "core", modules: ALL_MODULES },
  { answerId: "country", blockId: "core", modules: ALL_MODULES },
  { answerId: "activityLevel", blockId: "core", modules: ALL_MODULES },
  { answerId: "heightCm", blockId: "core", modules: BODY_DEPENDENT_MODULES },
  { answerId: "weightKg", blockId: "core", modules: BODY_DEPENDENT_MODULES },
  {
    answerId: "indirectCalorimetryRmrKcal",
    blockId: "core",
    modules: ["nutrition"],
    when: (answers) => answers.hasIndirectCalorimetry === true,
  },
  {
    answerId: "indirectCalorimetryDate",
    blockId: "core",
    modules: ["nutrition"],
    when: (answers) => answers.hasIndirectCalorimetry === true,
  },
  {
    answerId: "indirectCalorimetrySource",
    blockId: "core",
    modules: ["nutrition"],
    when: (answers) => answers.hasIndirectCalorimetry === true,
  },
  {
    answerId: "targetWeightKg",
    blockId: "goals",
    modules: BODY_DEPENDENT_MODULES,
    when: (answers) =>
      answers.primaryObjective === "body_composition_lose_fat" ||
      answers.primaryObjective === "body_composition_gain_muscle",
  },
  { answerId: "trainingMode", blockId: "training", modules: ALL_MODULES },
  { answerId: "hasConditions", blockId: "clinical", modules: ALL_MODULES },
  { answerId: "hasMedications", blockId: "clinical", modules: ALL_MODULES },
  {
    answerId: "conditions",
    blockId: "clinical",
    modules: ALL_MODULES,
    when: (answers) => answers.hasConditions === true,
  },
  {
    answerId: "medications",
    blockId: "clinical",
    modules: ALL_MODULES,
    when: (answers) => answers.hasMedications === true,
  },
  {
    answerId: "pregnancyLactation",
    blockId: "clinical",
    modules: ALL_MODULES,
    when: (answers) =>
      answers.physiologicalSex === "female" || answers.physiologicalSex === "intersex",
  },
  {
    answerId: "menopauseStage",
    blockId: "clinical",
    modules: ALL_MODULES,
    when: (answers) => answers.physiologicalSex === "female",
  },
  { answerId: "mealsPerDay", blockId: "nutrition", modules: ["nutrition"] },
  { answerId: "nutritionMode", blockId: "nutrition", modules: ["nutrition"] },
  { answerId: "dietaryPattern", blockId: "nutrition", modules: ["nutrition"] },
  {
    answerId: "nutritionAllergiesStatus",
    blockId: "nutrition",
    modules: ["nutrition"],
  },
  {
    answerId: "nutritionAllergies",
    blockId: "nutrition",
    modules: ["nutrition"],
    when: (answers) => answers.nutritionAllergiesStatus === "declared",
  },
  {
    answerId: "nutritionIntolerancesStatus",
    blockId: "nutrition",
    modules: ["nutrition"],
  },
  {
    answerId: "nutritionIntolerances",
    blockId: "nutrition",
    modules: ["nutrition"],
    when: (answers) => answers.nutritionIntolerancesStatus === "declared",
  },
  {
    answerId: "nutritionFoodAnxiety",
    blockId: "nutrition",
    modules: ["nutrition"],
  },
  { answerId: "proteinPreference", blockId: "nutrition", modules: ["nutrition"] },
  {
    answerId: "generatedTrainingStyles",
    blockId: "training",
    modules: ["training"],
    when: (answers) => answers.trainingMode === "generated",
  },
  {
    answerId: "generatedTrainingDaysPerWeek",
    blockId: "training",
    modules: ["training"],
    when: (answers) => answers.trainingMode === "generated",
  },
  {
    answerId: "generatedTrainingOtherStyle",
    blockId: "training",
    modules: ["training"],
    when: (answers) =>
      answers.trainingMode === "generated" &&
      Boolean(answers.generatedTrainingStyles?.includes("other")),
  },
  {
    answerId: "generatedTrainingExperience",
    blockId: "training",
    modules: ["training"],
    when: (answers) => answers.trainingMode === "generated",
  },
  {
    answerId: "generatedTrainingSessionMinutes",
    blockId: "training",
    modules: ["training"],
    when: (answers) => answers.trainingMode === "generated",
  },
  {
    answerId: "generatedTrainingEquipment",
    blockId: "training",
    modules: ["training"],
    when: (answers) => answers.trainingMode === "generated",
  },
  {
    answerId: "trainingLimitationsStatus",
    blockId: "training",
    modules: ["training", "mobility"],
    when: (answers) => answers.trainingMode !== "none",
  },
  {
    answerId: "trainingLimitations",
    blockId: "training",
    modules: ["training", "mobility"],
    when: (answers) => answers.trainingLimitationsStatus === "declared",
  },
  {
    answerId: "ownTrainingTypes",
    blockId: "training",
    modules: ALL_MODULES,
    when: (answers) => answers.trainingMode === "own",
  },
  {
    answerId: "ownTrainingDaysPerWeek",
    blockId: "training",
    modules: ALL_MODULES,
    when: (answers) => answers.trainingMode === "own",
  },
  {
    answerId: "ownTrainingSessionMinutes",
    blockId: "training",
    modules: ALL_MODULES,
    when: (answers) => answers.trainingMode === "own",
  },
  {
    answerId: "ownTrainingIntensity",
    blockId: "training",
    modules: ALL_MODULES,
    when: (answers) => answers.trainingMode === "own",
  },
  {
    answerId: "ownTrainingAnchors",
    blockId: "training",
    modules: ALL_MODULES,
    when: (answers) => answers.trainingMode === "own",
  },
  {
    answerId: "habitualWaterMl",
    blockId: "hydration",
    modules: ["hydration"],
  },
  {
    answerId: "hydrationFluidRestriction",
    blockId: "hydration",
    modules: ["hydration"],
  },
  { answerId: "hydrationSweat", blockId: "hydration", modules: ["hydration"] },
  { answerId: "sleepHours", blockId: "sleep", modules: ["sleep"] },
  { answerId: "sleepQuality", blockId: "sleep", modules: ["sleep"] },
  { answerId: "sleepRegularity", blockId: "sleep", modules: ["sleep"] },
  { answerId: "mobilityAreas", blockId: "mobility", modules: ["mobility"] },
  { answerId: "mobilityAnchors", blockId: "mobility", modules: ["mobility"] },
  {
    answerId: "mobilityDiscomfortStatus",
    blockId: "mobility",
    modules: ["mobility"],
  },
  {
    answerId: "mobilityDiscomfortDetails",
    blockId: "mobility",
    modules: ["mobility"],
    when: (answers) => answers.mobilityDiscomfortStatus === "declared",
  },
  {
    answerId: "hasCurrentSupplements",
    blockId: "supplements",
    modules: ["supplements"],
  },
  {
    answerId: "currentSupplements",
    blockId: "supplements",
    modules: ["supplements"],
    when: (answers) => answers.hasCurrentSupplements === true,
  },
  {
    answerId: "supplementRecommendationPreference",
    blockId: "supplements",
    modules: ["supplements"],
  },
] as const;

function hasAnswer(
  answers: QuestionnaireAnswers,
  answerId: keyof QuestionnaireAnswers,
) {
  const value = answers[answerId];
  return (
    value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0)
  );
}

function activeAffectedModules(
  answers: QuestionnaireAnswers,
  modules: readonly QuestionnaireModule[],
): QuestionnaireModule[] {
  return (answers.activeModules ?? []).filter((module) => modules.includes(module));
}

export function getVisibleQuestionIds(
  answers: QuestionnaireAnswers,
): Array<keyof QuestionnaireAnswers> {
  const visible = new Set<keyof QuestionnaireAnswers>([
    "activeModules",
    "activityLevel",
    "age",
    "country",
    "dailySchedule",
    "hasIndirectCalorimetry",
    "hasConditions",
    "hasLabValues",
    "hasMedications",
    "heightCm",
    "physiologicalSex",
    "primaryObjective",
    "secondaryObjectives",
    "trainingMode",
    "weightKg",
  ]);
  for (const rule of CRITICAL_RULES) {
    if (
      (rule.when?.(answers) ?? true) &&
      activeAffectedModules(answers, rule.modules).length
    ) {
      visible.add(rule.answerId);
    }
  }
  if (answers.activeModules?.includes("nutrition")) {
    visible.add("preferredFoods");
    visible.add("excludedFoods");
    visible.add("nutritionMealAnchors");
    visible.add("preferredSupermarket");
    visible.add("compareSupermarkets");
  }
  if (answers.activeModules?.includes("hydration")) {
    visible.add("habitualBeverages");
    visible.add("hydrationClimate");
    visible.add("hydrationFluidRestriction");
    visible.add("hydrationAnchors");
    visible.add("hydrationReminders");
  }
  if (answers.activeModules?.includes("sleep")) {
    visible.add("sleepBedTime");
    visible.add("sleepWakeTime");
    visible.add("sleepTracking");
    if (answers.sleepTracking) {
      visible.add("sleepRemMinutes");
      visible.add("sleepDeepMinutes");
      visible.add("sleepLightMinutes");
    }
  }
  if (answers.activeModules?.includes("mobility")) visible.add("mobilityMinutes");
  if (answers.activeModules?.includes("supplements")) visible.add("supplementGoals");
  if (answers.hasLabValues) visible.add("labValues");
  return [...visible];
}

const BLOCK_MINUTES: Readonly<Record<QuestionnaireBlockId, number>> = {
  clinical: 2,
  core: 2,
  goals: 1,
  hydration: 2,
  labs: 1,
  mobility: 1,
  modules: 1,
  nutrition: 3,
  sleep: 2,
  summary: 1,
  supplements: 2,
  training: 3,
};

export function getVisibleBlockIds(
  answers: QuestionnaireAnswers,
): QuestionnaireBlockId[] {
  const modules = new Set(answers.activeModules ?? []);
  return QUESTIONNAIRE_BLOCK_IDS.filter((blockId) => {
    if (
      blockId === "core" ||
      blockId === "goals" ||
      blockId === "modules" ||
      blockId === "training" ||
      blockId === "clinical" ||
      blockId === "labs" ||
      blockId === "summary"
    ) {
      return true;
    }
    return modules.has(blockId);
  });
}

export function getQuestionnaireProgress(
  visibleBlockIds: readonly QuestionnaireBlockId[],
  confirmedBlockIds: readonly QuestionnaireBlockId[],
): { completed: number; estimatedMinutesRemaining: number; total: number } {
  const confirmed = new Set(confirmedBlockIds);
  return {
    completed: visibleBlockIds.filter((blockId) => confirmed.has(blockId)).length,
    estimatedMinutesRemaining: visibleBlockIds
      .filter((blockId) => !confirmed.has(blockId))
      .reduce((total, blockId) => total + BLOCK_MINUTES[blockId], 0),
    total: visibleBlockIds.length,
  };
}

export function evaluateQuestionnaire(answers: QuestionnaireAnswers): {
  completeness: "complete" | "provisional";
  hardErrors: HardError[];
  uncertainties: QuestionnaireUncertainty[];
} {
  const hardErrors: HardError[] = [];
  if (!answers.activeModules?.length) {
    hardErrors.push({ answerId: "activeModules", code: "modules_required" });
  }
  if (!answers.primaryObjective) {
    hardErrors.push({
      answerId: "primaryObjective",
      code: "primary_objective_required",
    });
  }
  if ((answers.secondaryObjectives?.length ?? 0) > 2) {
    hardErrors.push({
      answerId: "secondaryObjectives",
      code: "secondary_objectives_limit",
    });
  }

  const uncertainties = CRITICAL_RULES.flatMap((rule) => {
    const affectedModules = activeAffectedModules(answers, rule.modules);
    if (
      affectedModules.length === 0 ||
      !(rule.when?.(answers) ?? true) ||
      hasAnswer(answers, rule.answerId)
    ) {
      return [];
    }
    return [
      {
        affectedModules,
        answerId: rule.answerId,
        blockId: rule.blockId,
        reason: `questionnaire.missing.${String(rule.answerId)}`,
      } satisfies QuestionnaireUncertainty,
    ];
  });

  return {
    completeness: uncertainties.length === 0 ? "complete" : "provisional",
    hardErrors,
    uncertainties,
  };
}
