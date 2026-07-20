import { describe, expect, it } from "vitest";

import {
  LegacyNutritionWeekSchema,
  NutritionWeekSchema,
  NutritionWeekV2Schema,
  normalizeNutritionWeek,
} from "@health-design/contracts";
import type { FoodPreparation, QuestionnaireAnswers } from "@health-design/domain";
import { generateNutritionWeek } from "@health-design/engine";
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

const fallbackPreparation = {
  instruction:
    "Utiliza la cantidad indicada. Consulta el envase o la información del alimento para su preparación habitual.",
  ruleId: "legacy-fallback",
  ruleSetVersion: "legacy-fallback-v1",
  status: "provisional",
} as const;

function legacyWeek() {
  const generated = generateNutritionWeek({
    answers,
    catalog: effectiveNutritionFoods,
  }) as ReturnType<typeof generateNutritionWeek> & {
    nutritionSchemaVersion?: 2;
    preparation?: unknown;
  };
  const {
    nutritionSchemaVersion: _schemaVersion,
    preparation: _preparation,
    ...week
  } = generated;
  return {
    ...week,
    days: week.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => ({
        ...meal,
        foods: meal.foods.map((food) => {
          const { preparation: _foodPreparation, ...legacyFood } =
            food as typeof food & {
              preparation?: unknown;
            };
          return {
            ...legacyFood,
            substitutes: food.substitutes.map((substitute) => {
              const { preparation: _substitutePreparation, ...legacySubstitute } =
                substitute as typeof substitute & { preparation?: unknown };
              return legacySubstitute;
            }),
          };
        }),
      })),
    })),
  };
}

function v2Week() {
  const legacy = legacyWeek();
  return {
    ...legacy,
    days: legacy.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => ({
        ...meal,
        foods: meal.foods.map((food) => ({
          ...food,
          preparation: fallbackPreparation,
          substitutes: food.substitutes.map((substitute) => ({
            ...substitute,
            preparation: fallbackPreparation,
          })),
        })),
      })),
    })),
    nutritionSchemaVersion: 2 as const,
    preparation: {
      completeness: "provisional" as const,
      ruleSetVersion: "legacy-fallback-v1",
      uncertainties: [
        {
          code: "PREPARATION_NOT_VERSIONED",
          messageKey: "nutrition.preparation.not_versioned",
        },
      ],
    },
  };
}

describe("contrato nutricional versionado T15A", () => {
  it("acepta por separado el payload heredado y la semana V2 completa", () => {
    const legacy = legacyWeek();
    const current = v2Week();

    expect(LegacyNutritionWeekSchema.parse(legacy)).toEqual(legacy);
    expect(NutritionWeekV2Schema.parse(current)).toEqual(current);
    expect(NutritionWeekSchema.parse(legacy)).toEqual(legacy);
    expect(NutritionWeekSchema.parse(current)).toEqual(current);
  });

  it("rechaza payloads mixtos y preparación parcial", () => {
    const legacy = legacyWeek();
    const current = v2Week();
    const firstFood = current.days[0]!.meals[0]!.foods[0]!;
    const firstSubstitute = firstFood.substitutes[0]!;
    const { preparation: _preparation, ...substituteWithoutPreparation } =
      firstSubstitute;
    const partial = {
      ...current,
      days: [
        {
          ...current.days[0]!,
          meals: [
            {
              ...current.days[0]!.meals[0]!,
              foods: [
                {
                  ...firstFood,
                  substitutes: [
                    substituteWithoutPreparation,
                    firstFood.substitutes[1]!,
                  ],
                },
                ...current.days[0]!.meals[0]!.foods.slice(1),
              ],
            },
            ...current.days[0]!.meals.slice(1),
          ],
        },
        ...current.days.slice(1),
      ],
    };

    expect(
      NutritionWeekSchema.safeParse({ ...legacy, nutritionSchemaVersion: 2 }).success,
    ).toBe(false);
    expect(NutritionWeekSchema.safeParse(partial).success).toBe(false);
  });

  it("limita texto e identificadores de preparación", () => {
    const current = v2Week();
    const firstFood = current.days[0]!.meals[0]!.foods[0]!;
    const withPreparation = (preparation: FoodPreparation) => ({
      ...current,
      days: [
        {
          ...current.days[0]!,
          meals: [
            {
              ...current.days[0]!.meals[0]!,
              foods: [
                { ...firstFood, preparation },
                ...current.days[0]!.meals[0]!.foods.slice(1),
              ],
            },
            ...current.days[0]!.meals.slice(1),
          ],
        },
        ...current.days.slice(1),
      ],
    });

    expect(
      NutritionWeekV2Schema.safeParse(
        withPreparation({
          ...fallbackPreparation,
          instruction: "x".repeat(241),
        }),
      ).success,
    ).toBe(false);
    expect(
      NutritionWeekV2Schema.safeParse(
        withPreparation({
          ...fallbackPreparation,
          ruleId: "INVALID RULE",
        }),
      ).success,
    ).toBe(false);
  });

  it("normaliza el legado sin mutarlo y congela el fallback", () => {
    const legacy = legacyWeek();
    const before = JSON.stringify(legacy);
    const normalized = normalizeNutritionWeek(legacy);

    expect(JSON.stringify(legacy)).toBe(before);
    expect(NutritionWeekV2Schema.parse(normalized)).toEqual(normalized);
    expect(normalized.preparation).toEqual({
      completeness: "provisional",
      ruleSetVersion: "legacy-fallback-v1",
      uncertainties: [
        {
          code: "PREPARATION_NOT_VERSIONED",
          messageKey: "nutrition.preparation.not_versioned",
        },
      ],
    });
    for (const food of normalized.days.flatMap(({ meals }) =>
      meals.flatMap(({ foods }) => foods),
    )) {
      expect(food.preparation).toEqual(fallbackPreparation);
      expect(food.substitutes.map(({ preparation }) => preparation)).toEqual([
        fallbackPreparation,
        fallbackPreparation,
      ]);
    }
  });
});
