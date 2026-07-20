import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  generateNutritionWeek,
  sha256CanonicalJson,
} from "../../packages/engine/src/index";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";

describe("contrato canónico del motor en navegador real", () => {
  it("coincide byte a byte con el vector de prueba de Node", async () => {
    const value = { b: 0.1, a: "Jose\u0301" };

    expect(canonicalJson(value)).toBe('{"a":"José","b":"0.1"}');
    await expect(sha256CanonicalJson(value)).resolves.toBe(
      "a44f7dce72420883053ef7a3b2f2a15bdd22153f94ce87943f3918bcc1909d14",
    );
  });

  it("genera la misma semana nutricional y el mismo hash que Node", async () => {
    const plan = generateNutritionWeek({
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

    expect(plan.validation.status).toBe("valid");
    await expect(sha256CanonicalJson(plan)).resolves.toBe(
      "2a1e03facc945234da0711874bcfda1a48d5303d8c7ce55c4d26fbc458a0fadb",
    );
  });
});
