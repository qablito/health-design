import { describe, expect, it } from "vitest";

import {
  ProductApplicationRequestSchema,
  type CommercialProductSnapshot,
} from "@health-design/contracts";
import type { QuestionnaireAnswers } from "@health-design/domain";
import {
  addDecimals,
  applyConfirmedCommercialProduct,
  generateNutritionWeek,
} from "@health-design/engine";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";
import { COMMERCIAL_PRODUCT_FIXTURE } from "@health-design/test-fixtures/products";

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
  nutritionMode: "simple",
  physiologicalSex: "male",
  primaryObjective: "body_composition_maintain",
  proteinPreference: "food_only",
  trainingMode: "none",
  weightKg: 80,
} as const satisfies QuestionnaireAnswers;

const known = (value: string, unit: "g" | "kcal" = "g") => ({
  state: "known" as const,
  unit,
  value,
});

function chickenProduct(
  overrides: Partial<CommercialProductSnapshot> = {},
): CommercialProductSnapshot {
  return {
    ...COMMERCIAL_PRODUCT_FIXTURE,
    brand: "Marca comercial",
    name: "Pechuga de pollo envasada",
    nutrients: {
      carbohydratesG: known("0"),
      clinical: {},
      energyKcal: known("110", "kcal"),
      fatG: known("1.5"),
      fiberG: { state: "unknown" },
      proteinG: known("23.4"),
      saltG: known("0.2"),
      saturatedFatG: known("0.4"),
      sugarsG: known("0"),
    },
    ...overrides,
  };
}

function generatedWeek() {
  return generateNutritionWeek({ answers, catalog: effectiveNutritionFoods });
}

function chickenSelection(plan: ReturnType<typeof generatedWeek>) {
  for (const [dayIndex, day] of plan.days.entries()) {
    for (const [mealIndex, meal] of day.meals.entries()) {
      const foodIndex = meal.foods.findIndex(
        ({ canonicalFoodKey }) => canonicalFoodKey === "food:chicken-breast",
      );
      if (foodIndex >= 0) {
        return { dayIndex, foodIndex, mealIndex };
      }
    }
  }
  throw new Error("fixture_missing_chicken");
}

function application(snapshot = chickenProduct()) {
  return {
    calculationHash: "ab".repeat(32),
    confirmationId: "10000000-0000-4000-8000-000000000001",
    manifestId: "20000000-0000-4000-8000-000000000001",
    matchingState: "exact" as const,
    productId: "30000000-0000-4000-8000-000000000001",
    revisionId: "40000000-0000-4000-8000-000000000001",
    snapshot,
  };
}

