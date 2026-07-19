import {
  QUESTIONNAIRE_MODULES,
  type QuestionnaireAnswers,
  type QuestionnaireModule,
} from "../questionnaire/index.ts";

export const PLAN_VERSION_STATUSES = ["draft", "active", "archived"] as const;
export type PlanVersionStatus = (typeof PLAN_VERSION_STATUSES)[number];

export const PLAN_COMPLETENESS = ["complete", "provisional"] as const;
export type PlanCompleteness = (typeof PLAN_COMPLETENESS)[number];

export const PLAN_VALIDATION_STATUSES = ["valid", "invalid"] as const;
export type PlanValidationStatus = (typeof PLAN_VALIDATION_STATUSES)[number];

export const PLAN_CANDIDATE_STATUSES = [
  "pending",
  "activated",
  "discarded",
  "invalid",
] as const;
export type PlanCandidateStatus = (typeof PLAN_CANDIDATE_STATUSES)[number];

export const CHANGE_IMPACTS = [
  "unaffected",
  "module_only",
  "dependent_modules",
  "structural",
] as const;
export type ChangeImpact = (typeof CHANGE_IMPACTS)[number];

export type ContextChange = Readonly<{
  affectedModules: QuestionnaireModule[];
  changedFields: string[];
  impact: ChangeImpact;
}>;

const STRUCTURAL_FIELDS = new Set<string>([
  "activeModules",
  "country",
  "primaryObjective",
  "secondaryObjectives",
  "trainingMode",
]);

const BODY_DEPENDENT_FIELDS = new Set<string>([
  "activityLevel",
  "heightCm",
  "targetWeightKg",
  "weightKg",
]);

const GLOBAL_CONTEXT_FIELDS = new Set<string>([
  "age",
  "conditions",
  "hasConditions",
  "hasMedications",
  "medications",
  "menopauseStage",
  "physiologicalSex",
  "pregnancyLactation",
]);

const NUTRITION_FIELDS = new Set<string>([
  "compareSupermarkets",
  "dietaryPattern",
  "excludedFoods",
  "hasIndirectCalorimetry",
  "indirectCalorimetryDate",
  "indirectCalorimetryRmrKcal",
  "indirectCalorimetrySource",
  "mealsPerDay",
  "nutritionMealAnchors",
  "nutritionMode",
  "preferredFoods",
  "preferredSupermarket",
  "proteinPreference",
]);

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (!deepEqual(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
}

function activeModules(
  previous: QuestionnaireAnswers,
  current: QuestionnaireAnswers,
): QuestionnaireModule[] {
  const selected = new Set([
    ...(previous.activeModules ?? []),
    ...(current.activeModules ?? []),
  ]);
  return QUESTIONNAIRE_MODULES.filter((module) => selected.has(module));
}

function selectedModules(
  active: readonly QuestionnaireModule[],
  candidates: readonly QuestionnaireModule[],
): QuestionnaireModule[] {
  const candidateSet = new Set(candidates);
  return active.filter((module) => candidateSet.has(module));
}

function modulesForField(
  field: string,
  active: readonly QuestionnaireModule[],
): QuestionnaireModule[] {
  if (STRUCTURAL_FIELDS.has(field) || GLOBAL_CONTEXT_FIELDS.has(field)) {
    return [...active];
  }
  if (BODY_DEPENDENT_FIELDS.has(field)) {
    return selectedModules(active, ["nutrition", "training", "hydration"]);
  }
  if (NUTRITION_FIELDS.has(field) || field.startsWith("nutrition")) {
    return selectedModules(active, ["nutrition"]);
  }
  if (
    field.startsWith("generatedTraining") ||
    field.startsWith("ownTraining") ||
    field.startsWith("training")
  ) {
    return selectedModules(active, ["nutrition", "training", "hydration", "mobility"]);
  }
  if (field.startsWith("hydration") || field === "habitualWaterMl") {
    return selectedModules(active, ["hydration"]);
  }
  if (field.startsWith("sleep")) return selectedModules(active, ["sleep"]);
  if (field.startsWith("mobility")) {
    return selectedModules(active, ["training", "mobility"]);
  }
  if (
    field.startsWith("supplement") ||
    field === "currentSupplements" ||
    field === "hasCurrentSupplements" ||
    field === "labValues" ||
    field === "hasLabValues"
  ) {
    return selectedModules(active, ["supplements"]);
  }
  return [...active];
}

export function detectContextChange(
  previous: QuestionnaireAnswers,
  current: QuestionnaireAnswers,
): ContextChange {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const changedFields = [...keys]
    .filter(
      (field) =>
        !deepEqual(
          previous[field as keyof QuestionnaireAnswers],
          current[field as keyof QuestionnaireAnswers],
        ),
    )
    .sort();
  if (changedFields.length === 0) {
    return { affectedModules: [], changedFields: [], impact: "unaffected" };
  }

  const active = activeModules(previous, current);
  const affected = new Set<QuestionnaireModule>();
  for (const field of changedFields) {
    for (const module of modulesForField(field, active)) affected.add(module);
  }
  const affectedModules = QUESTIONNAIRE_MODULES.filter((module) =>
    affected.has(module),
  );
  const impact: ChangeImpact = changedFields.some((field) =>
    STRUCTURAL_FIELDS.has(field),
  )
    ? "structural"
    : affectedModules.length === 0
      ? "unaffected"
      : affectedModules.length === 1
        ? "module_only"
        : "dependent_modules";
  return { affectedModules, changedFields, impact };
}

export function isActivatablePlanVersion(version: {
  completeness: PlanCompleteness;
  status: PlanVersionStatus;
  validationStatus: PlanValidationStatus;
}): boolean {
  return version.status === "draft" && version.validationStatus === "valid";
}
