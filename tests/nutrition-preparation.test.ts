import { describe, expect, it } from "vitest";

import {
  LEGACY_FOOD_PREPARATION,
  NutritionWeekV2Schema,
} from "@health-design/contracts";
import type {
  EffectiveNutritionFood,
  QuestionnaireAnswers,
} from "@health-design/domain";
import {
  PREPARATION_RULE_SET_VERSION,
  generateNutritionWeek,
  resolveFoodPreparation,
} from "@health-design/engine";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";

const answers = {
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
} as const satisfies QuestionnaireAnswers;

function preparationInput(
  food: Pick<EffectiveNutritionFood, "canonicalFoodKey" | "category" | "foodState">,
) {
  return {
    canonicalFoodKey: food.canonicalFoodKey,
    category: food.category,
    foodState: food.foodState,
  };
}

describe("reglas deterministas de preparación T15A", () => {
  it("cubre todos los alimentos activos con reglas completas y estables", () => {
    const first = effectiveNutritionFoods.map((food) =>
      resolveFoodPreparation(preparationInput(food)),
    );
    const second = effectiveNutritionFoods.map((food) =>
      resolveFoodPreparation(preparationInput(food)),
    );

    expect(first).toEqual(second);
    expect(first.every(({ status }) => status === "complete")).toBe(true);
    expect(
      first.every(
        ({ ruleSetVersion }) => ruleSetVersion === PREPARATION_RULE_SET_VERSION,
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(
      /medicaci[oó]n|condici[oó]n|suplementaci[oó]n|evidencia interna/i,
    );
  });

  it("prioriza la sobrescritura canónica sobre la regla de categoría", () => {
    const oats = resolveFoodPreparation({
      canonicalFoodKey: "food:oat-flakes",
      category: "cereals",
      foodState: "raw",
    });
    const genericCereal = resolveFoodPreparation({
      canonicalFoodKey: "food:future-cereal",
      category: "cereals",
      foodState: "raw",
    });

    expect(oats.status).toBe("complete");
    expect(genericCereal.status).toBe("complete");
    expect(oats.ruleId).not.toBe(genericCereal.ruleId);
    expect(oats.instruction).not.toBe(genericCereal.instruction);
  });

  it("usa exactamente el fallback congelado cuando no hay cobertura", () => {
    expect(
      resolveFoodPreparation({
        canonicalFoodKey: "food:future-unknown",
        category: "unknown_category",
        foodState: "unspecified",
      }),
    ).toEqual(LEGACY_FOOD_PREPARATION);
  });

  it("incorpora preparación completa en principales, sustitutos y semana", () => {
    const week = generateNutritionWeek({
      answers,
      catalog: effectiveNutritionFoods,
    });
    const parsed = NutritionWeekV2Schema.parse(week);

    expect(parsed.nutritionSchemaVersion).toBe(2);
    expect(parsed.preparation).toEqual({
      completeness: "complete",
      ruleSetVersion: PREPARATION_RULE_SET_VERSION,
      uncertainties: [],
    });
    for (const food of parsed.days.flatMap(({ meals }) =>
      meals.flatMap(({ foods }) => foods),
    )) {
      expect(food.preparation.status).toBe("complete");
      expect(food.substitutes).toHaveLength(2);
      expect(
        food.substitutes.every(({ preparation }) => preparation.status === "complete"),
      ).toBe(true);
    }
  });
});
