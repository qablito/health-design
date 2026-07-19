import { describe, expect, it } from "vitest";

import type { QuestionnaireAnswers } from "@health-design/domain";
import {
  applyNutritionSubstitution,
  calculateNutritionTargets,
  generateNutritionWeek,
} from "@health-design/engine";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";

const baseAnswers = {
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

describe("objetivos nutricionales T10", () => {
  it("calcula banda y centro energético con Mifflin-St Jeor y PAL contextual", () => {
    const result = calculateNutritionTargets(baseAnswers);

    expect(result.energy).toMatchObject({
      centerKcal: "2962.25",
      maximumKcal: "3293.325",
      minimumKcal: "2648.6",
      restingSource: "mifflin_st_jeor",
    });
    expect(result.protein).toMatchObject({
      centerG: "88",
      maximumGPerKg: "1.2",
      minimumGPerKg: "1",
    });
    expect(result.macros.fatPercent).toBe("30");
    expect(result.fiber).toMatchObject({ minimumG: "25", targetG: "41.472" });
  });

  it("usa la calorimetría indirecta aportada en vez de estimarla", () => {
    const result = calculateNutritionTargets({
      ...baseAnswers,
      hasIndirectCalorimetry: true,
      indirectCalorimetryDate: "2026-06-15",
      indirectCalorimetryRmrKcal: 1810,
      indirectCalorimetrySource: "clinical_service",
    });

    expect(result.energy).toMatchObject({
      centerKcal: "3077",
      restingCenterKcal: "1810",
      restingSource: "indirect_calorimetry",
    });
  });

  it("genera un intervalo provisional si el sexo fisiológico no permite elegir constante", () => {
    const result = calculateNutritionTargets({
      ...baseAnswers,
      physiologicalSex: "prefer_not_to_say",
    });

    expect(result.completeness).toBe("provisional");
    expect(result.uncertainties.map(({ code }) => code)).toContain(
      "PHYSIOLOGICAL_SEX_CONSTANT_UNAVAILABLE",
    );
    expect(result.energy.restingMinimumKcal).toBe("1576.5");
    expect(result.energy.restingMaximumKcal).toBe("1742.5");
  });

  it("mantiene energía de conservación provisional ante contexto clínico no modelado", () => {
    const result = calculateNutritionTargets({
      ...baseAnswers,
      hasConditions: true,
      conditions: [{ name: "Enfermedad renal" }],
      primaryObjective: "body_composition_lose_fat",
    });

    expect(result.completeness).toBe("provisional");
    expect(result.energy.goalApplied).toBe("maintenance_conservative");
    expect(result.uncertainties.map(({ code }) => code)).toContain(
      "CLINICAL_RULES_PENDING_T12",
    );
  });

  it("propone conservación provisional si el objetivo de peso es agresivo", () => {
    const result = calculateNutritionTargets({
      ...baseAnswers,
      primaryObjective: "body_composition_lose_fat",
      targetWeightKg: 55,
    });

    expect(result.completeness).toBe("provisional");
    expect(result.energy.goalApplied).toBe("maintenance_conservative");
    expect(result.uncertainties.map(({ code }) => code)).toContain(
      "AGGRESSIVE_TARGET_REQUIRES_REVIEW",
    );
  });

  it("usa anclajes predeterminados y marca provisional si la cantidad no coincide", () => {
    const result = calculateNutritionTargets({
      ...baseAnswers,
      nutritionMealAnchors: ["wake_up", "evening"],
    });

    expect(result.completeness).toBe("provisional");
    expect(result.uncertainties.map(({ code }) => code)).toContain(
      "MEAL_ANCHORS_DEFAULTED",
    );
  });

  it("usa la carga del entrenamiento propio para ajustar el centro dentro de la banda PAL", () => {
    const lightTraining = calculateNutritionTargets({
      ...baseAnswers,
      ownTrainingAnchors: ["evening"],
      ownTrainingDaysPerWeek: 2,
      ownTrainingIntensity: "low",
      ownTrainingSessionMinutes: 30,
      ownTrainingTypes: ["strength"],
      trainingMode: "own",
    });
    const highTraining = calculateNutritionTargets({
      ...baseAnswers,
      ownTrainingAnchors: ["evening"],
      ownTrainingDaysPerWeek: 5,
      ownTrainingIntensity: "high",
      ownTrainingSessionMinutes: 75,
      ownTrainingTypes: ["strength"],
      trainingMode: "own",
    });

    expect(Number(highTraining.energy.centerKcal)).toBeGreaterThan(
      Number(lightTraining.energy.centerKcal),
    );
    expect(Number(highTraining.energy.centerKcal)).toBeLessThanOrEqual(
      Number(highTraining.energy.maximumKcal),
    );
    expect(highTraining.energy.maximumKcal).toBe(lightTraining.energy.maximumKcal);
  });

  it("usa la duración realmente prescrita y no una rutina generada fallida", () => {
    const answers = {
      ...baseAnswers,
      generatedTrainingDaysPerWeek: 2,
      generatedTrainingExperience: "beginner" as const,
      generatedTrainingSessionMinutes: 60,
      trainingMode: "generated" as const,
    };
    const requestedDuration = calculateNutritionTargets(answers);
    const prescribedDuration = calculateNutritionTargets(answers, {
      daysPerWeek: 2,
      experience: "beginner",
      sessionMinutes: 26,
    });
    const unavailableRoutine = calculateNutritionTargets(answers, null);

    expect(Number(prescribedDuration.energy.centerKcal)).toBeLessThan(
      Number(requestedDuration.energy.centerKcal),
    );
    expect(Number(unavailableRoutine.energy.centerKcal)).toBeLessThan(
      Number(prescribedDuration.energy.centerKcal),
    );
    expect(unavailableRoutine.energy.maximumKcal).toBe(
      prescribedDuration.energy.maximumKcal,
    );
  });
});

describe("semana nutricional y sustituciones", () => {
  it("crea siete días, entre dos y seis comidas y dos sustitutos funcionales por alimento", () => {
    const plan = generateNutritionWeek({
      answers: baseAnswers,
      catalog: effectiveNutritionFoods,
    });

    expect(plan.days).toHaveLength(7);
    expect(plan.days.every(({ meals }) => meals.length === 4)).toBe(true);
    expect(plan.validation).toEqual({ errors: [], status: "valid", warnings: [] });
    for (const food of plan.days.flatMap(({ meals }) =>
      meals.flatMap(({ foods }) => foods),
    )) {
      expect(food.substitutes).toHaveLength(2);
      expect(
        food.substitutes.every(
          (substitute) =>
            substitute.function === food.function &&
            substitute.foodState === food.foodState,
        ),
      ).toBe(true);
    }
    const chicken = plan.days
      .flatMap(({ meals }) =>
        meals.flatMap(({ foods }) =>
          foods.flatMap((food) => [food, ...food.substitutes]),
        ),
      )
      .find(({ canonicalFoodKey }) => canonicalFoodKey === "food:chicken-breast");
    expect(chicken).toBeDefined();
    expect(chicken?.clinicalNutrients.iron?.unit).toBe("mg");
    expect(Number(chicken?.clinicalNutrients.iron?.value)).toBeCloseTo(
      (Number(chicken?.amountG) * 0.33) / 100,
      3,
    );
    for (const meal of plan.days.flatMap(({ meals }) => meals)) {
      const byFunction = new Map(meal.foods.map((food) => [food.function, food]));
      expect(
        Number(byFunction.get("protein")!.nutrients.proteinG),
      ).toBeGreaterThanOrEqual(
        Math.max(
          ...meal.foods
            .filter(({ function: function_ }) => function_ !== "protein")
            .map(({ nutrients }) => Number(nutrients.proteinG)),
        ),
      );
      expect(
        Number(byFunction.get("carbohydrate_base")!.nutrients.carbohydratesG),
      ).toBeGreaterThanOrEqual(
        Math.max(
          ...meal.foods
            .filter(({ function: function_ }) => function_ !== "carbohydrate_base")
            .map(({ nutrients }) => Number(nutrients.carbohydratesG)),
        ),
      );
      expect(Number(byFunction.get("fat")!.nutrients.fatG)).toBeGreaterThanOrEqual(
        Math.max(
          ...meal.foods
            .filter(({ function: function_ }) => function_ !== "fat")
            .map(({ nutrients }) => Number(nutrients.fatG)),
        ),
      );
    }
  });

  it.each([2, 6] as const)(
    "genera exactamente %i comidas válidas al día",
    (mealsPerDay) => {
      const plan = generateNutritionWeek({
        answers: {
          ...baseAnswers,
          mealsPerDay,
          nutritionMealAnchors: undefined,
        },
        catalog: effectiveNutritionFoods,
      });

      expect(plan.days.every(({ meals }) => meals.length === mealsPerDay)).toBe(true);
      expect(plan.validation.status).toBe("valid");
    },
  );

  it("no introduce proteína en polvo sin elección explícita", () => {
    const plan = generateNutritionWeek({
      answers: baseAnswers,
      catalog: effectiveNutritionFoods,
    });
    const allKeys = plan.days.flatMap(({ meals }) =>
      meals.flatMap(({ foods }) => [
        ...foods.map(({ canonicalFoodKey }) => canonicalFoodKey),
        ...foods.flatMap(({ substitutes }) =>
          substitutes.map(({ canonicalFoodKey }) => canonicalFoodKey),
        ),
      ]),
    );

    expect(allKeys).not.toContain("food:protein-powder");
  });

  it.each(["usual_powder", "optional_substitution"] as const)(
    "solo ofrece proteína en polvo cuando la elección explícita es %s",
    (proteinPreference) => {
      const plan = generateNutritionWeek({
        answers: { ...baseAnswers, proteinPreference },
        catalog: effectiveNutritionFoods,
      });
      const allKeys = plan.days.flatMap(({ meals }) =>
        meals.flatMap(({ foods }) =>
          foods.flatMap((food) => [
            food.canonicalFoodKey,
            ...food.substitutes.map(({ canonicalFoodKey }) => canonicalFoodKey),
          ]),
        ),
      );

      expect(allKeys).toContain("food:protein-powder");
    },
  );

  it("excluye alergeno directo y contaminación cruzada en principales y sustitutos", () => {
    const plan = generateNutritionWeek({
      answers: {
        ...baseAnswers,
        nutritionAllergies: [{ name: "Gluten" }],
        nutritionAllergiesStatus: "declared",
      },
      catalog: effectiveNutritionFoods,
    });
    const allKeys = plan.days.flatMap(({ meals }) =>
      meals.flatMap(({ foods }) => [
        ...foods.map(({ canonicalFoodKey }) => canonicalFoodKey),
        ...foods.flatMap(({ substitutes }) =>
          substitutes.map(({ canonicalFoodKey }) => canonicalFoodKey),
        ),
      ]),
    );

    expect(allKeys).not.toContain("food:oat-flakes");
    expect(allKeys).not.toContain("food:pasta");
    expect(allKeys).not.toContain("food:seitan");
  });

  it("adapta patrón vegano y conserva un plan completo con alternativas", () => {
    const plan = generateNutritionWeek({
      answers: { ...baseAnswers, dietaryPattern: "vegan" },
      catalog: effectiveNutritionFoods,
    });
    const used = new Set(
      plan.days.flatMap(({ meals }) =>
        meals.flatMap(({ foods }) => [
          ...foods.map(({ canonicalFoodKey }) => canonicalFoodKey),
          ...foods.flatMap(({ substitutes }) =>
            substitutes.map(({ canonicalFoodKey }) => canonicalFoodKey),
          ),
        ]),
      ),
    );

    expect(
      effectiveNutritionFoods
        .filter(({ canonicalFoodKey }) => used.has(canonicalFoodKey))
        .every(({ dietaryPatterns }) => dietaryPatterns.includes("vegan")),
    ).toBe(true);
  });

  it("excluye intolerancias graves y respeta la cantidad tolerada declarada", () => {
    const severe = generateNutritionWeek({
      answers: {
        ...baseAnswers,
        nutritionIntolerances: [
          { name: "Avena", severity: "severe" },
          { name: "Aceite de oliva", severity: "mild", toleratedAmount: "10 g" },
        ],
        nutritionIntolerancesStatus: "declared",
      },
      catalog: effectiveNutritionFoods,
    });
    const planned = severe.days.flatMap(({ meals }) =>
      meals.flatMap(({ foods }) =>
        foods.flatMap((food) => [food, ...food.substitutes]),
      ),
    );

    expect(planned.map(({ canonicalFoodKey }) => canonicalFoodKey)).not.toContain(
      "food:oat-flakes",
    );
    expect(
      planned
        .filter(({ canonicalFoodKey }) => canonicalFoodKey === "food:olive-oil")
        .every(({ amountG }) => Number(amountG) <= 10),
    ).toBe(true);
    expect(severe.validation.status).toBe("valid");
  });

  it("amplía la flexibilidad y añade estrategias ante ansiedad alimentaria", () => {
    const plan = generateNutritionWeek({
      answers: { ...baseAnswers, nutritionFoodAnxiety: "frequent" },
      catalog: effectiveNutritionFoods,
    });

    expect(plan.strategies).toEqual([
      "regular_meal_anchors",
      "protein_fiber_pairing",
      "planned_satiating_alternatives",
    ]);
    expect(
      plan.days.every(({ meals }) =>
        meals.every(({ flexibleWindowMinutes }) => flexibleWindowMinutes === 60),
      ),
    ).toBe(true);
  });

  it("una sustitución recalcula alimento, comida, día, semana y compra", () => {
    const original = generateNutritionWeek({
      answers: baseAnswers,
      catalog: effectiveNutritionFoods,
    });
    const first = original.days[0]!.meals[0]!.foods[0]!;
    const replacement = first.substitutes[0]!;
    const changed = applyNutritionSubstitution(original, {
      dayIndex: 0,
      foodIndex: 0,
      mealIndex: 0,
      substituteIndex: 0,
    });

    expect(changed.days[0]!.meals[0]!.foods[0]!.canonicalFoodKey).toBe(
      replacement.canonicalFoodKey,
    );
    expect(changed.days[0]!.meals[0]!.totals).not.toEqual(
      original.days[0]!.meals[0]!.totals,
    );
    expect(changed.days[0]!.totals).not.toEqual(original.days[0]!.totals);
    expect(changed.weekTotals).not.toEqual(original.weekTotals);
    expect(changed.shoppingList).not.toEqual(original.shoppingList);
  });

  it("cada sustituto ofrecido conserva válidas todas las bandas diarias", () => {
    const original = generateNutritionWeek({
      answers: baseAnswers,
      catalog: effectiveNutritionFoods,
    });

    for (const [dayIndex, day] of original.days.entries()) {
      for (const [mealIndex, meal] of day.meals.entries()) {
        for (const [foodIndex, food] of meal.foods.entries()) {
          for (const substituteIndex of food.substitutes.keys()) {
            const changed = applyNutritionSubstitution(original, {
              dayIndex,
              foodIndex,
              mealIndex,
              substituteIndex,
            });
            expect(changed.validation, `${dayIndex}/${mealIndex}/${foodIndex}`).toEqual(
              {
                errors: [],
                status: "valid",
                warnings: [],
              },
            );
          }
        }
      }
    }
  });

  it("simple y equilibrado son deterministas, diferentes y válidos", () => {
    const simple = generateNutritionWeek({
      answers: { ...baseAnswers, nutritionMode: "simple" },
      catalog: effectiveNutritionFoods,
    });
    const balanced = generateNutritionWeek({
      answers: { ...baseAnswers, nutritionMode: "balanced" },
      catalog: effectiveNutritionFoods,
    });

    expect(simple.validation.status).toBe("valid");
    expect(balanced.validation.status).toBe("valid");
    expect(simple.days).not.toEqual(balanced.days);
    expect(
      new Set(
        simple.days.flatMap(({ meals }) =>
          meals.flatMap(({ foods }) =>
            foods.map(({ canonicalFoodKey }) => canonicalFoodKey),
          ),
        ),
      ).size,
    ).toBeLessThan(
      new Set(
        balanced.days.flatMap(({ meals }) =>
          meals.flatMap(({ foods }) =>
            foods.map(({ canonicalFoodKey }) => canonicalFoodKey),
          ),
        ),
      ).size,
    );
  });
});
