import { generateNutritionWeek } from "@health-design/engine";
import { createExportModel } from "@health-design/export/model";

import { effectiveNutritionFoods } from "../profiles/nutrition/index.ts";

export const exportNutrition = generateNutritionWeek({
  answers: {
    activeModules: ["nutrition"],
    activityLevel: "moderate",
    age: 35,
    country: "ES",
    dietaryPattern: "omnivore",
    hasConditions: false,
    hasMedications: false,
    heightCm: 178,
    mealsPerDay: 4,
    nutritionAllergiesStatus: "none",
    nutritionFoodAnxiety: "no",
    nutritionIntolerancesStatus: "none",
    nutritionMealAnchors: ["wake_up", "midday", "afternoon", "evening"],
    nutritionMode: "balanced",
    physiologicalSex: "male",
    primaryObjective: "body_composition_maintain",
    proteinPreference: "food_only",
    trainingMode: "none",
    weightKg: 80,
  },
  catalog: effectiveNutritionFoods,
});

const shared = {
  nutrition: exportNutrition,
  planOutputHash: "ab".repeat(32),
  planVersionId: "20000000-0000-4000-8000-000000000001",
  rendererVersion: "export-v1",
} as const;

export const exportModels = {
  compact: createExportModel({
    ...shared,
    config: {
      choices: [],
      detail: "compact",
      format: "pdf",
      includeShopping: false,
      includeWeeklyPreparation: false,
      presentation: "ingredients",
      range: { kind: "week" },
      schemaVersion: 1,
    },
  }),
  complete: createExportModel({
    ...shared,
    config: {
      choices: [[0, 0, 0, 1]],
      detail: "complete",
      format: "pdf",
      includeShopping: true,
      includeWeeklyPreparation: true,
      presentation: "preparation",
      range: { kind: "week" },
      schemaVersion: 1,
    },
  }),
  preparation: createExportModel({
    ...shared,
    config: {
      choices: [],
      detail: "compact",
      format: "pdf",
      includeShopping: false,
      includeWeeklyPreparation: false,
      presentation: "preparation",
      range: { kind: "day", day: 1 },
      schemaVersion: 1,
    },
  }),
} as const;
