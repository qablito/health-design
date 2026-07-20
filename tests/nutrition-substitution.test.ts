import { describe, expect, it } from "vitest";

import { LEGACY_FOOD_PREPARATION, NutritionWeekV2Schema } from "@health-design/contracts";
import type {
  NutritionDay,
  NutritionMeal,
  NutritionTotals,
  NutritionWeek,
  NutritionWeekV2,
  PlannedFood,
  PlannedFoodAlternative,
  PreparedPlannedFood,
  PreparedPlannedFoodAlternative,
  QuestionnaireAnswers,
} from "@health-design/domain";
import {
  addDecimals,
  applyNutritionSubstitution,
  generateNutritionWeek,
  roundDecimal,
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

const TOTAL_KEYS = [
  "energyKcal",
  "proteinG",
  "carbohydratesG",
  "fatG",
  "fiberG",
] as const satisfies readonly (keyof NutritionTotals)[];

function sumTotals(values: readonly NutritionTotals[]): NutritionTotals {
  return Object.fromEntries(
    TOTAL_KEYS.map((key) => [
      key,
      roundDecimal(
        values.reduce((total, value) => addDecimals(total, value[key]), "0"),
        3,
        "half_away_from_zero",
      ),
    ]),
  ) as unknown as NutritionTotals;
}

function legacyAlternative(
  food: PreparedPlannedFoodAlternative,
): PlannedFoodAlternative {
  const { preparation, ...legacy } = food;
  void preparation;
  return legacy;
}

function legacyFood(food: PreparedPlannedFood): PlannedFood {
  return {
    ...legacyAlternative(food),
    substitutes: food.substitutes.map(legacyAlternative),
  };
}

function legacyWeek(plan: NutritionWeekV2): NutritionWeek {
  const { nutritionSchemaVersion, preparation, ...legacy } = plan;
  void nutritionSchemaVersion;
  void preparation;
  return {
    ...legacy,
    days: plan.days.map(
      (day): NutritionDay => ({
        ...day,
        meals: day.meals.map(
          (meal): NutritionMeal => ({
            ...meal,
            foods: meal.foods.map(legacyFood),
          }),
        ),
      }),
    ),
  };
}

function generatedWeek(): NutritionWeekV2 {
  return generateNutritionWeek({ answers, catalog: effectiveNutritionFoods });
}

describe("sustituciones nutricionales con preparación T15A", () => {
  it("promueve la instrucción elegida y conserva la del alimento anterior", () => {
    const original = generatedWeek();
    const first = original.days[0]!.meals[0]!.foods[0]!;
    const replacement = first.substitutes[0]!;
    const frozenInstruction = "Instrucción V2 almacenada para esta versión.";
    const stored = {
      ...original,
      days: original.days.map((day, dayIndex) =>
        dayIndex === 0
          ? {
              ...day,
              meals: day.meals.map((meal, mealIndex) =>
                mealIndex === 0
                  ? {
                      ...meal,
                      foods: meal.foods.map((food, foodIndex) =>
                        foodIndex === 0
                          ? {
                              ...food,
                              preparation: {
                                ...food.preparation,
                                instruction: frozenInstruction,
                              },
                            }
                          : food,
                      ),
                    }
                  : meal,
              ),
            }
          : day,
      ),
    } satisfies NutritionWeekV2;

    const changed = applyNutritionSubstitution(stored, {
      dayIndex: 0,
      foodIndex: 0,
      mealIndex: 0,
      substituteIndex: 0,
    });
    const promoted = changed.days[0]!.meals[0]!.foods[0]!;

    expect(promoted.preparation).toEqual(replacement.preparation);
    expect(promoted.substitutes[0]!.canonicalFoodKey).toBe(first.canonicalFoodKey);
    expect(promoted.substitutes[0]!.preparation.instruction).toBe(frozenInstruction);
  });

  it("recalcula exactamente alimento, comida, día y semana", () => {
    const original = generatedWeek();
    const replacement = original.days[0]!.meals[0]!.foods[0]!.substitutes[0]!;
    const changed = applyNutritionSubstitution(original, {
      dayIndex: 0,
      foodIndex: 0,
      mealIndex: 0,
      substituteIndex: 0,
    });
    const changedMeal = changed.days[0]!.meals[0]!;
    const changedDay = changed.days[0]!;

    expect(changedMeal.foods[0]!.nutrients).toEqual(replacement.nutrients);
    expect(changedMeal.foods[0]!.clinicalNutrients).toEqual(
      replacement.clinicalNutrients,
    );
    expect(changedMeal.totals).toEqual(
      sumTotals(changedMeal.foods.map(({ nutrients }) => nutrients)),
    );
    expect(changedDay.totals).toEqual(
      sumTotals(changedDay.meals.map(({ totals }) => totals)),
    );
    expect(changed.weekTotals).toEqual(
      sumTotals(changed.days.map(({ totals }) => totals)),
    );
    expect(NutritionWeekV2Schema.parse(changed)).toEqual(changed);
  });

  it("mantiene el fallback y la incertidumbre al elegir sobre un plan heredado", () => {
    const legacy = legacyWeek(generatedWeek());
    const before = JSON.stringify(legacy);
    const changed = applyNutritionSubstitution(legacy, {
      dayIndex: 0,
      foodIndex: 0,
      mealIndex: 0,
      substituteIndex: 0,
    });

    expect(JSON.stringify(legacy)).toBe(before);
    expect(changed.preparation).toEqual({
      completeness: "provisional",
      ruleSetVersion: "legacy-fallback-v1",
      uncertainties: [
        {
          code: "PREPARATION_NOT_VERSIONED",
          messageKey: "nutrition.preparation.not_versioned",
        },
      ],
    });
    expect(changed.days[0]!.meals[0]!.foods[0]!.preparation).toEqual(
      LEGACY_FOOD_PREPARATION,
    );
  });
});
