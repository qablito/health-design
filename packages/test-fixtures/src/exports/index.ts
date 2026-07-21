import {
  EXPORT_RENDERER_VERSION,
  QuestionnaireAnswersSchema,
} from "@health-design/contracts";
import {
  applyConfirmedCommercialProduct,
  generateNutritionWeek,
} from "@health-design/engine";
import { createExportModel } from "@health-design/export/model";

import { effectiveNutritionFoods } from "../profiles/nutrition/index.ts";
import { COMMERCIAL_PRODUCT_FIXTURE } from "../products/index.ts";

const exportAnswers = QuestionnaireAnswersSchema.parse({
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
});

export const exportNutrition = generateNutritionWeek({
  answers: exportAnswers,
  catalog: effectiveNutritionFoods,
});

const productApplicationIds = {
  calculationHash: "cd".repeat(32),
  confirmationId: "10000000-0000-4000-8000-000000000016",
  manifestId: "20000000-0000-4000-8000-000000000016",
  productId: "30000000-0000-4000-8000-000000000016",
  revisionId: "40000000-0000-4000-8000-000000000016",
} as const;

export const commercialProductName = "Alimento proteico envasado";
const commercialProductSourceName = `${commercialProductName} ${COMMERCIAL_PRODUCT_FIXTURE.gtin.displayGtin}`;
export const commercialProductPrivateSentinels = [
  COMMERCIAL_PRODUCT_FIXTURE.gtin.displayGtin,
  COMMERCIAL_PRODUCT_FIXTURE.gtin.gtin14,
  ...Object.values(productApplicationIds),
] as const;

const proteinPosition = (() => {
  for (const [dayIndex, day] of exportNutrition.days.entries()) {
    for (const [mealIndex, meal] of day.meals.entries()) {
      const foodIndex = meal.foods.findIndex(
        ({ function: role }) => role === "protein",
      );
      if (foodIndex >= 0) {
        return {
          canonicalFoodKey: meal.foods[foodIndex]!.canonicalFoodKey,
          dayIndex,
          foodIndex,
          mealIndex,
        };
      }
    }
  }
  throw new Error("fixture_missing_protein");
})();
const commercialProductNutrition = applyConfirmedCommercialProduct(exportNutrition, {
  answers: exportAnswers,
  product: {
    ...productApplicationIds,
    matchingState: "exact",
    snapshot: {
      ...COMMERCIAL_PRODUCT_FIXTURE,
      brand: "Marca comercial",
      name: commercialProductSourceName,
      nutrients: {
        carbohydratesG: { state: "known", unit: "g", value: "0" },
        clinical: {},
        energyKcal: { state: "known", unit: "kcal", value: "110" },
        fatG: { state: "known", unit: "g", value: "1.5" },
        fiberG: { state: "unknown" },
        proteinG: { state: "known", unit: "g", value: "23.4" },
        saltG: { state: "known", unit: "g", value: "0.2" },
        saturatedFatG: { state: "known", unit: "g", value: "0.4" },
        sugarsG: { state: "known", unit: "g", value: "0" },
      },
      safety: {
        allergens: { state: "known", values: [] },
        crossContactAllergens: { state: "known", values: [] },
        ingredients: { state: "known", values: ["Alimento proteico"] },
      },
    },
  },
  selection: {
    dayIndex: proteinPosition.dayIndex,
    expectedCanonicalFoodKey: proteinPosition.canonicalFoodKey,
    foodIndex: proteinPosition.foodIndex,
    mealIndex: proteinPosition.mealIndex,
  },
}).nutrition;

const shared = {
  nutrition: exportNutrition,
  planOutputHash: "ab".repeat(32),
  planVersionId: "20000000-0000-4000-8000-000000000001",
  rendererVersion: EXPORT_RENDERER_VERSION,
} as const;

export const exportModels = {
  commercialProduct: createExportModel({
    ...shared,
    config: {
      choices: [],
      detail: "compact",
      format: "pdf",
      includeShopping: true,
      includeWeeklyPreparation: false,
      presentation: "ingredients",
      range: { kind: "week" },
      schemaVersion: 1,
    },
    nutrition: commercialProductNutrition,
  }),
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