describe("aplicación de un producto comercial confirmado", () => {
  it("exige versión, confirmación y posición canónica esperada", () => {
    expect(
      ProductApplicationRequestSchema.safeParse({
        baseVersionId: "50000000-0000-4000-8000-000000000001",
        confirmationId: application().confirmationId,
        expectedVersion: 3,
        schemaVersion: 1,
        selection: {
          dayIndex: 0,
          expectedCanonicalFoodKey: "food:chicken-breast",
          foodIndex: 0,
          mealIndex: 0,
        },
      }).success,
    ).toBe(true);
    expect(
      ProductApplicationRequestSchema.safeParse({
        baseVersionId: "50000000-0000-4000-8000-000000000001",
        confirmationId: application().confirmationId,
        expectedVersion: 3,
        schemaVersion: 1,
        selection: {
          dayIndex: 0,
          expectedCanonicalFoodKey: "pollo libre",
          foodIndex: 0,
          mealIndex: 0,
        },
      }).success,
    ).toBe(false);
  });

  it("crea un principal comercial provisional con exactamente dos sustitutos", () => {
    const original = generatedWeek();
    const before = JSON.stringify(original);
    const position = chickenSelection(original);
    const selected =
      original.days[position.dayIndex]!.meals[position.mealIndex]!.foods[
        position.foodIndex
      ]!;

    const result = applyConfirmedCommercialProduct(original, {
      answers,
      product: application(),
      selection: {
        ...position,
        expectedCanonicalFoodKey: selected.canonicalFoodKey,
      },
    });
    const applied =
      result.nutrition.days[position.dayIndex]!.meals[position.mealIndex]!.foods[
        position.foodIndex
      ]!;

    expect(JSON.stringify(original)).toBe(before);
    expect(applied.name).toBe("Pechuga de pollo envasada");
    expect(applied.amountG).toBe(selected.amountG);
    expect(applied.substitutes).toHaveLength(2);
    expect(applied.substitutes[0]!.name).toBe(selected.name);
    expect(applied.substitutes[1]!.name).toBe(selected.substitutes[0]!.name);
    expect(applied.commercialProduct).toMatchObject({
      brand: "Marca comercial",
      confirmationId: application().confirmationId,
      productId: application().productId,
      revisionId: application().revisionId,
      nutrientStates: {
        fiberG: {
          calculation: "estimated_from_canonical",
          declaredState: "unknown",
        },
      },
    });
    expect(result).toMatchObject({
      completeness: "provisional",
      uncertainties: ["fiberG_estimated_from_canonical"],
    });
    expect(
      applied.substitutes.some(
        ({ commercialProduct }) => commercialProduct !== undefined,
      ),
    ).toBe(false);

    const meal = result.nutrition.days[position.dayIndex]!.meals[position.mealIndex]!;
    expect(meal.totals.energyKcal).toBe(
      meal.foods.reduce(
        (total, food) => addDecimals(total, food.nutrients.energyKcal),
        "0",
      ),
    );
    const day = result.nutrition.days[position.dayIndex]!;
    expect(day.totals.energyKcal).toBe(
      day.meals.reduce(
        (total, currentMeal) => addDecimals(total, currentMeal.totals.energyKcal),
        "0",
      ),
    );
    expect(result.nutrition.weekTotals.energyKcal).toBe(
      result.nutrition.days.reduce(
        (total, currentDay) => addDecimals(total, currentDay.totals.energyKcal),
        "0",
      ),
    );
    expect(
      result.nutrition.shoppingList.find(
        ({ canonicalFoodKey }) => canonicalFoodKey === applied.canonicalFoodKey,
      )?.amountG,
    ).toBe(
      result.nutrition.days.reduce(
        (total, currentDay) =>
          currentDay.meals.reduce(
            (dayTotal, currentMeal) =>
              currentMeal.foods.reduce(
                (mealTotal, food) =>
                  food.canonicalFoodKey === applied.canonicalFoodKey
                    ? addDecimals(mealTotal, food.amountG)
                    : mealTotal,
                dayTotal,
              ),
            total,
          ),
        "0",
      ),
    );
  });

  it("admite matching allowed y convierte por 100 ml con densidad confirmada", () => {
    const original = generatedWeek();
    const position = chickenSelection(original);
    const selected =
      original.days[position.dayIndex]!.meals[position.mealIndex]!.foods[
        position.foodIndex
      ]!;
    const result = applyConfirmedCommercialProduct(original, {
      answers,
      product: {
        ...application(
          chickenProduct({
            basis: "per_100_ml",
            density: {
              gramsPerMl: "1.03",
              sourceRef: "etiqueta_confirmada",
              state: "known",
            },
          }),
        ),
        matchingState: "allowed",
      },
      selection: {
        ...position,
        expectedCanonicalFoodKey: selected.canonicalFoodKey,
      },
    });
    const applied =
      result.nutrition.days[position.dayIndex]!.meals[position.mealIndex]!.foods[
        position.foodIndex
      ]!;

    expect(applied.commercialProduct?.nutrientStates.proteinG).toMatchObject({
      calculation: "confirmed_conversion",
      declaredState: "known",
    });
  });

  it("rechaza matching no aplicable y una base por 100 ml sin densidad", () => {
    const original = generatedWeek();
    const position = chickenSelection(original);
    const selected =
      original.days[position.dayIndex]!.meals[position.mealIndex]!.foods[
        position.foodIndex
      ]!;
    const selection = {
      ...position,
      expectedCanonicalFoodKey: selected.canonicalFoodKey,
    };

    expect(() =>
      applyConfirmedCommercialProduct(original, {
        answers,
        product: { ...application(), matchingState: "review" },
        selection,
      }),
    ).toThrow("PRODUCT_MATCH_REVIEW_REQUIRED");
    expect(() =>
      applyConfirmedCommercialProduct(original, {
        answers,
        product: { ...application(), matchingState: "excluded" },
        selection,
      }),
    ).toThrow("PRODUCT_MATCH_EXCLUDED");
    expect(() =>
      applyConfirmedCommercialProduct(original, {
        answers,
        product: { ...application(), matchingState: "insufficient" },
        selection,
      }),
    ).toThrow("PRODUCT_DATA_INSUFFICIENT");
    expect(() =>
      applyConfirmedCommercialProduct(original, {
        answers,
        product: application(
          chickenProduct({ basis: "per_100_ml", density: { state: "unknown" } }),
        ),
        selection,
      }),
    ).toThrow("PRODUCT_DATA_INSUFFICIENT");
    expect(() =>
      applyConfirmedCommercialProduct(original, {
        answers,
        product: application(),
        selection: { ...selection, expectedCanonicalFoodKey: "food:stale-line" },
      }),
    ).toThrow("STALE_PLAN_VERSION");
  });

  it("aplica exclusiones de alergia y no decide cuando falta seguridad crítica", () => {
    const original = generatedWeek();
    const position = chickenSelection(original);
    const selected =
      original.days[position.dayIndex]!.meals[position.mealIndex]!.foods[
        position.foodIndex
      ]!;
    const selection = {
      ...position,
      expectedCanonicalFoodKey: selected.canonicalFoodKey,
    };
    const allergicAnswers = {
      ...answers,
      nutritionAllergies: [{ name: "leche" }],
      nutritionAllergiesStatus: "declared",
    } as const satisfies QuestionnaireAnswers;

    expect(() =>
      applyConfirmedCommercialProduct(original, {
        answers: allergicAnswers,
        product: application({
          ...chickenProduct(),
          safety: {
            allergens: { state: "known", values: ["milk"] },
            crossContactAllergens: { state: "known", values: [] },
            ingredients: { state: "known", values: ["Pollo", "Leche"] },
          },
        }),
        selection,
      }),
    ).toThrow("PRODUCT_MATCH_EXCLUDED");
    expect(() =>
      applyConfirmedCommercialProduct(original, {
        answers: allergicAnswers,
        product: application({
          ...chickenProduct(),
          safety: {
            allergens: { state: "unknown" },
            crossContactAllergens: { state: "known", values: [] },
            ingredients: { state: "known", values: ["Pollo"] },
          },
        }),
        selection,
      }),
    ).toThrow("PRODUCT_DATA_INSUFFICIENT");
  });

  it("hace crítico el dato de sal cuando el contexto detecta hipertensión", () => {
    const original = generatedWeek();
    const position = chickenSelection(original);
    const selected =
      original.days[position.dayIndex]!.meals[position.mealIndex]!.foods[
        position.foodIndex
      ]!;
    const hypertensionAnswers = {
      ...answers,
      conditions: [{ name: "Hipertensión" }],
      hasConditions: true,
    } as const satisfies QuestionnaireAnswers;

    expect(() =>
      applyConfirmedCommercialProduct(original, {
        answers: hypertensionAnswers,
        product: application({
          ...chickenProduct(),
          nutrients: { ...chickenProduct().nutrients, saltG: { state: "unknown" } },
        }),
        selection: {
          ...position,
          expectedCanonicalFoodKey: selected.canonicalFoodKey,
        },
      }),
    ).toThrow("PRODUCT_DATA_INSUFFICIENT");
  });
});
